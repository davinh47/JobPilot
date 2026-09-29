"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChartNoAxesCombined, ChevronDown, Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { buildPipelineFlow, layoutPipelineFlow, type FlowNode, type PipelineTransition } from "@/lib/pipeline-summary";

type SummaryStatus = { slug: string; label: string; color: string };
const colors: Record<string, string> = { gray: "#8290a4", blue: "#1455f3", amber: "#ad7c24", purple: "#8176b5", green: "#287e61", red: "#c25e68" };

function shortLabel(label: string) {
  let width = 0;
  let result = "";
  for (const char of label) {
    // Conservative width budget for 13px type, including the ellipsis, keeps
    // custom labels inside the protected straight segment of the connector.
    width += /[^\x00-\x7F]|[MWmw@%&]/.test(char) ? 14 : /[ilI .,'!]/.test(char) ? 4 : 9;
    if (width > 104) return `${result}…`;
    result += char;
  }
  return result;
}

export function PipelineSummary({ locale, rows, statuses, events }: {
  locale: Locale;
  rows: { applicationId: string; status: string }[];
  statuses: SummaryStatus[];
  events: PipelineTransition[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  return <section className="pipeline-summary" aria-labelledby={`${id}-heading`}>
    <div className="pipeline-summary-header">
      <div><h2 id={`${id}-heading`}>{text("申请全景", "Application overview")}</h2><p>{text(`${rows.length} 条记录，查看申请阶段与进展分布。`, `${rows.length} records. See your application stages and progress.`)}</p></div>
      <button className="button button-secondary" type="button" aria-expanded={open} aria-controls={`${id}-chart`} onClick={() => setOpen((value) => !value)}><ChartNoAxesCombined size={17} />{open ? text("收起流向图", "Hide flow") : text("查看流向图", "View flow")}<ChevronDown size={15} className={open ? "flow-chevron-open" : ""} /></button>
    </div>
    <div id={`${id}-chart`} hidden={!open}>
      {open ? <PipelineFlowChart locale={locale} rows={rows} statuses={statuses} events={events} /> : null}
    </div>
  </section>;
}

export function PipelineFlowChart({ locale, rows, statuses, events }: {
  locale: Locale;
  rows: { applicationId: string; status: string }[];
  statuses: SummaryStatus[];
  events: PipelineTransition[];
}) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [exportError, setExportError] = useState(false);
  const flow = useMemo(() => buildPipelineFlow(rows, events), [rows, events]);
  const layout = useMemo(() => layoutPipelineFlow(flow, statuses.map((status) => status.slug)), [flow, statuses]);
  const statusMap = new Map(statuses.map((status) => [status.slug, status]));
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const label = (node: FlowNode) => node.kind === "total" ? text("全部条目", "All records")
    : node.kind === "gap" ? text("记录缺口", "History gap")
    : node.kind === "collapsed" ? text("中间阶段已折叠", "Earlier stages folded")
    : statusMap.get(node.status)?.label ?? text("未识别状态", "Unknown status");
  const color = (node: FlowNode) => node.kind === "total" ? "#101116" : colors[statusMap.get(node.status)?.color ?? "gray"] ?? colors.gray;
  const currentByStatus = new Map<string, FlowNode>();
  for (const node of layout.nodes.filter((item) => item.currentCount > 0)) {
    const existing = currentByStatus.get(node.status);
    currentByStatus.set(node.status, existing ? { ...existing, value: existing.value + node.currentCount } : { ...node, value: node.currentCount });
  }
  const current = [...currentByStatus.values()];
  const download = () => {
    if (!svgRef.current) return;
    setExportError(false);
    try {
      const svg = svgRef.current.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", String(layout.width));
      svg.setAttribute("height", String(layout.height));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `jobpilot-application-flow-${new Date().toISOString().slice(0, 10)}.svg`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError(true); }
  };

  if (!flow.total) return <div className="pipeline-summary-empty"><ChartNoAxesCombined size={28} aria-hidden="true" /><p>{text("添加第一条申请后，这里就会出现流向图。", "Add your first application to start your flow chart.")}</p><span>{text("后续阶段变化会自动纳入，无需手动生成。", "Future status changes will be included automatically.")}</span></div>;

  return <div className="pipeline-flow-content">
    <div className="pipeline-flow-caption"><p id={`${id}-description`}>{text("按申请阶段汇总，每条申请在同一条路径中只计一次；“停留”表示尚未进入下一阶段。", "Stage summary: each application is counted once along its path. “Still here” means it has not moved to the next stage.")}</p><button className="button button-quiet compact-button" type="button" onClick={download}><Download size={15} />{text("下载 SVG", "Download SVG")}</button></div>
    <p className="pipeline-flow-scroll-hint">{text("图表可横向滚动，完整状态名称和数量见下方。", "Scroll across the chart. Full status names and counts are listed below.")}</p>
    <div className="pipeline-flow-scroll" tabIndex={0} role="region" aria-label={text("申请流向图，可滚动", "Scrollable application flow chart")}>
      <svg ref={svgRef} role="img" aria-labelledby={`${id}-title ${id}-description`} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} fontFamily="Helvetica Neue, Arial, PingFang SC, Microsoft YaHei, sans-serif">
        <title id={`${id}-title`}>{text("申请阶段流向图", "Application stage flow")}</title>
        <desc>{text("依据已记录的阶段汇总申请进展；回改产生的循环已合并，原始记录保留在时间线。", "Progress is summarized from recorded stages. Status-edit loops are simplified; original records remain in the timeline.")}</desc>
        <rect width={layout.width} height={layout.height} fill="#ffffff" />
        {layout.links.map((link) => <path key={`${link.source}:${link.target}`} d={link.path} fill={color(link.targetNode)} fillOpacity={0.24}><title>{`${label(link.sourceNode)} → ${label(link.targetNode)} · ${link.value}`}</title></path>)}
        {layout.nodes.map((node) => {
          const terminal = node.currentCount === node.value;
          const stopped = node.currentCount > 0 && !terminal;
          return <g key={node.id}>
            <title>{`${label(node)} · ${node.value}${stopped ? text(` · ${node.currentCount} 条停留`, ` · ${node.currentCount} still here`) : ""}`}</title>
            <rect x={node.x} y={node.y} width={12} height={node.height} fill={color(node)} />
            {!terminal ? <><text x={node.x + 14} y={node.y - 32} fill="#101116" fontSize={19} fontWeight={700}>{node.value}{stopped ? <tspan dx={8} fill="#596477" fontSize={10} fontWeight={400}>{text(`${node.currentCount} 条停留`, `${node.currentCount} still here`)}</tspan> : null}</text><text x={node.x + 14} y={node.y - 12} fill="#363d49" fontSize={13}>{shortLabel(label(node))}</text></> : null}
            {terminal ? <><text x={node.x + 23} y={node.y + node.height / 2 - 3} fill="#101116" fontSize={19} fontWeight={700}>{node.value}</text><text x={node.x + 23} y={node.y + node.height / 2 + 17} fill="#363d49" fontSize={13}>{shortLabel(label(node))}</text></> : null}
          </g>;
        })}
      </svg>
    </div>
    <ul className="pipeline-flow-legend" aria-label={text("当前状态统计", "Current status counts")}>{current.map((node) => <li key={node.id}><i aria-hidden="true" style={{ background: color(node) }} /><span>{label(node)}</span><strong>{node.value}</strong><small>{Math.round(node.value / flow.total * 100)}%</small></li>)}</ul>
    <div className="pipeline-flow-notes">
      {layout.nodes.filter((node) => node.currentCount > 0).length > current.length ? <p>{text("不同历史路径分别展示，同名当前状态的合计见上方。", "Different histories are shown separately. Current status totals are listed above.")}</p> : null}
      {flow.simplifiedHistory > 0 ? <p>{text("重复和回改状态已合并展示；完整修改记录仍保留在申请时间线。", "Repeated and reverted statuses are simplified here; the full edit history remains in each application timeline.")}</p> : null}
      {flow.withoutHistory > 0 ? <p>{text(`${flow.withoutHistory} 条暂无阶段变更记录，仅展示当前状态。`, `${flow.withoutHistory} records have no status-change history; only their current status is shown.`)}</p> : null}
      {flow.incompleteHistory > 0 ? <p>{text(`${flow.incompleteHistory} 条存在记录缺口，不推测缺失阶段。`, `${flow.incompleteHistory} records have history gaps. Missing stages are not inferred.`)}</p> : null}
      {flow.collapsedHistory > 0 ? <p>{text(`${flow.collapsedHistory} 条较长路径已折叠中间记录，保留最早和最近的阶段。`, `${flow.collapsedHistory} longer paths have folded middle visits, keeping the earliest and most recent stages.`)}</p> : null}
    </div>
    {exportError ? <p className="form-error" role="alert">{text("下载失败，请重试。", "Download failed. Please try again.")}</p> : null}
  </div>;
}
