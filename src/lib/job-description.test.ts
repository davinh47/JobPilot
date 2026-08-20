import assert from "node:assert/strict";
import test from "node:test";
import { rebuildAiStructuredDescription } from "@/lib/job-detail-structurer";
import { parseStructuredJobDescription, stripJobPageNoise, structureJobDescription } from "@/lib/job-description";
import { parseSalaryText } from "@/lib/job-page-parser";

test("structures Chinese job descriptions without dropping source content", () => {
  const source = [
    "职位描述",
    "负责产品设计与交付。",
    "岗位职责",
    "与工程和业务团队协作",
    "任职要求",
    "三年以上相关经验",
    "薪资福利",
    "HKD 30k-40k，另有医疗保险",
  ].join("\n");
  const result = structureJobDescription(source);
  assert.match(result, /## 工作职责/);
  assert.match(result, /## 任职要求/);
  assert.match(result, /## 薪资与福利/);
  for (const detail of ["负责产品设计与交付。", "与工程和业务团队协作", "三年以上相关经验", "HKD 30k-40k，另有医疗保险"]) assert.ok(result.includes(detail));
});

test("rebuilds AI-classified sections from local source lines and preserves unassigned lines", () => {
  const lines = ["Build useful tools.", "Own product delivery.", "Work with design.", "Three years of TypeScript.", "Annual learning budget."];
  const result = rebuildAiStructuredDescription(lines, [
    { section: "responsibilities", startLine: 2, endLine: 3 },
    { section: "requirements", startLine: 4, endLine: 4 },
    { section: "benefits", startLine: 5, endLine: 5 },
  ], "en");
  assert.equal(parseStructuredJobDescription(result).flatMap((block) => block.lines).length, lines.length);
  for (const line of lines) assert.ok(result.includes(line));
});

test("extracts common salary ranges without guessing a currency", () => {
  assert.deepEqual(parseSalaryText("HKD 30k - 45k per month"), { salaryMin: 30_000, salaryMax: 45_000, salaryCurrency: "HKD" });
  assert.deepEqual(parseSalaryText("薪资 2万-3万/月"), { salaryMin: 20_000, salaryMax: 30_000, salaryCurrency: null });
});

test("recovers inline headings and numbered duties from flattened extension text", () => {
  const result = structureJobDescription("职位介绍 AI产品工程师 岗位职责 1. 负责RAG产品规划 2. 对接研发上线 任职要求 1. 本科及以上 2. 熟悉向量数据库 薪资福利 HKD 30k-40k");
  assert.match(result, /## 工作职责\n- 负责RAG产品规划\n- 对接研发上线/);
  assert.match(result, /## 任职要求\n- 本科及以上\n- 熟悉向量数据库/);
  assert.match(result, /## 薪资与福利\nHKD 30k-40k/);
});

test("removes browser controls from captured job text without dropping the description", () => {
  const cleaned = stripJobPageNoise("Easy Apply\nSave job\nShare\nAbout the role\nBuild reliable AI systems.\nRequirements\nTypeScript\n查看更多职位\n登录");
  assert.doesNotMatch(cleaned, /Easy Apply|Save job|Share|查看更多职位|登录/);
  assert.match(cleaned, /Build reliable AI systems/);
  assert.match(cleaned, /TypeScript/);
});
