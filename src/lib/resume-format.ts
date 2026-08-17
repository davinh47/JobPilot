import { createResumeEntry, editableResumeEntryDescription, renderResumeEntry, renderResumeSection, unifiedResumeEntryDescriptionPatch } from "@/lib/resume-entry-format";
import { upgradeLegacyResumeSections } from "@/lib/resume-legacy-adapter";
import type { PlatformResume, ResumeSection, ResumeSectionType } from "@/lib/resume-schema";

export { createResumeEntry, editableResumeEntryDescription, renderResumeEntry, renderResumeSection, unifiedResumeEntryDescriptionPatch };
export type { PlatformResume, ResumeEntry, ResumeSection, ResumeSectionType } from "@/lib/resume-schema";

export const defaultResumeSectionTypes: ResumeSectionType[] = ["experience_projects", "education", "experience", "projects", "skills", "certifications", "other"];

export function normalizeResumeString(value: string) {
  return value.normalize("NFKC");
}

export function createDefaultPlatformResume(locale: "zh" | "en"): PlatformResume {
  const section = (type: ResumeSectionType, zh: string, en: string): ResumeSection => ({
    id: crypto.randomUUID(),
    type,
    title: locale === "zh" ? zh : en,
    content: "",
    entries: [createResumeEntry(type)],
  });
  return {
    schemaVersion: 2,
    basics: { fullName: "", headline: "", email: "", phone: "", location: "", links: "", additionalInfo: "" },
    summary: "",
    sections: [
      section("education", "教育经历", "Education"),
      section("experience_projects", "工作与项目经历", "Experience & Projects"),
      section("skills", "技能", "Skills"),
    ],
  };
}

export function normalizePlatformResume(resume: PlatformResume): PlatformResume {
  const normalizedSections = upgradeLegacyResumeSections(resume.sections.map((section) => {
    const title = normalizeResumeString(section.title);
    const detected = section.type === "other" ? detectResumeSectionHeading(title) : undefined;
    const type = detected && detected.type !== "summary" ? detected.type : section.type;
    return {
      ...section,
      type,
      title,
      content: normalizeResumeString(section.content),
      entries: section.entries?.map((entry) => ({
        ...entry,
        kind: type,
        organization: normalizeResumeString(entry.organization),
        position: normalizeResumeString(entry.position),
        school: normalizeResumeString(entry.school),
        degree: normalizeResumeString(entry.degree),
        fieldOfStudy: normalizeResumeString(entry.fieldOfStudy),
        projectName: normalizeResumeString(entry.projectName),
        role: normalizeResumeString(entry.role),
        name: normalizeResumeString(entry.name),
        issuer: normalizeResumeString(entry.issuer),
        category: normalizeResumeString(entry.category),
        title: normalizeResumeString(entry.title),
        subtitle: normalizeResumeString(entry.subtitle),
        location: normalizeResumeString(entry.location),
        startDate: normalizeResumeString(entry.startDate),
        endDate: normalizeResumeString(entry.endDate),
        date: normalizeResumeString(entry.date),
        url: normalizeResumeString(entry.url),
        description: normalizeResumeString(entry.description),
        highlights: entry.highlights.map(normalizeResumeString),
        skills: entry.skills.map(normalizeResumeString),
      })),
    };
  }), detectResumeSectionHeading);
  return {
    ...resume,
    schemaVersion: 2,
    basics: {
      fullName: normalizeResumeString(resume.basics.fullName),
      headline: normalizeResumeString(resume.basics.headline),
      email: normalizeResumeString(resume.basics.email),
      phone: normalizeResumeString(resume.basics.phone),
      location: normalizeResumeString(resume.basics.location),
      links: normalizeResumeString(resume.basics.links),
      additionalInfo: normalizeResumeString(resume.basics.additionalInfo ?? ""),
    },
    summary: normalizeResumeString(resume.summary),
    sections: normalizedSections,
  };
}

const sectionAliases: Array<{ type: ResumeSectionType | "summary"; title: string; values: string[] }> = [
  { type: "summary", title: "Professional Summary", values: ["summary", "profile", "professional profile", "professional summary", "career summary", "objective", "个人简介", "职业简介", "个人总结", "自我评价", "求职目标"] },
  { type: "experience_projects", title: "Experience & Projects", values: ["experience and projects", "experience & projects", "work and project experience", "work & project experience", "工作与项目经历", "工作及项目经历", "工作和项目经历"] },
  { type: "experience", title: "Experience", values: ["experience", "work experience", "professional experience", "technical experience", "research experience", "industry experience", "previous industry experience", "employment", "employment history", "工作经历", "工作经验", "职业经历", "技术经历", "科研经历", "研究经历", "行业经历", "过往行业经历", "实习经历"] },
  { type: "projects", title: "Projects", values: ["projects", "other projects", "project experience", "selected projects", "selected work", "portfolio projects", "research projects", "项目经历", "项目经验", "项目作品", "其他项目", "其它项目", "其他项目经历", "其它项目经历", "精选项目", "科研项目", "研究项目"] },
  { type: "education", title: "Education", values: ["education", "academic background", "education background", "qualifications", "教育经历", "教育背景", "学历", "学术背景"] },
  { type: "skills", title: "Skills", values: ["skills", "technical skills", "core competencies", "competencies", "expertise", "技能", "专业技能", "核心能力", "技能专长", "语言与技能"] },
  { type: "certifications", title: "Certifications", values: ["certifications", "certificates", "licenses", "licenses and certifications", "awards and certifications", "证书", "认证", "资质", "证书与认证"] },
  { type: "other", title: "Other", values: ["awards", "honors", "publications", "volunteering", "activities", "interests", "获奖经历", "荣誉奖项", "论文发表", "出版物", "志愿经历", "社团活动", "兴趣爱好", "其他经历"] },
];

function normalizedHeading(line: string) {
  return normalizeResumeString(line).toLowerCase().replace(/[：:|]/g, "").replace(/\s+/g, " ").trim();
}

function findKnownSection(line: string) {
  const normalized = normalizedHeading(line);
  return sectionAliases.find((section) => section.values.some((value) => normalized === value || new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*[(/\\-]|\\s+—)`).test(normalized)));
}

export function detectResumeSectionHeading(line: string) {
  const known = findKnownSection(line);
  if (known) return known;
  const trimmed = normalizeResumeString(line).trim();
  const compactChineseHeading = /^[\u3400-\u9fff]{2,16}$/.test(trimmed) && /(简介|概况|经历|背景|技能|专长|项目|作品|证书|认证|奖项|荣誉|成果|活动)$/.test(trimmed);
  if (compactChineseHeading) {
    const type: ResumeSectionType = /(项目|作品)$/.test(trimmed) ? "projects"
      : /(技能|专长)$/.test(trimmed) ? "skills"
        : /(证书|认证)$/.test(trimmed) ? "certifications"
          : /经历$/.test(trimmed) ? "experience"
            : "other";
    return { type, title: trimmed, values: [normalizedHeading(trimmed)] };
  }
  return undefined;
}

export function parseResumeText(rawText: string): PlatformResume {
  const normalizedText = normalizeResumeString(rawText);
  const lines = normalizedText.replace(/\r/g, "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const email = lines.join(" ").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone = lines.join(" ").match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? "";
  const linkLines = lines.filter((line) => /(?:https?:\/\/|www\.|linkedin\s*:|github\s*:)/i.test(line));
  const links = Array.from(new Set(linkLines)).join("\n");
  const additionalInfoPattern = /^(?:国籍|签证(?:状态)?|工作许可|nationality|visa(?:\s+status)?|work\s+authori[sz]ation)\s*[:：]/i;
  const additionalInfo = Array.from(new Set(lines.flatMap((line) => line.split(/[|｜]/)).map((part) => part.trim()).filter((part) => additionalInfoPattern.test(part)))).join("\n");
  const contactLine = (line: string) => Boolean((email && line.includes(email)) || (phone && line.includes(phone)) || /(?:https?:\/\/|www\.|linkedin\s*:|github\s*:)/i.test(line) || line.split(/[|｜]/).some((part) => additionalInfoPattern.test(part.trim())));
  const nameIndex = lines.findIndex((line) => !contactLine(line) && !findKnownSection(line) && line.length <= 80);
  const fullName = nameIndex >= 0 ? lines[nameIndex] : "";
  const headline = lines.slice(nameIndex + 1, nameIndex + 4).find((line) => !contactLine(line) && !findKnownSection(line) && line.length <= 120) ?? "";

  let summary = "";
  const sections: PlatformResume["sections"] = [];
  let active: PlatformResume["sections"][number] | null = null;
  const preamble: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (index === nameIndex || line === headline || contactLine(line)) continue;
    const heading = findKnownSection(line) ?? detectResumeSectionHeading(line);
    if (heading) {
      if (heading.type === "summary") {
        active = { id: crypto.randomUUID(), type: "other", title: "__summary__", content: "" };
      } else {
        active = { id: crypto.randomUUID(), type: heading.type, title: line, content: "" };
        sections.push(active);
      }
      continue;
    }
    if (active?.title === "__summary__") summary = [summary, line].filter(Boolean).join("\n");
    else if (active) active.content = [active.content, line].filter(Boolean).join("\n");
    else preamble.push(line);
  }

  if (!summary && preamble.length) summary = preamble.slice(0, 4).join("\n");
  if (!sections.length) {
    const remaining = preamble.slice(summary ? Math.min(4, preamble.length) : 0).join("\n") || normalizedText.trim();
    sections.push({ id: crypto.randomUUID(), type: "experience", title: "Experience", content: remaining });
  }

  return normalizePlatformResume({
    schemaVersion: 1,
    basics: { fullName, headline, email, phone, location: "", links, additionalInfo },
    summary,
    sections,
  });
}

export function renderResumeText(resume: PlatformResume) {
  const basics = [resume.basics.fullName, resume.basics.headline, [resume.basics.email, resume.basics.phone, resume.basics.location].filter(Boolean).join(" | "), resume.basics.links, resume.basics.additionalInfo].filter(Boolean).join("\n");
  const summary = resume.summary ? `SUMMARY\n${resume.summary}` : "";
  const sections = resume.sections.map((section) => `${section.title.toUpperCase()}\n${renderResumeSection(section)}`).join("\n\n");
  return [basics, summary, sections].filter(Boolean).join("\n\n");
}

export function isPlatformResume(value: unknown): value is PlatformResume {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlatformResume>;
  return (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) && Boolean(candidate.basics) && Array.isArray(candidate.sections);
}
