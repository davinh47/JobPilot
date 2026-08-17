export type JobDescriptionSection = "overview" | "responsibilities" | "requirements" | "preferred" | "benefits" | "other";

export type JobDescriptionBlock = {
  section: JobDescriptionSection;
  lines: string[];
};

const sectionPatterns: Array<[JobDescriptionSection, RegExp]> = [
  ["responsibilities", /^(?:responsibilities|key responsibilities|what you(?:'|’)ll do|what you will do|the role|your role|工作职责|岗位职责|职位职责|主要职责|你将负责)\s*[:：]?$/i],
  ["requirements", /^(?:requirements|qualifications|required qualifications|what you(?:'|’)ll need|what we(?:'|’)re looking for|任职要求|岗位要求|职位要求|资格要求|我们希望你)\s*[:：]?$/i],
  ["preferred", /^(?:preferred qualifications|nice to have|bonus points|加分项|优先条件|优先考虑)\s*[:：]?$/i],
  ["benefits", /^(?:benefits|compensation|compensation and benefits|salary and benefits|what we offer|perks|薪资福利|薪资与福利|福利待遇|薪酬福利|我们提供)\s*[:：]?$/i],
  ["overview", /^(?:overview|about the role|about this role|job description|position summary|role summary|职位描述|岗位描述|岗位概览|职位概览)\s*[:：]?$/i],
  ["other", /^(?:about (?:us|the company|the team)|company overview|other information|other details|其他信息|关于我们|关于团队|工作地点|申请方式)\s*[:：]?$/i],
];

const displayHeadings: Record<"zh" | "en", Record<JobDescriptionSection, string>> = {
  zh: { overview: "岗位概览", responsibilities: "工作职责", requirements: "任职要求", preferred: "加分项", benefits: "薪资与福利", other: "其他信息" },
  en: { overview: "Overview", responsibilities: "Responsibilities", requirements: "Requirements", preferred: "Preferred qualifications", benefits: "Compensation and benefits", other: "Other details" },
};

const inlineHeadingLabels = [
  "Key responsibilities", "What you'll do", "What you’ll do", "What you will do",
  "Required qualifications", "Preferred qualifications", "What we're looking for", "What we’re looking for",
  "Compensation and benefits", "Salary and benefits", "Position summary", "Job description",
  "About the role", "Other information", "Other details", "Responsibilities", "Requirements",
  "Qualifications", "Nice to have", "What we offer", "Benefits", "Compensation", "Overview",
  "主要职责", "工作职责", "岗位职责", "职位职责", "任职要求", "岗位要求", "职位要求", "资格要求",
  "职位描述", "岗位描述", "岗位概览", "职位概览", "薪资福利", "薪资与福利", "福利待遇",
  "薪酬福利", "加分项", "优先条件", "其他信息", "公司简介", "关于我们", "关于团队",
];

export function cleanJobText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sourceLocale(value: string): "zh" | "en" {
  const chinese = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return chinese >= Math.max(8, value.length * 0.03) ? "zh" : "en";
}

function splitFlattenedText(value: string) {
  let text = cleanJobText(value);
  for (const label of inlineHeadingLabels) {
    const escaped = label.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
    text = text.replace(new RegExp("(^|\\s)(" + escaped + ")\\s*[:：]?\\s*", "gi"), "$1\n$2\n");
  }
  text = text.replace(/\s+(?=(?:\d{1,2}[.)、]|[-•▪◦])\s*)/g, "\n");
  if (text.split("\n").filter(Boolean).length <= 3 && text.length > 500) {
    text = text.replace(/([。！？.!?])\s+(?=[A-Z\u3400-\u9fff])/g, "$1\n");
  }
  return text;
}

export function jobDescriptionLines(value: string) {
  return splitFlattenedText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, lines) => index === 0 || line !== lines[index - 1]);
}

export function classifyJobHeading(line: string): JobDescriptionSection | null {
  const normalized = line.replace(/^#{1,4}\s*/, "").trim();
  return sectionPatterns.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

function bulletLike(line: string) {
  return /^[-*•▪◦·]\s*/.test(line) || /^\d+[.)、]\s*/.test(line);
}

export function renderJobDescription(blocks: JobDescriptionBlock[], locale: "zh" | "en") {
  return blocks
    .filter((block) => block.lines.length)
    .map((block) => {
      const lines = block.lines.map((line) => {
        const cleaned = line.replace(/^#{1,4}\s*/, "").trim();
        return bulletLike(cleaned) ? `- ${cleaned.replace(/^[-*•▪◦·]\s*|^\d+[.)、]\s*/, "")}` : cleaned;
      });
      return `## ${displayHeadings[locale][block.section]}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export function structureJobDescription(value: string) {
  const lines = jobDescriptionLines(value);
  if (!lines.length) return "";
  const locale = sourceLocale(value);
  const grouped = new Map<JobDescriptionSection, string[]>();
  let section: JobDescriptionSection = "overview";
  for (const line of lines) {
    const heading = classifyJobHeading(line);
    if (heading) {
      section = heading;
      continue;
    }
    const current = grouped.get(section) ?? [];
    current.push(line);
    grouped.set(section, current);
  }
  const order: JobDescriptionSection[] = ["overview", "responsibilities", "requirements", "preferred", "benefits", "other"];
  return renderJobDescription(order.map((key) => ({ section: key, lines: grouped.get(key) ?? [] })), locale);
}

export function parseStructuredJobDescription(value: string): JobDescriptionBlock[] {
  const blocks: JobDescriptionBlock[] = [];
  let current: JobDescriptionBlock = { section: "overview", lines: [] };
  for (const line of cleanJobText(value).split("\n")) {
    const heading = classifyJobHeading(line);
    if (heading && /^#{1,4}\s*/.test(line)) {
      if (current.lines.length) blocks.push(current);
      current = { section: heading, lines: [] };
      continue;
    }
    if (line.trim()) current.lines.push(line.trim());
  }
  if (current.lines.length) blocks.push(current);
  return blocks;
}

export function jobDescriptionHeading(section: JobDescriptionSection, locale: "zh" | "en") {
  return displayHeadings[locale][section];
}
