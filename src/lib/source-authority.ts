export type SourceAuthority = "user_provided" | "resume_grounded" | "ai_inferred";

const userProvidedSources = new Set(["user", "user_context"]);
const resumeGroundedSources = new Set(["resume", "resume_version"]);

export function sourceAuthority(sourceType: string): SourceAuthority {
  const normalized = sourceType.trim().toLowerCase();
  if (userProvidedSources.has(normalized)) return "user_provided";
  if (resumeGroundedSources.has(normalized) || normalized.startsWith("resume_")) return "resume_grounded";
  return "ai_inferred";
}

export function sourceNeedsConfirmation(sourceType: string) {
  return sourceAuthority(sourceType) === "ai_inferred";
}
