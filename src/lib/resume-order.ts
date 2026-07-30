import type { ResumeEntry } from "@/lib/resume-format";

export function reorderResumeEntries(entries: ResumeEntry[], activeId: string, overId: string) {
  const fromIndex = entries.findIndex((entry) => entry.id === activeId);
  const toIndex = entries.findIndex((entry) => entry.id === overId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return entries;

  const reordered = [...entries];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}
