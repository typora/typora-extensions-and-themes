// Pure logic for the slides view: turn Typora's flat block list into a tree,
// split it into slides and parse inline Markdown into plain node objects.
// No DOM here, so it runs under node:test.

// blocks: [{ id, type, text, attrs, depth, parent }] in document order.
export function buildTree(blocks) {
  const byId = new Map();
  const roots = [];
  for (const block of blocks) byId.set(block.id, { ...block, children: [] });
  for (const block of blocks) {
    const node = byId.get(block.id);
    const parent = byId.get(block.parent);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const isBlank = (node) => node.type === "paragraph" && !String(node.text || "").trim();
const isSkipped = (node) => node.type === "meta_block" || node.type === "toc" || node.type === "def_link" || isBlank(node);

// Slides are separated by a top-level `---`. A document without any rule is
// split before each h1 and h2 instead, so ordinary notes still present well.
export function splitSlides(blocks) {
  const roots = buildTree(blocks).filter((node) => !isSkipped(node));
  const hasRule = roots.some((node) => node.type === "hr");
  const slides = [];
  let current = [];
  const flush = () => {
    if (current.length) slides.push(current);
    current = [];
  };
  for (const node of roots) {
    if (node.type === "hr") {
      flush();
      continue;
    }
    if (!hasRule && node.type === "heading" && (node.attrs?.level ?? 9) <= 2) flush();
    if (node.type === "page_break") {
      flush();
      continue;
    }
    current.push(node);
  }
  flush();
  return slides.map((nodes, index) => ({ index, nodes, firstId: nodes[0]?.id, title: slideTitle(nodes) }));
}

export function headingText(node) {
  return String(node.text || "").replace(/^#{1,6}\s*/, "").replace(/\s*#+\s*$/, "");
}

function slideTitle(nodes) {
  const heading = nodes.find((node) => node.type === "heading");
  if (heading) return plainText(headingText(heading));
  const first = nodes.find((node) => node.text);
  return first ? plainText(first.text).slice(0, 40) : "";
}

export function plainText(markdown) {
  const one = (n) => {
    if (n.type === "badge") return `${n.label} ${n.value}`;
    if (n.type === "crumb") return n.parts.join(" › ");
    if (n.type === "image") return n.alt || "";
    return n.value !== undefined ? n.value : flat(n.children || []);
  };
  const flat = (nodes) => nodes.map(one).join("");
  return flat(parseInline(markdown));
}

// Inline Markdown -> [{ type, value?, children?, href?, src?, alt? }]
// Types: text, strong, em, del, mark, code, link, image, kbd, br, math.
const HL = { "🔴": "red", "🟠": "orange", "🟢": "green", "🔵": "blue", "🟣": "purple" };
const RULES = [
  { type: "badge", re: /^\(\((blue|green|orange|red|purple):([^()|\n]+)\|([^()\n]+)\)\)/, make: (m) => ({ color: m[1], label: m[2].trim(), value: m[3].trim() }) },
  { type: "spoiler", re: /^\(\(spoiler:([^()\n]+)\)\)/, make: (m) => ({ value: m[1].trim() }) },
  { type: "ruby", re: /^\(\(ruby:([^()|\n]+)\|([^()\n]+)\)\)/, make: (m) => ({ value: m[1].trim(), reading: m[2].trim() }) },
  { type: "crumb", re: /^\(\(crumb:([^()\n]+)\)\)/, make: (m) => ({ parts: m[1].split(">").map((p) => p.trim()).filter(Boolean) }) },
  { type: "mark", re: /^==(🔴|🟠|🟢|🔵|🟣)([^=\n]+)==/u, make: (m) => ({ color: HL[m[1]], children: parseInline(m[2]) }) },
  { type: "code", re: /^(`+)([\s\S]*?[^`])\1(?!`)/, make: (m) => ({ value: m[2].trim() }) },
  { type: "math", re: /^\$([^$\n]+)\$/, make: (m) => ({ value: m[1] }) },
  { type: "footnote", re: /^\[\^([^\]\s]+)\]/, make: (m) => ({ id: m[1] }) },
  { type: "image", re: /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/, make: (m) => ({ alt: m[1], src: m[2] }) },
  { type: "link", re: /^\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/, make: (m) => ({ children: parseInline(m[1]), href: m[2] }) },
  { type: "kbd", re: /^<kbd>([\s\S]*?)<\/kbd>/i, make: (m) => ({ value: m[1] }) },
  { type: "br", re: /^<br\s*\/?>/i, make: () => ({}) },
  { type: "strong", re: /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/, make: (m) => ({ children: parseInline(m[2]) }) },
  { type: "del", re: /^~~(?=\S)([\s\S]*?\S)~~/, make: (m) => ({ children: parseInline(m[1]) }) },
  { type: "mark", re: /^==(?=\S)([\s\S]*?\S)==/, make: (m) => ({ children: parseInline(m[1]) }) },
  { type: "em", re: /^(\*|_)(?=\S)([\s\S]*?\S)\1/, make: (m) => ({ children: parseInline(m[2]) }) },
  { type: "text", re: /^<!--[\s\S]*?-->/, make: () => ({ value: "" }) },
  { type: "icon", re: /^:([a-z][a-z0-9_-]*):\s*/, make: (m) => ({ name: m[1] }) },
  { type: "text", re: /^<\/?[a-z][^>]*>/i, make: () => ({ value: "" }) },
  { type: "text", re: /^\\([\\`*_{}[\]()#+\-.!=~|<>$])/, make: (m) => ({ value: m[1] }) },
];

// Footnote definitions by id, from def_footnote blocks whose text is "[^id]: content".
export function footnoteDefinitions(blocks) {
  const defs = new Map();
  for (const block of blocks || []) {
    if (block.type !== "def_footnote") continue;
    const m = /^\[\^([^\]\s]+)\]:\s*([\s\S]*)$/.exec(String(block.text || "").trim());
    if (m) defs.set(m[1], m[2].trim());
  }
  return defs;
}

export function parseInline(source) {
  const out = [];
  let text = "";
  let rest = String(source ?? "");
  const pushText = () => {
    if (text) out.push({ type: "text", value: text });
    text = "";
  };
  while (rest) {
    let matched = false;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (!m) continue;
      pushText();
      const node = { type: rule.type, ...rule.make(m) };
      if (!(node.type === "text" && node.value === "")) out.push(node);
      rest = rest.slice(m[0].length);
      matched = true;
      break;
    }
    if (!matched) {
      text += rest[0];
      rest = rest.slice(1);
    }
  }
  pushText();
  // Merge neighbouring text nodes left by escapes.
  return out.reduce((acc, node) => {
    const last = acc[acc.length - 1];
    if (node.type === "text" && last?.type === "text") last.value += node.value;
    else acc.push(node);
    return acc;
  }, []);
}

// Only these URL schemes may reach an <a href> or <img src>.
export function safeUrl(url, { image = false } = {}) {
  const value = String(url || "").trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (image && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(value)) return value;
  if (!image && /^#/.test(value)) return value;
  return null;
}

// `<!-- layout: name | tag -->` anywhere in a slide picks its layout; the
// optional tag is a small label shown above the title. Without a comment a
// slide whose only content is an h1 (plus one line) is a cover.
const LAYOUTS = new Set(["default", "cover", "section", "center", "split", "grid", "image-full", "two-cols"]);
export function slideLayout(nodes) {
  for (const node of nodes) {
    if (node.type !== "html_block") continue;
    const m = /^<!--\s*layout:\s*([a-z-]+)\s*(?:\|\s*([^>]*?))?\s*-->$/i.exec(String(node.text || "").trim());
    if (m) return { layout: LAYOUTS.has(m[1].toLowerCase()) ? m[1].toLowerCase() : "default", tag: (m[2] || "").trim() };
  }
  const visible = nodes.filter((node) => node.type !== "html_block");
  const coverLike = visible.length <= 3 && visible[0]?.type === "heading" && visible[0].attrs?.level === 1;
  return { layout: coverLike ? "cover" : "default", tag: "" };
}

// The pieces of a `::: kpi` item: "**+38%** 远程协作渗透率" -> value + label.
export function kpiParts(markdown) {
  const m = /^\s*(\*\*|__)(.+?)\1\s*(.*)$/.exec(String(markdown || ""));
  return m ? { value: m[2], label: m[3] } : { value: "", label: String(markdown || "") };
}

// A fingerprint of everything a slide renders from, so the panel can skip
// re-rendering (and re-drawing diagrams) while the user types elsewhere.
export function slideKey(slide) {
  const walk = (node) => [node.type, node.text, node.attrs, (node.children || []).map(walk)];
  return JSON.stringify(slide ? slide.nodes.map(walk) : null);
}

// Typora stores the list kind in attrs.listType: "ol", "ul" or "task".
export const listTag = (attrs) => (attrs?.listType === "ol" ? "ol" : "ul");
