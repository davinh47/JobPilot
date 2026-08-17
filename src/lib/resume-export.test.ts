import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { extractResumeText } from "@/lib/resume-extract";
import { generateResumePdf, resumeEntryPresentation } from "@/lib/resume-export";
import { createResumeEntry, type PlatformResume } from "@/lib/resume-format";
import nextConfig from "../../next.config";

test("repository bundles the CJK font required by serverless PDF export", () => {
  assert.equal(existsSync(join(process.cwd(), "assets/fonts/NotoSansCJKsc-Regular.otf")), true);
  assert.deepEqual(nextConfig.outputFileTracingIncludes?.["/resumes/[id]/export"], ["./assets/fonts/**/*"]);
  assert.deepEqual(nextConfig.outputFileTracingIncludes?.["/materials/[id]/export"], ["./assets/fonts/**/*"]);
  assert.deepEqual(nextConfig.outputFileTracingIncludes?.["/*"], [
    "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  ]);
});

test("serverless resume PDF export does not depend on PDFKit's Helvetica AFM", async () => {
  const resume: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "Example Candidate", headline: "Software Engineer", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "Builds reliable web applications.",
    sections: [],
  };
  const pdf = await generateResumePdf(resume, "classic");
  assert.equal(pdf.toString("latin1").includes("/BaseFont /Helvetica"), false);
});

test("structured entries keep titles, organizations, locations, and dates in separate hierarchy fields", () => {
  const education = {
    ...createResumeEntry("education"),
    degree: "信息技术硕士",
    fieldOfStudy: "人工智能方向",
    school: "示例科技大学",
    location: "悉尼/澳大利亚",
    startDate: "2024年2月",
    endDate: "2026年6月",
  };

  assert.deepEqual(resumeEntryPresentation(education), {
    primary: "信息技术硕士, 人工智能方向",
    secondary: "示例科技大学 · 悉尼/澳大利亚",
    date: "2024年2月 - 2026年6月",
    description: "",
    highlights: [],
  });

  const currentExperience = { ...createResumeEntry("experience"), position: "助理研究员", startDate: "2024年11月", current: true };
  assert.equal(resumeEntryPresentation(currentExperience).date, "2024年11月 - 至今");

  const unifiedDescription = {
    ...createResumeEntry("projects"),
    description: "Built the platform.\n- Reduced processing time by 30%.\n* Added bilingual editing.",
  };
  assert.equal(resumeEntryPresentation(unifiedDescription).description, "Built the platform.");
  assert.deepEqual(resumeEntryPresentation(unifiedDescription).highlights, ["Reduced processing time by 30%.", "Added bilingual editing."]);
});

test("PDF export never merges the next structured experience into the previous bullet", async (context) => {
  const first = {
    ...createResumeEntry("experience"),
    position: "Atlas Memory Engine",
    organization: "Example Institute",
    startDate: "2024年11月",
    current: true,
    highlights: ["参与设计智能体记忆高效记录与读取策略框架，建立长期记忆架构并提高数倍记忆读取效率。"],
  };
  const second = {
    ...createResumeEntry("experience"),
    position: "联合创始人 & iOS产品负责人",
    organization: "Harbor Labs Pty Ltd",
    location: "墨尔本/澳大利亚",
    startDate: "2016年2月",
    endDate: "2017年6月",
    highlights: ["主导产品全生命周期开发。"],
  };
  const resume: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "示例候选人", headline: "", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "",
    sections: [{ id: "experience", type: "experience", title: "技术经历", content: "", entries: [first, second] }],
  };

  let pdf: Buffer;
  try {
    pdf = await generateResumePdf(resume, "modern");
  } catch (error) {
    if (error instanceof Error && /CJK-compatible font/.test(error.message)) return context.skip("No CJK font is installed in this environment");
    throw error;
  }
  const extracted = await extractResumeText(pdf, "pdf");
  assert.match(extracted, /Atlas Memory Engine[\s\S]*Example Institute[\s\S]*记忆读取效率。[\s\S]*联合创始人\s*&\s*iOS产品负责人[\s\S]*Harbor Labs Pty Ltd/);
  assert.doesNotMatch(extracted, /记忆读取效率。\s*联合创始人\s*&\s*iOS产品负责人\s*\n?\s*•/);
});

test("PDF export reapplies the CJK font after automatic page breaks", async (context) => {
  const sentinel = "分页后中文字体回退检查";
  const resume: PlatformResume = {
    schemaVersion: 2,
    basics: { fullName: "中文测试", headline: "", email: "", phone: "", location: "", links: "", additionalInfo: "国籍: 澳大利亚" },
    summary: "",
    sections: [{ id: "details", type: "other", title: "详细信息", content: Array.from({ length: 220 }, () => sentinel).join("\n") }],
  };
  let pdf: Buffer;
  try {
    pdf = await generateResumePdf(resume, "modern");
  } catch (error) {
    if (error instanceof Error && /CJK-compatible font/.test(error.message)) return context.skip("No CJK font is installed in this environment");
    throw error;
  }
  const extracted = await extractResumeText(pdf, "pdf");
  assert.equal(extracted.split(sentinel).length - 1, 220);
  assert.match(extracted, /国籍:\s*澳大利亚/);
});
