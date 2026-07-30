import assert from "node:assert/strict";
import test from "node:test";
import { companyDiscoveryDisposition, companyDiscoveryLimits, companyVerificationQuery, isUsableCompanyCandidate, sanitizePublicResearchText } from "@/lib/company-discovery";

test("company discovery preserves the original broad verified search", () => {
  assert.deepEqual(companyDiscoveryLimits, {
    companiesPerTarget: 6,
    totalCompanies: 8,
    webSearchUses: 8,
    verificationResults: 10,
  });
});

test("rejects placeholder company research results", () => {
  assert.equal(isUsableCompanyCandidate({
    name: "No Data",
    reason: "No data available in search result.",
    confidence: 0,
    officialWebsite: "https://example.com",
    careersUrl: "https://example.com",
    evidence: [{ url: "https://example.com", note: "No evidence found." }],
  }), false);
});

test("accepts a source-grounded company candidate for page verification", () => {
  assert.equal(isUsableCompanyCandidate({
    name: "Acme Technology",
    reason: "The official careers page lists engineering teams in the target location.",
    confidence: 0.82,
    officialWebsite: "https://acme.example-careers.test",
    careersUrl: "https://careers.acme.example-careers.test/jobs",
    evidence: [{ url: "https://careers.acme.example-careers.test/jobs", note: "Official careers page with current role listings." }],
  }), true);
});

test("company verification keeps the target role and locations in the live search", () => {
  const query = companyVerificationQuery("Acme Technology", {
    title: "AI Engineer",
    locations: ["Hong Kong", "Sydney"],
  });
  assert.match(query, /AI Engineer/);
  assert.match(query, /Hong Kong/);
  assert.match(query, /Sydney/);
  assert.match(query, /greenhouse/);
});

test("public company research strips contact details and arbitrary URLs", () => {
  const redacted = sanitizePublicResearchText("AI Engineer jane@example.com +61 412 345 678 https://profile.example/jane @janedoe");
  assert.doesNotMatch(redacted, /jane@example|\+61|profile\.example|@janedoe/);
  assert.match(redacted, /AI Engineer/);
});

test("standard company recommendations keep verified careers pages without pretending they are connectors", () => {
  assert.deepEqual(companyDiscoveryDisposition("recommend", false), {
    include: true,
    connect: false,
    status: "verified",
  });
});

test("advanced company-source discovery only keeps sources that can actually sync", () => {
  assert.deepEqual(companyDiscoveryDisposition("connect", false), {
    include: false,
    connect: false,
    status: "verified",
  });
  assert.deepEqual(companyDiscoveryDisposition("connect", true), {
    include: true,
    connect: true,
    status: "connected",
  });
});

test("refreshing recommendations does not downgrade connected or dismissed companies", () => {
  assert.equal(companyDiscoveryDisposition("recommend", true, "connected").status, "connected");
  assert.equal(companyDiscoveryDisposition("recommend", false, "dismissed").status, "dismissed");
});
