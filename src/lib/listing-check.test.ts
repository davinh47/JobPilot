import test from "node:test";
import assert from "node:assert/strict";
import { classifyListingPage } from "./listing-check";

test("listing verification changes status only with meaningful evidence", () => {
  assert.equal(classifyListingPage(
    { status: 200, contentType: "text/html", text: "<main><button>Apply for this job</button></main>" },
    "unknown",
  ).status, "active");
  assert.equal(classifyListingPage(
    { status: 200, contentType: "text/html", text: "<main>This position has been filled.</main>" },
    "active",
  ).status, "expired");
  assert.equal(classifyListingPage(
    { status: 404, contentType: "text/html", text: "" },
    "active",
  ).status, "expired");
});

test("listing verification recognizes Chinese closure notices and structured deadlines", () => {
  assert.equal(classifyListingPage(
    { status: 200, contentType: "text/html", text: "<main><strong>岗位已失效</strong><p>原职位描述仍然保留。</p></main>" },
    "active",
  ).status, "expired");
  assert.equal(classifyListingPage(
    { status: 200, contentType: "text/html", text: `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", validThrough: "2026-01-31" })}</script><main>Job description</main>` },
    "active",
    new Date("2026-02-01T12:00:00Z"),
  ).status, "expired");
});

test("an ambiguous successful response retains the previous status", () => {
  assert.equal(classifyListingPage(
    { status: 200, contentType: "text/html", text: "<main>The original job description is still visible.</main>" },
    "unknown",
  ).status, "unknown");
  assert.equal(classifyListingPage(
    { status: 200, contentType: "text/html", text: "<main>The original job description is still visible.</main>" },
    "possibly_expired",
  ).status, "possibly_expired");
});

test("access controls and temporary failures retain the previous listing status", () => {
  for (const status of [401, 403, 408, 425, 429, 500, 503]) {
    assert.equal(classifyListingPage(
      { status, contentType: "text/html", text: "" },
      "active",
    ).status, "active");
  }
  assert.equal(classifyListingPage(
    { status: 200, contentType: "application/pdf", text: "" },
    "unknown",
  ).status, "unknown");
});

test("listing checks use a tiered cadence", async () => {
  const { isListingCheckDue, listingCheckIntervalMs } = await import("./listing-check");
  const now = new Date("2026-07-24T12:00:00Z");
  assert.equal(listingCheckIntervalMs({ listingStatus: "active", applicationDeadline: null, hasApplication: false }, now), 7 * 24 * 60 * 60_000);
  assert.equal(listingCheckIntervalMs({ listingStatus: "active", applicationDeadline: null, hasApplication: true }, now), 3 * 24 * 60 * 60_000);
  assert.equal(listingCheckIntervalMs({ listingStatus: "active", applicationDeadline: new Date("2026-07-28T12:00:00Z"), hasApplication: false }, now), 24 * 60 * 60_000);
  assert.equal(isListingCheckDue({ listingStatus: "active", listingCheckedAt: new Date("2026-07-18T12:00:01Z"), applicationDeadline: null, hasApplication: false }, now), false);
  assert.equal(isListingCheckDue({ listingStatus: "active", listingCheckedAt: new Date("2026-07-17T12:00:00Z"), applicationDeadline: null, hasApplication: false }, now), true);
});
