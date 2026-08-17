import { z } from "zod";
import { renderResumeText, type PlatformResume, type ResumeEntry, type ResumeSectionType } from "@/lib/resume-format";

export const assistantNavigationSchema = z.object({
  href: z.enum(["/matches", "/jobs/new", "/pipeline", "/resumes", "/preferences", "/interviews", "/automation", "/profile", "/settings"]),
  label: z.string().min(1).max(80),
}).nullable();

export const assistantProjectDraftSchema = z.object({
  operation: z.enum(["add", "update"]),
  targetSectionId: z.union([z.string().uuid(), z.null()]),
  targetEntryId: z.union([z.string().uuid(), z.null()]),
  projectName: z.string().trim().min(2).max(200),
  role: z.string().trim().max(160),
  startDate: z.string().trim().max(60),
  endDate: z.string().trim().max(60),
  current: z.boolean(),
  url: z.union([z.literal(""), z.url()]),
  description: z.string().trim().min(8).max(2400),
  highlights: z.array(z.string().trim().min(3).max(500)).max(8),
  skills: z.array(z.string().trim().min(1).max(100)).max(24),
  sourceQuotes: z.array(z.string().trim().min(2).max(1200)).min(1).max(10),
});

export const assistantSkillDraftSchema = z.object({
  operation: z.enum(["add", "update"]),
  targetSectionId: z.union([z.string().uuid(), z.null()]),
  targetEntryId: z.union([z.string().uuid(), z.null()]),
  category: z.string().trim().min(1).max(160),
  skills: z.array(z.string().trim().min(1).max(100)).min(1).max(40),
  sourceQuotes: z.array(z.string().trim().min(1).max(1200)).min(1).max(10),
});

export const assistantResponseSchema = z.object({
  intent: z.enum(["guide", "resume_advice", "resume_project", "resume_sync", "needs_information", "out_of_scope"]),
  reply: z.string().trim().min(1).max(2400),
  navigation: assistantNavigationSchema,
  questions: z.array(z.string().trim().min(2).max(300)).max(6),
  projectDrafts: z.array(assistantProjectDraftSchema).max(3),
  skillDrafts: z.array(assistantSkillDraftSchema).max(5),
});

export type AssistantProjectDraft = z.infer<typeof assistantProjectDraftSchema>;
export type AssistantSkillDraft = z.infer<typeof assistantSkillDraftSchema>;
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;
export type AssistantChatMessage = {
  role: "user" | "assistant";
  content: string;
  intent?: AssistantResponse["intent"];
  awaitingReply?: boolean;
};

const contextualAssistantIntents = new Set<AssistantResponse["intent"]>([
  "resume_advice",
  "resume_project",
  "resume_sync",
]);

function explicitNonResumeWorkflow(message: string) {
  if (/简历|履历|resume|cv/i.test(message)) return false;
  return /岗位发现|岗位搜索|岗位匹配|添加岗位|新增岗位|职位搜索|申请进度|申请状态|看板|面试|求职偏好|岗位偏好|自动化|公司招聘页|岗位来源|通知|(?:api|模型|deepseek|openai)\s*(?:key|设置)?|job discovery|job search|job match|add (?:a )?job|application|pipeline|interview|preference|automation|career page|notification|settings/i.test(message);
}

function looksLikeContextualFollowUp(message: string) {
  const normalized = message.trim();
  if (!normalized) return false;
  if (/^(?:好|好的|可以|行|对|是|不是|不用|继续|那就|就按|按这个|这样|这个|那个|第一|第二|第三|上一|下一|同步吧|修改吧|开始吧|go ahead|yes|no|continue|do it|that|this|the (?:first|second|third)|sync it)\b/i.test(normalized)) return true;
  if (/^(?:那|那么|所以|不过|但是|另外|还有|其中|关于|对于|我说的是|我的意思是|具体|为什么|怎么|如何)/i.test(normalized)) return true;
  return normalized.length <= 120;
}

/**
 * Carries the active task through natural follow-ups before keyword routing.
 * Generic guides and refusals are intentionally not sticky.
 */
export function resolveAssistantActiveIntent(messages: AssistantChatMessage[], latestUserIndex: number) {
  const latestMessage = messages[latestUserIndex];
  if (!latestMessage || latestMessage.role !== "user") return undefined;

  const assistants = messages
    .slice(0, latestUserIndex)
    .filter((message) => message.role === "assistant")
    .reverse();
  const immediateAssistant = assistants[0];
  const priorTask = assistants.find((message) => message.intent && contextualAssistantIntents.has(message.intent));
  const inferredIntent = assistants.find((message) => /专业技能|技能类别|skill category|technical skills/i.test(message.content))
    ? "resume_advice" as const
    : assistants.find((message) => /中英文简历|简历同步|同步到.*(?:简历|resume)|resume sync/i.test(message.content))
      ? "resume_sync" as const
      : assistants.find((message) => /简历.*项目|项目.*简历|resume project|project.*resume/i.test(message.content))
        ? "resume_project" as const
        : undefined;
  const priorIntent = priorTask?.intent ?? inferredIntent;
  if (!priorIntent) return undefined;

  const latest = latestMessage.content;
  if (explicitNonResumeWorkflow(latest)) return undefined;
  if (isResumeSyncRequest(latest)) return "resume_sync" as const;
  // A clear new resume question overrides an older pending sync or edit task.
  // Otherwise a correction such as "I mean the layout" gets misread as sync input.
  const isClearAdviceQuestion = /建议|评价|评估|检查|问题|不足|优点|缺点|改进|怎么样|如何|怎么|看看|能看到|可以看到|看得到|看见|展现|展示|排版|版式|布局|样式|视觉|字体|字号|间距|标题层级|显示效果|我说的是|我的意思是|我要问|不是|不对|而是|advice|feedback|evaluate|improve|weakness|strength|how|review|look over|see (?:my )?resume|read (?:my )?resume|access (?:my )?resume|i mean|instead/i.test(latest);
  if (isResumeAdviceRequest(latest) && (!immediateAssistant?.awaitingReply || isClearAdviceQuestion)) return "resume_advice" as const;
  if (immediateAssistant?.awaitingReply || looksLikeContextualFollowUp(latest)) return priorIntent;
  return undefined;
}

const resumeSectionTypeSchema = z.enum(["experience_projects", "experience", "education", "skills", "projects", "certifications", "other"]);

export const assistantResumeSyncEntrySchema = z.object({
  organization: z.string().trim().max(300),
  position: z.string().trim().max(300),
  school: z.string().trim().max(300),
  degree: z.string().trim().max(300),
  fieldOfStudy: z.string().trim().max(300),
  projectName: z.string().trim().max(300),
  role: z.string().trim().max(300),
  name: z.string().trim().max(300),
  issuer: z.string().trim().max(300),
  category: z.string().trim().max(100),
  title: z.string().trim().max(300),
  subtitle: z.string().trim().max(300),
  location: z.string().trim().max(300),
  startDate: z.string().trim().max(80),
  endDate: z.string().trim().max(80),
  current: z.boolean(),
  date: z.string().trim().max(80),
  url: z.string().trim().max(1000),
  description: z.string().trim().max(4000),
  highlights: z.array(z.string().trim().min(1).max(800)).max(16),
  skills: z.array(z.string().trim().min(1).max(160)).max(40),
});

export const assistantResumeSyncDraftSchema = z.object({
  operation: z.enum(["add", "update"]),
  sourceSectionId: z.string().uuid(),
  sourceEntryId: z.string().uuid(),
  targetSectionId: z.union([z.string().uuid(), z.null()]),
  targetEntryId: z.union([z.string().uuid(), z.null()]),
  sectionType: resumeSectionTypeSchema,
  targetSectionTitle: z.string().trim().min(1).max(160),
  sourceLabel: z.string().trim().min(1).max(300),
  translatedEntry: assistantResumeSyncEntrySchema,
  sourceQuotes: z.array(z.string().trim().min(2).max(1200)).max(12).optional(),
});

export const assistantResumeSyncPlanSchema = z.object({
  reply: z.string().trim().min(1).max(2400),
  questions: z.array(z.string().trim().min(2).max(300)).max(6),
  items: z.array(z.object({
    operation: z.enum(["add", "update"]),
    sourceRef: z.string().regex(/^S\d+E\d+$/),
    targetSectionRef: z.union([z.string().regex(/^T\d+$/), z.null()]),
    targetEntryRef: z.union([z.string().regex(/^T\d+E\d+$/), z.null()]),
    sectionType: resumeSectionTypeSchema,
    targetSectionTitle: z.string().trim().min(1).max(160),
    sourceLabel: z.string().trim().min(1).max(300),
  })).max(20),
});

export const assistantResumeSyncDraftBatchSchema = z.object({
  translations: z.array(z.object({
    sourceRef: z.string().regex(/^S\d+E\d+$/),
    translatedEntry: assistantResumeSyncEntrySchema,
  })).max(3),
});

export type AssistantResumeSyncDraft = z.infer<typeof assistantResumeSyncDraftSchema>;
export type ResumeLanguage = "zh" | "en";

export function isResumeSyncRequest(message: string) {
  const mentionsResume = /简历|履历|resume|cv/i.test(message);
  const mentionsSync = /同步|合并|更新到|补到|迁移|sync|merge|copy.*(?:change|update)|bring.*(?:change|update)/i.test(message);
  const mentionsLanguages = /(中文|中文版|汉语|chinese)/i.test(message) && /(英文|英文版|英语|english)/i.test(message);
  return mentionsSync && mentionsLanguages && (mentionsResume || /中文版|英文版/i.test(message));
}

export function resumeSyncDirection(message: string): { source: ResumeLanguage; target: ResumeLanguage } | null {
  const normalized = message.toLowerCase();
  const zhIndex = normalized.search(/中文|中文版|汉语|chinese/);
  const enIndex = normalized.search(/英文|英文版|英语|english/);
  if (zhIndex < 0 || enIndex < 0) return null;
  return zhIndex < enIndex ? { source: "zh", target: "en" } : { source: "en", target: "zh" };
}

export function detectResumeLanguage(resume: PlatformResume): ResumeLanguage {
  const content = renderResumeText(resume);
  const chineseCount = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinCount = content.match(/[a-z]/gi)?.length ?? 0;
  return chineseCount >= 20 && chineseCount / Math.max(latinCount, 1) >= 0.08 ? "zh" : "en";
}

export function isCompatibleResumeSyncSection(sourceType: ResumeSectionType, targetType: ResumeSectionType, category = "") {
  if (sourceType === targetType) return true;
  if (sourceType === "experience_projects") {
    return category === "project" ? targetType === "projects" : targetType === "experience";
  }
  if (targetType === "experience_projects") return sourceType === "projects" || sourceType === "experience";
  return false;
}

const guideDestinations = [
  { href: "/jobs/new" as const, words: ["添加岗位", "新增岗位", "add job", "paste job", "job url"], zh: "你可以在“手动添加岗位”页面粘贴链接或 JD，保存后再进行匹配分析。", en: "Use Add job to paste a URL or job description, then run matching after it is saved." },
  { href: "/preferences" as const, words: ["偏好", "目标岗位", "薪资要求", "签证", "preferences", "target role", "salary", "visa"], zh: "岗位搜索偏好用于网络搜索、硬过滤和匹配；可以同时添加多个目标岗位。", en: "Job preferences drive web search, hard filters, and matching. You can add multiple target roles." },
  { href: "/pipeline" as const, words: ["申请进度", "申请状态", "看板", "pipeline", "application status", "board"], zh: "申请进度支持看板和列表两种视图，也可以添加自定义状态。", en: "The application pipeline supports board and list views, plus custom statuses." },
  { href: "/resumes" as const, words: ["简历", "resume", "cv"], zh: "简历工作室可以导入现有文件、在线新建、编辑模块、预览并导出不同版本。", en: "Resume Studio can import or create resumes, edit sections, preview layouts, and export versions." },
  { href: "/interviews" as const, words: ["面试", "interview"], zh: "面试中心用于保存面试安排、研究资料、问题和答案草稿。", en: "Interview Center stores schedules, research, questions, and answer drafts." },
  { href: "/automation" as const, words: ["岗位源", "自动搜索", "自动化", "source", "automation", "automatic search"], zh: "岗位来源与自动化页面管理公开 ATS、搜索计划、同步任务和有效性检查。", en: "Sources & automation manages public ATS connectors, search plans, sync tasks, and listing checks." },
  { href: "/profile" as const, words: ["个人档案", "用户画像", "ai画像", "profile", "candidate analysis"], zh: "个人档案汇总补充信息、AI 分析和用户确认的长期记忆。", en: "Profile contains additional context, AI analysis, and user-confirmed long-term memory." },
  { href: "/settings" as const, words: ["api key", "deepseek", "openai", "ai设置", "ai 设置", "模型", "settings"], zh: "在设置中选择 DeepSeek 或 OpenAI 并测试 API 连接；AI 关闭时基础功能仍然可用。", en: "Settings lets you select DeepSeek or OpenAI and test the API connection. Core tools work with AI off." },
  { href: "/matches" as const, words: ["岗位发现", "岗位匹配", "job discovery", "job match", "matches"], zh: "岗位发现集中显示自动找到和手动添加的岗位；加入申请进度后会从发现列表移出。", en: "Job discovery shows automatic and manual roles. A role leaves discovery after you add it to the pipeline." },
] as const;

export function isResumeAdviceRequest(message: string) {
  const mentionsResume = /简历|履历|resume|cv/i.test(message);
  const asksForAdvice = /建议|评价|评估|检查|问题|不足|优点|缺点|改进|调整|优化|怎么样|如何写|怎么写|应该|适合|保留|删除|修改|更新|改写|重写|润色|添加|增加|补充|翻译|比较|同步|生成|review|advice|feedback|evaluate|improve|weakness|strength|edit|update|rewrite|revise|polish|add|translate|compare|sync|generate|tailor|ats/i.test(message);
  const asksAboutPresentation = /展现|展示|排版|版式|布局|样式|视觉|字体|字号|间距|标题层级|看起来|显示效果|presentation|layout|formatting|style|visual|typography|spacing|appearance/i.test(message);
  const asksWhetherItIsVisible = /能看到|可以看到|看得到|看见|读取|读到|查看到|see (?:my )?resume|read (?:my )?resume|access (?:my )?resume/i.test(message);
  const asksForReview = /看看|看一下|帮我看|帮我检查|帮我读|take a look|look over|review/i.test(message);
  return (mentionsResume || asksAboutPresentation) && (asksForAdvice || asksAboutPresentation || asksWhetherItIsVisible || asksForReview);
}

export function isExplicitResumeMutationRequest(message: string) {
  const normalized = message.trim();
  const asksForChange = /添加|增加|补充|修改|调整|更改|更新|改写|重写|润色|优化|整理|重排|重构|同步|改得|改成|改为|add|create|write|edit|update|rewrite|revise|polish|improve|reorder|restructure|sync/i.test(normalized);
  const directAddress = /帮我|请你|请帮我|希望你|我想让你|(?:能不能|可以|能)帮我|直接|替我|为我|按你说|按照建议|那就|就按|please|help me|can you|could you|i want you to|directly|use your suggestion/i.test(normalized);
  const directImperative = /^(?:请\s*)?(?:把|将|添加|增加|补充|修改|调整|更改|更新|改写|重写|润色|优化|整理|重排|重构|同步|add|create|write|edit|update|rewrite|revise|polish|improve|reorder|restructure|sync)(?![a-z])/i.test(normalized);
  const politeImperative = /请(?:你|帮我)?(?:直接)?(?:把|将|添加|增加|补充|修改|调整|更改|更新|改写|重写|润色|优化|整理|重排|重构|同步)/i.test(normalized);
  if (!asksForChange || (!directAddress && !directImperative && !politeImperative)) return false;
  const asksForReview = /建议|看看|看一下|分析|评价|评估|反馈|哪里|哪些|什么|如何|怎么|能看到|可以看到|看得到|看见|吗[？?]?$|advice|review|feedback|evaluate|how|where|what|whether|can you see|read (?:my )?resume/i.test(normalized);
  const namesConcreteAction = /(?:帮我|请(?:你|帮我)?|希望你|我想让你|直接|please|help me|can you|could you|i want you to)\s*(?:直接\s*)?(?:把|将)\s*[^，。！？?]{0,80}(?:添加|增加|补充|修改|调整|更改|更新|改写|重写|润色|优化|整理|重排|重构|同步|改得|改成|改为)/i.test(normalized)
    || /(?:帮我|请(?:你|帮我)?|希望你|我想让你|直接|please|help me|can you|could you|i want you to)\s*(?:添加|增加|补充|修改|调整|更改|更新|改写|重写|润色|优化|整理|重排|重构|同步|改得|改成|改为)\s+(?:我的|简历中的|简历里|项目|技能|简介|工作经历|教育经历|my|the|this|that|a|an|in my|to my)/i.test(normalized);
  return !asksForReview || namesConcreteAction || directImperative || politeImperative;
}

export function isExplicitResumeStudioGuideRequest(message: string) {
  const normalized = message.toLowerCase();
  if (/(?:简历工作室|resume studio)/i.test(normalized)) {
    return /怎么|如何|哪里|在哪|入口|打开|前往|跳转|使用|导入|上传|新建|预览|导出|下载|how|where|open|navigate|use|import|upload|create|preview|export|download/i.test(normalized);
  }
  const mentionsResume = /简历|履历|resume|cv/i.test(normalized);
  const mentionsStudioOperation = /导入|上传|新建|预览|导出|下载|import|upload|create|preview|export|download/i.test(normalized);
  const asksForInstructions = /怎么|如何|哪里|在哪|入口|打开|前往|跳转|how|where|open|navigate/i.test(normalized);
  return mentionsResume && mentionsStudioOperation && asksForInstructions;
}

export function findAssistantGuide(message: string, locale: "zh" | "en") {
  const resumeStudioGuideRequest = isExplicitResumeStudioGuideRequest(message);
  if (isResumeSyncRequest(message) || (isResumeAdviceRequest(message) && !resumeStudioGuideRequest)) return null;
  const normalized = message.toLowerCase();
  const asksForNavigationOrInstructions = /怎么|如何|哪里|在哪|入口|打开|前往|跳转|设置|配置|添加|导入|查看|使用|how|where|open|navigate|set up|setup|configure|add|import|view|use/i.test(normalized);
  if (!asksForNavigationOrInstructions) return null;
  const match = guideDestinations.find((item) => item.words.some((word) => normalized.includes(word)));
  if (!match) return null;
  if (match.href === "/resumes" && !resumeStudioGuideRequest) return null;
  return {
    intent: "guide" as const,
    reply: locale === "zh" ? match.zh : match.en,
    navigation: { href: match.href, label: locale === "zh" ? "打开对应页面" : "Open this page" },
    questions: [],
    projectDrafts: [],
    skillDrafts: [],
  } satisfies AssistantResponse;
}

export function findOfflineAssistantGuide(message: string, locale: "zh" | "en", aiAvailable: boolean) {
  return aiAvailable ? null : findAssistantGuide(message, locale);
}

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function numericClaims(value: string) {
  return new Set(value.match(/\b\d+(?:[.,]\d+)*(?:%|k|m|b)?\b/gi) ?? []);
}

function resumeEntryEvidenceValues(entry: ResumeEntry) {
  return Object.entries(entry).flatMap(([key, value]) => {
    if (key === "id" || key === "kind" || key === "current") return [];
    if (typeof value === "string") return [value.trim()];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
    return [];
  }).filter((value) => value.length >= 2);
}

export function validateGroundedProjectDrafts(sourceConversation: string, drafts: AssistantProjectDraft[]) {
  const source = normalized(sourceConversation);
  const sourceNumbers = numericClaims(sourceConversation);
  for (const draft of drafts) {
    if (!draft.sourceQuotes.every((quote) => source.includes(normalized(quote)))) return { ok: false as const, error: "Project source quotes could not be verified against the user conversation." };
    const proposal = [draft.projectName, draft.role, draft.startDate, draft.endDate, draft.description, ...draft.highlights, ...draft.skills].join("\n");
    const unsupportedNumbers = [...numericClaims(proposal)].filter((number) => !sourceNumbers.has(number));
    if (unsupportedNumbers.length) return { ok: false as const, error: `Project draft introduced unsupported numeric claims: ${unsupportedNumbers.join(", ")}` };
  }
  return { ok: true as const };
}

export function validateProjectDraftTargets(
  drafts: AssistantProjectDraft[],
  sections: Array<{ id: string; type: string; entries?: Array<{ id: string }> }>,
) {
  for (const draft of drafts) {
    const section = draft.targetSectionId ? sections.find((item) => item.id === draft.targetSectionId) : undefined;
    if (draft.operation === "update") {
      if (!section || section.type !== "projects" || !draft.targetEntryId || !section.entries?.some((entry) => entry.id === draft.targetEntryId)) {
        return { ok: false as const, error: "The assistant edit no longer points to an existing project entry." };
      }
    } else if (draft.targetSectionId && (!section || section.type !== "projects")) {
      return { ok: false as const, error: "The assistant selected an incompatible resume section." };
    }
  }
  return { ok: true as const };
}

export function validateGroundedSkillDrafts(sourceConversation: string, drafts: AssistantSkillDraft[]) {
  const source = normalized(sourceConversation);
  for (const draft of drafts) {
    if (!draft.sourceQuotes.every((quote) => source.includes(normalized(quote)))) {
      return { ok: false as const, error: "Skill source quotes could not be verified against the user conversation or resume." };
    }
    if (!draft.skills.every((skill) => source.includes(normalized(skill)))) {
      return { ok: false as const, error: "Skill draft introduced a skill that was not present in the user conversation or resume." };
    }
  }
  return { ok: true as const };
}

export function validateSkillDraftTargets(
  drafts: AssistantSkillDraft[],
  sections: Array<{ id: string; type: string; entries?: Array<{ id: string }> }>,
) {
  for (const draft of drafts) {
    const section = draft.targetSectionId ? sections.find((item) => item.id === draft.targetSectionId) : undefined;
    if (draft.operation === "update") {
      if (!section || section.type !== "skills" || !draft.targetEntryId || !section.entries?.some((entry) => entry.id === draft.targetEntryId)) {
        return { ok: false as const, error: "The assistant skill edit no longer points to an existing skill category." };
      }
    } else if (draft.targetSectionId && (!section || section.type !== "skills")) {
      return { ok: false as const, error: "The assistant selected an incompatible resume section for the skill category." };
    }
  }
  return { ok: true as const };
}

export function validateResumeSyncDrafts(source: PlatformResume, target: PlatformResume, drafts: AssistantResumeSyncDraft[]) {
  for (const draft of drafts) {
    const sourceSection = source.sections.find((section) => section.id === draft.sourceSectionId);
    const sourceEntry = sourceSection?.entries?.find((entry) => entry.id === draft.sourceEntryId);
    if (!sourceSection || !sourceEntry || sourceSection.type !== draft.sectionType) {
      return { ok: false as const, error: "The sync draft no longer points to an existing source resume entry." };
    }
    const sourceEvidence = resumeEntryEvidenceValues(sourceEntry);
    if (!sourceEvidence.length) {
      return { ok: false as const, error: "The synchronized source entry has no verifiable content." };
    }
    const targetSection = draft.targetSectionId ? target.sections.find((section) => section.id === draft.targetSectionId) : undefined;
    if (targetSection && !isCompatibleResumeSyncSection(sourceSection.type, targetSection.type, sourceEntry.category)) {
      return { ok: false as const, error: "The sync draft selected an incompatible target section." };
    }
    const targetEntry = draft.targetEntryId ? targetSection?.entries?.find((entry) => entry.id === draft.targetEntryId) : undefined;
    if (draft.operation === "update") {
      if (!targetSection || !targetEntry) {
        return { ok: false as const, error: "The sync draft no longer points to an existing target resume entry." };
      }
    } else if (draft.targetEntryId) {
      return { ok: false as const, error: "A new synchronized entry cannot replace an existing target entry." };
    }
    const proposal = JSON.stringify(draft.translatedEntry);
    const allowedNumbers = numericClaims([
      ...sourceEvidence,
      ...(draft.operation === "update" && targetEntry ? resumeEntryEvidenceValues(targetEntry) : []),
    ].join("\n"));
    const unsupportedNumbers = [...numericClaims(proposal)].filter((number) => !allowedNumbers.has(number));
    if (unsupportedNumbers.length) {
      return { ok: false as const, error: `Resume sync introduced unsupported numeric claims: ${unsupportedNumbers.join(", ")}` };
    }
  }
  return { ok: true as const };
}
