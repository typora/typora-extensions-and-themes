// Dispatches a ```mermaid fence to the built-in renderers (not the Mermaid library): flowchart / graph,
// sequenceDiagram, pie and gantt. Any other diagram type throws a readable
// error and the slide shows the source instead.
import { renderFlowSvg } from "./flow.js";
import { renderSequenceSvg } from "./sequence.js";
import { renderGanttSvg } from "./gantt.js";
import { renderChartSvg } from "./charts.js";

// `pie [showData]`, optional `title X`, then `"label" : value` lines.
export function parsePie(source) {
  const lines = String(source).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
  const head = /^pie(?:\s+showData)?(?:\s+title\s+(.+))?$/i.exec(lines.shift() || "");
  if (!head) throw new Error("这不是饼图。");
  let title = (head[1] || "").trim();
  const data = [];
  for (const line of lines) {
    let m;
    if ((m = /^title\s+(.+)$/i.exec(line))) title = m[1].trim();
    else if ((m = /^"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?)$/.exec(line)) || (m = /^([^":]+?)\s*:\s*(-?\d+(?:\.\d+)?)$/.exec(line))) data.push({ name: m[1].trim(), value: Number(m[2]) });
    else throw new Error(`无法解析饼图：${line}`);
  }
  if (!data.length) throw new Error("饼图里没有数据。");
  return { series: [{ type: "pie", data }], ...(title ? { title: { text: title } } : {}) };
}

export function renderMermaidSvg(source, theme) {
  const first = String(source).split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("%%")) || "";
  const kind = /^(graph|flowchart|sequenceDiagram|pie|gantt)\b/i.exec(first)?.[1].toLowerCase();
  if (kind === "graph" || kind === "flowchart") return renderFlowSvg(source, theme);
  if (kind === "sequencediagram") return renderSequenceSvg(source, theme);
  if (kind === "pie") return renderChartSvg(parsePie(source), theme, { width: 960, height: 460 });
  if (kind === "gantt") return renderGanttSvg(source, theme);
  throw new Error("演示里支持流程图、序列图、饼图和甘特图，其他 Mermaid 图显示为源码。");
}
