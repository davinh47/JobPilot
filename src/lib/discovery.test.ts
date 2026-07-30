import assert from "node:assert/strict";
import test from "node:test";
import { detectConnectorUrl } from "@/lib/job-sources/detect";
import { extractJobFromPage, parseJobPostings } from "@/lib/job-page-parser";

test("detects supported public ATS board URLs", () => {
  assert.deepEqual(detectConnectorUrl("https://boards.greenhouse.io/example/jobs/123"), { provider: "greenhouse", boardToken: "example", region: "global", url: "https://boards.greenhouse.io/example/jobs/123" });
  assert.deepEqual(detectConnectorUrl("https://jobs.eu.lever.co/example/role-id"), { provider: "lever", boardToken: "example", region: "eu", url: "https://jobs.eu.lever.co/example/role-id" });
  assert.deepEqual(detectConnectorUrl("https://jobs.ashbyhq.com/example/role-id"), { provider: "ashby", boardToken: "example", region: "global", url: "https://jobs.ashbyhq.com/example/role-id" });
  assert.equal(detectConnectorUrl("https://example.com/careers"), null);
});

test("parses independently fetched JobPosting structured data", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Senior Data Engineer",
    hiringOrganization: { "@type": "Organization", name: "Example Labs" },
    jobLocation: { "@type": "Place", address: { addressLocality: "Sydney", addressRegion: "NSW", addressCountry: "AU" } },
    employmentType: ["FULL_TIME"],
    baseSalary: { "@type": "MonetaryAmount", currency: "AUD", value: { "@type": "QuantitativeValue", minValue: 120000, maxValue: 145000 } },
    description: "<p>Build reliable data systems for a growing product team.</p><p>Work with SQL, Python, and cloud infrastructure.</p>",
    datePosted: "2026-07-12",
    url: "/careers/data-engineer",
    identifier: { value: "job-42" },
  })}</script></head></html>`;
  const jobs = parseJobPostings(html, "https://example.com/jobs/42");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.companyName, "Example Labs");
  assert.equal(jobs[0]?.location, "Sydney, NSW, AU");
  assert.equal(jobs[0]?.canonicalUrl, "https://example.com/careers/data-engineer");
  assert.equal(jobs[0]?.salaryMin, 120000);
  assert.equal(jobs[0]?.salaryMax, 145000);
  assert.equal(jobs[0]?.salaryCurrency, "AUD");
  assert.match(jobs[0]?.descriptionText ?? "", /SQL, Python/);
});

test("ignores incomplete job structured data", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Mystery role" })}</script>`;
  assert.deepEqual(parseJobPostings(html, "https://example.com/jobs/unknown"), []);
});

test("extracts a captured signed-in job page from visible fields", () => {
  const html = `<main><h1>Machine Learning Engineer</h1><div class="company-name">Example AI</div><div class="location">Melbourne · Hybrid</div><section class="job-description">Build and deploy production machine learning services. Work with Python, model evaluation, APIs, data pipelines, and cloud infrastructure across the full product lifecycle.</section></main>`;
  const job = extractJobFromPage(html, "https://jobs.example.com/ml-engineer");
  assert.equal(job?.title, "Machine Learning Engineer");
  assert.equal(job?.companyName, "Example AI");
  assert.equal(job?.workplaceType, "hybrid");
  assert.match(job?.descriptionText ?? "", /model evaluation/);
});

test("uses local readability when a public page has no dedicated job-description selector", () => {
  const paragraphs = Array.from({ length: 8 }, (_, index) => `<p>Responsibility ${index + 1}: build reliable machine learning products, collaborate with engineers, evaluate models, and document production requirements.</p>`).join("");
  const html = `<html><head><meta property="og:site_name" content="Example Research"><title>Graduate AI Engineer</title></head><body><h1>Graduate AI Engineer</h1><div class="content-shell">${paragraphs}</div></body></html>`;
  const job = extractJobFromPage(html, "https://careers.example.com/jobs/graduate-ai-engineer");
  assert.equal(job?.companyName, "Example Research");
  assert.match(job?.descriptionText ?? "", /Responsibility 8/);
});

test("does not import an arbitrary role from a multi-job board page", () => {
  const posting = (title: string, url: string) => ({ "@type": "JobPosting", title, url, hiringOrganization: { name: "Example" }, description: "A sufficiently detailed role description with responsibilities, requirements, collaboration, delivery, and measurable product outcomes." });
  const html = `<script type="application/ld+json">${JSON.stringify([posting("Role A", "/jobs/a"), posting("Role B", "/jobs/b")])}</script>`;
  assert.equal(extractJobFromPage(html, "https://example.com/jobs"), null);
});
