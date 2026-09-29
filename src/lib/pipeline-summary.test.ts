import assert from "node:assert/strict";
import test from "node:test";
import { buildPipelineFlow, layoutPipelineFlow, type PipelineTransition } from "./pipeline-summary";

function transition(applicationId: string, fromStatus: string | null, toStatus: string, occurredAt: number): PipelineTransition {
  return { applicationId, fromStatus, toStatus, occurredAt };
}

test("flow totals count applications once and include custom and unrecognized current statuses", () => {
  const flow = buildPipelineFlow([
    { applicationId: "a", status: "to_apply" },
    { applicationId: "b", status: "custom:portfolio" },
    { applicationId: "c", status: "custom:portfolio" },
    { applicationId: "d", status: "removed-status" },
  ], []);
  assert.equal(flow.total, 4);
  assert.equal(flow.withoutHistory, 4);
  assert.equal(flow.nodes.filter((node) => node.currentCount > 0).reduce((sum, node) => sum + node.currentCount, 0), 4);
  assert.equal(flow.nodes.find((node) => node.status === "custom:portfolio")?.value, 2);
  assert.equal(flow.historyColumns, 0);
});

test("recorded skips are preserved while reverted loops do not create duplicate stages", () => {
  const flow = buildPipelineFlow([{ applicationId: "a", status: "offer" }], [
    transition("a", "applied", "offer", 3),
    transition("a", "applied", "interviewed", 1),
    transition("a", "interviewed", "applied", 2),
    transition("someone-else", "applied", "declined", 0),
  ]);
  assert.deepEqual(flow.nodes.filter((node) => node.kind === "stage" && node.currentCount === 0).map((node) => node.status), ["applied"]);
  assert.equal(flow.nodes.some((node) => node.status === "interview_pending"), false);
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  assert.ok(flow.links.every((link) => nodes.get(link.source)!.column < nodes.get(link.target)!.column));
});

test("inconsistent history is marked rather than silently connecting unrelated stages", () => {
  const flow = buildPipelineFlow([{ applicationId: "a", status: "offer" }], [
    transition("a", null, "applied", 1),
    transition("a", "interviewed", "declined", 2),
  ]);
  assert.equal(flow.incompleteHistory, 1);
  assert.ok(flow.nodes.some((node) => node.kind === "gap"));
  assert.equal(flow.nodes.find((node) => node.currentCount > 0)?.status, "offer");
});

test("long histories are explicitly folded and always preserve the current outcome", () => {
  const events = Array.from({ length: 12 }, (_, i) => transition("a", `step-${i}`, `step-${i + 1}`, i));
  const flow = buildPipelineFlow([{ applicationId: "a", status: "step-12" }], events);
  assert.equal(flow.collapsedHistory, 1);
  assert.equal(flow.historyColumns, 4);
  assert.ok(flow.nodes.some((node) => node.kind === "collapsed"));
  assert.equal(flow.nodes.find((node) => node.currentCount > 0)?.status, "step-12");
});

test("every internal node conserves flow despite journeys ending at different depths", () => {
  const flow = buildPipelineFlow([
    { applicationId: "a", status: "applied" },
    { applicationId: "b", status: "offer" },
    { applicationId: "c", status: "declined" },
  ], [transition("b", "applied", "interviewed", 1), transition("b", "interviewed", "offer", 2), transition("c", "applied", "declined", 1)]);
  for (const node of flow.nodes) {
    if (node.kind !== "total") assert.equal(flow.links.filter((link) => link.target === node.id).reduce((sum, link) => sum + link.value, 0), node.value);
    assert.equal(flow.links.filter((link) => link.source === node.id).reduce((sum, link) => sum + link.value, 0) + node.currentCount, node.value);
  }
  const layout = layoutPipelineFlow(flow, ["applied", "interviewed", "offer", "declined"]);
  assert.ok(layout.links.every((link) => !/NaN|Infinity/.test(link.path)));
  assert.ok(layout.nodes.every((node) => node.y >= 0 && node.y + node.height <= layout.height));
  assert.ok(layout.nodes.every((node) => node.y >= layout.labelHeight), "leave space above each node for its label");
});

test("short journeys end naturally and different histories do not merge into crossing shortcuts", () => {
  const flow = buildPipelineFlow([
    { applicationId: "a", status: "declined" },
    { applicationId: "b", status: "declined" },
    { applicationId: "c", status: "offer" },
  ], [
    transition("a", "applied", "declined", 1),
    transition("b", "applied", "interviewed", 1), transition("b", "interviewed", "declined", 2),
    transition("c", "applied", "interviewed", 1), transition("c", "interviewed", "offer", 2),
  ]);
  const layout = layoutPipelineFlow(flow, ["applied", "interviewed", "offer", "declined"]);
  assert.ok(layout.links.every((link) => link.targetNode.column === link.sourceNode.column + 1));
  const outcomes = layout.nodes.filter((node) => node.currentCount > 0);
  assert.ok(outcomes.some((node) => node.column < flow.finalColumn));
  assert.equal(outcomes.filter((node) => node.status === "declined").reduce((sum, node) => sum + node.value, 0), 2);
  assert.equal(outcomes.filter((node) => node.status === "declined").length, 2);
});

test("branch corridors stay disjoint across the full curves, including sparse and revisited paths", () => {
  const paths = [
    ["applied"], ["applied", "declined"], ["applied", "interview", "offer"],
    ["applied", "interview", "declined"], ["applied", "interview", "applied", "interview", "offer"],
    ["custom", "applied", "declined"], ["custom", "offer"], ["unknown"],
  ];
  const rows = paths.map((path, index) => ({ applicationId: String(index), status: path.at(-1)! }));
  const events = paths.flatMap((path, index) => path.slice(1).map((status, step) => transition(String(index), path[step], status, step)));
  const layout = layoutPipelineFlow(buildPipelineFlow(rows, events), ["applied", "interview", "offer", "declined", "custom"]);
  for (let column = 0; column < 6; column++) {
    const links = layout.links.filter((link) => link.sourceNode.column === column).sort((a, b) => a.sourceY - b.sourceY);
    for (let sample = 0; sample <= 20; sample++) {
      const t = sample / 20;
      const blend = 3 * t * t - 2 * t * t * t;
      for (let i = 1; i < links.length; i++) {
        const upper = links[i - 1], lower = links[i];
        const bottom = upper.sourceY * (1 - blend) + upper.targetY * blend + upper.thickness;
        const top = lower.sourceY * (1 - blend) + lower.targetY * blend;
        assert.ok(bottom <= top + 1e-8, `overlapping bands in column ${column} at ${t}`);
      }
    }
    const nodes = layout.nodes.filter((node) => node.column === column).sort((a, b) => a.y - b.y);
    for (let i = 1; i < nodes.length; i++) assert.ok(nodes[i].y - nodes[i - 1].y - nodes[i - 1].height >= layout.branchGap - 1e-8);
  }
});

test("empty, identical transitions and uneven distributions have safe geometry", () => {
  assert.equal(buildPipelineFlow([], []).nodes.length, 0);
  assert.equal(layoutPipelineFlow(buildPipelineFlow([], []), []).links.length, 0);
  const rows = Array.from({ length: 500 }, (_, i) => ({ applicationId: String(i), status: i === 0 ? "offer" : "applied" }));
  const flow = buildPipelineFlow(rows, [transition("0", "offer", "offer", 1)]);
  assert.equal(flow.withoutHistory, 500);
  const layout = layoutPipelineFlow(flow, ["applied", "offer"]);
  assert.ok(layout.nodes.every((node) => node.height > 0 && node.y + node.height <= layout.height));
  const current = layout.nodes.filter((node) => node.currentCount > 0);
  assert.ok(Math.abs((current[1].y + current[1].height / 2) - (current[0].y + current[0].height / 2)) >= 52);
});


test("the 15-record overview merges Applied history, current records and status-edit loops", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ applicationId: String(i), status: i < 3 ? "to_apply" : i < 13 ? "applied" : "declined" }));
  const events = rows.slice(3).flatMap((row) => [transition(row.applicationId, "to_apply", "applied", 1)]);
  events.push(transition("12", "applied", "to_apply", 2), transition("12", "to_apply", "applied", 3));
  events.push(transition("13", "applied", "declined", 2), transition("14", "applied", "declined", 2));
  const flow = buildPipelineFlow(rows, events);
  assert.equal(flow.total, 15);
  assert.equal(flow.simplifiedHistory, 1);
  assert.equal(flow.nodes.filter((node) => node.status === "applied").length, 1);
  assert.equal(flow.nodes.filter((node) => node.status === "to_apply").length, 1);
  const applied = flow.nodes.find((node) => node.status === "applied")!;
  assert.equal(applied.value, 12);
  assert.equal(applied.currentCount, 10);
  assert.equal(flow.nodes.find((node) => node.status === "to_apply")!.currentCount, 3);
  assert.equal(flow.nodes.find((node) => node.status === "declined")!.currentCount, 2);
  assert.equal(flow.finalColumn, 2);
  const layout = layoutPipelineFlow(flow, ["to_apply", "applied", "declined"]);
  const departure = layout.links.find((link) => link.source === applied.id)!;
  assert.equal(departure.sourceY, departure.sourceNode.y + 10 * 180 / 15);
});

test("an application reverted to an earlier stage stops there without changing its saved events", () => {
  const events = [transition("a", "to_apply", "applied", 1), transition("a", "applied", "interviewed", 2), transition("a", "interviewed", "applied", 3)];
  const original = JSON.stringify(events);
  const flow = buildPipelineFlow([{ applicationId: "a", status: "applied" }], events);
  assert.equal(JSON.stringify(events), original);
  assert.deepEqual(flow.nodes.filter((node) => node.kind !== "total").map((node) => [node.status, node.value, node.currentCount]), [["applied", 1, 1]]);
  assert.equal(flow.simplifiedHistory, 1);
});
