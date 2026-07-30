import assert from "node:assert/strict";
import test from "node:test";
import { assistantResponseSchema, assistantResumeSyncEntrySchema, detectResumeLanguage, findAssistantGuide, findOfflineAssistantGuide, isExplicitResumeStudioGuideRequest, isResumeAdviceRequest, isResumeSyncRequest, resolveAssistantActiveIntent, resumeSyncDirection, validateGroundedProjectDrafts, validateGroundedSkillDrafts, validateProjectDraftTargets, validateResumeSyncDrafts, validateSkillDraftTargets, type AssistantChatMessage, type AssistantProjectDraft, type AssistantResumeSyncDraft, type AssistantSkillDraft } from "@/lib/jobpilot-assistant";
import { createResumeEntry, type PlatformResume } from "@/lib/resume-format";

const groundedDraft: AssistantProjectDraft = {
  operation: "add",
  targetSectionId: null,
  targetEntryId: null,
  projectName: "Sales Dashboard",
  role: "Data analyst",
  startDate: "2025",
  endDate: "",
  current: false,
  url: "",
  description: "Built a sales dashboard from weekly order data.",
  highlights: ["Reduced weekly reporting time by 4 hours."],
  skills: ["SQL", "Power BI"],
  sourceQuotes: ["I built a Sales Dashboard with SQL and Power BI in 2025", "reduced weekly reporting time by 4 hours"],
};

test("answers common JobPilot guidance without requiring a model", () => {
  const result = findAssistantGuide("OpenAI API Key 要在哪里设置？", "zh");
  assert.equal(result?.navigation?.href, "/settings");
  assert.equal(result?.intent, "guide");
});

test("fixed guides are used only when no configured AI is available", () => {
  assert.equal(findOfflineAssistantGuide("OpenAI API Key 要在哪里设置？", "zh", false)?.navigation?.href, "/settings");
  assert.equal(findOfflineAssistantGuide("OpenAI API Key 要在哪里设置？", "zh", true), null);
});

test("routes resume feedback questions to the AI instead of the fixed Resume Studio guide", () => {
  assert.equal(isResumeAdviceRequest("你觉得我的简历有哪些问题和改进建议？"), true);
  assert.equal(findAssistantGuide("你觉得我的简历有哪些问题和改进建议？", "zh"), null);
  assert.equal(assistantResponseSchema.safeParse({
    intent: "resume_advice",
    reply: "项目经历有清晰技术栈，但可以补充与你目标岗位相关的影响说明。",
    navigation: null,
    questions: [],
    projectDrafts: [],
    skillDrafts: [],
  }).success, true);
});

test("routes bilingual resume synchronization to AI before the generic resume guide", () => {
  const message = "把中文版简历里新添加和修改的内容同步到英文版简历";
  assert.equal(isResumeSyncRequest(message), true);
  assert.deepEqual(resumeSyncDirection(message), { source: "zh", target: "en" });
  assert.equal(findAssistantGuide(message, "zh"), null);
  assert.equal(isResumeSyncRequest("把中文版的新内容同步到英文版"), true);
  assert.deepEqual(resumeSyncDirection("把英文版简历的新内容同步到中文版简历"), { source: "en", target: "zh" });
});

test("does not turn a resume title or follow-up answer into a mechanical navigation reply", () => {
  assert.equal(findAssistantGuide("Sample_Candidate_Resume_CN", "zh"), null);
  assert.equal(findAssistantGuide("我的中文版简历", "zh"), null);
  assert.equal(findAssistantGuide("简历在哪里导入？", "zh")?.navigation?.href, "/resumes");
});

test("only explicit Resume Studio navigation questions use the fixed resume guide", () => {
  assert.equal(isExplicitResumeStudioGuideRequest("简历工作室怎么导入文件？"), true);
  assert.equal(findAssistantGuide("简历工作室怎么导入文件？", "zh")?.navigation?.href, "/resumes");
  assert.equal(findAssistantGuide("请帮我在简历中添加一段工作经历", "zh"), null);
  assert.equal(findAssistantGuide("帮我查看一下简历并说说哪里需要修改", "zh"), null);
  assert.equal(findAssistantGuide("Can you add this experience to my resume?", "en"), null);
});

test("inherits the active resume task for natural contextual follow-ups", () => {
  const syncMessages: AssistantChatMessage[] = [
    { role: "user", content: "比较我的中英文简历" },
    { role: "assistant", content: "我找到了两份版本，可以同步差异。", intent: "resume_sync" },
    { role: "user", content: "那就同步吧" },
  ];
  assert.equal(resolveAssistantActiveIntent(syncMessages, 2), "resume_sync");

  const adviceMessages: AssistantChatMessage[] = [
    { role: "user", content: "请分析一下我的简历" },
    { role: "assistant", content: "第二点是项目描述缺少结果。", intent: "resume_advice" },
    { role: "user", content: "第二点具体怎么改？" },
  ];
  assert.equal(resolveAssistantActiveIntent(adviceMessages, 2), "resume_advice");
});

test("uses the task behind an information request and respects explicit task switches", () => {
  const awaitingProject: AssistantChatMessage[] = [
    { role: "user", content: "帮我修改简历里的 JobPilot 项目" },
    { role: "assistant", content: "你想补充哪项成果？", intent: "resume_project" },
    { role: "assistant", content: "请提供要补充的原始信息。", intent: "needs_information", awaitingReply: true },
    { role: "user", content: "主要增加了中英文简历同步功能。" },
  ];
  assert.equal(resolveAssistantActiveIntent(awaitingProject, 3), "resume_project");

  const switched: AssistantChatMessage[] = [
    { role: "user", content: "请分析一下我的简历" },
    { role: "assistant", content: "项目部分可以更具体。", intent: "resume_advice" },
    { role: "user", content: "怎么添加岗位到申请进度？" },
  ];
  assert.equal(resolveAssistantActiveIntent(switched, 2), undefined);
});

test("does not make generic assistant intents sticky", () => {
  const messages: AssistantChatMessage[] = [
    { role: "user", content: "设置在哪里？" },
    { role: "assistant", content: "请打开设置页面。", intent: "guide" },
    { role: "user", content: "那就继续吧" },
  ];
  assert.equal(resolveAssistantActiveIntent(messages, 2), undefined);
});

test("recovers a resume skill task from prior assistant context", () => {
  const messages: AssistantChatMessage[] = [
    { role: "user", content: "把 Codex 加到专业技能里" },
    { role: "assistant", content: "你希望新增技能类别，还是加到现有的 AI 框架及工具？", intent: "needs_information", awaitingReply: true },
    { role: "user", content: "还是加入 AI 框架及工具吧" },
  ];
  assert.equal(resolveAssistantActiveIntent(messages, 2), "resume_advice");
});

test("validates grounded skill drafts and their real resume targets", () => {
  const sectionId = "11111111-1111-4111-8111-111111111111";
  const entryId = "22222222-2222-4222-8222-222222222222";
  const draft: AssistantSkillDraft = {
    operation: "update",
    targetSectionId: sectionId,
    targetEntryId: entryId,
    category: "AI frameworks and tools",
    skills: ["OpenAI Codex", "Cursor"],
    sourceQuotes: ["add OpenAI Codex and Cursor"],
  };
  assert.equal(validateGroundedSkillDrafts("Please add OpenAI Codex and Cursor to my skills.", [draft]).ok, true);
  assert.equal(validateGroundedSkillDrafts("Please add OpenAI Codex to my skills.", [draft]).ok, false);
  assert.equal(validateSkillDraftTargets([draft], [{ id: sectionId, type: "skills", entries: [{ id: entryId }] }]).ok, true);
  assert.equal(validateSkillDraftTargets([draft], [{ id: sectionId, type: "projects", entries: [{ id: entryId }] }]).ok, false);
});

test("accepts grounded project drafts and rejects invented numbers", () => {
  const source = "I built a Sales Dashboard with SQL and Power BI in 2025 and reduced weekly reporting time by 4 hours.";
  assert.equal(validateGroundedProjectDrafts(source, [groundedDraft]).ok, true);
  const invented = { ...groundedDraft, highlights: ["Improved reporting speed by 80%."] };
  assert.equal(validateGroundedProjectDrafts(source, [invented]).ok, false);
});

test("restricts assistant navigation to JobPilot pages", () => {
  const parsed = assistantResponseSchema.safeParse({ intent: "guide", reply: "Open this page.", navigation: { href: "https://example.com", label: "Leave" }, questions: [], projectDrafts: [], skillDrafts: [] });
  assert.equal(parsed.success, false);
});

test("requires update drafts to target an existing project entry", () => {
  const sectionId = "11111111-1111-4111-8111-111111111111";
  const entryId = "22222222-2222-4222-8222-222222222222";
  const update = { ...groundedDraft, operation: "update" as const, targetSectionId: sectionId, targetEntryId: entryId };
  assert.equal(validateProjectDraftTargets([update], [{ id: sectionId, type: "projects", entries: [{ id: entryId }] }]).ok, true);
  assert.equal(validateProjectDraftTargets([{ ...update, targetEntryId: "33333333-3333-4333-8333-333333333333" }], [{ id: sectionId, type: "projects", entries: [{ id: entryId }] }]).ok, false);
});

test("detects resume language and validates grounded cross-language sync drafts", () => {
  const sourceSectionId = "11111111-1111-4111-8111-111111111111";
  const sourceEntryId = "22222222-2222-4222-8222-222222222222";
  const targetSectionId = "33333333-3333-4333-8333-333333333333";
  const sourceEntry = {
    ...createResumeEntry("projects"),
    id: sourceEntryId,
    projectName: "JobPilot",
    role: "创始开发者",
    startDate: "2026-07",
    current: true,
    description: "主导开发本地优先的人工智能求职管理平台，支持简历编辑和岗位匹配。",
    highlights: ["使用 Next.js、TypeScript 和 SQLite 构建完整工作流。"],
    skills: ["Next.js", "TypeScript", "SQLite"],
  };
  const unrelatedSourceEntry = {
    ...createResumeEntry("projects"),
    id: "44444444-4444-4444-8444-444444444444",
    projectName: "另一项目",
    description: "将处理时间缩短了 80%。",
  };
  const source: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "林小明", headline: "人工智能工程师", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "具备人工智能研究与全栈开发经验，能够独立完成复杂产品。",
    sections: [{ id: sourceSectionId, type: "projects", title: "项目经历", content: "", entries: [sourceEntry, unrelatedSourceEntry] }],
  };
  const target: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "Alex Lin", headline: "AI Engineer", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "AI engineer.",
    sections: [{ id: targetSectionId, type: "projects", title: "Projects", content: "", entries: [] }],
  };
  const translatedEntry = assistantResumeSyncEntrySchema.parse({
    ...createResumeEntry("projects"),
    projectName: "JobPilot",
    role: "Founding Developer",
    startDate: "2026-07",
    current: true,
    description: "Led development of a local-first AI job-search management platform supporting resume editing and job matching.",
    highlights: ["Built the end-to-end workflow with Next.js, TypeScript, and SQLite."],
    skills: ["Next.js", "TypeScript", "SQLite"],
  });
  const draft: AssistantResumeSyncDraft = {
    operation: "add",
    sourceSectionId,
    sourceEntryId,
    targetSectionId,
    targetEntryId: null,
    sectionType: "projects",
    targetSectionTitle: "Projects",
    sourceLabel: "JobPilot",
    translatedEntry,
  };
  assert.equal(detectResumeLanguage(source), "zh");
  assert.equal(detectResumeLanguage(target), "en");
  assert.equal(validateResumeSyncDrafts(source, target, [draft]).ok, true);
  assert.equal(validateResumeSyncDrafts(source, target, [{ ...draft, sourceQuotes: ["旧客户端携带的不可验证引用"] }]).ok, true);
  assert.equal(validateResumeSyncDrafts(source, target, [{ ...draft, translatedEntry: { ...draft.translatedEntry, highlights: ["Improved results by 80%."] } }]).ok, false);

  const targetEntry = {
    ...translatedEntry,
    id: "55555555-5555-4555-8555-555555555555",
    kind: "projects" as const,
    description: "Built JobPilot and served 500 users.",
  };
  const targetWithExisting: PlatformResume = {
    ...target,
    sections: [{ ...target.sections[0], entries: [targetEntry] }],
  };
  const updateDraft: AssistantResumeSyncDraft = {
    ...draft,
    operation: "update",
    targetEntryId: targetEntry.id,
    translatedEntry: { ...translatedEntry, description: "Built JobPilot and served 500 users." },
  };
  assert.equal(validateResumeSyncDrafts(source, targetWithExisting, [updateDraft]).ok, true);
});
