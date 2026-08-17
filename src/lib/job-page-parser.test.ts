import assert from "node:assert/strict";
import test from "node:test";
import { extractCapturedJobText, extractJobFromCapturedText, extractJobFromPage } from "@/lib/job-page-parser";

const noisyJobPage = `<!doctype html>
<html><head><title>AI Engineer · Example Labs</title></head>
<body>
  <header>Home Jobs Sign in</header>
  <main>
    <h1>AI Engineer</h1>
    <p class="company-name">Example Labs</p>
    <button>Apply now</button><button>Save job</button>
    <section class="job-description">
      <h2>Responsibilities</h2>
      <p>Build and evaluate reliable AI systems with the research team.</p>
      <h2>Requirements</h2>
      <ul><li>Python experience</li><li>Strong communication</li></ul>
    </section>
  </main>
  <footer>Privacy Terms Contact</footer>
</body></html>`;

test("removes page controls and navigation from captured job text", () => {
  const text = extractCapturedJobText(noisyJobPage, "https://example.com/jobs/ai-engineer");

  assert.match(text, /Responsibilities/);
  assert.match(text, /Build and evaluate reliable AI systems/);
  assert.doesNotMatch(text, /Apply now|Save job|Home Jobs Sign in|Privacy Terms/);
});

test("deterministic job extraction keeps the cleaned description", () => {
  const job = extractJobFromPage(noisyJobPage, "https://example.com/jobs/ai-engineer", {
    title: "AI Engineer",
    companyName: "Example Labs",
  });

  assert.equal(job?.title, "AI Engineer");
  assert.equal(job?.companyName, "Example Labs");
  assert.match(job?.descriptionText ?? "", /## Responsibilities/);
  assert.doesNotMatch(job?.descriptionText ?? "", /Apply now|Save job|Privacy Terms/);
});

test("captured extension text can be imported without reparsing the full page", () => {
  const job = extractJobFromPage("", "https://example.com/jobs/ai-engineer", {
    title: "AI Engineer",
    companyName: "Example Labs",
    descriptionText: "Responsibilities\nBuild and evaluate reliable AI systems with the research team.\nRequirements\nPython experience and strong communication.",
  });

  assert.equal(job?.title, "AI Engineer");
  assert.equal(job?.companyName, "Example Labs");
  assert.match(job?.descriptionText ?? "", /## Responsibilities/);
});

test("captured extension text still creates a transparent fallback when company metadata is missing", () => {
  const job = extractJobFromCapturedText(
    "AI Engineer\nResponsibilities\nBuild and evaluate reliable AI systems with the research team.\nRequirements\nPython experience and strong communication.",
    "https://jobs.example.com/roles/ai-engineer",
    { title: "AI Engineer" },
  );

  assert.equal(job?.title, "AI Engineer");
  assert.match(job?.companyName ?? "", /Company to identify/);
  assert.match(job?.descriptionText ?? "", /## Responsibilities/);
});
