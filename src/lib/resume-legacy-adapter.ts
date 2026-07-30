import { createResumeEntry, renderResumeEntry } from "@/lib/resume-entry-format";
import type { ResumeSection, ResumeSectionType } from "@/lib/resume-schema";

type DetectedHeading = { type: ResumeSectionType | "summary"; title: string; values: string[] };

const datedEntryPattern = /^(.*?)\s+((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+)?(?:19|20)\d{2})\s*[-\u2013\u2014]\s*(Present|Current|Now|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+)?(?:19|20)\d{2})$/i;

function entryFromLines(type: ResumeSectionType, lines: string[]) {
  const entry = createResumeEntry(type);
  const dated = lines[0]?.trim().match(datedEntryPattern);
  if (!dated) {
    entry.description = lines.join("\n").trim();
    return entry;
  }
  const heading = dated[1].trim();
  entry.startDate = dated[2].trim();
  entry.current = /^(present|current|now)$/i.test(dated[3].trim());
  entry.endDate = entry.current ? "" : dated[3].trim();
  const remaining = lines.slice(1).map((line) => line.trim()).filter(Boolean);
  if (type === "education") {
    entry.degree = heading;
    entry.school = remaining.shift() ?? "";
  } else if (type === "experience" || type === "experience_projects") {
    entry.position = heading;
    entry.organization = remaining.shift() ?? "";
  } else if (type === "projects") {
    entry.projectName = heading;
  } else {
    entry.title = heading;
  }
  entry.highlights = remaining.filter((line) => /^[-*\u2022]/.test(line)).map((line) => line.replace(/^[-*\u2022]\s*/, ""));
  entry.description = remaining.filter((line) => !/^[-*\u2022]/.test(line)).join("\n");
  return entry;
}

function legacyEntries(section: ResumeSection) {
  if (section.type === "skills") {
    const entry = createResumeEntry(section.type);
    entry.skills = section.content.split(/[,;\n•]+/).map((item) => item.trim().replace(/^[-*]\s*/, "")).filter((item) => Boolean(item) && !/^--?\s*\d+\s+of\s+\d+\s*--?$/i.test(item));
    return [entry];
  }
  const lines = section.content.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!["experience_projects", "experience", "education", "projects"].includes(section.type) || !lines.some((line) => datedEntryPattern.test(line))) {
    const entry = createResumeEntry(section.type);
    entry.description = section.content;
    return [entry];
  }
  const groups: string[][] = [];
  for (const line of lines) {
    if (datedEntryPattern.test(line)) groups.push([line]);
    else if (groups.length) groups[groups.length - 1].push(line);
    else groups.push([line]);
  }
  return groups.filter((group) => group.some((line) => line.trim())).map((group) => entryFromLines(section.type, group));
}

export function upgradeLegacyResumeSections(
  sections: ResumeSection[],
  detectHeading: (line: string) => DetectedHeading | undefined,
) {
  const expanded: ResumeSection[] = [];
  for (const section of sections) {
    if (section.entries?.length) {
      expanded.push(section);
      continue;
    }
    let active: ResumeSection = { ...section, content: "" };
    expanded.push(active);
    for (const rawLine of section.content.replace(/\r/g, "").split("\n")) {
      const line = rawLine.trim();
      const embedded = line ? detectHeading(line) : undefined;
      if (embedded && embedded.type !== "summary") {
        active = { id: crypto.randomUUID(), type: embedded.type, title: line, content: "" };
        expanded.push(active);
      } else {
        active.content = [active.content, rawLine].filter(Boolean).join("\n");
      }
    }
  }
  return expanded.filter((section) => section.title.trim() || section.content.trim()).map((section) => {
    const entries = section.entries?.length ? section.entries.map((entry) => ({ ...createResumeEntry(section.type), ...entry, kind: section.type })) : legacyEntries(section);
    return { ...section, content: entries.map(renderResumeEntry).filter(Boolean).join("\n\n"), entries };
  });
}
