import assert from "node:assert/strict";
import test from "node:test";
import { selectResumeVersionForLanguage, type ResumeVersionCandidate } from "@/lib/resume-version-language";
import { createDefaultPlatformResume, renderResumeText } from "@/lib/resume-format";

test("cover letters prefer a resume version matching the requested language", () => {
  const chinese = createDefaultPlatformResume("zh");
  chinese.basics.fullName = "林小明";
  chinese.summary = "我是一名拥有丰富项目经验的人工智能工程师，负责多个智能系统的设计、开发与交付。";
  const english = createDefaultPlatformResume("en");
  english.basics.fullName = "Alex Lin";
  english.summary = "I am an artificial intelligence engineer with extensive experience designing, building, and delivering production systems.";
  const rows = [{
    resume: { id: "resume-zh", isPrimary: true },
    version: { id: "version-zh", resumeId: "resume-zh", jobId: null, structuredContentJson: chinese, renderedText: renderResumeText(chinese) },
  }, {
    resume: { id: "resume-en", isPrimary: false },
    version: { id: "version-en", resumeId: "resume-en", jobId: null, structuredContentJson: english, renderedText: renderResumeText(english) },
  }] as unknown as ResumeVersionCandidate[];

  assert.equal(selectResumeVersionForLanguage(rows, "en", { preferredVersionId: "version-zh" })?.version.id, "version-en");
  assert.equal(selectResumeVersionForLanguage(rows, "zh", { preferredVersionId: "version-zh" })?.version.id, "version-zh");
});
