const NS = "http://www.w3.org/2000/svg";
const REFRESH_PREFIX = "graph-refresh-";
const REFRESH_DONE = "graph-refresh-done";
const REFRESH_WAIT = 60_000;
const AI_PREFIX = "graph-ai-";
const AI_DONE = "graph-ai-done";
const AI_WAIT = 120_000;
const HOVER_LIMIT = 400;
const GROUPS = 6;
const LIST_LIMIT = 30;
const HUB_LABELS = 10;
const LABEL_GROUP_LIMIT = 20;
const MAX_RADIUS = 14;
const REGION_MIN_NODES = 8;
const PREFS = "graph-view-prefs";
function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
    return { layout: saved.layout === "side" ? "side" : "stack", grouped: saved.grouped !== false };
  } catch {
    return { layout: "stack", grouped: true };
  }
}
function savePrefs() {
  try { localStorage.setItem(PREFS, JSON.stringify({ layout: state.layout, grouped: state.grouped })); } catch { /* storage unavailable */ }
}
const state = { ...loadPrefs(), full: false, scope: "local", depth: 1, query: "", orphans: true, broken: true, parents: true, tasks: true, arrows: false, selected: undefined, group: undefined, dock: false, hover: undefined, view: undefined, refreshing: false, refreshError: "" };
let currentContext;
let shownSnapshot;
let data;
let svg;
let detailBox;
let legendBox;
let countLine;
let refreshButton;
let dockBox;
let countRefs = {};
let sideBox;
let miniBox;
let sideSignature = "";
let infoMap = {};
let globalGraph;
let loadedGlobalId;
let graphRequest = 0;
let frame;
const aiResults = new Map();
const aiPending = new Set();

const ICONS = {
  refresh: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  stack: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], "M3 12h18"],
  side: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], "M12 3v18"],
  expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
  shrink: ["M4 14h6v6", "M20 10h-6V4", "M14 10l7-7", "M3 21l7-7"],
  fit: ["M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3"],
  folder: ["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],
  unlink: ["m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71", "m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71", "M8 2v3", "M2 8h3", "M16 22v-3", "M19 16h3"],
  layers: ["m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z", "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65", "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"],
  task: [["circle", { cx: 12, cy: 12, r: 10 }], "m9 12 2 2 4-4"],
  arrow: ["M5 12h14", "m12 5 7 7-7 7"],
  orphan: [["circle", { cx: 12, cy: 12, r: 9, "stroke-dasharray": "3 3" }], ["circle", { cx: 12, cy: 12, r: 2 }]],
  sparkles: ["M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"],
  chevron: ["m6 9 6 6 6-6"],
  file: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
  up: ["m5 12 7-7 7 7", "M12 19V5"],
  down: ["M12 5v14", "m19 12-7 7-7-7"],
  inbound: ["M17 7 7 17", "M17 17H7V7"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  chart: ["M3 3v16a2 2 0 0 0 2 2h16", "M7 16V9", "M12 16V5", "M17 16v-4"],
  link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  text: ["M17 6.1H3", "M21 12.1H3", "M15.1 18H3"],
  outbound: ["M7 7h10v10", "M7 17 17 7"],
  search: [["circle", { cx: 11, cy: 11, r: 8 }], "m21 21-4.3-4.3"],
  hull: [["circle", { cx: 9, cy: 9, r: 5, "stroke-dasharray": "2 2" }], ["circle", { cx: 15, cy: 15, r: 5, "stroke-dasharray": "2 2" }]],
  hierarchy: [["circle", { cx: 12, cy: 5, r: 2 }], ["circle", { cx: 6, cy: 19, r: 2 }], ["circle", { cx: 18, cy: 19, r: 2 }], "M12 7v5m0 0-6 5m6-5 6 5"],
};

function icon(name) {
  const node = make("svg", { class: "graph-ic", viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", "stroke-width": 1.9, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  for (const part of ICONS[name]) node.append(typeof part === "string" ? make("path", { d: part }) : make(part[0], part[1]));
  return node;
}

const control = (tag, props) => Object.assign(document.createElement(tag), props);
const today = () => new Date().toLocaleDateString("sv");

function make(tag, attrs, text) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text != null) node.textContent = text;
  return node;
}

function shown() {
  const wide = state.scope === "global" && !data.overflow && globalGraph;
  return wide ? { graph: globalGraph, size: data.size } : { graph: data.local[state.depth - 1], size: data.localSize };
}

function lookup() {
  return globalGraph && !data.overflow ? globalGraph : shown().graph;
}

function adjacency(edges) {
  const result = new Map();
  for (const { source, target } of edges) {
    if (!result.has(source)) result.set(source, new Set());
    if (!result.has(target)) result.set(target, new Set());
    result.get(source).add(target);
    result.get(target).add(source);
  }
  return result;
}

function groupIndex() {
  const groups = [...new Set(lookup().nodes.filter((node) => !node.broken).map((node) => node.group))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  return new Map(groups.map((group, index) => [group, Math.min(index, GROUPS - 1)]));
}

const textUnits = (text) => [...text].reduce((sum, char) => sum + (char.codePointAt(0) > 255 ? 1 : 0.58), 0);

function pill(x, y, text, size, unit, className, attrs = {}) {
  const width = textUnits(text) * size + 10 * unit;
  const height = size + 7 * unit;
  const group = make("g", { class: className });
  group.append(make("rect", { class: "graph-pill", x, y: y - height / 2, width, height, rx: height / 2 }));
  group.append(make("text", { class: `graph-label${attrs.strong ? " strong" : ""}`, x: x + 5 * unit, y: y + size * 0.36, "font-size": size }, text));
  return group;
}

function drawHulls(graph, groups, unit) {
  const layer = make("g", {});
  const members = new Map();
  for (const node of graph.nodes) {
    if (node.broken) continue;
    if (!members.has(node.group)) members.set(node.group, []);
    members.get(node.group).push(node);
  }
  const labels = [];
  for (const [name, nodes] of [...members].sort((a, b) => b[1].length - a[1].length)) {
    if (nodes.length < 2) continue;
    const pad = 18 * unit;
    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // An ellipse through the corners of the bounding box would cover a lot of empty space, so 1.2 of the half extent plus padding.
    const rx = ((Math.max(...xs) - Math.min(...xs)) / 2) * 1.2 + pad;
    const ry = ((Math.max(...ys) - Math.min(...ys)) / 2) * 1.2 + pad;
    const index = groups.get(name) ?? 0;
    const box = make("g", { class: `graph-hull g${index}` });
    box.append(make("ellipse", { class: "graph-hull-box", cx, cy, rx, ry, "stroke-width": unit, "stroke-dasharray": `${4 * unit} ${4 * unit}` }));
    const text = name || "根目录";
    const labelWidth = textUnits(text) * 11 * unit + 10 * unit;
    const x = cx - labelWidth / 2;
    let y = cy - ry;
    // Ellipses of different folders overlap in a local graph, so push a name down until it clears the others.
    while (labels.some((other) => x < other.x + other.width && x + labelWidth > other.x && Math.abs(y - other.y) < 16 * unit) && y < cy) y += 16 * unit;
    labels.push({ x, y, width: labelWidth });
    box.append(pill(x, y, text, 11 * unit, unit, "graph-hull-label"));
    layer.append(box);
  }
  svg.append(layer);
}

// In dense graphs boxes would cover everything, so each folder gets a faint name at its centre.
function drawRegions(graph, groups, unit) {
  const layer = make("g", {});
  const members = new Map();
  for (const node of graph.nodes) {
    if (node.broken) continue;
    if (!members.has(node.group)) members.set(node.group, []);
    members.get(node.group).push(node);
  }
  const middle = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const placed = [];
  const regions = [...members].filter(([, nodes]) => nodes.length >= REGION_MIN_NODES).sort((a, b) => b[1].length - a[1].length);
  for (const [name, nodes] of regions) {
    const index = groups.get(name) ?? 0;
    const size = Math.min(17, 11 + Math.sqrt(nodes.length) * 0.4) * unit;
    const label = name || "根目录";
    const width = textUnits(label) * size;
    const x = middle(nodes.map((node) => node.x));
    let y = [...nodes.map((node) => node.y)].sort((a, b) => a - b)[Math.floor(nodes.length * 0.04)] - size * 0.8;
    const clash = () => placed.some((box) => Math.abs(box.x - x) < (box.width + width) / 2 && Math.abs(box.y - y) < size * 1.1);
    for (let step = 0; step < 8 && clash(); step++) y -= size * 1.1;
    placed.push({ x, y, width });
    layer.append(make("text", { class: `graph-region g${index}`, x, y, "font-size": size, "text-anchor": "middle", "stroke-width": 6 * unit }, label));
  }
  svg.append(layer);
}

const isDense = (graph) => graph.nodes.length > 60;

function linkedIds(graph) {
  return new Set(graph.edges.filter((edge) => state.parents || edge.kind !== "parent").flatMap(({ source, target }) => [source, target]));
}

function filtered(graph) {
  let nodes = graph.nodes;
  if (!state.broken) nodes = nodes.filter((node) => !node.broken);
  const linked = linkedIds(graph);
  if (!state.orphans || isDense(graph)) nodes = nodes.filter((node) => linked.has(node.id) || node.path === data.current);
  if (state.group !== undefined) nodes = nodes.filter((node) => node.broken || node.group === state.group);
  let edges = graph.edges.filter((edge) => state.parents || edge.kind !== "parent");
  let ids = new Set(nodes.map((node) => node.id));
  edges = edges.filter(({ source, target }) => ids.has(source) && ids.has(target));
  if (state.group !== undefined) {
    const touched = new Set(edges.flatMap(({ source, target }) => [source, target]));
    nodes = nodes.filter((node) => !node.broken || touched.has(node.id));
  }
  return { nodes, edges };
}

function setViewBox() {
  const { x, y, width, height } = state.view;
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
}

function fitView(size) {
  const pixels = svg.getBoundingClientRect().width || size.width;
  const fit = pixels / Math.max(pixels - 80, pixels / 2);
  state.view = { x: 0, y: -22, width: size.width * fit, height: size.height * fit + 22 };
}

function draw() {
  const { graph: full, size } = shown();
  const graph = filtered(full);
  const terms = globalThis.graphMatch.parseQuery(state.query);
  const near = adjacency(graph.edges);
  const focusId = state.hover ?? state.selected;
  const focus = focusId && graph.nodes.some(({ id }) => id === focusId) ? focusId : undefined;
  const lit = focus ? new Set([focus, ...(near.get(focus) ?? [])]) : undefined;
  const matched = terms ? new Set(graph.nodes.filter((node) => globalThis.graphMatch.matchNode(terms, node, infoMap[node.path])).map(({ id }) => id)) : undefined;
  const currentNode = graph.nodes.find(({ path }) => path && path === data.current);
  const neighbours = currentNode ? near.get(currentNode.id) ?? new Set() : new Set();
  const dense = graph.nodes.length > 60;
  const groups = groupIndex();
  if (!state.view) fitView(size);
  setViewBox();
  const unit = state.view.width / (svg.getBoundingClientRect().width || state.view.width);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const radius = new Map(graph.nodes.map((node) => [node.id, Math.min(3.2 + Math.sqrt(near.get(node.id)?.size ?? 0) * 1.5, MAX_RADIUS) * unit + (node.id === currentNode?.id ? 1.5 * unit : 0)]));
  const late = today();
  svg.replaceChildren();
  if (state.grouped && !dense) drawHulls(graph, groups, unit);
  for (const { source, target, kind } of graph.edges) {
    const from = byId.get(source);
    const to = byId.get(target);
    const touches = source === focus || target === focus;
    const classes = ["graph-edge", kind];
    if (touches) classes.push("active");
    else if (lit) classes.push("graph-dim");
    const line = make("line", { class: classes.join(" "), x1: from.x, y1: from.y, x2: to.x, y2: to.y, "stroke-width": 1.2 * unit });
    if (kind === "parent") line.setAttribute("stroke-dasharray", `${5 * unit} ${3.5 * unit}`);
    svg.append(line);
    if (state.arrows && kind === "link") {
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      const tip = { x: to.x - ux * (radius.get(target) + unit), y: to.y - uy * (radius.get(target) + unit) };
      const back = 6 * unit;
      const wing = 2.6 * unit;
      const points = [tip, { x: tip.x - ux * back - uy * wing, y: tip.y - uy * back + ux * wing }, { x: tip.x - ux * back + uy * wing, y: tip.y - uy * back - ux * wing }];
      svg.append(make("polygon", { class: `graph-arrow${touches ? " active" : lit ? " graph-dim" : ""}`, points: points.map((p) => `${p.x},${p.y}`).join(" ") }));
    }
  }
  const hubs = new Set(dense ? [...graph.nodes].sort((a, b) => (near.get(b.id)?.size ?? 0) - (near.get(a.id)?.size ?? 0)).slice(0, HUB_LABELS).map((node) => node.id) : []);
  const nodeLayer = make("g", {});
  const labelLayer = make("g", {});
  const candidates = [];
  for (const node of graph.nodes) {
    const degree = near.get(node.id)?.size ?? 0;
    const isCurrent = node.id === currentNode?.id;
    const r = radius.get(node.id);
    const classes = ["graph-node"];
    if (node.broken) classes.push("broken");
    else classes.push(`g${groups.get(node.group) ?? 0}`);
    if (isCurrent) classes.push("current");
    else if (neighbours.has(node.id)) classes.push("near");
    if (node.id === state.selected) classes.push("selected");
    const dimmed = (lit && !lit.has(node.id)) || (matched && !matched.has(node.id));
    const group = make("g", { class: dimmed ? "graph-dim" : "" });
    if (isCurrent) group.append(make("circle", { class: "graph-halo", cx: node.x, cy: node.y, r: r + 5 * unit }));
    const circle = make("circle", { class: classes.join(" "), cx: node.x, cy: node.y, r, "data-id": node.id, "stroke-width": 1.5 * unit });
    if (node.broken) circle.setAttribute("stroke-dasharray", `${2.2 * unit} ${2.2 * unit}`);
    circle.append(make("title", {}, node.name));
    group.append(circle);
    const info = infoMap[node.path];
    if (state.tasks && info?.open) {
      group.append(make("circle", { class: `graph-task${info.due && info.due < late ? " late" : ""}`, cx: node.x + r * 0.8, cy: node.y - r * 0.8, r: (info.due && info.due < late ? 3.6 : 2.8) * unit, "stroke-width": unit }));
    }
    nodeLayer.append(group);
    const emphasised = isCurrent || node.id === state.selected || node.id === focus || (matched?.has(node.id) && matched.size <= LABEL_GROUP_LIMIT) || (lit?.has(node.id) && lit.size <= LABEL_GROUP_LIMIT);
    if (emphasised || !dense || hubs.has(node.id)) {
      candidates.push({ node, r, dimmed, strong: isCurrent || node.id === state.selected, rank: emphasised ? 2 : 1, degree });
    }
  }
  const taken = [];
  const labelSize = 12 * unit;
  candidates.sort((a, b) => b.rank - a.rank || b.degree - a.degree);
  for (const { node, r, dimmed, strong } of candidates) {
    const x = node.x + r + 3 * unit;
    const box = { left: x, right: x + textUnits(node.name) * labelSize + 10 * unit, top: node.y - labelSize * 0.7, bottom: node.y + labelSize * 0.7 };
    if (taken.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
    taken.push(box);
    labelLayer.append(pill(x, node.y, node.name, labelSize, unit, dimmed ? "graph-dim" : "", { strong }));
  }
  svg.append(nodeLayer);
  if (state.grouped && dense) drawRegions(graph, groups, unit);
  svg.append(labelLayer);
  drawCounts(graph, full);
  drawDock(full, groups);
  drawLegend(graph, groups);
  drawMini(graph, size, groups);
  drawSide(sideGraph(full), full, groups);
}

function drawMini(graph, size, groups) {
  if (!miniBox) return;
  const dot = Math.max(size.width, size.height) / 55;
  miniBox.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
  miniBox.replaceChildren();
  for (const node of graph.nodes) miniBox.append(make("circle", { class: `mini-dot ${node.broken ? "broken" : `g${groups.get(node.group) ?? 0}`}`, cx: node.x, cy: node.y, r: dot }));
  const { x, y, width, height } = state.view;
  miniBox.append(make("rect", { class: "mini-view", x, y, width, height }));
}

// The folder tree lists every note except what the toggles hide, so a folder filter can always be switched off again.
function sideGraph(full) {
  let nodes = full.nodes;
  if (!state.broken) nodes = nodes.filter((node) => !node.broken);
  if (!state.orphans) {
    const linked = linkedIds(full);
    nodes = nodes.filter((node) => linked.has(node.id) || node.path === data.current);
  }
  return { nodes, edges: full.edges };
}

function orphanNotes(full) {
  const linked = linkedIds(full);
  return full.nodes.filter((node) => !node.broken && !linked.has(node.id) && (state.group === undefined || node.group === state.group));
}

function drawCounts(graph, full) {
  const stat = (glyph, value, title) => {
    const item = control("span", { title });
    item.append(glyph, control("b", { textContent: value.toLocaleString() }));
    return item;
  };
  countLine.replaceChildren(stat(control("i", { className: "swatch ink" }), graph.nodes.length, "节点"), stat(icon("link"), graph.edges.length, "链接"));
  const open = full.nodes.filter((node) => infoMap[node.path]?.open).length;
  const values = { orphans: noteStats(full)[2][2], broken: full.nodes.filter((node) => node.broken).length, tasks: open };
  for (const [key, value] of Object.entries(values)) if (countRefs[key]) countRefs[key].textContent = String(value);
}

function drawDock(full, groups) {
  if (!dockBox) return;
  const list = isDense(filtered(full)) && state.orphans ? orphanNotes(full) : [];
  dockBox.hidden = list.length === 0;
  dockBox.replaceChildren();
  if (!list.length) return;
  const toggle = control("button", { type: "button", className: "dock-toggle" });
  toggle.setAttribute("aria-expanded", String(state.dock));
  const dots = control("span", { className: "dock-dots" });
  for (const index of [...new Set(list.map((node) => groups.get(node.group) ?? 0))].slice(0, 6)) dots.append(control("i", { className: `swatch g${index}` }));
  toggle.append(dots, control("span", { textContent: `孤立 · ${list.length}` }), icon("chevron"));
  toggle.addEventListener("click", () => { state.dock = !state.dock; drawDock(full, groups); });
  dockBox.append(toggle);
  if (!state.dock) return;
  const panel = control("div", { className: "dock-panel" });
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  for (const node of sorted.slice(0, 60)) {
    const button = control("button", { type: "button", className: "pill-link", textContent: node.name, title: node.path ?? node.name });
    button.addEventListener("click", () => select(node.id));
    panel.append(button);
  }
  if (sorted.length > 60) panel.append(control("span", { className: "rel-more", textContent: `另有 ${sorted.length - 60} 个` }));
  dockBox.append(panel);
}

function toggleGroup(key) {
  state.group = state.group === key ? undefined : key;
  state.view = undefined;
  sideSignature = "";
  draw();
}

function noteStats(full) {
  const notes = full.nodes.filter((node) => !node.broken);
  const linked = new Set(full.edges.flatMap(({ source, target }) => [source, target]));
  return [
    ["list", "笔记总数", notes.length],
    ["link", "链接总数", full.edges.filter((edge) => edge.kind === "link").length],
    ["orphan", "孤立笔记", notes.filter((node) => !linked.has(node.id)).length],
    ["unlink", "断链节点", full.nodes.length - notes.length],
  ];
}

function treeItem(node, groups, active) {
  const button = control("button", { type: "button", className: `tree-item${node.id === active ? " active" : ""}`, title: node.path ?? node.name });
  button.append(control("i", { className: `swatch ${node.broken ? "hollow" : `g${groups.get(node.group) ?? 0}`}` }), control("span", { textContent: node.name }));
  button.addEventListener("click", () => select(node.id));
  return button;
}

function drawSide(graph, full, groups) {
  if (!sideBox) return;
  const active = state.selected ?? currentNodeId();
  const signature = [active, state.query, state.grouped, state.group, state.scope, state.depth, graph.nodes.length, graph.edges.length, data.version].join("|");
  if (signature === sideSignature) return;
  sideSignature = signature;
  const nodes = [...graph.nodes].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const head = control("div", { className: "side-head" });
  head.append(icon(state.grouped ? "folder" : "list"), control("span", { textContent: state.grouped ? "分组视图" : `节点列表 (${nodes.length})` }));
  const tree = control("div", { className: "tree" });
  if (state.grouped) {
    const members = new Map();
    for (const node of nodes) {
      const key = node.broken ? "\0" : node.group;
      if (!members.has(key)) members.set(key, []);
      members.get(key).push(node);
    }
    const ordered = [...members].sort(([a], [b]) => (a === "\0") - (b === "\0") || a.localeCompare(b, "zh-CN"));
    const noted = ordered.filter(([key]) => key !== "\0");
    const total = noted.reduce((sum, [, list]) => sum + list.length, 0) || 1;
    const biggest = Math.max(1, ...noted.map(([, list]) => list.length));
    const share = control("div", { className: "share-bar" });
    for (const [key, list] of noted) {
      const part = control("button", { type: "button", className: `share-part swatch-bg g${groups.get(key) ?? 0}${state.group !== undefined && state.group !== key ? " off" : ""}`, title: `${key || "根目录"} · ${list.length}` });
      part.style.flexGrow = String(list.length);
      part.setAttribute("aria-label", `${key || "根目录"}，${list.length}`);
      part.addEventListener("click", () => toggleGroup(key));
      share.append(part);
    }
    if (noted.length > 1) tree.append(share);
    for (const [key, list] of ordered) {
      const details = control("details", { className: "tree-group", open: list.length <= 8 || list.some((node) => node.id === active) });
      const summary = control("summary");
      const mark = key === "\0" ? icon("unlink") : control("i", { className: `swatch g${groups.get(key) ?? 0}` });
      summary.append(mark, control("span", { className: "rel-title", textContent: key === "\0" ? "未分组" : key || "根目录" }));
      if (key !== "\0") {
        const bar = control("span", { className: "mini-bar" });
        const fillBar = control("i", { className: `swatch-bg g${groups.get(key) ?? 0}` });
        fillBar.style.width = `${Math.max(6, Math.round((list.length / biggest) * 100))}%`;
        bar.append(fillBar);
        summary.append(bar);
        summary.title = "点击色块只看这个目录";
        mark.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); toggleGroup(key); });
        if (state.group !== undefined && state.group !== key) details.classList.add("off");
      }
      summary.append(control("span", { className: "rel-count", textContent: String(list.length) }), icon("chevron"));
      const items = control("div", { className: "tree-items" });
      const fill = () => {
        if (items.childNodes.length) return;
        for (const node of list.slice(0, 200)) items.append(treeItem(node, groups, active));
        if (list.length > 200) items.append(control("span", { className: "rel-more", textContent: `另有 ${list.length - 200} 个` }));
      };
      details.addEventListener("toggle", () => { if (details.open) fill(); });
      if (details.open) fill();
      details.append(summary, items);
      tree.append(details);
    }
  } else {
    for (const node of nodes.slice(0, 200)) tree.append(treeItem(node, groups, active));
    if (nodes.length > 200) tree.append(control("span", { className: "rel-more", textContent: `另有 ${nodes.length - 200} 个` }));
  }
  const stats = control("div", { className: "stats" });
  stats.append(control("div", { className: "side-head" }));
  stats.firstChild.append(icon("chart"), control("span", { textContent: "统计信息" }));
  for (const [glyph, label, value] of noteStats(full)) {
    const row = control("div", { className: "stat-row" });
    row.append(icon(glyph), control("span", { textContent: label }), control("b", { textContent: String(value) }));
    stats.append(row);
  }
  sideBox.replaceChildren(head, tree, stats);
}

function currentNodeId() {
  return lookup().nodes.find((node) => node.path && node.path === data.current)?.id;
}

function drawLegend(graph, groups) {
  legendBox.replaceChildren();
  const add = (className, text) => {
    const item = control("span");
    item.append(control("i", { className: `swatch ${className}` }), text);
    legendBox.append(item);
  };
  const used = [...new Set(graph.nodes.filter((node) => !node.broken).map((node) => groups.get(node.group) ?? 0))].sort((a, b) => a - b);
  const names = new Map();
  for (const [group, index] of groups) names.set(index, names.has(index) ? "其他" : group || "根目录");
  for (const index of used) add(`g${index}`, names.get(index) ?? "根目录");
  if (graph.nodes.some((node) => node.path === data.current)) add("current", "当前");
  if (graph.nodes.some((node) => node.broken)) add("hollow", "断链");
  if (state.tasks && graph.nodes.some((node) => infoMap[node.path]?.open)) add("task", "待办");
  if (state.parents && graph.edges.some(({ kind }) => kind === "parent")) add("line", "层级");
}

function pillButton(name, onClick) {
  const button = control("button", { type: "button", className: "pill-link", textContent: name, title: name });
  button.addEventListener("click", onClick);
  return button;
}

function relatedList(title, iconName, ids, byId) {
  if (!ids.length) return undefined;
  const section = control("details", { className: "rel", open: ids.length <= 12 });
  const head = control("summary");
  head.append(icon(iconName), control("span", { className: "rel-title", textContent: title }), control("span", { className: "rel-count", textContent: String(ids.length) }), icon("chevron"));
  const list = control("div", { className: "rel-list" });
  for (const id of ids.slice(0, LIST_LIMIT)) list.append(pillButton(byId.get(id).name, () => select(id)));
  if (ids.length > LIST_LIMIT) list.append(control("span", { className: "rel-more", textContent: `另有 ${ids.length - LIST_LIMIT} 个` }));
  section.append(head, list);
  return section;
}

function aiKey(node) {
  return `${data.scope}:${node.id}:${data.version}`;
}

async function askAi(node, byId) {
  const key = aiKey(node);
  if (aiPending.has(key)) return;
  aiPending.add(key);
  aiResults.delete(key);
  renderDetail();
  const request = `${AI_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sources = node.broken ? lookup().edges.filter((edge) => edge.kind === "link" && edge.target === node.id).map((edge) => byId.get(edge.source)?.path).filter(Boolean).slice(0, 5) : [];
  try {
    await sdk.storage.set(request, { at: Date.now(), scope: data.scope, kind: node.broken ? "broken" : "note", path: node.path, name: node.name, sources });
    const started = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const response = (await sdk.storage.get(AI_DONE))?.[request];
      if (response) {
        aiResults.set(key, response);
        break;
      }
      if (Date.now() - started > AI_WAIT) {
        aiResults.set(key, { error: "等待模型超时" });
        break;
      }
    }
  } catch (error) {
    aiResults.set(key, { error: error.message });
  }
  aiPending.delete(key);
  if (state.selected === node.id) renderDetail();
}

function aiBlock(node, byId) {
  const block = control("section", { className: "graph-ai" });
  const key = aiKey(node);
  const busy = aiPending.has(key);
  const button = control("button", { type: "button", className: "chip ai", disabled: busy });
  button.append(icon("sparkles"), busy ? "整理中" : "整理建议");
  button.addEventListener("click", () => void askAi(node, byId));
  block.append(button);
  const outcome = aiResults.get(key);
  if (!outcome) return block;
  if (outcome.error) {
    block.append(control("p", { className: "ai-note", textContent: `整理失败：${outcome.error}` }));
    return block;
  }
  const { summary, tags, related, matches } = outcome.result;
  if (summary) block.append(control("p", { className: "ai-note", textContent: summary }));
  if (tags.length) {
    const row = control("div", { className: "tag-row" });
    for (const tag of tags) row.append(control("span", { className: "tag", textContent: `#${tag}` }));
    block.append(row);
  }
  const rows = node.broken ? matches : related;
  if (rows.length) {
    block.append(control("h3", { className: "ai-head", textContent: node.broken ? "可能指向" : "建议关联" }));
    const list = control("div", { className: "ai-rows" });
    for (const { path, reason } of rows) {
      const item = control("div", { className: "ai-row" });
      const target = byId.get(path);
      if (target) {
        item.append(pillButton(target.name, () => select(target.id)));
      } else {
        item.append(path.split("/").at(-1).replace(/\.(?:md|markdown)$/i, ""));
      }
      if (reason) item.append(control("span", { className: "ai-reason", textContent: reason }));
      list.append(item);
    }
    block.append(list);
  } else if (!summary && !tags.length) {
    block.append(control("p", { className: "ai-note", textContent: "没有可用建议" }));
  }
  return block;
}

function detailSection(glyph, title) {
  const box = control("section", { className: "d-sec" });
  const head = control("h3", { className: "d-head" });
  head.append(icon(glyph), title);
  box.append(head);
  return box;
}

function renderDetail() {
  detailBox.replaceChildren();
  const graph = lookup();
  const id = state.selected ?? currentNodeId();
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) return;
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const touching = graph.edges.filter((edge) => (edge.source === node.id || edge.target === node.id) && byId.has(edge.source) && byId.has(edge.target));
  const groups = groupIndex();
  const top = control("div", { className: "d-top" });
  const badge = control("span", { className: "d-badge" });
  badge.append(control("i", { className: node.broken ? "swatch hollow" : `swatch g${groups.get(node.group) ?? 0}` }), node.broken ? "断链" : node.group || "根目录");
  const degree = control("span", { className: `d-degree${touching.length ? "" : " zero"}`, title: "链接数" });
  degree.append(icon("link"), control("b", { textContent: String(touching.length) }));
  top.append(badge, degree);
  const title = control("div", { className: "d-title" });
  title.append(control("h2", { textContent: node.name }));
  detailBox.append(top, title);
  if (node.path) {
    const path = control("div", { className: "detail-path", title: node.path });
    path.append(icon("file"), control("span", { textContent: node.path }));
    detailBox.append(path);
  }
  const info = infoMap[node.path];
  if (info && (info.open || info.done || info.cards || info.tags.length || info.props.length)) {
    const sum = detailSection("text", "内容摘要");
    const meta = control("div", { className: "tag-row" });
    const late = info.due && info.due < today();
    if (info.open) {
      const span = control("span", { className: `tag${late ? " late" : ""}` });
      span.append(icon("task"), `待办 ${info.open}${info.due ? ` · ${info.due}` : ""}${late ? " 已逾期" : ""}`);
      meta.append(span);
    }
    if (info.done) meta.append(control("span", { className: "tag", textContent: `已完成 ${info.done}` }));
    if (info.cards) {
      const span = control("span", { className: "tag" });
      span.append(icon("layers"), `复习卡片 ${info.cards}`);
      meta.append(span);
    }
    for (const tag of info.tags) meta.append(control("span", { className: "tag", textContent: `#${tag}` }));
    if (meta.childNodes.length) sum.append(meta);
    if (info.props.length) {
      const props = control("dl", { className: "d-props" });
      for (const [key, value] of info.props) props.append(control("dt", { textContent: key }), control("dd", { textContent: value }));
      sum.append(props);
    }
    detailBox.append(sum);
  }
  const ai = detailSection("sparkles", "整理建议");
  ai.append(aiBlock(node, byId));
  detailBox.append(ai);
  const pick = (kind, from, to) => [...new Set(graph.edges.filter((edge) => edge.kind === kind && edge[from] === node.id && byId.has(edge[to])).map((edge) => edge[to]))];
  const tree = detailSection("layers", "层级结构");
  const links = detailSection("link", "链接");
  for (const [box, list] of [[tree, [relatedList("上级", "up", pick("parent", "source", "target"), byId), relatedList("下级", "down", pick("parent", "target", "source"), byId)]], [links, [relatedList("反向链接", "inbound", pick("link", "target", "source"), byId), relatedList("出链", "outbound", pick("link", "source", "target"), byId)]]]) {
    const present = list.filter(Boolean);
    if (!present.length) continue;
    box.append(...present);
    detailBox.append(box);
  }
}

function select(id) {
  state.selected = id;
  renderDetail();
  draw();
}

async function refresh() {
  if (state.refreshing || !data?.scope) return;
  const scope = data.scope;
  state.refreshing = true;
  state.refreshError = "";
  refreshButton.disabled = true;
  refreshButton.classList.add("spin");
  const key = `${REFRESH_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await sdk.storage.set(key, { scope, at: Date.now() });
    const started = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const response = (await sdk.storage.get(REFRESH_DONE))?.[key];
      if (response) {
        state.refreshError = response.error;
        break;
      }
      if (Date.now() - started > REFRESH_WAIT) {
        state.refreshError = "刷新超时";
        break;
      }
    }
  } catch (error) {
    state.refreshError = error.message;
  }
  state.refreshing = false;
  shownSnapshot = undefined;
  await readGraph().catch(() => {});
}

const LOADING_NODES = [[34, 78], [82, 34], [132, 70], [96, 100], [168, 36]];
const LOADING_LINKS = [[0, 1], [1, 2], [2, 3], [1, 3], [2, 4]];

function showLoading() {
  output.replaceChildren();
  const box = control("div", { className: "graph-loading" });
  const canvas = make("svg", { viewBox: "0 0 200 130", "aria-hidden": "true" });
  LOADING_LINKS.forEach(([from, to], index) => {
    const line = make("line", { x1: LOADING_NODES[from][0], y1: LOADING_NODES[from][1], x2: LOADING_NODES[to][0], y2: LOADING_NODES[to][1] });
    line.style.animationDelay = `${index * 0.3}s`;
    canvas.append(line);
  });
  LOADING_NODES.forEach(([x, y], index) => {
    const dot = make("circle", { cx: x, cy: y, r: 5 });
    dot.style.animationDelay = `${index * 0.25}s`;
    canvas.append(dot);
  });
  box.append(canvas, control("p", { textContent: "正在建立索引" }));
  output.append(box);
}

function build() {
  output.replaceChildren();
  if (!data.current && !data.overflow && !data.version) {
    output.textContent = "没有当前笔记的关系";
    return;
  }
  const top = control("div", { className: "graph-bar" });
  const mode = control("select", { className: "scope-select", title: "范围" });
  mode.setAttribute("aria-label", "范围");
  for (const [value, label, disabled] of [["local-1", "局部 · 1 层"], ["local-2", "局部 · 2 层"], ["local-3", "局部 · 3 层"], ["global", "全局", !globalGraph]]) {
    mode.append(control("option", { value, textContent: label, disabled: Boolean(disabled) }));
  }
  mode.value = state.scope === "global" ? "global" : `local-${state.depth}`;
  mode.addEventListener("change", () => {
    if (mode.value === "global") state.scope = "global";
    else {
      state.scope = "local";
      state.depth = Number(mode.value.slice(6));
    }
    state.view = undefined;
    build();
  });
  const search = control("input", { type: "search", value: state.query, placeholder: "搜索：名称 #标签 path:目录" });
  search.setAttribute("aria-label", "搜索");
  search.addEventListener("input", () => { state.query = search.value; draw(); });
  const searchBox = control("div", { className: "search-box" });
  searchBox.append(mode, icon("search"), search);
  top.append(searchBox);
  const layoutButton = control("button", { type: "button", className: "chip icon", disabled: state.full });
  const layoutName = state.layout === "side" ? "左右布局" : "上下布局";
  layoutButton.append(icon(state.layout === "side" ? "side" : "stack"));
  layoutButton.title = `${layoutName}，点击切换`;
  layoutButton.setAttribute("aria-label", `${layoutName}，点击切换`);
  layoutButton.addEventListener("click", () => {
    state.layout = state.layout === "side" ? "stack" : "side";
    savePrefs();
    state.view = undefined;
    build();
  });
  refreshButton = control("button", { type: "button", className: `chip icon${state.refreshing ? " spin" : ""}`, title: "刷新索引", disabled: state.refreshing });
  refreshButton.setAttribute("aria-label", "刷新索引");
  refreshButton.append(icon("refresh"));
  refreshButton.addEventListener("click", () => void refresh());
  const full = control("button", { type: "button", className: "chip icon", title: state.full ? "退出全屏" : "全屏显示" });
  full.setAttribute("aria-label", state.full ? "退出全屏" : "全屏显示");
  full.append(icon(state.full ? "shrink" : "expand"));
  full.addEventListener("click", () => void toggleFull());
  full.hidden = Boolean(sdk.capabilities?.toolbar);
  top.append(layoutButton, refreshButton, full);
  countLine = control("span", { className: "graph-count" });
  countRefs = {};
  const filters = control("div", { className: "graph-bar" });
  const segment = control("div", { className: "seg" });
  for (const [label, key, dot] of [["孤立", "orphans", "swatch hollow-dash"], ["断链", "broken", "swatch hollow"], ["待办", "tasks", "swatch task"]]) {
    const button = control("button", { type: "button", className: "seg-btn" });
    countRefs[key] = control("b", { textContent: "0" });
    button.append(control("i", { className: dot }), control("span", { textContent: label }), countRefs[key]);
    button.setAttribute("aria-pressed", String(state[key]));
    button.addEventListener("click", () => {
      state[key] = !state[key];
      button.setAttribute("aria-pressed", String(state[key]));
      draw();
    });
    segment.append(button);
  }
  const toggles = control("div", { className: "seg" });
  for (const [label, key, glyph] of [["分组边界", "grouped", "hull"], ["层级", "parents", "hierarchy"], ["箭头", "arrows", "arrow"]]) {
    const button = control("button", { type: "button", className: "seg-btn icon", title: label });
    button.setAttribute("aria-label", label);
    button.append(icon(glyph));
    button.setAttribute("aria-pressed", String(state[key]));
    button.addEventListener("click", () => {
      state[key] = !state[key];
      button.setAttribute("aria-pressed", String(state[key]));
      if (key === "grouped") sideSignature = "";
      draw();
    });
    toggles.append(button);
  }
  filters.append(segment, toggles, countLine);
  output.append(top, filters);
  if (state.refreshError) output.append(control("p", { textContent: `刷新失败：${state.refreshError}` }));
  const notice = data.overflow ? "笔记超过 2,000 篇，只显示局部图" : data.globalNotice;
  if (notice) output.append(control("p", { textContent: notice }));
  svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "graph-canvas graph-scope");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "笔记关系图，方向键切换笔记，Esc 取消选择");
  legendBox = control("div", { className: "graph-legend" });
  detailBox = control("div", { className: "graph-detail" });
  const stage = control("div", { className: "graph-stage" });
  const zoom = control("div", { className: "graph-zoom" });
  for (const [label, title, factor] of [["+", "放大", 1 / 1.3], ["−", "缩小", 1.3]]) {
    const button = control("button", { type: "button", textContent: label, title });
    button.setAttribute("aria-label", title);
    button.addEventListener("click", () => zoomBy(factor));
    zoom.append(button);
  }
  const fitButton = control("button", { type: "button", title: "适应画布" });
  fitButton.setAttribute("aria-label", "适应画布");
  fitButton.append(icon("fit"));
  fitButton.addEventListener("click", () => { state.view = undefined; draw(); });
  zoom.append(fitButton);
  dockBox = control("div", { className: "graph-dock" });
  stage.append(svg, zoom, dockBox);
  miniBox = make("svg", { class: "graph-mini graph-scope", "aria-label": "缩略图" });
  stage.append(miniBox);
  bindMini();
  const left = control("div", { className: "graph-main" });
  left.append(stage, legendBox);
  const body = control("div", { className: `graph-body ${state.full ? "side" : state.layout}` });
  sideSignature = "";
  if (state.full || state.layout === "side") {
    sideBox = control("aside", { className: "graph-side" });
    body.append(sideBox, left, detailBox);
  } else {
    sideBox = undefined;
    body.append(left, detailBox);
  }
  const wrap = control("div", { className: "graph-wrap" });
  wrap.append(body);
  output.append(wrap);
  bindPointer();
  bindKeys();
  renderDetail();
  draw();
}

function bindMini() {
  const move = (event) => {
    const box = miniBox.getBoundingClientRect();
    const { size } = shown();
    const view = state.view;
    const cx = ((event.clientX - box.left) / box.width) * size.width;
    const cy = ((event.clientY - box.top) / box.height) * size.height;
    state.view = { ...view, x: cx - view.width / 2, y: cy - view.height / 2 };
    draw();
  };
  miniBox.addEventListener("pointerdown", (event) => {
    miniBox.setPointerCapture(event.pointerId);
    move(event);
    const drag = (next) => move(next);
    miniBox.addEventListener("pointermove", drag);
    const stop = () => { miniBox.removeEventListener("pointermove", drag); miniBox.removeEventListener("pointerup", stop); miniBox.removeEventListener("pointercancel", stop); };
    miniBox.addEventListener("pointerup", stop);
    miniBox.addEventListener("pointercancel", stop);
  });
}

async function toggleFull() {
  state.full = !state.full;
  output.classList.toggle("graph-full", state.full);
  try {
    if (state.full) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* the panel can still fill its own area */ }
  state.view = undefined;
  build();
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && state.full) {
    state.full = false;
    output.classList.remove("graph-full");
    state.view = undefined;
    if (data) build();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.full && !sdk.capabilities?.toolbar) void toggleFull();
});

// Inside Typora the panel goes fullsize through a host toolbar button; the browser Fullscreen API is not available to the view.
const FULL_ICONS = {
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>',
  shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/></svg>',
};
let fullToolbar;

function ensureFullToolbar() {
  if (fullToolbar || !sdk.capabilities?.toolbar) return;
  fullToolbar = sdk.Toolbar({
    label: "图谱",
    buttons: [sdk.Button({ id: "full", role: "fullsize", icon: FULL_ICONS.expand, activeIcon: FULL_ICONS.shrink, tooltip: "全屏显示" })],
  });
  void fullToolbar.ready?.catch(() => {});
}

sdk.onFullsize?.(({ fullsize }) => {
  state.full = Boolean(fullsize);
  output.classList.toggle("graph-full", state.full);
  const rebuild = () => {
    state.view = undefined;
    if (data) build();
  };
  rebuild();
  // The host resizes the panel after this event, so draw again once the new size is in place.
  setTimeout(rebuild, 150);
});

function zoomBy(factor) {
  const view = state.view;
  const { size } = shown();
  const width = Math.min(size.width * 4, Math.max(size.width / 20, view.width * factor));
  const ratio = width / view.width;
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  state.view = { x: cx - (view.width * ratio) / 2, y: cy - (view.height * ratio) / 2, width, height: view.height * ratio };
  draw();
}

function scheduleDraw() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = undefined; draw(); });
}

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function bindKeys() {
  svg.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selected && !state.full) {
      state.selected = undefined;
      renderDetail();
      draw();
      return;
    }
    const direction = ARROWS[event.key];
    if (!direction || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const { nodes } = filtered(shown().graph);
    const current = nodes.find((node) => node.id === state.selected) ?? nodes.find((node) => node.path && node.path === data.current);
    const target = current ? globalThis.graphMatch.nextNode(current, nodes, direction) : nodes[0];
    if (target && target.id !== state.selected) select(target.id);
  });
}

function bindPointer() {
  let drag;
  const toView = (event) => {
    const box = svg.getBoundingClientRect();
    const view = state.view;
    return { x: view.x + ((event.clientX - box.left) / box.width) * view.width, y: view.y + ((event.clientY - box.top) / box.height) * view.height };
  };
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const view = state.view;
    const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
    const point = toView(event);
    const { size } = shown();
    const width = Math.min(size.width * 4, Math.max(size.width / 20, view.width * factor));
    const ratio = width / view.width;
    state.view = { x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio, width, height: view.height * ratio };
    setViewBox();
  }, { passive: false });
  svg.addEventListener("pointerdown", (event) => {
    const target = event.target.closest?.("circle[data-id]");
    if (target) {
      const id = target.getAttribute("data-id");
      state.selected = state.selected === id ? undefined : id;
      renderDetail();
      draw();
      return;
    }
    drag = { clientX: event.clientX, clientY: event.clientY, view: { ...state.view } };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("dragging");
  });
  svg.addEventListener("pointermove", (event) => {
    if (drag) {
      const box = svg.getBoundingClientRect();
      state.view = { ...drag.view, x: drag.view.x - ((event.clientX - drag.clientX) / box.width) * drag.view.width, y: drag.view.y - ((event.clientY - drag.clientY) / box.height) * drag.view.height };
      setViewBox();
      return;
    }
    if (shown().graph.nodes.length > HOVER_LIMIT) return;
    const id = event.target.closest?.("circle[data-id]")?.getAttribute("data-id");
    if (id !== state.hover) {
      state.hover = id;
      scheduleDraw();
    }
  });
  svg.addEventListener("pointerleave", () => {
    if (state.hover) {
      state.hover = undefined;
      scheduleDraw();
    }
  });
  const stop = () => { drag = undefined; svg.classList.remove("dragging"); };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
}

async function readGraph() {
  const context = currentContext;
  if (!context) return;
  const request = ++graphRequest;
  const stored = (await sdk.storage.get("detail-contexts"))?.[context];
  if (context !== currentContext || request !== graphRequest) return;
  const model = stored?.graph;
  const message = stored?.message ?? model?.error;
  const signature = JSON.stringify(model ?? message ?? stored?.status ?? null);
  if (signature === shownSnapshot) return;
  if (message || !model) {
    shownSnapshot = signature;
    if (message) output.textContent = message;
    else if (stored?.status === "no-workspace") output.textContent = "请先打开工作区文件夹";
    else showLoading();
    return;
  }

  if (model.globalId !== loadedGlobalId) {
    const snapshot = model.globalId ? (await sdk.storage.get("graph-workspaces"))?.[model.scope] : undefined;
    if (context !== currentContext || request !== graphRequest) return;
    const matches = snapshot && snapshot.id === model.globalId;
    globalGraph = matches ? snapshot.graph : undefined;
    loadedGlobalId = matches ? snapshot.id : undefined;
    infoMap = matches ? snapshot.info : model.localInfo;
  } else if (!globalGraph) {
    infoMap = model.localInfo;
  }

  if (!model.globalId || globalGraph) shownSnapshot = signature;
  const changed = !data || data.scope !== model.scope || data.current !== model.current;
  data = model;
  if (changed) {
    state.selected = undefined;
    state.view = undefined;
  }
  if (!globalGraph) state.scope = "local";
  build();
}

// An unsaved document never gets a snapshot, so the loading animation would run forever.
let emptyTimer;

sdk.onDocument(({ blocks }) => {
  graphRequest++;
  ensureFullToolbar();
  currentContext = blocks[0]?.id;
  shownSnapshot = undefined;
  showLoading();
  clearTimeout(emptyTimer);
  const context = currentContext;
  emptyTimer = setTimeout(() => {
    if (context === currentContext && shownSnapshot === "null") output.textContent = "保存笔记后显示图谱";
  }, 6000);
  void readGraph().catch(() => {});
});
setInterval(() => { void readGraph().catch(() => {}); }, 1000);
