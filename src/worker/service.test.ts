import assert from "node:assert/strict";
import test from "node:test";
import { backgroundQueueRetryDelay, pickFairBackgroundJob } from "./service";

test("worker selects one best job per tenant and gives the least recently served tenant priority", () => {
  const now = Date.now();
  const jobs = [
    { id: "a-low", userId: "a", priority: 1, createdAt: new Date(now - 10_000) },
    { id: "a-high", userId: "a", priority: 9, createdAt: new Date(now - 5_000) },
    { id: "b", userId: "b", priority: 2, createdAt: new Date(now - 2_000) },
  ];
  const selected = pickFairBackgroundJob(jobs, new Map([["a", now], ["b", now - 60_000]]));
  assert.equal(selected?.id, "b");
  assert.equal(pickFairBackgroundJob(jobs, new Map())?.id, "a-high");
});

test("worker retries only while jobs remain pending and honors a future retry time", () => {
  const now = Date.now();
  assert.equal(backgroundQueueRetryDelay([], now), null);
  assert.equal(backgroundQueueRetryDelay([{ status: "running", runAfter: null }], now), 3_000);
  assert.equal(backgroundQueueRetryDelay([{ status: "queued", runAfter: new Date(now) }], now), 1_000);
  assert.equal(backgroundQueueRetryDelay([{ status: "queued", runAfter: new Date(now + 12_000) }], now), 12_000);
  assert.equal(backgroundQueueRetryDelay([{ status: "queued", runAfter: new Date(now + 60_000) }], now), 30_000);
});
