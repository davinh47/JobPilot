"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { agentRuns, appSettings, experienceEvidence, resumes, resumeVersions } from "@/db/schema";
import { friendlyAgentError } from "@/lib/agent-errors";
import { selectAiModel } from "@/lib/ai-models";
import { requestStructuredAiJson } from "@/lib/ai-provider";
import { assistantProjectDraftSchema, assistantResponseSchema, assistantResumeSyncDraftBatchSchema, assistantResumeSyncDraftSchema, assistantResumeSyncPlanSchema, assistantSkillDraftSchema, detectResumeLanguage, findOfflineAssistantGuide, isCompatibleResumeSyncSection, isExplicitResumeMutationRequest, isResumeAdviceRequest, isResumeSyncRequest, resolveAssistantActiveIntent, resumeSyncDirection, validateGroundedProjectDrafts, validateGroundedSkillDrafts, validateProjectDraftTargets, validateResumeSyncDrafts, validateSkillDraftTargets, type AssistantChatMessage, type AssistantProjectDraft, type AssistantResponse, type AssistantResumeSyncDraft, type AssistantSkillDraft } from "@/lib/jobpilot-assistant";
import { createResumeEntry, isPlatformResume, normalizePlatformResume, renderResumeEntry, renderResumeText, type PlatformResume, type ResumeEntry } from "@/lib/resume-format";
import { queueSearchReindex } from "@/lib/background-queue";
import { aiLanguageInstruction } from "@/lib/i18n";
import { appendResumeVersionTx, ResumeVersionConflictError } from "@/lib/resume-versions";
import { hasAiProviderKey } from "@/lib/secrets";
import { assistantPromptMessages, loadAssistantContext, persistAssistantExchange, prepareAssistantTurn } from "@/lib/assistant-context";

const chatInputSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(5000),
    intent: assistantResponseSchema.shape.intent.optional(),
    awaitingReply: z.boolean().optional(),
  })).min(1).max(16),
  pathname: z.string().startsWith("/").max(500),
  locale: z.enum(["zh", "en"]),
});

function isProjectRequest(message: string) {
  return /项目|project/i.test(message) && /添加|增加|补充|写|润色|修改|调整|更新|改写|重写|优化|整理|重排|重构|add|create|write|polish|edit|update|rewrite|revise|improve|reorder|restructure/i.test(message);
}

function isProjectEditRequest(message: string) {
  return /修改|调整|更新|改写|重写|润色|优化|整理|重排|重构|edit|update|rewrite|revise|polish|improve|reorder|restructure/i.test(message);
}

function resumeIdFromPath(pathname: string) {
  return pathname.match(/^\/resumes\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? null;
}

function normalizedResumeReference(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s._()[\]{}·•:：/\\-]+/g, "");
}

function assistantResumeContext(content: unknown) {
  if (!isPlatformResume(content)) return { sections: [], sourceText: "", adviceContext: null };
  const normalized = normalizePlatformResume(content);
  const sections = normalized.sections.filter((section) => section.type === "projects" || section.type === "skills").map((section) => ({
    id: section.id,
    type: section.type,
    title: section.title,
    entries: (section.entries ?? []).map((entry) => ({
      id: entry.id,
      projectName: entry.projectName,
      category: entry.category,
      role: entry.role,
      startDate: entry.startDate,
      endDate: entry.endDate,
      current: entry.current,
      url: entry.url,
      description: entry.description,
      highlights: entry.highlights,
      skills: entry.skills,
    })),
  }));
  return {
    sections,
    sourceText: normalized.sections.filter((section) => section.type === "projects" || section.type === "skills").flatMap((section) => (section.entries ?? []).map(renderResumeEntry)).join("\n"),
    adviceContext: {
      basics: {
        headline: normalized.basics.headline,
        location: normalized.basics.location,
        additionalInfo: normalized.basics.additionalInfo,
      },
      summary: normalized.summary,
      sections: normalized.sections.map((section) => ({
        type: section.type,
        title: section.title,
        entries: section.entries,
      })),
    },
  };
}

function compactResumeSyncEntry(entry: ResumeEntry) {
  return Object.fromEntries(Object.entries(entry).filter(([key, value]) => {
    if (key === "id" || key === "kind") return false;
    return Array.isArray(value) ? value.length > 0 : typeof value === "boolean" ? value : Boolean(value);
  }));
}

function indexedResumeSyncContext(content: PlatformResume, prefix: "S" | "T") {
  const sectionsByRef = new Map<string, PlatformResume["sections"][number]>();
  const entriesByRef = new Map<string, { section: PlatformResume["sections"][number]; entry: ResumeEntry }>();
  const context = {
    basics: {
      headline: content.basics.headline,
      location: content.basics.location,
      additionalInfo: content.basics.additionalInfo,
    },
    summary: content.summary,
    sections: content.sections.map((section, sectionIndex) => {
      const sectionRef = `${prefix}${sectionIndex + 1}`;
      sectionsByRef.set(sectionRef, section);
      return {
        ref: sectionRef,
        type: section.type,
        title: section.title,
        entries: (section.entries ?? []).map((entry, entryIndex) => {
          const entryRef = `${sectionRef}E${entryIndex + 1}`;
          entriesByRef.set(entryRef, { section, entry });
          return { ref: entryRef, ...compactResumeSyncEntry(entry) };
        }),
      };
    }),
  };
  return { context, sectionsByRef, entriesByRef };
}

export async function askJobPilotAssistant(input: { messages: AssistantChatMessage[]; pathname: string; locale: "zh" | "en" }) {
  const checked = chatInputSchema.safeParse(input);
  if (!checked.success) return { ok: false as const, error: input.locale === "en" ? "That message could not be processed." : "这条消息无法处理，请缩短后重试。" };
  const latestClientUser = checked.data.messages.findLast((message) => message.role === "user");
  if (!latestClientUser) return { ok: false as const, error: checked.data.locale === "en" ? "Enter a message first." : "请先输入消息。" };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: checked.data.locale === "en" ? "The local workspace is not initialized." : "本地工作区尚未初始化。" };
  const [settings, resumeRows, storedContext] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get(),
    db.select().from(resumes).where(eq(resumes.userId, user.id)).orderBy(desc(resumes.isPrimary), desc(resumes.updatedAt)).all(),
    loadAssistantContext(user.id),
  ]);
  const turnContext = prepareAssistantTurn(storedContext, latestClientUser, checked.data.locale);
  const conversation = assistantPromptMessages(turnContext.messages);
  const latestUserIndex = conversation.findLastIndex((message) => message.role === "user");
  const latestUserMessage = latestClientUser.content;
  const routingConversation = conversation.map((message, index) => index === latestUserIndex ? { ...message, content: latestUserMessage } : message);
  const activeIntent = resolveAssistantActiveIntent(routingConversation, latestUserIndex);
  const recentUserText = [
    ...conversation
      .slice(Math.max(0, latestUserIndex - 5), latestUserIndex)
      .filter((message) => message.role === "user")
      .map((message) => message.content),
    latestUserMessage,
  ].join("\n");
  const directResumeMutation = isExplicitResumeMutationRequest(latestUserMessage);
  const explicitResumeSyncRequest = isResumeSyncRequest(latestUserMessage);
  const resumeAdviceRequest = !explicitResumeSyncRequest && (isResumeAdviceRequest(latestUserMessage) && !directResumeMutation)
    || (activeIntent === "resume_advice" && !directResumeMutation);
  const projectRequest = !explicitResumeSyncRequest && !resumeAdviceRequest
    && ((isProjectRequest(latestUserMessage) && directResumeMutation) || activeIntent === "resume_project");
  const resumeSyncRequest = explicitResumeSyncRequest || (activeIntent === "resume_sync" && !resumeAdviceRequest);
  const requestMode = resumeSyncRequest ? "resume_sync" : projectRequest ? "resume_project" : resumeAdviceRequest ? "resume_advice" : "conversation";
  const complete = async <T extends Record<string, unknown>>(response: AssistantResponse, extra: T) => {
    await persistAssistantExchange({ userId: user.id, state: turnContext, response, locale: checked.data.locale });
    return { ok: true as const, response, ...extra };
  };
  const aiAvailable = Boolean(settings?.aiEnabled && await hasAiProviderKey(settings.aiProvider, user.id));
  const guide = projectRequest || resumeAdviceRequest || resumeSyncRequest
    ? null
    : findOfflineAssistantGuide(latestUserMessage, checked.data.locale, aiAvailable);
  if (guide) return complete(guide, { aiUsed: false as const });
  const routeResumeId = resumeIdFromPath(checked.data.pathname);

  if (resumeSyncRequest) {
    if (!aiAvailable || !settings) {
      const response: AssistantResponse = {
        intent: "needs_information",
        reply: checked.data.locale === "en" ? "AI assistance must be enabled to compare and translate resume versions." : "跨语言比较和翻译简历需要先开启 AI 辅助。",
        navigation: { href: "/settings", label: checked.data.locale === "en" ? "Open AI settings" : "打开 AI 设置" },
        questions: [],
        projectDrafts: [],
        skillDrafts: [],
      };
      return complete(response, { aiUsed: false as const });
    }
    const direction = resumeSyncDirection(latestUserMessage) ?? resumeSyncDirection(recentUserText);
    const snapshots = (await Promise.all(resumeRows.map(async (resume) => {
      const version = await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
      if (!version || !isPlatformResume(version.structuredContentJson)) return null;
      const content = normalizePlatformResume(version.structuredContentJson as PlatformResume);
      return { resume, version, content, language: resume.language || detectResumeLanguage(content) };
    }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const normalizedReferenceText = normalizedResumeReference(recentUserText);
    const explicitlyNamed = (language: "zh" | "en") => snapshots
      .filter((item) => item.language === language)
      .sort((left, right) => right.resume.title.length - left.resume.title.length)
      .find((item) => {
        const title = normalizedResumeReference(item.resume.title);
        return title.length >= 4 && normalizedReferenceText.includes(title);
      });
    const source = direction
      ? explicitlyNamed(direction.source)
        ?? snapshots.find((item) => item.resume.id === routeResumeId && item.language === direction.source)
        ?? snapshots.find((item) => item.language === direction.source && item.resume.isPrimary)
        ?? snapshots.find((item) => item.language === direction.source)
      : undefined;
    const target = direction
      ? explicitlyNamed(direction.target)
        ?? snapshots.find((item) => item.resume.id === routeResumeId && item.language === direction.target)
        ?? snapshots.find((item) => item.language === direction.target && item.resume.resumeGroupId === source?.resume.resumeGroupId && item.resume.id !== source?.resume.id)
        ?? snapshots.find((item) => item.language === direction.target && item.resume.id !== source?.resume.id)
      : undefined;
    if (!direction || !source || !target) {
      const response: AssistantResponse = {
        intent: "resume_sync",
        reply: checked.data.locale === "en"
          ? "I could not confidently identify one Chinese resume and one English resume. Make sure both have editable JobPilot versions, then name the source and target resume."
          : "我还不能准确识别一份中文版和一份英文版简历。请确认两份简历都已有可编辑的平台版本，并告诉我源简历与目标简历的名称。",
        navigation: { href: "/resumes", label: checked.data.locale === "en" ? "Open Resume Studio" : "打开简历工作室" },
        questions: [checked.data.locale === "en" ? "Which resume is the source, and which one should be updated?" : "哪一份是源简历，哪一份需要接收更新？"],
        projectDrafts: [],
        skillDrafts: [],
      };
      return complete(response, { aiUsed: false as const });
    }
    const model = selectAiModel(settings, "complex");
    const run = await db.insert(agentRuns).values({
      userId: user.id,
      runType: "assistant",
      status: "running",
      entityType: "resume",
      entityId: target.resume.id,
      modelProvider: settings.aiProvider,
      modelName: model,
      promptVersion: "assistant-resume-sync-v4",
      inputRefsJson: [{ type: "source_resume_version", id: source.version.id }, { type: "target_resume_version", id: target.version.id }],
      startedAt: new Date(),
    }).returning().get();
    try {
      const sourceIndexed = indexedResumeSyncContext(source.content, "S");
      const targetIndexed = indexedResumeSyncContext(target.content, "T");
      const plan = await requestStructuredAiJson({
        userId: user.id,
        provider: settings.aiProvider,
        apiBaseUrl: settings.aiBaseUrl,
        model,
        system: `You are JobPilot's bilingual resume synchronization planner. Compare the latest SOURCE resume with the TARGET resume. Identify only source entries whose factual content is absent or meaningfully outdated in the target. Do not translate or rewrite entry content in this planning step.

Rules:
- SOURCE is authoritative for the proposed changes. Never invent employers, schools, projects, roles, dates, locations, metrics, technologies, achievements, URLs, or skills.
- Match entries semantically across languages. operation=update only when a corresponding target entry exists; copy its short target references exactly.
- operation=add only when the source entry has no corresponding target entry. Prefer an existing compatible target section. Set targetSectionRef to null only when no compatible section exists, and always set targetEntryRef to null.
- Copy the short references such as S1E2, T3, and T3E1 exactly. Never create a reference that is absent from the input.
- Use stable section types. An experience_projects entry with category=project may map to projects; one with category=experience may map to experience.
- Do not synchronize contact details. Do not remove target-only entries. If the resumes already contain the same facts, return no drafts.
- reply and questions must use ${checked.data.locale === "zh" ? "Chinese" : "English"}. targetSectionTitle must use the TARGET language.
- Return at most 20 concise plan items.`,
        user: `<EARLIER_CONVERSATION_SUMMARY>${turnContext.summary}</EARLIER_CONVERSATION_SUMMARY>\n<SOURCE_RESUME title="${source.resume.title}" version="${source.version.versionNumber}" language="${source.language}">${JSON.stringify(sourceIndexed.context)}</SOURCE_RESUME>\n<TARGET_RESUME title="${target.resume.title}" version="${target.version.versionNumber}" language="${target.language}">${JSON.stringify(targetIndexed.context)}</TARGET_RESUME>\n<USER_REQUEST>${latestUserMessage}</USER_REQUEST>\nRespond only with the structured synchronization plan.`,
        schema: assistantResumeSyncPlanSchema,
      });
      await db.update(agentRuns).set({ outputJson: { phase: "planned", itemCount: plan.items.length, items: plan.items }, updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
      const resolvedPlan = plan.items.map((item) => {
        const sourceLocation = sourceIndexed.entriesByRef.get(item.sourceRef);
        const targetSection = item.targetSectionRef ? targetIndexed.sectionsByRef.get(item.targetSectionRef) : undefined;
        const targetLocation = item.targetEntryRef ? targetIndexed.entriesByRef.get(item.targetEntryRef) : undefined;
        if (!sourceLocation) throw new Error(`Resume sync plan referenced missing source ${item.sourceRef}.`);
        if (item.targetEntryRef && targetLocation?.section.id !== targetSection?.id) throw new Error(`Resume sync plan returned inconsistent target references for ${item.sourceRef}.`);
        const sourceSection = sourceLocation.section;
        const sourceEntry = sourceLocation.entry;
        if (targetSection && !isCompatibleResumeSyncSection(sourceSection.type, targetSection.type, sourceEntry.category)) throw new Error("Resume sync plan selected an incompatible target section.");
        if (item.operation === "update" && (!targetSection || !targetLocation)) throw new Error("Resume sync plan referenced a missing target entry.");
        if (item.operation === "add" && item.targetEntryRef) throw new Error("Resume sync plan attempted to replace a target entry while adding.");
        return {
          sourceRef: item.sourceRef,
          sourceSection,
          sourceEntry,
          targetSection,
          targetEntry: targetLocation?.entry,
          draft: {
            operation: item.operation,
            sourceSectionId: sourceSection.id,
            sourceEntryId: sourceEntry.id,
            targetSectionId: targetSection?.id ?? null,
            targetEntryId: targetLocation?.entry.id ?? null,
            sectionType: sourceSection.type,
            targetSectionTitle: item.targetSectionTitle,
            sourceLabel: item.sourceLabel,
          },
        };
      });
      if (new Set(resolvedPlan.map((item) => item.sourceRef)).size !== resolvedPlan.length) throw new Error("Resume sync plan returned the same source entry more than once.");
      const drafts: AssistantResumeSyncDraft[] = [];
      for (let index = 0; index < resolvedPlan.length; index += 3) {
        const batch = resolvedPlan.slice(index, index + 3);
        const units = batch.map((item) => {
          return {
            sourceRef: item.sourceRef,
            plan: { operation: item.draft.operation, sectionType: item.draft.sectionType, targetSectionTitle: item.draft.targetSectionTitle, sourceLabel: item.draft.sourceLabel },
            source: { sectionTitle: item.sourceSection.title, entry: compactResumeSyncEntry(item.sourceEntry) },
            target: item.targetSection ? { sectionTitle: item.targetSection.title, entry: item.targetEntry ? compactResumeSyncEntry(item.targetEntry) : null } : null,
          };
        });
        const translated = await requestStructuredAiJson({
          userId: user.id,
          provider: settings.aiProvider,
          apiBaseUrl: settings.aiBaseUrl,
          model,
          system: `You are JobPilot's bilingual resume translator. Translate every supplied synchronization unit. Copy each short sourceRef exactly.

Rules:
- Translate the SOURCE entry into ${direction.target === "en" ? "professional resume English" : "professional resume Chinese"}.
- Never invent or infer facts. Preserve proper nouns, numbers, dates, URLs, technologies, and factual meaning.
- For update, return the complete merged target entry and preserve target-only facts unless they conflict with the source update.
- translatedEntry must include every schema field. Use empty strings or arrays for fields that do not apply. Keep current accurate.
- JobPilot derives evidence quotes directly from the selected SOURCE entry. Do not return evidence quotes.
- Return exactly one translation for every supplied unit and no others.`,
          user: `<SYNC_UNITS>${JSON.stringify(units)}</SYNC_UNITS>\nRespond only with the translated batch.`,
          schema: assistantResumeSyncDraftBatchSchema,
        });
        const translations = new Map(translated.translations.map((item) => [item.sourceRef, item]));
        if (translations.size !== batch.length || batch.some((item) => !translations.has(item.sourceRef))) {
          throw new Error("Resume sync translation did not preserve the comparison references.");
        }
        drafts.push(...batch.map((item) => {
          const translation = translations.get(item.sourceRef)!;
          return { ...item.draft, translatedEntry: translation.translatedEntry };
        }));
      }
      const validated = validateResumeSyncDrafts(source.content, target.content, drafts);
      if (!validated.ok) throw new Error(validated.error);
      const response: AssistantResponse = {
        intent: "resume_sync",
        reply: plan.reply,
        navigation: null,
        questions: plan.questions,
        projectDrafts: [],
        skillDrafts: [],
      };
      const sync = {
        sourceResume: { id: source.resume.id, title: source.resume.title, versionId: source.version.id, versionNumber: source.version.versionNumber, language: source.language },
        targetResume: { id: target.resume.id, title: target.resume.title, versionId: target.version.id, versionNumber: target.version.versionNumber, language: target.language },
        drafts,
      };
      await db.transaction(async (tx) => {
        await tx.update(agentRuns).set({
          status: "succeeded",
          outputJson: { intent: response.intent, draftCount: drafts.length, assistantResult: { response, sync } },
          finishedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(agentRuns.id, run.id)).run();
      });
      return complete(response, {
        aiUsed: true as const,
        runId: run.id,
        sync,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown resume sync error";
      await db.update(agentRuns).set({ status: "failed", errorCode: "ASSISTANT_RESUME_SYNC_ERROR", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
      return { ok: false as const, error: friendlyAgentError(message, checked.data.locale) };
    }
  }

  const targetResume = resumeRows.find((resume) => resume.id === routeResumeId) ?? resumeRows.find((resume) => resume.isPrimary) ?? resumeRows[0];
  const latestVersion = targetResume ? await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, targetResume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get() : undefined;
  const resumeContext = assistantResumeContext(latestVersion?.structuredContentJson);

  if ((projectRequest || resumeAdviceRequest) && !targetResume) {
    const response: AssistantResponse = {
      intent: "needs_information",
      reply: checked.data.locale === "en" ? "Create or import a resume first, then I can review it or prepare project entries." : "请先创建或导入一份简历，然后我就能阅读它并提供建议或整理项目条目。",
      navigation: { href: "/resumes", label: checked.data.locale === "en" ? "Open Resume Studio" : "打开简历工作室" },
      questions: [],
      projectDrafts: [],
      skillDrafts: [],
    };
    return complete(response, { aiUsed: false as const });
  }
  if (!aiAvailable || !settings) {
    const response: AssistantResponse = {
      intent: "needs_information",
      reply: checked.data.locale === "en" ? "AI assistance is off. I can still guide you around JobPilot, but drafting resume content requires an enabled model." : "AI 辅助当前已关闭。我仍然可以介绍和导航 JobPilot，但生成简历内容需要先开启模型。",
      navigation: { href: "/settings", label: checked.data.locale === "en" ? "Open AI settings" : "打开 AI 设置" },
      questions: [],
      projectDrafts: [],
      skillDrafts: [],
    };
    return complete(response, { aiUsed: false as const });
  }

  const model = selectAiModel(settings, "balanced");
  const run = await db.insert(agentRuns).values({
    userId: user.id,
    runType: "assistant",
    status: "running",
    entityType: targetResume ? "resume" : "workspace",
    entityId: targetResume?.id ?? user.id,
    modelProvider: settings.aiProvider,
    modelName: model,
    promptVersion: "jobpilot-assistant-v5-conversational-routing",
    inputRefsJson: targetResume ? [{ type: "resume", id: targetResume.id }] : [],
    startedAt: new Date(),
  }).returning().get();

  const authoritativeUserText = [
    ...conversation.filter((message, index) => message.role === "user" && index !== latestUserIndex).map((message) => message.content),
    latestUserMessage,
  ].join("\n");
  const authoritativeResumeEditText = [authoritativeUserText, resumeContext.sourceText].filter(Boolean).join("\n");
  try {
    const generatedResult = await requestStructuredAiJson({
      userId: user.id,
      provider: settings.aiProvider,
      apiBaseUrl: settings.aiBaseUrl,
      model,
      system: `You are JobPilot Assistant, a helpful and conversational interface inside a job-search application. You may: explain JobPilot, suggest one allowlisted page, ask questions needed for a JobPilot task, provide grounded resume feedback, and draft confirmed project or skill edits. Refuse unrelated general conversation briefly. Never claim that you already changed data. Never submit applications or send messages.

Conversation behavior:
- Interpret context in this order: EARLIER_CONVERSATION_SUMMARY, the token-bounded recent CONVERSATION, CURRENT_PAGE and RESUME context, then the latest user wording.
- The latest explicit question or correction takes priority over an older pending workflow. Never force a new question into resume synchronization just because the previous assistant message was waiting for sync details.
- Treat the latest user message as the request to answer now. Older conversation is context, not a command that must be completed.
- The server-selected REQUEST_MODE is a routing hint. In resume_advice or conversation mode, answer the user's question conversationally and do not invent an operation. In resume_project mode, discuss a possible grounded edit and wait for confirmation. In resume_sync mode, discuss only the explicitly requested language synchronization.
- Before matching keywords, decide whether the latest message continues, corrects, confirms, or supplies information for the active task.
- Treat a short latest message as a likely continuation or answer to the assistant's preceding response, even when that response did not end with a question.
- Continue the active JobPilot task when the latest message is genuinely contextual. Switch tasks immediately when the user asks a new question about resume content, presentation, layout, readability, or what the assistant can see.
- A resume title, company name, project name, job title, location, or yes/no response may be task input rather than a new request.
- Be conversational and specific. Acknowledge what the user means, answer the question first, and ask at most one focused follow-up only when it is genuinely needed. Do not repeat a generic JobPilot feature description.
- Do not recite JobPilot features unless the user explicitly asks what a feature does or how to navigate to it.
- Use natural conversational Chinese or English, matching the requested language. Avoid bureaucratic phrases such as “经逐项对比”“目标简历已包含源简历全部事实内容” unless the user explicitly asked for a synchronization report.

For resume feedback and edits:
- Read RESUME_CONTENT and answer questions about clarity, structure, relevance, evidence, ATS readability, strengths, gaps, and possible improvements.
- Presentation questions include layout, hierarchy, typography, spacing, section alignment, visual rhythm, preview appearance, and whether you can see the supplied resume. Answer these directly from RESUME_CONTENT and the current page context; do not ask for source and target resumes.
- When asked whether you can see the resume, explain accurately that you can read the structured editable resume content and fields supplied here, but cannot see the user's screen or rendered visual preview unless it is provided. Still answer what can be assessed from the available content.
- Tie advice to specific content that is actually present. Clearly distinguish observations from optional suggestions.
- You may suggest wording or what information the user should add, but never invent experience, skills, employers, dates, metrics, or achievements.
- If a target role or job description is needed for tailored advice and none was provided, ask for it; for a general review, give useful observations from the resume before asking anything.
- Advice alone must not create projectDrafts or skillDrafts or claim to edit the resume.

Workflow boundaries:
- Use resume_sync only when the latest request explicitly asks to compare, translate, merge, or synchronize one language version into another.
- Use resume_project or skill drafts only when the latest request explicitly asks to add or change resume data. A request for advice, explanation, or review must return a normal conversational answer with no drafts.

Resume drafts may only restate facts in role=user messages or the existing resume entries supplied in RESUME_STRUCTURE. Never infer technologies, dates, roles, metrics, employers, outcomes, URLs, or skills. Every sourceQuotes item must be an exact contiguous quote from one of those authoritative sources. Assistant messages and page routing are not authoritative facts.

For each projectDraft:
- Use operation=update when the user asks to modify, polish, rewrite, or add information to an existing project. Copy the exact targetSectionId and targetEntryId from RESUME_STRUCTURE and return the complete updated entry, preserving existing facts the user did not ask to remove, including the current flag.
- Use operation=add only when the user clearly asks to add a genuinely new project. Point targetSectionId to an existing section whose type is projects when available and set targetEntryId to null.
- Never create or propose a new resume section. Section titles are user-customizable; map by the stable type and IDs, not by guessing from the displayed title.
- If an edit target is ambiguous or absent, return no projectDrafts and ask which existing project should be changed.

For each skillDraft:
- Use operation=update when adding skills to an existing category. Copy its exact skills section ID and entry ID, return the complete category, and preserve existing skills.
- Use operation=add only when the user requests a genuinely new skill category. Point targetSectionId to an existing section whose type is skills and set targetEntryId to null.
- Read the skills entries and their IDs from RESUME_STRUCTURE. Never ask the user for an internal section or entry ID.
- Include only skills explicitly present in the user's messages or existing resume. Never infer adjacent tools or capabilities.
- Never create a new resume section; when no skills section exists, return targetSectionId=null and JobPilot will create the standard section after confirmation.

If facts are insufficient, return no drafts and ask short targeted questions. ${aiLanguageInstruction(checked.data.locale)}`,
      user: `<CURRENT_PAGE>${checked.data.pathname}</CURRENT_PAGE>\n<REQUEST_MODE>${requestMode}</REQUEST_MODE>\n<EARLIER_CONVERSATION_SUMMARY>${turnContext.summary}</EARLIER_CONVERSATION_SUMMARY>\n<RESUME>${JSON.stringify(targetResume ? { id: targetResume.id, title: targetResume.title } : null)}</RESUME>\n<RESUME_CONTENT>${JSON.stringify(resumeContext.adviceContext)}</RESUME_CONTENT>\n<RESUME_STRUCTURE>${JSON.stringify(resumeContext.sections)}</RESUME_STRUCTURE>\n<CONVERSATION>${JSON.stringify(conversation)}</CONVERSATION>\nRespond only with the requested structured assistant result.`,
      schema: assistantResponseSchema,
    });
    const result: AssistantResponse = resumeAdviceRequest && !directResumeMutation
      ? { ...generatedResult, intent: "resume_advice", projectDrafts: [], skillDrafts: [] }
      : generatedResult;
    const grounded = validateGroundedProjectDrafts(authoritativeResumeEditText, result.projectDrafts);
    if (!grounded.ok) throw new Error(grounded.error);
    const groundedSkills = validateGroundedSkillDrafts(authoritativeResumeEditText, result.skillDrafts);
    if (!groundedSkills.ok) throw new Error(groundedSkills.error);
    const targets = validateProjectDraftTargets(result.projectDrafts, resumeContext.sections);
    if (!targets.ok) throw new Error(targets.error);
    const skillTargets = validateSkillDraftTargets(result.skillDrafts, resumeContext.sections);
    if (!skillTargets.ok) throw new Error(skillTargets.error);
    const rejectedEditAsAdd = isProjectEditRequest(latestUserMessage) && result.projectDrafts.some((draft) => draft.operation === "add");
    const response: AssistantResponse = rejectedEditAsAdd ? {
      ...result,
      intent: "resume_project",
      reply: rejectedEditAsAdd ? (checked.data.locale === "en" ? "I could not confidently identify the existing project to update. Please name the project as it appears in your resume." : "我还不能准确定位要修改的已有项目。请告诉我它在简历中的项目名称。") : result.reply,
      questions: rejectedEditAsAdd ? [checked.data.locale === "en" ? "Which existing project should I update?" : "你希望修改哪一个已有项目？"] : result.questions,
      projectDrafts: [],
      skillDrafts: [],
    } : {
      ...result,
      intent: result.intent === "needs_information"
        ? projectRequest ? "resume_project" : resumeAdviceRequest ? "resume_advice" : result.intent
        : result.intent,
    };
    const resume = targetResume && latestVersion ? { id: targetResume.id, title: targetResume.title, versionId: latestVersion.id } : null;
    await db.transaction(async (tx) => {
      await tx.update(agentRuns).set({
        status: "succeeded",
        outputJson: {
          intent: response.intent,
          draftCount: response.projectDrafts.length + response.skillDrafts.length,
          assistantResult: { response, resume },
        },
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id)).run();
    });
    return complete(response, { aiUsed: true as const, runId: run.id, resume });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown assistant error";
    await db.update(agentRuns).set({ status: "failed", errorCode: "ASSISTANT_ERROR", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
    return { ok: false as const, error: friendlyAgentError(message, checked.data.locale) };
  }
}

const applyResumeEditsSchema = z.object({
  resumeId: z.string().uuid(),
  expectedVersionId: z.string().uuid(),
  locale: z.enum(["zh", "en"]),
  projectDrafts: z.array(assistantProjectDraftSchema).max(3),
  skillDrafts: z.array(assistantSkillDraftSchema).max(5),
}).refine((value) => value.projectDrafts.length + value.skillDrafts.length > 0);

export async function applyAssistantResumeEdits(input: { resumeId: string; expectedVersionId: string; locale: "zh" | "en"; projectDrafts: AssistantProjectDraft[]; skillDrafts: AssistantSkillDraft[] }) {
  const checked = applyResumeEditsSchema.safeParse(input);
  if (!checked.success) return { ok: false as const, error: input.locale === "en" ? "The resume edit draft is invalid." : "简历修改草稿格式无效。" };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: checked.data.locale === "en" ? "Sign in first." : "请先登录。" };
  const resume = await db.select().from(resumes).where(and(eq(resumes.id, checked.data.resumeId), eq(resumes.userId, user.id))).get();
  if (!resume) return { ok: false as const, error: checked.data.locale === "en" ? "Resume not found." : "找不到这份简历。" };
  const latest = await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
  if (!latest || !isPlatformResume(latest.structuredContentJson)) return { ok: false as const, error: checked.data.locale === "en" ? "The latest resume version is not editable." : "最新简历版本无法结构化编辑。" };
  if (latest.id !== checked.data.expectedVersionId) return { ok: false as const, error: checked.data.locale === "en" ? "The resume changed after this draft was generated. Ask the assistant to read it again." : "草稿生成后简历已发生变化，请让助手重新读取后再应用。" };

  const content = normalizePlatformResume(latest.structuredContentJson as PlatformResume);
  const targets = validateProjectDraftTargets(checked.data.projectDrafts, content.sections);
  if (!targets.ok) return { ok: false as const, error: checked.data.locale === "en" ? targets.error : "要修改的项目已不存在或位置已经变化，请让助手重新读取简历。" };
  const skillTargets = validateSkillDraftTargets(checked.data.skillDrafts, content.sections);
  if (!skillTargets.ok) return { ok: false as const, error: checked.data.locale === "en" ? skillTargets.error : "要修改的技能类别已不存在或位置已经变化，请让助手重新读取简历。" };
  const existingNames = new Set(content.sections.filter((section) => section.type === "projects").flatMap((section) => (section.entries ?? []).map((entry) => entry.projectName.trim().toLowerCase())));
  const acceptedProjects = checked.data.projectDrafts.filter((draft) => draft.operation === "update" || !existingNames.has(draft.projectName.trim().toLowerCase()));
  const existingSkillCategories = content.sections.flatMap((section) => section.type === "skills"
    ? (section.entries ?? []).map((entry) => ({ section, entry }))
    : []);
  const acceptedSkills = checked.data.skillDrafts.map((draft) => {
    if (draft.operation === "update") return draft;
    const existing = existingSkillCategories.find(({ entry }) => entry.category.trim().toLowerCase() === draft.category.trim().toLowerCase());
    return existing ? {
      ...draft,
      operation: "update" as const,
      targetSectionId: existing.section.id,
      targetEntryId: existing.entry.id,
      skills: [...new Set([...existing.entry.skills, ...draft.skills])],
    } : draft;
  });
  if (!acceptedProjects.length && !acceptedSkills.length) return { ok: false as const, error: checked.data.locale === "en" ? "These resume changes are already present." : "这些简历修改已经存在。" };

  const sections = content.sections.map((section) => ({ ...section, entries: section.entries?.map((entry) => ({ ...entry })) }));
  const entryFromDraft = (draft: AssistantProjectDraft, id: string) => ({
    ...createResumeEntry("projects"),
    id,
    projectName: draft.projectName,
    role: draft.role,
    startDate: draft.startDate,
    endDate: draft.endDate,
    current: draft.current,
    url: draft.url,
    description: draft.description,
    highlights: draft.highlights,
    skills: draft.skills,
  });
  for (const draft of acceptedProjects) {
    if (draft.operation === "update") {
      const sectionIndex = sections.findIndex((section) => section.id === draft.targetSectionId);
      if (sectionIndex < 0 || !draft.targetEntryId) continue;
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        entries: (sections[sectionIndex].entries ?? []).map((entry) => entry.id === draft.targetEntryId ? { ...entry, ...entryFromDraft(draft, entry.id) } : entry),
      };
      continue;
    }
    let sectionIndex = draft.targetSectionId ? sections.findIndex((section) => section.id === draft.targetSectionId && section.type === "projects") : -1;
    if (sectionIndex < 0) sectionIndex = sections.findIndex((section) => section.type === "projects");
    const newEntry = entryFromDraft(draft, randomUUID());
    if (sectionIndex >= 0) sections[sectionIndex] = { ...sections[sectionIndex], entries: [...(sections[sectionIndex].entries ?? []), newEntry] };
    else sections.push({ id: randomUUID(), type: "projects", title: checked.data.locale === "zh" ? "项目经历" : "Projects", content: "", entries: [newEntry] });
  }
  for (const draft of acceptedSkills) {
    if (draft.operation === "update") {
      const sectionIndex = sections.findIndex((section) => section.id === draft.targetSectionId);
      if (sectionIndex < 0 || !draft.targetEntryId) continue;
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        entries: (sections[sectionIndex].entries ?? []).map((entry) => entry.id === draft.targetEntryId ? {
          ...entry,
          category: draft.category,
          skills: [...new Set(draft.skills)],
        } : entry),
      };
      continue;
    }
    let sectionIndex = draft.targetSectionId ? sections.findIndex((section) => section.id === draft.targetSectionId && section.type === "skills") : -1;
    if (sectionIndex < 0) sectionIndex = sections.findIndex((section) => section.type === "skills");
    const existingEntry = sections.flatMap((section, index) => section.type === "skills"
      ? (section.entries ?? []).map((entry) => ({ sectionIndex: index, entry }))
      : []).find(({ entry }) => entry.category.trim().toLowerCase() === draft.category.trim().toLowerCase());
    if (existingEntry) {
      sections[existingEntry.sectionIndex] = {
        ...sections[existingEntry.sectionIndex],
        entries: (sections[existingEntry.sectionIndex].entries ?? []).map((entry) => entry.id === existingEntry.entry.id ? {
          ...entry,
          skills: [...new Set([...entry.skills, ...draft.skills])],
        } : entry),
      };
      continue;
    }
    const newEntry = { ...createResumeEntry("skills"), id: randomUUID(), category: draft.category, skills: [...new Set(draft.skills)] };
    if (sectionIndex >= 0) sections[sectionIndex] = { ...sections[sectionIndex], entries: [...(sections[sectionIndex].entries ?? []), newEntry] };
    else sections.push({ id: randomUUID(), type: "skills", title: checked.data.locale === "zh" ? "专业技能" : "Skills", content: "", entries: [newEntry] });
  }
  const updatedContent = normalizePlatformResume({ ...content, sections });
  const allDrafts = [...acceptedProjects, ...acceptedSkills];
  const addedCount = allDrafts.filter((draft) => draft.operation === "add").length;
  const updatedCount = allDrafts.filter((draft) => draft.operation === "update").length;
  const changedNames = [...acceptedProjects.map((draft) => draft.projectName), ...acceptedSkills.map((draft) => draft.category)].join(checked.data.locale === "zh" ? "、" : ", ");

  const version = await db.transaction(async (tx) => {
    const created = await appendResumeVersionTx(tx, {
      resumeId: resume.id,
      expectedVersionId: checked.data.expectedVersionId,
      versionType: latest.versionType === "tailored" ? "tailored" : "manual_edit",
      title: latest.title,
      structuredContentJson: updatedContent,
      renderedText: renderResumeText(updatedContent),
      changeSummary: checked.data.locale === "zh" ? `通过 JobPilot 助手更新简历：${changedNames}` : `Updated resume through JobPilot Assistant: ${changedNames}`,
      factCheckStatus: "needs_review",
      createdBy: "ai",
    });
    await tx.insert(experienceEvidence).values([
      ...acceptedProjects.map((draft) => ({
      userId: resume.userId,
      resumeId: resume.id,
      evidenceType: "project" as const,
      title: draft.projectName,
      organization: draft.role || null,
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      description: [draft.description, ...draft.highlights].filter(Boolean).join("\n"),
      factsJson: { operation: draft.operation, skills: draft.skills, sourceQuotes: draft.sourceQuotes, resumeVersionId: created.id },
      sourceLocator: `assistant_confirmation:${created.id}`,
      userConfirmed: true,
      })),
      ...acceptedSkills.map((draft) => ({
        userId: resume.userId,
        resumeId: resume.id,
        evidenceType: "skill" as const,
        title: draft.category,
        organization: null,
        startDate: null,
        endDate: null,
        description: draft.skills.join(", "),
        factsJson: { operation: draft.operation, skills: draft.skills, sourceQuotes: draft.sourceQuotes, resumeVersionId: created.id },
        sourceLocator: `assistant_confirmation:${created.id}`,
        userConfirmed: true,
      })),
    ]).run();
    return created;
  }).catch((error) => {
    if (error instanceof ResumeVersionConflictError) return null;
    throw error;
  });
  if (!version) return { ok: false as const, error: checked.data.locale === "en" ? "A newer resume version appeared. The older assistant draft was not applied." : "检测到更新的简历版本，较旧的助手草稿未应用。" };
  await queueSearchReindex(resume.userId);
  revalidatePath("/resumes");
  revalidatePath(`/resumes/${resume.id}/edit`);
  revalidatePath(`/resumes/${resume.id}/preview`);
  revalidatePath("/profile");
  return { ok: true as const, versionNumber: version.versionNumber, addedCount, updatedCount, href: `/resumes/${resume.id}/edit?assistant=1` };
}

const applyResumeSyncSchema = z.object({
  sourceResumeId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  targetResumeId: z.string().uuid(),
  targetVersionId: z.string().uuid(),
  locale: z.enum(["zh", "en"]),
  drafts: z.array(assistantResumeSyncDraftSchema).min(1).max(20),
});

export async function applyAssistantResumeSync(input: {
  sourceResumeId: string;
  sourceVersionId: string;
  targetResumeId: string;
  targetVersionId: string;
  locale: "zh" | "en";
  drafts: AssistantResumeSyncDraft[];
}) {
  const checked = applyResumeSyncSchema.safeParse(input);
  if (!checked.success) return { ok: false as const, error: input.locale === "en" ? "The resume synchronization draft is invalid." : "简历同步草稿格式无效。" };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: checked.data.locale === "en" ? "Sign in first." : "请先登录。" };
  const [sourceResume, targetResume] = await Promise.all([
    db.select().from(resumes).where(and(eq(resumes.id, checked.data.sourceResumeId), eq(resumes.userId, user.id))).get(),
    db.select().from(resumes).where(and(eq(resumes.id, checked.data.targetResumeId), eq(resumes.userId, user.id))).get(),
  ]);
  if (!sourceResume || !targetResume || sourceResume.userId !== targetResume.userId) {
    return { ok: false as const, error: checked.data.locale === "en" ? "The source or target resume could not be found." : "找不到源简历或目标简历。" };
  }
  const [sourceLatest, targetLatest] = await Promise.all([
    db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, sourceResume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get(),
    db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, targetResume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get(),
  ]);
  if (!sourceLatest || !targetLatest || sourceLatest.id !== checked.data.sourceVersionId || targetLatest.id !== checked.data.targetVersionId) {
    return { ok: false as const, error: checked.data.locale === "en" ? "One of the resumes changed after this comparison. Ask the assistant to compare them again." : "比较完成后其中一份简历已经发生变化，请让助手重新比较后再同步。" };
  }
  if (!isPlatformResume(sourceLatest.structuredContentJson) || !isPlatformResume(targetLatest.structuredContentJson)) {
    return { ok: false as const, error: checked.data.locale === "en" ? "Both resumes need editable JobPilot versions." : "两份简历都需要有可编辑的平台版本。" };
  }
  const sourceContent = normalizePlatformResume(sourceLatest.structuredContentJson as PlatformResume);
  const targetContent = normalizePlatformResume(targetLatest.structuredContentJson as PlatformResume);
  const validated = validateResumeSyncDrafts(sourceContent, targetContent, checked.data.drafts);
  if (!validated.ok) return { ok: false as const, error: checked.data.locale === "en" ? validated.error : "同步草稿引用的内容或位置已经变化，请重新比较。" };

  const sections = targetContent.sections.map((section) => ({ ...section, entries: section.entries?.map((entry) => ({ ...entry })) }));
  const translatedEntry = (draft: AssistantResumeSyncDraft, type: PlatformResume["sections"][number]["type"], id: string) => ({
    ...createResumeEntry(type),
    ...draft.translatedEntry,
    id,
    kind: type,
  });
  for (const draft of checked.data.drafts) {
    const sourceSection = sourceContent.sections.find((section) => section.id === draft.sourceSectionId);
    const sourceEntry = sourceSection?.entries?.find((entry) => entry.id === draft.sourceEntryId);
    if (!sourceSection || !sourceEntry) continue;
    let sectionIndex = draft.targetSectionId ? sections.findIndex((section) => section.id === draft.targetSectionId) : -1;
    if (sectionIndex < 0 && draft.operation === "add") {
      sectionIndex = sections.findIndex((section) => isCompatibleResumeSyncSection(sourceSection.type, section.type, sourceEntry.category));
    }
    if (draft.operation === "update") {
      if (sectionIndex < 0 || !draft.targetEntryId) continue;
      const section = sections[sectionIndex];
      sections[sectionIndex] = {
        ...section,
        entries: (section.entries ?? []).map((entry) => entry.id === draft.targetEntryId ? translatedEntry(draft, section.type, entry.id) : entry),
      };
      continue;
    }
    if (sectionIndex < 0) {
      sections.push({
        id: randomUUID(),
        type: draft.sectionType,
        title: draft.targetSectionTitle,
        content: "",
        entries: [translatedEntry(draft, draft.sectionType, randomUUID())],
      });
      continue;
    }
    const section = sections[sectionIndex];
    sections[sectionIndex] = {
      ...section,
      entries: [...(section.entries ?? []), translatedEntry(draft, section.type, randomUUID())],
    };
  }
  const updatedContent = normalizePlatformResume({ ...targetContent, sections });
  const addedCount = checked.data.drafts.filter((draft) => draft.operation === "add").length;
  const updatedCount = checked.data.drafts.filter((draft) => draft.operation === "update").length;
  const version = await db.transaction(async (tx) => {
    const currentSource = await tx.select({ currentVersionId: resumes.currentVersionId }).from(resumes).where(eq(resumes.id, sourceResume.id)).get();
    if (currentSource?.currentVersionId !== checked.data.sourceVersionId) throw new ResumeVersionConflictError();
    const created = await appendResumeVersionTx(tx, {
      resumeId: targetResume.id,
      expectedVersionId: checked.data.targetVersionId,
      versionType: targetLatest.versionType === "tailored" ? "tailored" : "manual_edit",
      title: targetLatest.title,
      structuredContentJson: updatedContent,
      renderedText: renderResumeText(updatedContent),
      changeSummary: checked.data.locale === "zh"
        ? `通过 JobPilot 助手从“${sourceResume.title}”同步 ${checked.data.drafts.length} 项内容`
        : `Synchronized ${checked.data.drafts.length} item${checked.data.drafts.length === 1 ? "" : "s"} from “${sourceResume.title}” through JobPilot Assistant`,
      factCheckStatus: "needs_review",
      createdBy: "ai",
    });
    return created;
  }).catch((error) => {
    if (error instanceof ResumeVersionConflictError) return null;
    throw error;
  });
  if (!version) return { ok: false as const, error: checked.data.locale === "en" ? "One of the resumes changed during synchronization. The stale result was not applied." : "同步期间其中一份简历已更新，较旧结果未应用。" };
  await queueSearchReindex(targetResume.userId);
  revalidatePath("/resumes");
  revalidatePath(`/resumes/${targetResume.id}/edit`);
  revalidatePath(`/resumes/${targetResume.id}/preview`);
  revalidatePath("/profile");
  return {
    ok: true as const,
    versionNumber: version.versionNumber,
    addedCount,
    updatedCount,
    href: `/resumes/${targetResume.id}/edit?assistantSync=1`,
  };
}
