import assert from "node:assert/strict";
import test from "node:test";
import { shouldScheduleWebSearch } from "./web-search-schedule";

const now = new Date("2026-07-19T12:00:00.000Z");

test("schedules a first web search", () => {
  assert.equal(shouldScheduleWebSearch({ now, frequencyMinutes: 1440, lastSearchAt: null, latestJob: null }), true);
});

test("does not duplicate queued or running searches", () => {
  for (const status of ["queued", "running"]) {
    assert.equal(shouldScheduleWebSearch({ now, frequencyMinutes: 1440, lastSearchAt: null, latestJob: { status, updatedAt: new Date(0) } }), false);
  }
});

test("waits one schedule interval after retries are exhausted", () => {
  assert.equal(shouldScheduleWebSearch({ now, frequencyMinutes: 1440, lastSearchAt: null, latestJob: { status: "failed", updatedAt: new Date(now.getTime() - 60_000) } }), false);
  assert.equal(shouldScheduleWebSearch({ now, frequencyMinutes: 1440, lastSearchAt: null, latestJob: { status: "failed", updatedAt: new Date(now.getTime() - 1441 * 60_000) } }), true);
});

test("waits until the last successful search is due", () => {
  assert.equal(shouldScheduleWebSearch({ now, frequencyMinutes: 1440, lastSearchAt: new Date(now.getTime() - 60_000), latestJob: { status: "succeeded", updatedAt: now } }), false);
  assert.equal(shouldScheduleWebSearch({ now, frequencyMinutes: 1440, lastSearchAt: new Date(now.getTime() - 1441 * 60_000), latestJob: { status: "succeeded", updatedAt: now } }), true);
});
