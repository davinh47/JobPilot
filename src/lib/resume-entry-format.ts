import type { ResumeEntry, ResumeSection, ResumeSectionType } from "@/lib/resume-schema";

export function createResumeEntry(kind: ResumeSectionType): ResumeEntry {
  return {
    id: crypto.randomUUID(), kind, organization: "", position: "", school: "", degree: "", fieldOfStudy: "", projectName: "", role: "", name: "", issuer: "", category: kind === "experience_projects" ? "experience" : "", title: "", subtitle: "", location: "", startDate: "", endDate: "", current: false, date: "", url: "", description: "", highlights: [], skills: [],
  };
}

export function editableResumeEntryDescription(entry: ResumeEntry) {
  return [
    entry.description.trim(),
    ...entry.highlights.map((item) => item.trim()).filter(Boolean).map((item) => `- ${item}`),
  ].filter(Boolean).join("\n");
}

export function unifiedResumeEntryDescriptionPatch(value: string): Pick<ResumeEntry, "description" | "highlights"> {
  return { description: value, highlights: [] };
}

function dateRange(entry: ResumeEntry) {
  return [entry.startDate, entry.current ? "Present" : entry.endDate].filter(Boolean).join(" - ");
}

export function renderResumeEntry(entry: ResumeEntry) {
  const dates = dateRange(entry);
  let heading = "";
  let meta = "";
  if (entry.kind === "experience" || (entry.kind === "experience_projects" && entry.category !== "project")) {
    heading = [entry.position, entry.organization].filter(Boolean).join(" | ");
    meta = entry.location;
  } else if (entry.kind === "experience_projects" && entry.category === "project") {
    heading = [entry.projectName, entry.role].filter(Boolean).join(" | ");
    meta = entry.url;
  } else if (entry.kind === "education") {
    heading = [entry.degree, entry.fieldOfStudy].filter(Boolean).join(", ");
    meta = [entry.school, entry.location].filter(Boolean).join(" | ");
  } else if (entry.kind === "projects") {
    heading = [entry.projectName, entry.role].filter(Boolean).join(" | ");
    meta = entry.url;
  } else if (entry.kind === "certifications") {
    heading = [entry.name, entry.issuer].filter(Boolean).join(" | ");
    meta = entry.url;
  } else if (entry.kind === "skills") {
    heading = entry.category;
    meta = entry.skills.join(", ");
  } else {
    heading = entry.title;
    meta = entry.subtitle;
  }
  const datedHeading = [heading, entry.kind === "certifications" ? entry.date : dates].filter(Boolean).join("    ");
  const highlights = entry.highlights.map((item) => item.trim()).filter(Boolean).map((item) => `- ${item}`).join("\n");
  return [datedHeading, meta, entry.description, highlights].filter(Boolean).join("\n");
}

export function renderResumeSection(section: ResumeSection) {
  if (section.entries?.length) return section.entries.map(renderResumeEntry).filter(Boolean).join("\n\n");
  return section.content;
}
