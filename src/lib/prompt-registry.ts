export const promptRegistry = {
  assistant: "assistant-v4",
  companyResearch: "company-strategy-v4-redacted",
  coverLetter: "cover-letter-v7-claim-coverage",
  jobExtraction: "job-extraction-v3",
  jobMatch: "job-match-v9-current-location-grounded",
  profileAnalysis: "candidate-profile-v5-complete-refresh",
  resumeOptimization: "resume-job-optimization-v4-grounded",
  resumePolish: "resume-field-polish-v3-grounded",
  resumeStructure: "resume-structure-v7-authoritative-source",
  resumeTranslation: "resume-translation-v2",
  searchStrategy: "search-strategy-v3",
} as const;

export type PromptId = keyof typeof promptRegistry;

export function promptVersion(id: PromptId) {
  return promptRegistry[id];
}
