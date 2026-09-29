export type PipelineTransition = {
  applicationId: string;
  fromStatus: string | null;
  toStatus: string | null;
  occurredAt: number;
};

export type FlowNode = {
  id: string;
  status: string;
  kind: "total" | "stage" | "gap" | "collapsed";
  currentCount: number;
  column: number;
  value: number;
};

export type FlowLink = { source: string; target: string; value: number };
const GAP = "__history_gap__";
const COLLAPSED = "__collapsed_history__";

/** Summarize each application's effective stage path, not its edit log.
 * A return to an earlier stage erases that loop from the overview. Original
 * events are untouched, missing stages remain explicit, and no visits are inferred.
 */
export function buildPipelineFlow(
  rows: { applicationId: string; status: string }[],
  events: PipelineTransition[],
) {
  const byApplication = new Map<string, PipelineTransition[]>();
  for (const event of events) {
    const group = byApplication.get(event.applicationId) ?? [];
    group.push(event);
    byApplication.set(event.applicationId, group);
  }
  let withoutHistory = 0;
  let incompleteHistory = 0;
  let collapsedHistory = 0;
  let simplifiedHistory = 0;
  const journeys = rows.map((row) => {
    const changes = [...(byApplication.get(row.applicationId) ?? [])]
      .filter((event) => event.toStatus && event.fromStatus !== event.toStatus)
      .sort((a, b) => a.occurredAt - b.occurredAt);
    if (!changes.length) {
      withoutHistory++;
      return [row.status];
    }
    const visits: string[] = [];
    for (const change of changes) {
      if (!visits.length) visits.push(change.fromStatus ?? GAP);
      else if (visits.at(-1) !== change.fromStatus) {
        visits.push(GAP);
        if (change.fromStatus) visits.push(change.fromStatus);
      }
      visits.push(change.toStatus!);
    }
    if (visits.at(-1) !== row.status) visits.push(GAP, row.status);
    if (visits.includes(GAP)) incompleteHistory++;
    const path: string[] = [];
    let simplified = false;
    for (const status of visits) {
      const previous = status === GAP ? -1 : path.indexOf(status);
      if (previous >= 0) { path.splice(previous + 1); simplified = true; }
      else path.push(status);
    }
    if (simplified) simplifiedHistory++;
    // Initial preparation is implicit in the record total; only applications
    // still at this stage need a separate To apply branch.
    if (path.length > 1 && path[0] === "to_apply") path.shift();
    if (path.length > 5) {
      collapsedHistory++;
      return [path[0], COLLAPSED, ...path.slice(-3)];
    }
    return path;
  });
  const finalColumn = Math.max(1, ...journeys.map((path) => path.length));
  const historyColumns = finalColumn - 1;
  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, FlowLink>();
  if (rows.length) nodes.set("total", { id: "total", status: "", kind: "total", column: 0, value: rows.length, currentCount: 0 });
  for (const journey of journeys) {
    let previous = "total";
    journey.forEach((status, index) => {
      const kind = status === GAP ? "gap" : status === COLLAPSED ? "collapsed" : "stage";
      // Share the stage regardless of whether a record stops here or continues.
      const id = JSON.stringify([previous, status]);
      const node = nodes.get(id) ?? { id, status, kind, column: index + 1, value: 0, currentCount: 0 };
      node.value++;
      if (index === journey.length - 1) node.currentCount++;
      nodes.set(id, node);
      const key = JSON.stringify([previous, id]);
      const link = links.get(key) ?? { source: previous, target: id, value: 0 };
      link.value++;
      links.set(key, link);
      previous = id;
    });
  }
  return { nodes: [...nodes.values()], links: [...links.values()], total: rows.length, historyColumns, finalColumn, withoutHistory, incompleteHistory, collapsedHistory, simplifiedHistory };
}

export type PipelineFlow = ReturnType<typeof buildPipelineFlow>;
export type PositionedFlowNode = FlowNode & { x: number; y: number; height: number };

export function layoutPipelineFlow(flow: PipelineFlow, statusOrder: string[]) {
  const order = new Map(statusOrder.map((status, index) => [status, index]));
  const originals = new Map(flow.nodes.map((node) => [node.id, node]));
  const children = new Map<string, FlowNode[]>();
  for (const link of flow.links) {
    const list = children.get(link.source) ?? [];
    list.push(originals.get(link.target)!);
    children.set(link.source, list);
  }
  for (const list of children.values()) list.sort((a, b) =>
    Number(b.currentCount === b.value) - Number(a.currentCount === a.value) ||
    (order.get(a.status) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.status) ?? Number.MAX_SAFE_INTEGER) ||
    a.status.localeCompare(b.status));

  const unit = flow.total ? 180 / flow.total : 0;
  const labelHeight = 64;
  const branchGap = 88;
  const columnWidth = 240;
  let cursor = labelHeight;
  const positioned = new Map<string, PositionedFlowNode>();
  // Each subtree owns a disjoint vertical interval. Unlike independent column
  // centering, this reserves the entire corridor after a split for that branch.
  function place(node: FlowNode): { top: number; bottom: number } {
    const descendants = children.get(node.id) ?? [];
    const nodeHeight = node.value * unit;
    let top: number, bottom: number;
    if (!descendants.length) {
      top = cursor;
      bottom = top + Math.max(52, nodeHeight);
      cursor = bottom + branchGap;
    } else {
      const stoppedTop = cursor;
      if (node.currentCount) cursor += Math.max(52, node.currentCount * unit) + branchGap;
      const bounds = descendants.map(place);
      top = node.currentCount ? stoppedTop : bounds[0].top;
      bottom = bounds.at(-1)!.bottom;
    }
    positioned.set(node.id, { ...node, x: 24 + node.column * columnWidth, y: (top + bottom - nodeHeight) / 2, height: nodeHeight });
    return { top, bottom };
  }
  const root = originals.get("total");
  if (root) place(root);
  const height = Math.max(320, cursor - branchGap + 40);
  const width = Math.max(760, 24 + flow.finalColumn * columnWidth + 176);
  const nodes = [...positioned.values()].sort((a, b) => a.column - b.column || a.y - b.y);
  const links = flow.links.map((link) => ({ ...link, sourceNode: positioned.get(link.source)!, targetNode: positioned.get(link.target)! }))
    .sort((a, b) => a.sourceNode.column - b.sourceNode.column || a.sourceNode.y - b.sourceNode.y || a.targetNode.y - b.targetNode.y);
  const outgoing = new Map<string, number>();
  const paths = links.map((link) => {
    const source = link.sourceNode, target = link.targetNode;
    const thickness = link.value * unit;
    const sourceY = source.y + (outgoing.get(source.id) ?? source.currentCount * unit);
    outgoing.set(source.id, (outgoing.get(source.id) ?? source.currentCount * unit) + thickness);
    const targetY = target.y;
    const x1 = source.x + 12, x2 = target.x;
    // The short straight departure leaves a protected label area above the node.
    // Every edge spans one column and bends at the same x, preserving vertical order.
    const bendStart = source.x + 144;
    const control = (bendStart + x2) / 2;
    const path = `M${x1},${sourceY} L${bendStart},${sourceY} C${control},${sourceY} ${control},${targetY} ${x2},${targetY} L${x2},${targetY + thickness} C${control},${targetY + thickness} ${control},${sourceY + thickness} ${bendStart},${sourceY + thickness} L${x1},${sourceY + thickness} Z`;
    return { ...link, sourceY, targetY, thickness, path };
  });
  return { width, height, labelHeight, branchGap, nodes, links: paths };
}
