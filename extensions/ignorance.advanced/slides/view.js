// Slides detail view: the current document as 16:9 slides. Slides are split
// on `---` (or before each h1/h2 when the note has no rule). In the panel it
// shows the current slide and a list; in fullsize it is the presentation.
import { slideKey, splitSlides, parseInline, headingText, safeUrl, slideLayout, kpiParts, footnoteDefinitions, listTag } from "./core.js";
import { parseChart } from "./chart-source.js";
import { renderChartSvg } from "./charts.js";
import { renderMermaidSvg } from "./diagrams.js";

const view = window.typora.view;
const SLIDE_W = 1280;
const SLIDE_H = 720;

const state = { slides: [], index: 0, theme: view.theme };
const saved = view.getState?.();
if (saved && Number.isInteger(saved.index)) state.index = saved.index;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// ---------- math & diagrams ----------
function renderMath(tex, display) {
  const box = el(display ? "div" : "span", display ? "math-block" : "math");
  try {
    window.katex.render(tex, box, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });
  } catch {
    box.textContent = tex;
  }
  return box;
}

// ---------- icons (Lucide, loaded on first use) ----------
const ICON_ALIAS = { chart: "chart-column-increasing" };
const ICON_TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "g"]);
const ICON_ATTRS = new Set(["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "width", "height", "points", "transform", "opacity"]);
let iconData = null;
function loadIcons() {
  // Absolute URL: a relative import() has no base inside the sandboxed page.
  iconData ??= import(new URL("../vendor/lucide-icons.js", document.baseURI).href).then((m) => m.default);
  iconData.catch(() => (iconData = null));
  return iconData;
}
function iconBody(data, name) {
  let current = ICON_ALIAS[name] || name;
  const seen = new Set();
  while (!data.icons?.[current] && data.aliases?.[current] && !seen.has(current)) {
    seen.add(current);
    const alias = data.aliases[current];
    current = typeof alias === "string" ? alias : alias.parent;
  }
  return data.icons?.[current]?.body || null;
}
function copySafe(source, target) {
  for (const child of source.children) {
    const tag = child.tagName.toLowerCase();
    if (!ICON_TAGS.has(tag)) continue;
    const copy = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const attr of child.attributes) if (ICON_ATTRS.has(attr.name)) copy.setAttribute(attr.name, attr.value);
    copySafe(child, copy);
    target.append(copy);
  }
}
function renderIcon(name) {
  const holder = el("span", "icon");
  loadIcons().then((data) => {
    const body = iconBody(data, name);
    if (!body) return;
    const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, "image/svg+xml").documentElement;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
    copySafe(parsed, svg);
    holder.append(svg);
  }).catch(() => {});
  return holder;
}

// ---------- footnotes ----------
let footnotes = { defs: new Map(), order: [] };

// ---------- inline ----------
function renderInline(parent, nodes) {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        parent.append(node.value);
        break;
      case "br":
        parent.append(el("br"));
        break;
      case "code":
      case "kbd":
        parent.append(el(node.type, undefined, node.value));
        break;
      case "math":
        parent.append(renderMath(node.value, false));
        break;
      case "badge": {
        const badge = el("span", "badge badge-" + node.color);
        badge.append(el("span", "badge-label", node.label), el("span", "badge-value", node.value));
        parent.append(badge);
        break;
      }
      case "spoiler": {
        const spoiler = el("span", "spoiler", node.value);
        spoiler.addEventListener("click", (event) => {
          event.stopPropagation();
          spoiler.classList.toggle("shown");
        });
        parent.append(spoiler);
        break;
      }
      case "ruby": {
        const ruby = el("ruby", undefined, node.value);
        ruby.append(el("rt", undefined, node.reading));
        parent.append(ruby);
        break;
      }
      case "icon":
        parent.append(renderIcon(node.name));
        break;
      case "footnote": {
        if (!footnotes.defs.has(node.id)) {
          parent.append(`[^${node.id}]`);
          break;
        }
        if (!footnotes.order.includes(node.id)) footnotes.order.push(node.id);
        parent.append(el("sup", "footnote-ref", String(footnotes.order.indexOf(node.id) + 1)));
        break;
      }
      case "crumb": {
        const crumb = el("span", "crumb");
        node.parts.forEach((part, i) => {
          if (i) crumb.append(el("span", "crumb-sep", "›"));
          crumb.append(el("span", undefined, part));
        });
        parent.append(crumb);
        break;
      }
      case "strong":
      case "em":
      case "del":
      case "mark": {
        const wrap = el(node.type, node.color ? "hl-" + node.color : undefined);
        renderInline(wrap, node.children);
        parent.append(wrap);
        break;
      }
      case "link": {
        const href = safeUrl(node.href);
        const link = el(href ? "a" : "span", "link");
        if (href) {
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        renderInline(link, node.children);
        parent.append(link);
        break;
      }
      case "image": {
        const src = safeUrl(node.src, { image: true });
        if (src) {
          const img = el("img");
          img.src = src;
          img.alt = node.alt;
          parent.append(img);
        } else {
          parent.append(el("span", "image-missing", node.alt || node.src));
        }
        break;
      }
      default:
        break;
    }
  }
}

const inline = (tag, className, markdown) => {
  const node = el(tag, className);
  renderInline(node, parseInline(markdown));
  return node;
};

// ---------- blocks ----------
function renderBlock(node) {
  switch (node.type) {
    case "heading": {
      const level = Math.min(node.attrs?.level ?? 2, 4);
      return inline("h" + level, undefined, headingText(node));
    }
    case "paragraph":
      return inline("p", undefined, node.text || "");
    case "blockquote": {
      const alert = node.attrs?.alertType;
      const box = el(alert ? "div" : "blockquote", alert ? "alert alert-" + alert : undefined);
      for (const child of node.children) {
        if (child.type === "alert_title") {
          const custom = String(child.text || "").replace(/^\[![^\]]+\]\s*/, "");
          box.append(el("div", "alert-title", custom || alert.toUpperCase()));
        } else {
          const rendered = renderBlock(child);
          if (rendered) box.append(rendered);
        }
      }
      return box;
    }
    case "list": {
      const list = el(listTag(node.attrs), node.attrs?.listType === "task" ? "task" : undefined);
      if (node.attrs?.start > 1) list.start = node.attrs.start;
      for (const item of node.children) list.append(renderBlock(item));
      return list;
    }
    case "list_item": {
      const li = el("li", node.attrs?.checked === true ? "checked" : node.attrs?.checked === false ? "unchecked" : undefined);
      for (const child of node.children) {
        const rendered = renderBlock(child);
        if (rendered) li.append(rendered);
      }
      return li;
    }
    case "fences":
      return renderFence(node);
    case "math_block":
      return renderMath(String(node.text || "").replace(/^\$\$\s*|\s*\$\$$/g, ""), true);
    case "table":
      return renderTable(node);
    case "custom_container":
      return renderContainer(node);
    case "html_block":
    case "def_footnote":
    case "meta_block":
      return null;
    default:
      return node.text ? inline("p", undefined, node.text) : null;
  }
}

// ---------- ::: containers ----------
const CALLOUTS = { note: "说明", info: "信息", tip: "提示", success: "完成", warning: "注意", danger: "危险", caution: "危险", question: "问题", important: "重要" };

function renderChildren(parent, nodes) {
  for (const child of nodes) {
    const rendered = renderBlock(child);
    if (rendered) parent.append(rendered);
  }
  return parent;
}

// Items of the first list inside a container, as list_item nodes.
const listItems = (node) => node.children.find((c) => c.type === "list")?.children || [];
const itemText = (item) => item.children.map((c) => c.text || "").join(" ");

function renderContainer(node) {
  const type = String(node.attrs?.customContainerType || "").toLowerCase();
  const title = String(node.attrs?.customContainerTitle || "").trim();
  const box = el("div", "c c-" + (type || "plain"));

  if (type in CALLOUTS) {
    box.className = "c c-callout callout-" + type;
    box.append(inline("div", "c-title", title || CALLOUTS[type]));
    return renderChildren(box, node.children);
  }
  switch (type) {
    case "kpi": {
      for (const item of listItems(node)) {
        const { value, label } = kpiParts(itemText(item));
        const card = el("div", "kpi");
        if (value) card.append(inline("div", "kpi-value", value));
        card.append(inline("div", "kpi-label", label));
        box.append(card);
      }
      if (!box.childElementCount) renderChildren(box, node.children);
      return box;
    }
    case "timeline":
    case "process":
    case "roadmap":
    case "steps": {
      const items = listItems(node);
      if (!items.length) return renderChildren(box, node.children);
      box.className = "c c-flow";
      items.forEach((item, i) => {
        const step = el("div", "flow-step");
        step.append(el("div", "flow-no", String(i + 1)));
        renderChildren(step, item.children);
        box.append(step);
      });
      return box;
    }
    case "matrix": {
      const [x, y] = title.split("|").map((t) => t.trim());
      const grid = el("div", "matrix-grid");
      for (const item of listItems(node).slice(0, 4)) grid.append(renderChildren(el("div", "matrix-cell"), item.children));
      box.append(grid);
      if (x) box.append(el("div", "matrix-x", x + " →"));
      if (y) box.append(el("div", "matrix-y", y + " →"));
      return box;
    }
    case "tabs":
      for (const tab of node.children) {
        if (tab.type !== "custom_container") continue;
        const section = el("div", "tab");
        section.append(el("div", "tab-title", String(tab.attrs?.customContainerTitle || "")));
        box.append(renderChildren(section, tab.children));
      }
      return box;
    case "details":
    case "panel":
    case "card":
    case "col":
    default:
      if (title) box.append(inline("div", "c-title", title));
      return renderChildren(box, node.children);
  }
}

// Charts and flowcharts are drawn by the built-in renderers; anything they
// cannot draw falls back to the source with a one-line reason.
function svgFigure(className, svg) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  if (root.nodeName.toLowerCase() !== "svg") throw new Error("图形没有画出来。");
  const figure = el("div", className);
  const svgNode = document.importNode(root, true);
  const box = svgNode.getAttribute("viewBox")?.split(/\s+/).map(Number);
  // Small diagrams stay small instead of stretching to the slide width.
  if (className === "diagram" && box?.[2]) svgNode.style.maxWidth = Math.round(box[2] * 1.3) + "px";
  figure.append(svgNode);
  return figure;
}

function renderFence(node) {
  const lang = String(node.attrs?.lang || "").toLowerCase();
  const source = node.text || "";
  const draw = { chart: () => svgFigure("chart", renderChartSvg(parseChart(source), state.theme, { width: 960, height: 460 })), mermaid: () => svgFigure("diagram", renderMermaidSvg(source, state.theme)) }[lang];
  let note = null;
  if (draw) {
    try {
      return draw();
    } catch (error) {
      note = el("div", "chart-error", String(error?.message || error).split("\n")[0]);
    }
  }
  const pre = el("pre");
  const code = el("code", undefined, source);
  if (lang) pre.dataset.lang = lang;
  pre.append(code);
  if (!note) return pre;
  const box = el("div", "fallback");
  box.append(note, pre);
  return box;
}

function renderTable(node) {
  const table = el("table");
  const align = node.attrs?.align || [];
  let head = null;
  let body = null;
  for (const row of node.children) {
    const isHeader = row.children.some((cell) => cell.attrs?.isHeader);
    const section = isHeader ? (head ||= table.createTHead()) : (body ||= table.createTBody());
    const tr = section.insertRow();
    row.children.forEach((cell, i) => {
      const td = inline(isHeader ? "th" : "td", undefined, cell.text || "");
      if (align[i]) td.style.textAlign = align[i];
      tr.append(td);
    });
  }
  return table;
}

// ---------- slides ----------
function renderSlide(slide) {
  const { layout, tag } = slideLayout(slide.nodes);
  const page = el("section", "slide layout-" + layout);
  page.style.width = SLIDE_W + "px";
  page.style.height = SLIDE_H + "px";
  const content = el("div", "slide-content");
  if (tag) content.append(el("div", "slide-tag", tag));
  footnotes.order = [];
  renderChildren(content, slide.nodes);
  if (layout === "split") {
    // Title across the top, the rest in two columns.
    const heading = content.querySelector(":scope > h1, :scope > h2");
    const columns = el("div", "split-cols");
    for (const child of [...content.children]) if (child !== heading && !child.classList.contains("slide-tag")) columns.append(child);
    content.append(columns);
  }
  if (footnotes.order.length) {
    const list = el("ol", "footnotes");
    for (const id of footnotes.order) list.append(inline("li", undefined, footnotes.defs.get(id)));
    content.append(list);
  }
  page.append(content);
  return page;
}

// Shrink a slide whose content is taller than the page instead of clipping it.
function fitContent(page) {
  const content = page.querySelector(".slide-content");
  content.style.transform = "";
  const available = SLIDE_H - 2 * 56;
  const needed = content.scrollHeight;
  if (needed > available) {
    content.style.transformOrigin = "top center";
    content.style.transform = `scale(${Math.max(0.45, available / needed)})`;
  }
}

const stage = document.getElementById("stage");
const counter = document.getElementById("counter");
const outline = document.getElementById("outline");
const empty = document.getElementById("empty");

function scaleStage() {
  const page = stage.firstElementChild;
  if (!page) return;
  const box = stage.getBoundingClientRect();
  // In the panel the stage height follows the width; in fullsize both limit it.
  const byWidth = box.width / SLIDE_W;
  const scale = document.body.classList.contains("is-fullsize") ? Math.min(byWidth, box.height / SLIDE_H) : byWidth;
  page.style.transform = `scale(${scale})`;
  stage.style.setProperty("--slide-scaled-height", SLIDE_H * scale + "px");
}

function show(index, { reveal = false } = {}) {
  const total = state.slides.length;
  empty.hidden = total > 0;
  document.body.classList.toggle("is-empty", total === 0);
  if (!total) {
    stage.replaceChildren();
    counter.textContent = "";
    outline.replaceChildren();
    return;
  }
  state.index = Math.max(0, Math.min(index, total - 1));
  view.setState?.({ index: state.index });
  const page = renderSlide(state.slides[state.index]);
  page.classList.toggle("is-last", state.index === total - 1);
  stage.replaceChildren(page);
  fitContent(page);
  scaleStage();
  counter.textContent = `${state.index + 1} / ${total}`;
  for (const [i, item] of [...outline.children].entries()) item.classList.toggle("active", i === state.index);
  if (reveal && state.slides[state.index].firstId) view.reveal?.({ blockId: state.slides[state.index].firstId });
}

function renderOutline() {
  outline.replaceChildren(
    ...state.slides.map((slide, i) => {
      const item = el("button", "outline-item");
      item.type = "button";
      item.append(el("span", "outline-no", String(i + 1)), el("span", "outline-title", slide.title || "无标题"));
      item.addEventListener("click", () => show(i, { reveal: true }));
      return item;
    }),
  );
}

const step = (delta) => show(state.index + delta);
document.getElementById("prev").addEventListener("click", () => step(-1));
document.getElementById("next").addEventListener("click", () => step(1));
stage.addEventListener("click", (event) => {
  if (!view.fullsize || event.target.closest("a")) return;
  step(event.clientX < window.innerWidth / 3 ? -1 : 1);
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const keys = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
  if (event.key in keys) {
    event.preventDefault();
    step(event.shiftKey && event.key === " " ? -1 : keys[event.key]);
  } else if (event.key === "Home") {
    event.preventDefault();
    show(0);
  } else if (event.key === "End") {
    event.preventDefault();
    show(state.slides.length - 1);
  }
});

function applyFullsize(on) {
  document.body.classList.toggle("is-fullsize", Boolean(on));
  requestAnimationFrame(scaleStage);
}

// Host toolbar (a floating pill at the bottom of the panel): prev, fullsize, next.
// Created after the first document arrives, as the View SDK asks.
const ICONS = {
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  next: '<svg viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};
let toolbar = null;
function ensureToolbar() {
  if (toolbar || !view.capabilities?.toolbar) return;
  toolbar = view.Toolbar({
    label: "演示",
    buttons: [
      view.Button({ id: "prev", icon: ICONS.prev, tooltip: "上一页", onClick: () => step(-1) }),
      view.Button({ id: "play", role: "fullsize", icon: ICONS.play, activeIcon: ICONS.stop, tooltip: "全屏放映" }),
      view.Button({ id: "next", icon: ICONS.next, tooltip: "下一页", onClick: () => step(1) }),
    ],
  });
  void toolbar.ready?.catch((error) => view.log?.("toolbar", error?.message));
}

view.onFullsize?.(({ fullsize }) => applyFullsize(fullsize));
applyFullsize(view.fullsize);

view.onTheme?.((theme) => {
  state.theme = theme;
  document.documentElement.dataset.theme = theme?.dark ? "dark" : "light";
  show(state.index);
});
document.documentElement.dataset.theme = view.theme?.dark ? "dark" : "light";

// Typing sends a document update per keystroke. Coalesce them, and leave the
// stage alone when the visible slide did not change, so the editor stays smooth.
let pendingDoc = null;
let docTimer = 0;
let shownKey = "";
function applyDocument() {
  const { blocks, switched } = pendingDoc;
  pendingDoc = null;
  state.slides = splitSlides(blocks || []);
  footnotes = { defs: footnoteDefinitions(blocks), order: [] };
  renderOutline();
  ensureToolbar();
  const index = switched ? 0 : Math.min(state.index, Math.max(0, state.slides.length - 1));
  const key = index + ":" + state.slides.length + ":" + slideKey(state.slides[index]);
  if (!switched && key === shownKey) return;
  shownKey = key;
  show(index);
}
async function applySettings() {
  try {
    const settings = await view.settings?.();
    document.body.classList.toggle("mascot", Boolean(settings?.showMascot));
  } catch {
    document.body.classList.remove("mascot");
  }
}
applySettings();

view.onDocument((doc) => {
  applySettings();
  const first = !pendingDoc && !shownKey;
  pendingDoc = { blocks: doc.blocks, switched: Boolean(doc.switched || pendingDoc?.switched) };
  clearTimeout(docTimer);
  if (first || doc.switched) applyDocument();
  else docTimer = setTimeout(applyDocument, 250);
});

new ResizeObserver(scaleStage).observe(stage);
