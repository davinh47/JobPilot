import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPlatformResume, createResumeEntry, editableResumeEntryDescription, normalizePlatformResume, parseResumeText, renderResumeSection, renderResumeText, unifiedResumeEntryDescriptionPatch, type PlatformResume } from "@/lib/resume-format";

test("creates an online resume with the three default structured sections", () => {
  const resume = createDefaultPlatformResume("zh");

  assert.equal(resume.basics.additionalInfo, "");
  assert.deepEqual(resume.sections.map((section) => section.type), ["education", "experience_projects", "skills"]);
  assert.deepEqual(resume.sections.map((section) => section.title), ["教育经历", "工作与项目经历", "技能"]);
  assert.ok(resume.sections.every((section) => section.entries?.length === 1));
});

test("extracts nationality and work authorization into other basic information", () => {
  const parsed = parseResumeText(`Candidate Name
AI Engineer
candidate@example.com | Nationality: Australian
Work Authorization: Australia
EXPERIENCE
Engineer
Example Company`);

  assert.equal(parsed.basics.headline, "AI Engineer");
  assert.equal(parsed.basics.additionalInfo, "Nationality: Australian\nWork Authorization: Australia");
  assert.match(renderResumeText(parsed), /Nationality: Australian/);
});

test("adds an empty other-information field to legacy structured resumes", () => {
  const legacyWithoutOther = {
    schemaVersion: 2,
    basics: { fullName: "Candidate", headline: "", email: "", phone: "", location: "", links: "" },
    summary: "",
    sections: [{ id: "experience", type: "experience", title: "Experience", content: "Engineer" }],
  } as unknown as PlatformResume;

  assert.equal(normalizePlatformResume(legacyWithoutOther).basics.additionalInfo, "");
});

test("renders work and project entries from a mixed experience section", () => {
  const work = createResumeEntry("experience_projects");
  Object.assign(work, { category: "experience", organization: "Example Lab", position: "Researcher" });
  const project = createResumeEntry("experience_projects");
  Object.assign(project, { category: "project", projectName: "Memory System", role: "Lead" });

  const rendered = renderResumeSection({ id: "mixed", type: "experience_projects", title: "Experience & Projects", content: "", entries: [work, project] });
  assert.match(rendered, /Researcher \| Example Lab/);
  assert.match(rendered, /Memory System \| Lead/);
});

test("combines legacy descriptions and highlights in one editable field without losing text", () => {
  const entry = createResumeEntry("experience");
  Object.assign(entry, {
    description: "Built the initial platform.",
    highlights: ["Reduced processing time by 30%.", "Shipped the bilingual workflow."],
  });

  assert.equal(
    editableResumeEntryDescription(entry),
    "Built the initial platform.\n- Reduced processing time by 30%.\n- Shipped the bilingual workflow.",
  );
  assert.deepEqual(
    unifiedResumeEntryDescriptionPatch("Built the platform.\n- Reduced processing time by 30%."),
    { description: "Built the platform.\n- Reduced processing time by 30%.", highlights: [] },
  );
});

test("migrates a legacy text section without losing its content", () => {
  const legacy: PlatformResume = {
    schemaVersion: 1,
    basics: { fullName: "Ada Lovelace", headline: "Engineer", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "Builds reliable analytical systems.",
    sections: [{ id: "experience", type: "experience", title: "Experience", content: "Analytical Engines Ltd\n- Designed a computation system." }],
  };

  const normalized = normalizePlatformResume(legacy);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.sections[0]?.entries?.[0]?.description, legacy.sections[0]?.content);
  assert.match(renderResumeText(normalized), /Designed a computation system/);
});

test("renders detailed education fields and dates", () => {
  const entry = createResumeEntry("education");
  Object.assign(entry, { school: "Example University", degree: "Master of Science", fieldOfStudy: "Computer Science", location: "Sydney", startDate: "2022", endDate: "2024", description: "Research focus in trustworthy AI." });
  const rendered = renderResumeSection({ id: "education", type: "education", title: "Education", content: "", entries: [entry] });

  assert.match(rendered, /Master of Science, Computer Science/);
  assert.match(rendered, /Example University \| Sydney/);
  assert.match(rendered, /2022 - 2024/);
  assert.match(rendered, /trustworthy AI/);
});

test("splits embedded legacy headings and dated entries", () => {
  const legacy: PlatformResume = {
    schemaVersion: 1,
    basics: { fullName: "Candidate", headline: "", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "",
    sections: [{ id: "education", type: "education", title: "Education", content: "Master of Science Feb. 2022 - Dec. 2024\nExample University\nBachelor of Design Feb. 2018 - Dec. 2021\nDesign University\nTECHNICAL EXPERIENCE\nResearch Assistant Nov. 2024 - Present\nExample Lab\nSydney\n- Built a verified prototype." }],
  };

  const normalized = normalizePlatformResume(legacy);
  assert.equal(normalized.sections.length, 2);
  assert.equal(normalized.sections[0]?.entries?.length, 2);
  assert.equal(normalized.sections[0]?.entries?.[0]?.degree, "Master of Science");
  assert.equal(normalized.sections[1]?.type, "experience");
  assert.equal(normalized.sections[1]?.entries?.[0]?.position, "Research Assistant");
});

test("normalizes Chinese compatibility characters without treating every Chinese line as a heading", () => {
  const parsed = parseResumeText(`林⼩明
AI 工程师
教育背景
示例科技⼤学
信息技术硕⼠（⼈⼯智能⽅向）
其它项⽬经历
智能体记忆系统
负责记忆保存与读取策略。`);

  assert.equal(parsed.basics.fullName, "林小明");
  assert.deepEqual(parsed.sections.map((section) => section.type), ["education", "projects"]);
  assert.match(parsed.sections[0]?.entries?.[0]?.description ?? "", /示例科技大学/);
  assert.match(parsed.sections[1]?.entries?.[0]?.description ?? "", /智能体记忆系统/);
});

test("maps common customized headings to stable default section types", () => {
  const parsed = parseResumeText(`Candidate
Engineer
SELECTED WORK
Portfolio platform
- Built a verified workflow.
RESEARCH EXPERIENCE
Research assistant
- Evaluated model behavior.`);

  assert.deepEqual(parsed.sections.map((section) => section.type), ["projects", "experience"]);
  assert.equal(parsed.sections[0]?.title, "SELECTED WORK");
});

test("does not treat uppercase school names as standalone sections", () => {
  const parsed = parseResumeText(`Candidate
Architect
EDUCATION
UNIVERSITY OF EXAMPLE
Master of Architecture 2022 - 2024
DESIGN INSTITUTE
Bachelor of Design 2018 - 2021`);

  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0]?.type, "education");
  assert.doesNotMatch(parsed.sections[0]?.title ?? "", /UNIVERSITY|INSTITUTE/);
});

test("recognizes compact custom Chinese section headings without splitting ordinary content", () => {
  const parsed = parseResumeText(`候选人
产品设计师
代表作品
移动端服务设计
负责从研究到交付的完整流程。`);

  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0]?.type, "projects");
  assert.match(parsed.sections[0]?.entries?.[0]?.description ?? "", /移动端服务设计/);
});

test("repairs known legacy other sections while preserving their custom titles", () => {
  const legacy: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "Candidate", headline: "", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "",
    sections: [{ id: "legacy-projects", type: "other", title: "其它项⽬经历", content: "记忆系统", entries: [] }],
  };

  const normalized = normalizePlatformResume(legacy);
  assert.equal(normalized.sections[0]?.type, "projects");
  assert.equal(normalized.sections[0]?.title, "其它项目经历");
});
