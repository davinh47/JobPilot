import assert from "node:assert/strict";
import test from "node:test";
import { createResumeEntry, renderResumeSection } from "@/lib/resume-format";
import { reorderResumeEntries } from "@/lib/resume-order";

test("reorders resume entries within a section and preserves rendered order", () => {
  const first = { ...createResumeEntry("projects"), id: "first", projectName: "Project 1" };
  const second = { ...createResumeEntry("projects"), id: "second", projectName: "Project 2" };
  const third = { ...createResumeEntry("projects"), id: "third", projectName: "Project 3" };

  const entries = reorderResumeEntries([first, second, third], "second", "first");
  const rendered = renderResumeSection({
    id: "projects",
    type: "projects",
    title: "Projects",
    content: "",
    entries,
  });

  assert.deepEqual(entries.map((entry) => entry.id), ["second", "first", "third"]);
  assert.ok(rendered.indexOf("Project 2") < rendered.indexOf("Project 1"));
  assert.ok(rendered.indexOf("Project 1") < rendered.indexOf("Project 3"));
});

test("ignores reorder requests with ids outside the current section", () => {
  const first = { ...createResumeEntry("education"), id: "first" };
  const second = { ...createResumeEntry("education"), id: "second" };
  const entries = [first, second];

  assert.equal(reorderResumeEntries(entries, "outside", "first"), entries);
  assert.equal(reorderResumeEntries(entries, "first", "outside"), entries);
});
