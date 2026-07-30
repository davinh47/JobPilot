import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { extractResumeText } from "@/lib/resume-extract";
import { generateCoverLetterDocx, generateCoverLetterPdf } from "@/lib/cover-letter-export";
import { cleanCoverLetterContent, coverLetterOutputLocale, coverLetterSenderLines, createCoverLetterDocumentMeta } from "@/lib/cover-letter-format";
import type { PlatformResume } from "@/lib/resume-format";
import { localeCompatibleFallback } from "@/lib/text-language";

const resume: PlatformResume = {
  schemaVersion: 2,
  basics: {
    fullName: "林小明",
    headline: "AI Engineer",
    email: "alex@example.com",
    phone: "+61 400 000 000",
    location: "Sydney, NSW",
    links: "https://example.com",
    additionalInfo: "",
  },
  summary: "",
  sections: [],
};

const meta = createCoverLetterDocumentMeta(
  resume,
  { companyName: "Example", title: "AI Engineer" },
  new Date("2026-07-23T00:00:00Z"),
  "en",
);

test("cover letter metadata comes from the bound structured resume", () => {
  assert.equal(meta.identity.fullName, "林小明");
  assert.equal(meta.identity.email, "alex@example.com");
  assert.equal(meta.companyName, "Example");
  assert.equal(meta.jobTitle, "AI Engineer");
  assert.match(meta.dateLabel, /2026/);
  assert.deepEqual(coverLetterSenderLines(meta), [
    "林小明",
    "Sydney, NSW",
    "+61 400 000 000",
    "alex@example.com",
    meta.dateLabel,
  ]);
});

test("cover letter output language is stored independently from the interface language", () => {
  assert.equal(coverLetterOutputLocale([{ type: "output_language", id: "en" }], "这是中文正文"), "en");
  assert.equal(coverLetterOutputLocale([], "Dear Hiring Team,\n\nI am applying for this role."), "en");
  assert.equal(coverLetterOutputLocale([], "尊敬的招聘团队：\n\n我希望申请这个岗位，并介绍相关工作经历。"), "zh");
  assert.equal(localeCompatibleFallback("澳大利亚悉尼", "en"), "");
  assert.equal(localeCompatibleFallback("Sydney, Australia", "en"), "Sydney, Australia");
});

test("duplicate contact details are removed only from the closing", () => {
  const content = "Dear Hiring Team,\n\nContact me at alex@example.com if helpful.\n\nSincerely,\n林小明\nalex@example.com\n+61 400 000 000";
  const cleaned = cleanCoverLetterContent(content, meta);
  assert.match(cleaned, /Contact me at alex@example\.com/);
  assert.match(cleaned, /Sincerely,\n林小明$/);
});

test("Word cover letters include the professional letterhead before the body", async () => {
  const output = await generateCoverLetterDocx("Application", "Dear Hiring Team,\n\nBody paragraph.\n\nSincerely,\n林小明", meta);
  const archive = await JSZip.loadAsync(output);
  const xml = await archive.file("word/document.xml")?.async("string");
  assert.ok(xml);
  assert.ok(xml.indexOf("林小明") < xml.indexOf("Dear Hiring Team"));
  assert.ok(xml.includes("alex@example.com"));
  assert.ok(xml.includes(meta.dateLabel));
});

test("PDF cover letters preserve CJK identity text and body order", async () => {
  const output = await generateCoverLetterPdf("Application", "Dear Hiring Team,\n\n这是正文内容。\n\nSincerely,\n林小明", meta);
  const extracted = await extractResumeText(output, "pdf");
  assert.match(extracted, /林小明[\s\S]*alex@example\.com[\s\S]*Dear Hiring Team[\s\S]*这是正文内容/);
});
