type GroundedClaim = {
  claim: string;
  sourceQuote: string;
};

export type CoverLetterGroundingIssues = {
  invalidEvidenceQuotes: string[];
  inventedNumbers: string[];
  unmappedClaims: string[];
  uncoveredCandidateSentences: string[];
  weakClaimEvidence: string[];
};

function normalized(value: string) {
  return value.toLowerCase().replace(/[\s\u00a0]+/g, " ").trim();
}

function numericTokens(value: string) {
  return new Set(value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []);
}

function meaningfulTokens(value: string) {
  return new Set(normalized(value).match(/[a-z][a-z0-9+#.-]{2,}|[\u3400-\u9fff]{2,}/g) ?? []);
}

function sentenceList(value: string) {
  return value.split(/(?<=[.!?。！？])\s*|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
}

function isCandidateFactSentence(sentence: string) {
  if (!/(?:\b(?:I|my|me|we|our)\b|我|本人|我的|曾|负责|具备|拥有|完成|主导|开发|构建)/i.test(sentence)) return false;
  const motivationOnly = /(?:excited|interested|apply|welcome|look forward|believe|align|contribute|很高兴|申请|期待|兴趣|相信|匹配|贡献)/i.test(sentence);
  const factualSignal = /(?:built|created|developed|led|managed|delivered|improved|designed|implemented|worked|experience|skill|certif|degree|构建|开发|负责|主导|交付|提升|设计|实现|经验|技能|证书|学位)/i.test(sentence);
  return !motivationOnly || factualSignal;
}

function claimCoversSentence(claim: string, sentence: string) {
  const normalizedClaim = normalized(claim);
  const normalizedSentence = normalized(sentence);
  if (normalizedSentence.includes(normalizedClaim) || normalizedClaim.includes(normalizedSentence)) return true;
  const claimTokens = meaningfulTokens(claim);
  const sentenceTokens = meaningfulTokens(sentence);
  if (!claimTokens.size) return false;
  const overlap = [...claimTokens].filter((token) => sentenceTokens.has(token)).length;
  return overlap / claimTokens.size >= 0.75;
}

export function findCoverLetterGroundingIssues(
  result: { content: string; groundedClaims: GroundedClaim[] },
  resumeText: string,
  jobDescription: string,
): CoverLetterGroundingIssues {
  const resumeNormalized = normalized(resumeText);
  const invalidEvidenceQuotes = result.groundedClaims
    .map((item) => item.sourceQuote)
    .filter((quote) => !resumeNormalized.includes(normalized(quote)));
  const allowedNumbers = numericTokens(`${resumeText}\n${jobDescription}`);
  const inventedNumbers = [...numericTokens(result.content)].filter((token) => !allowedNumbers.has(token));
  const contentNormalized = normalized(result.content);
  const unmappedClaims = result.groundedClaims
    .map((item) => item.claim)
    .filter((claim) => !contentNormalized.includes(normalized(claim)));
  const candidateSentences = sentenceList(result.content).filter(isCandidateFactSentence);
  const uncoveredCandidateSentences = candidateSentences.filter((sentence) => !result.groundedClaims.some((item) => claimCoversSentence(item.claim, sentence)));
  const weakClaimEvidence = result.groundedClaims
    .filter((item) => {
      const claimTokens = meaningfulTokens(item.claim);
      const quoteTokens = meaningfulTokens(item.sourceQuote);
      if (!claimTokens.size || !quoteTokens.size) return false;
      return ![...claimTokens].some((token) => quoteTokens.has(token));
    })
    .map((item) => item.claim);
  return { invalidEvidenceQuotes, inventedNumbers, unmappedClaims, uncoveredCandidateSentences, weakClaimEvidence };
}

export function hasCoverLetterGroundingIssues(issues: CoverLetterGroundingIssues) {
  return Boolean(
    issues.invalidEvidenceQuotes.length
    || issues.inventedNumbers.length
    || issues.unmappedClaims.length
    || issues.uncoveredCandidateSentences.length
    || issues.weakClaimEvidence.length,
  );
}

export function coverLetterRepairInstruction(issues: CoverLetterGroundingIssues) {
  const reasons = [
    issues.invalidEvidenceQuotes.length
      ? `${issues.invalidEvidenceQuotes.length} evidence quote(s) were not exact excerpts from the resume`
      : "",
    issues.inventedNumbers.length
      ? `these numbers were not present in the resume or job description: ${issues.inventedNumbers.join(", ")}`
      : "",
    issues.unmappedClaims.length
      ? `${issues.unmappedClaims.length} grounded claim(s) were not exact phrases in the letter`
      : "",
    issues.uncoveredCandidateSentences.length
      ? `${issues.uncoveredCandidateSentences.length} candidate-fact sentence(s) were not mapped to grounded claims`
      : "",
    issues.weakClaimEvidence.length
      ? `${issues.weakClaimEvidence.length} claim(s) had no meaningful overlap with their resume quote`
      : "",
  ].filter(Boolean);
  return `The previous draft failed JobPilot's factual grounding check because ${reasons.join("; ")}. Write a fresh, complete draft. Remove unsupported facts and numbers, and copy every sourceQuote exactly from the supplied resume. Do not explain the correction.`;
}

export function coverLetterGroundingError(issues: CoverLetterGroundingIssues) {
  const messages = [
    issues.invalidEvidenceQuotes.length
      ? `${issues.invalidEvidenceQuotes.length} cover-letter evidence quote(s) could not be verified in the resume.`
      : "",
    issues.inventedNumbers.length
      ? `Unverified numeric claim(s) detected: ${issues.inventedNumbers.join(", ")}`
      : "",
    issues.unmappedClaims.length ? `${issues.unmappedClaims.length} grounded claim(s) were not mapped into the letter.` : "",
    issues.uncoveredCandidateSentences.length ? `${issues.uncoveredCandidateSentences.length} candidate statement(s) lacked claim-level evidence.` : "",
    issues.weakClaimEvidence.length ? `${issues.weakClaimEvidence.length} claim-to-evidence mapping(s) were too weak.` : "",
  ].filter(Boolean);
  return messages.join(" ");
}
