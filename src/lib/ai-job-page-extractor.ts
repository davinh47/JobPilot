/**
 * Compatibility exports. Automated discovery uses the bounded candidate
 * extractor; complete user-imported job pages use job-detail-structurer.
 */
export {
  extractJobCandidateFromTextWithAi as extractJobFromTextWithAi,
  isPotentialJobSearchResult,
} from "@/lib/job-candidate-extractor";
