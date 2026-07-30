import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPlatformResume, createResumeEntry, parseResumeText, type PlatformResume } from "@/lib/resume-format";
import { applyResumeSectionTemplate, buildGroundedPlatformResume, indexedResultToResumeResult, preserveUnmappedResumeSource, type ResumeStructureAiResult } from "@/lib/resume-structure-ai";

function emptyEntry(overrides: Partial<ResumeStructureAiResult["sections"][number]["entries"][number]>) {
  return {
    organization: "", position: "", school: "", degree: "", fieldOfStudy: "", projectName: "", role: "", name: "", issuer: "", category: "", title: "", subtitle: "", location: "", startDate: "", endDate: "", current: false, date: "", url: "", description: "", highlights: [], skills: [], sourceQuotes: ["EDUCATION"], ...overrides,
  };
}

test("merges multiple AI education sections into education entries and rejects invented fields", () => {
  const sourceText = `Candidate Name
EDUCATION
UNIVERSITY OF EXAMPLE
Master of Architecture
2022 - 2024
DESIGN INSTITUTE
Bachelor of Design
2018 - 2021`;
  const result: ResumeStructureAiResult = {
    basics: { fullName: "Candidate Name", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    sections: [
      {
        type: "education",
        sourceLabel: "EDUCATION",
        entries: [emptyEntry({ school: "UNIVERSITY OF EXAMPLE", degree: "Master of Architecture", startDate: "2022", endDate: "2024", sourceQuotes: ["UNIVERSITY OF EXAMPLE\nMaster of Architecture\n2022 - 2024"] })],
      },
      {
        type: "education",
        sourceLabel: "EDUCATION",
        entries: [emptyEntry({ school: "DESIGN INSTITUTE", degree: "Bachelor of Design", fieldOfStudy: "Artificial Intelligence", startDate: "2018", endDate: "2021", sourceQuotes: ["DESIGN INSTITUTE\nBachelor of Design\n2018 - 2021"] })],
      },
    ],
  };

  const built = buildGroundedPlatformResume({ sourceText, result, fallback: parseResumeText(sourceText), locale: "en" });
  const education = built.content.sections.filter((section) => section.type === "education");

  assert.equal(education.length, 1);
  assert.equal(education[0]?.entries?.length, 2);
  assert.equal(education[0]?.entries?.[0]?.school, "UNIVERSITY OF EXAMPLE");
  assert.equal(education[0]?.entries?.[1]?.school, "DESIGN INSTITUTE");
  assert.equal(education[0]?.entries?.[1]?.fieldOfStudy, "");
  assert.equal(built.rejectedFieldCount, 1);
});

test("drops an AI entry when none of its evidence quotes exist in the source", () => {
  const sourceText = "Candidate Name\nEDUCATION\nExample University";
  const result: ResumeStructureAiResult = {
    basics: { fullName: "Candidate Name", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    sections: [{ type: "education", sourceLabel: "EDUCATION", entries: [emptyEntry({ school: "Example University", sourceQuotes: ["A different university"] })] }],
  };

  assert.throws(() => buildGroundedPlatformResume({ sourceText, result, fallback: parseResumeText(sourceText), locale: "en" }), /source-grounded/);
});

test("accepts compact AI entries that omit every empty field", () => {
  const sourceText = "Candidate Name\nEDUCATION\nExample University\nMaster of Design\n2022 - 2024";
  const result: ResumeStructureAiResult = {
    basics: { fullName: "Candidate Name" },
    summary: "",
    sections: [{
      type: "education",
      sourceLabel: "EDUCATION",
      entries: [{ school: "Example University", degree: "Master of Design", startDate: "2022", endDate: "2024", sourceQuotes: ["Example University"] }],
    }],
  };

  const built = buildGroundedPlatformResume({ sourceText, result, fallback: parseResumeText(sourceText), locale: "en" });
  assert.equal(built.content.sections[0]?.entries?.[0]?.school, "Example University");
  assert.equal(built.content.sections[0]?.entries?.[0]?.organization, "");
});

test("reconstructs long entry content locally from compact AI line references", () => {
  const sourceLines = [
    { id: 1, text: "PROJECTS" },
    { id: 2, text: "Spatial Reasoning Agent" },
    { id: 3, text: "Research Engineer" },
    { id: 4, text: "Built a source-grounded evaluation pipeline." },
    { id: 5, text: "• Improved evaluation consistency." },
  ];
  const mapped = indexedResultToResumeResult(sourceLines, {
    basics: {},
    summaryLineIds: [],
    sections: [{
      type: "projects",
      sourceLabelLineId: 1,
      entries: [{ projectName: "Spatial Reasoning Agent", role: "Research Engineer", sourceLineIds: [2, 3], bodyLineIds: [4, 5] }],
    }],
  });
  const entry = mapped.sections[0]?.entries[0];

  assert.equal(entry?.projectName, "Spatial Reasoning Agent");
  assert.equal(entry?.description, "Built a source-grounded evaluation pipeline.");
  assert.deepEqual(entry?.highlights, ["Improved evaluation consistency."]);
  assert.deepEqual(entry?.sourceQuotes, ["Spatial Reasoning Agent"]);
});

test("joins wrapped bullet lines and absorbs an unclaimed continuation before the next entry", () => {
  const sourceLines = [
    { id: 1, text: "EXPERIENCE" },
    { id: 2, text: "Research Assistant" },
    { id: 3, text: "Example University" },
    { id: 4, text: "• 提高数" },
    { id: 5, text: "倍记忆读取效率" },
    { id: 6, text: "Founder" },
    { id: 7, text: "Example Company" },
    { id: 8, text: "• Designed a matching algo" },
    { id: 9, text: "rithm for production use." },
  ];
  const mapped = indexedResultToResumeResult(sourceLines, {
    basics: {},
    sections: [{
      type: "experience",
      sourceLabelLineId: 1,
      entries: [
        { position: "Research Assistant", organization: "Example University", sourceLineIds: [2, 3], bodyLineIds: [4] },
        { position: "Founder", organization: "Example Company", sourceLineIds: [6, 7], bodyLineIds: [8, 9] },
      ],
    }],
  });

  assert.deepEqual(mapped.sections[0]?.entries[0]?.highlights, ["提高数倍记忆读取效率"]);
  assert.deepEqual(mapped.sections[0]?.entries[1]?.highlights, ["Designed a matching algo rithm for production use."]);
  assert.equal(mapped.sections[0]?.entries[1]?.description, "");
});

test("preserves every body line between entry anchors even when AI omits line references", () => {
  const sourceLines = [
    { id: 1, text: "EXPERIENCE" },
    { id: 2, text: "Research Assistant 2024 - Present" },
    { id: 3, text: "Example University" },
    { id: 4, text: "• Named research project" },
    { id: 5, text: "• A result the model forgot to reference" },
    { id: 6, text: "continued result details" },
    { id: 7, text: "Founder 2020 - 2022" },
    { id: 8, text: "Example Company" },
    { id: 9, text: "• Shipped a production product" },
  ];
  const mapped = indexedResultToResumeResult(sourceLines, {
    basics: {},
    sections: [{
      type: "experience",
      sourceLabelLineId: 1,
      entries: [
        { position: "Research Assistant", organization: "Example University", current: false, sourceLineIds: [2, 3], bodyLineIds: [4] },
        { position: "Founder", organization: "Example Company", sourceLineIds: [7, 8], bodyLineIds: [9] },
      ],
    }],
  });

  assert.equal(mapped.sections[0]?.entries[0]?.current, true);
  assert.deepEqual(mapped.sections[0]?.entries[0]?.highlights, ["Named research project", "A result the model forgot to reference continued result details"]);
});

test("keeps descriptive content that the AI referenced as an identifying line", () => {
  const sourceLines = [
    { id: 1, text: "EXPERIENCE" },
    { id: 2, text: "Research Assistant 2024 - Present" },
    { id: 3, text: "Example University Sydney" },
    { id: 4, text: "Research focus: Agentic AI and structured memory" },
    { id: 5, text: "• Built a memory architecture" },
  ];
  const mapped = indexedResultToResumeResult(sourceLines, {
    basics: {},
    sections: [{
      type: "experience",
      sourceLabelLineId: 1,
      entries: [{
        position: "Research Assistant",
        organization: "Example University",
        location: "Sydney",
        startDate: "2024",
        current: true,
        sourceLineIds: [2, 3, 4],
        bodyLineIds: [5],
      }],
    }],
  });

  assert.equal(mapped.sections[0]?.entries[0]?.description, "Research focus: Agentic AI and structured memory");
  assert.deepEqual(mapped.sections[0]?.entries[0]?.highlights, ["Built a memory architecture"]);
});

test("keeps skill source lines even when the AI uses them as entry anchors", () => {
  const sourceLines = [
    { id: 1, text: "SKILLS" },
    { id: 2, text: "Programming: Python, C++, SQL" },
    { id: 3, text: "AI: PyTorch, TensorFlow" },
  ];
  const mapped = indexedResultToResumeResult(sourceLines, {
    basics: {},
    sections: [{
      type: "skills",
      sourceLabelLineId: 1,
      entries: [{ sourceLineIds: [2, 3] }],
    }],
  });

  assert.deepEqual(mapped.sections[0]?.entries[0]?.skills, [
    "Programming: Python",
    "C++",
    "SQL",
    "AI: PyTorch",
    "TensorFlow",
  ]);
});

test("keeps source facts that cannot be mapped into the platform schema", () => {
  const source = "Candidate Name\nPhone: +61 400 000 000 | Nationality: Australian\nEXPERIENCE\nEngineer\nBuilt reliable systems";
  const content = parseResumeText("Candidate Name\n+61 400 000 000\nEXPERIENCE\nEngineer\nBuilt reliable systems");
  const preserved = preserveUnmappedResumeSource({ sourceText: source, content, locale: "en" });
  const supplement = preserved.content.sections.find((section) => section.title === "Source details to organize");

  assert.equal(preserved.unmappedLineCount, 1);
  assert.match(supplement?.entries?.[0]?.description ?? "", /Nationality: Australian/);
});

test("maps nationality into basic other information instead of the supplement", () => {
  const sourceText = "Candidate Name\nPhone: +61 400 000 000 | Nationality: Australian\nEXPERIENCE\nEngineer\nExample Company";
  const result: ResumeStructureAiResult = {
    basics: { fullName: "Candidate Name", phone: "+61 400 000 000", additionalInfo: "Nationality: Australian" },
    summary: "",
    sections: [{ type: "experience", entries: [emptyEntry({ position: "Engineer", organization: "Example Company", sourceQuotes: ["Engineer"] })] }],
  };
  const built = buildGroundedPlatformResume({ sourceText, result, fallback: parseResumeText(sourceText), locale: "en" });
  const preserved = preserveUnmappedResumeSource({ sourceText, content: built.content, locale: "en" });

  assert.equal(built.content.basics.additionalInfo, "Nationality: Australian");
  assert.equal(preserved.unmappedLineCount, 0);
});

test("accepts grounded Chinese content joined across a PDF line break", () => {
  const sourceText = `Candidate
EXPERIENCE
Research Assistant
• Atlas Memory Engine
• 参与设计记忆架构，提高数
倍记忆读取效率`;
  const result: ResumeStructureAiResult = {
    basics: { fullName: "Candidate" },
    summary: "",
    sections: [{
      type: "experience",
      entries: [emptyEntry({
        position: "Research Assistant",
        highlights: ["Atlas Memory Engine", "参与设计记忆架构，提高数倍记忆读取效率"],
        sourceQuotes: ["Research Assistant"],
      })],
    }],
  };
  const built = buildGroundedPlatformResume({ sourceText, result, fallback: parseResumeText(sourceText), locale: "zh" });

  assert.equal(built.rejectedFieldCount, 0);
  assert.deepEqual(built.content.sections[0]?.entries?.[0]?.highlights, ["Atlas Memory Engine", "参与设计记忆架构,提高数倍记忆读取效率"]);
});

test("keeps wrapped project details with their correct adjacent work entries", () => {
  const sourceLines = [
    { id: 1, text: "技术经历" },
    { id: 2, text: "助理研究员 2024年11月 - 至今" },
    { id: 3, text: "示例科技大学" },
    { id: 4, text: "• Atlas Memory Engine" },
    { id: 5, text: "• 参与设计记忆架构，提高数" },
    { id: 6, text: "倍记忆读取效率" },
    { id: 7, text: "联合创始人 2016年2月 - 2017年6月" },
    { id: 8, text: "Harbor Labs Pty Ltd" },
    { id: 9, text: "• Wayfinder: 主导产品全生命周期并实现时空匹配算" },
    { id: 10, text: "法，发布 TestFlight Beta。" },
    { id: 11, text: "• VR/AR 房产视察工作流" },
  ];
  const mapped = indexedResultToResumeResult(sourceLines, {
    basics: {},
    sections: [{
      type: "experience",
      sourceLabelLineId: 1,
      entries: [
        { position: "助理研究员", organization: "示例科技大学", sourceLineIds: [2, 3], bodyLineIds: [4] },
        { position: "联合创始人", organization: "Harbor Labs Pty Ltd", sourceLineIds: [7, 8], bodyLineIds: [11] },
      ],
    }],
  });
  const [research, founder] = mapped.sections[0]?.entries ?? [];

  assert.deepEqual(research?.highlights, ["Atlas Memory Engine", "参与设计记忆架构，提高数倍记忆读取效率"]);
  assert.deepEqual(founder?.highlights, ["Wayfinder: 主导产品全生命周期并实现时空匹配算法，发布 TestFlight Beta。", "VR/AR 房产视察工作流"]);
});

test("groups unmapped details by their source section without repeating nearby mapped lines", () => {
  const research = createResumeEntry("experience");
  Object.assign(research, { position: "Research Assistant", highlights: ["Atlas Memory Engine"] });
  const founder = createResumeEntry("experience");
  Object.assign(founder, { organization: "Harbor Labs Pty Ltd", position: "Founder" });
  const content: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "Candidate", headline: "", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "",
    sections: [{ id: "experience", type: "experience", title: "EXPERIENCE", content: "", entries: [research, founder] }],
  };
  const source = `Candidate
EXPERIENCE
Research Assistant
• Atlas Memory Engine
• Missing memory detail
Harbor Labs Pty Ltd
• Missing Wayfinder detail`;
  const preserved = preserveUnmappedResumeSource({ sourceText: source, content, locale: "en" });
  const supplement = preserved.content.sections.find((section) => section.title === "Source details to organize");

  assert.equal(preserved.unmappedLineCount, 2);
  assert.equal(supplement?.entries?.length, 1);
  assert.equal(supplement?.entries?.[0]?.title, "EXPERIENCE");
  assert.equal(supplement?.entries?.[0]?.description, "• Missing memory detail\n• Missing Wayfinder detail");
});

test("does not treat an equivalent current date or formatted identity line as unmapped", () => {
  const entry = createResumeEntry("experience");
  Object.assign(entry, {
    position: "助理研究员(人工智能)",
    organization: "示例科技大学",
    location: "悉尼/澳大利亚",
    startDate: "2024年11月",
    current: true,
  });
  const content: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "候选人", headline: "", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "",
    sections: [{ id: "experience", type: "experience", title: "技术经历", content: "", entries: [entry] }],
  };
  const source = `候选人
技术经历
助理研究员(人工智能) 2024年11月 – 至今
示例科技大学 悉尼/澳大利亚`;
  const preserved = preserveUnmappedResumeSource({ sourceText: source, content, locale: "zh" });

  assert.equal(preserved.unmappedLineCount, 0);
  assert.equal(preserved.content.sections.some((section) => section.title.includes("原文补充")), false);
});

test("maps separate work and project results into the user's mixed custom section", () => {
  const source = `Candidate
EXPERIENCE
Engineer
Example Lab
PROJECTS
Memory System
Lead`;
  const content = buildGroundedPlatformResume({
    sourceText: source,
    fallback: parseResumeText(source),
    locale: "en",
    result: {
      basics: { fullName: "Candidate" },
      summary: "",
      sections: [
        { type: "experience", entries: [emptyEntry({ position: "Engineer", organization: "Example Lab", sourceQuotes: ["Engineer"] })] },
        { type: "projects", entries: [emptyEntry({ projectName: "Memory System", role: "Lead", sourceQuotes: ["Memory System"] })] },
      ],
    },
  }).content;
  const template = createDefaultPlatformResume("en").sections.map((section) => section.type === "experience_projects" ? { ...section, title: "Selected Work & Builds" } : section);
  const mapped = applyResumeSectionTemplate(content, template);
  const mixed = mapped.sections.find((section) => section.type === "experience_projects");

  assert.equal(mixed?.title, "Selected Work & Builds");
  assert.equal(mixed?.entries?.length, 2);
  assert.deepEqual(mixed?.entries?.map((entry) => entry.category), ["experience", "project"]);
  assert.deepEqual(mapped.sections.map((section) => section.id), template.map((section) => section.id));
});

test("honors AI target ids when the user has multiple custom sections of one type", () => {
  const source = "Candidate\nPROJECTS\nResearch Memory\nCommunity App";
  const template = [
    { id: "research", type: "projects" as const, title: "Research Work", content: "", entries: [] },
    { id: "products", type: "projects" as const, title: "Product Builds", content: "", entries: [] },
  ];
  const content = buildGroundedPlatformResume({
    sourceText: source,
    fallback: parseResumeText(source),
    locale: "en",
    result: {
      basics: { fullName: "Candidate" },
      summary: "",
      sections: [
        { type: "projects", targetSectionId: "research", entries: [emptyEntry({ projectName: "Research Memory", sourceQuotes: ["Research Memory"] })] },
        { type: "projects", targetSectionId: "products", entries: [emptyEntry({ projectName: "Community App", sourceQuotes: ["Community App"] })] },
      ],
    },
  }).content;
  const mapped = applyResumeSectionTemplate(content, template);

  assert.equal(mapped.sections[0]?.entries?.[0]?.projectName, "Research Memory");
  assert.equal(mapped.sections[1]?.entries?.[0]?.projectName, "Community App");
});
