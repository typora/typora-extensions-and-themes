// Built-in sequence diagram renderer for slides: reads a Mermaid
// `sequenceDiagram` (participants, actors, messages, notes, activations,
// autonumber, loop / opt / alt / par frames) and draws an SVG string. Syntax it
// cannot draw throws a readable error and the slide shows the source instead.
import { palette, esc, textWidth, mix } from "./colors.js";

const OPS = "-->>|->>|--x|-x|--\\)|-\\)|-->|->";
const MESSAGE = new RegExp(`^(.+?)\\s*(${OPS})\\s*([+-]?)\\s*(.+?)\\s*$`);
const FRAME = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i;

const clean = (s) => String(s ?? "").trim().replace(/^"(.*)"$/, "$1").replace(/<br\s*\/?>/gi, " ");

export function parseSequence(source) {
  const lines = String(source).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
  if (!/^sequenceDiagram$/i.test(lines.shift() || "")) throw new Error("这不是序列图。");
  const people = new Map();
  const events = [];
  const stack = [];
  let numbered = false;
  const person = (id, label, actor) => {
    const key = clean(id);
    const p = people.get(key) || { id: key, label: key, actor: false };
    if (label !== undefined) p.label = clean(label);
    if (actor) p.actor = true;
    people.set(key, p);
    return p;
  };
  for (const line of lines) {
    let m;
    if ((m = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i.exec(line))) {
      person(m[2], m[3], m[1].toLowerCase() === "actor");
    } else if (/^autonumber\b/i.test(line)) {
      numbered = true;
    } else if ((m = /^(activate|deactivate)\s+(\S+)$/i.exec(line))) {
      events.push({ type: m[1].toLowerCase(), who: person(m[2]).id });
    } else if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(line))) {
      const who = m[2].split(",").map((s) => person(s.trim()).id);
      events.push({ type: "note", side: m[1].toLowerCase().replace(" ", "-"), who, text: clean(m[3]) });
    } else if ((m = FRAME.exec(line))) {
      stack.push(m[1].toLowerCase());
      events.push({ type: "frame-start", kind: m[1].toLowerCase(), text: clean(m[2]) });
    } else if ((m = /^(else|and|option)\b\s*(.*)$/i.exec(line))) {
      if (!stack.length) throw new Error(`${m[1]} 没有对应的块。`);
      events.push({ type: "frame-split", text: clean(m[2]) });
    } else if (/^end$/i.test(line)) {
      if (!stack.pop()) throw new Error("多出一个 end。");
      events.push({ type: "frame-end" });
    } else {
      const colon = line.indexOf(":");
      const head = colon < 0 ? line : line.slice(0, colon);
      m = MESSAGE.exec(head);
      if (!m) throw new Error(`无法解析序列图：${line}`);
      const [, from, op, sign, to] = m;
      const a = person(from).id;
      const b = person(to).id;
      events.push({ type: "message", from: a, to: b, op, text: clean(colon < 0 ? "" : line.slice(colon + 1)), sign });
    }
  }
  if (stack.length) throw new Error("块缺少 end。");
  if (!events.length) throw new Error("序列图里没有消息。");
  return { people: [...people.values()], events, numbered };
}

const FONT = 16;
let counter = 0;

export function renderSequenceSvg(source, theme) {
  const c = palette(theme);
  const { people, events, numbered } = parseSequence(source);
  const index = new Map(people.map((p, i) => [p.id, i]));
  const boxW = people.map((p) => Math.max(96, textWidth(p.label, FONT) + 36));
  // Horizontal gaps: wide enough for the box halves and for each message label that spans them.
  const gaps = people.slice(1).map((_, k) => (boxW[k] + boxW[k + 1]) / 2 + 36);
  for (const e of events) {
    if (e.type !== "message" || e.from === e.to) continue;
    const [i, j] = [index.get(e.from), index.get(e.to)].sort((a, b) => a - b);
    const need = (textWidth(e.text, FONT) + 56) / (j - i);
    for (let k = i; k < j; k++) gaps[k] = Math.max(gaps[k], need);
  }
  const xs = [boxW[0] / 2];
  gaps.forEach((g, k) => xs.push(xs[k] + g));
  const left = Math.min(...xs.map((x, i) => x - boxW[i] / 2)) - 24;
  const right = Math.max(...xs.map((x, i) => x + boxW[i] / 2)) + 24;
  const id = `seq-arrow-${++counter}`;
  const top = 16;
  const headH = 44;
  let y = top + headH + 28;
  const lifelines = [];
  const frames = [];
  const bars = [];
  const msgs = [];
  const notes = [];
  const open = new Map(people.map((p) => [p.id, []]));
  const frameStack = [];
  let n = 0;
  const f = (v) => Math.round(v * 10) / 10;
  for (const e of events) {
    if (e.type === "activate") open.get(e.who).push(y);
    else if (e.type === "deactivate") {
      const start = open.get(e.who).pop();
      if (start !== undefined) bars.push({ who: e.who, y0: start, y1: y, depth: open.get(e.who).length });
    } else if (e.type === "message") {
      y += 14;
      const a = xs[index.get(e.from)];
      const b = xs[index.get(e.to)];
      const dashed = e.op.startsWith("--");
      const label = (numbered ? `${++n}. ` : "") + e.text;
      if (e.sign === "+") open.get(e.to).push(y + 22);
      const style = `fill="none" stroke="${c.fg}" stroke-width="1.8"${dashed ? ' stroke-dasharray="7 5"' : ""}`;
      const head = e.op.endsWith("x") ? "cross" : e.op.endsWith(">>") ? "solid" : "open";
      const marker = head === "cross" ? `marker-end="url(#${id}-x)"` : head === "solid" ? `marker-end="url(#${id}-s)"` : `marker-end="url(#${id}-o)"`;
      if (e.from === e.to) {
        const w = 44;
        msgs.push(`<path d="M${f(a + 4)},${f(y)}h${w}v26h${-w + 4}" ${style} ${marker}/>`);
        msgs.push(`<text x="${f(a + w + 10)}" y="${f(y + 18)}" font-size="${FONT}" fill="${c.fg}">${esc(label)}</text>`);
        y += 44;
      } else {
        const dir = Math.sign(b - a);
        msgs.push(`<path d="M${f(a + dir * 4)},${f(y + 12)}H${f(b - dir * 4)}" ${style} ${marker}/>`);
        msgs.push(`<text x="${f((a + b) / 2)}" y="${f(y + 2)}" font-size="${FONT}" fill="${c.fg}" text-anchor="middle">${esc(label)}</text>`);
        y += 38;
      }
      if (e.sign === "-") {
        const start = open.get(e.from).pop();
        if (start !== undefined) bars.push({ who: e.from, y0: start, y1: y - 14, depth: open.get(e.from).length });
      }
    } else if (e.type === "note") {
      y += 8;
      const w = Math.max(120, textWidth(e.text, FONT) + 28);
      const xa = xs[index.get(e.who[0])];
      const xb = xs[index.get(e.who[e.who.length - 1])];
      let x0;
      let ww = w;
      if (e.side === "over") {
        ww = Math.max(w, Math.abs(xb - xa) + 80);
        x0 = (xa + xb) / 2 - ww / 2;
      } else x0 = e.side === "left-of" ? xa - 14 - w : xa + 14;
      notes.push(`<rect x="${f(x0)}" y="${f(y)}" width="${f(ww)}" height="34" rx="6" fill="${mix(c.bg, c.series[1], 0.16)}" stroke="${mix(c.bg, c.series[1], 0.5)}" stroke-width="1.5"/><text x="${f(x0 + ww / 2)}" y="${f(y + 22)}" font-size="${FONT}" fill="${c.fg}" text-anchor="middle">${esc(e.text)}</text>`);
      y += 50;
    } else if (e.type === "frame-start") {
      y += 10;
      frameStack.push({ kind: e.kind, text: e.text, y0: y, depth: frameStack.length, splits: [] });
      y += 32;
    } else if (e.type === "frame-split") {
      y += 8;
      frameStack[frameStack.length - 1].splits.push({ y, text: e.text });
      y += 26;
    } else if (e.type === "frame-end") {
      const fr = frameStack.pop();
      y += 6;
      frames.push({ ...fr, y1: y });
      y += 14;
    }
  }
  for (const [who, list] of open) for (const start of list) bars.push({ who, y0: start, y1: y - 6, depth: 0 });
  y += 8;
  const bottom = y;
  const head = (p, i, yy) => {
    const x = xs[i] - boxW[i] / 2;
    return `<rect x="${f(x)}" y="${yy}" width="${f(boxW[i])}" height="${headH}" rx="${p.actor ? headH / 2 : 8}" fill="${c.tint}" stroke="${c.accent}" stroke-width="2"/><text x="${f(xs[i])}" y="${yy + 28}" font-size="${FONT + 1}" fill="${c.fg}" text-anchor="middle">${esc(p.label)}</text>`;
  };
  people.forEach((p, i) => lifelines.push(`<line x1="${f(xs[i])}" y1="${top + headH}" x2="${f(xs[i])}" y2="${bottom}" stroke="${c.line}" stroke-width="1.5" stroke-dasharray="6 6"/>`));
  const frameSvg = frames
    .sort((a, b) => a.depth - b.depth)
    .map((fr) => {
      const x0 = left + 8 + fr.depth * 10;
      const x1 = right - 8 - fr.depth * 10;
      const tag = fr.kind;
      const tw = textWidth(tag, 14) + 18;
      let out = `<rect x="${f(x0)}" y="${f(fr.y0)}" width="${f(x1 - x0)}" height="${f(fr.y1 - fr.y0)}" rx="6" fill="none" stroke="${c.line}" stroke-width="1.5"/>`;
      out += `<path d="M${f(x0)},${f(fr.y0)}h${f(tw)}v18l-8,8h${f(-tw + 8)}z" fill="${mix(c.bg, c.fg, 0.1)}" stroke="${c.line}" stroke-width="1.5"/><text x="${f(x0 + 9)}" y="${f(fr.y0 + 17)}" font-size="14" font-weight="500" fill="${c.fg}">${esc(tag)}</text>`;
      if (fr.text) out += `<text x="${f(x0 + tw + 10)}" y="${f(fr.y0 + 18)}" font-size="${FONT}" fill="${c.muted}">${esc("[" + fr.text + "]")}</text>`;
      for (const s of fr.splits) {
        out += `<line x1="${f(x0)}" y1="${f(s.y)}" x2="${f(x1)}" y2="${f(s.y)}" stroke="${c.line}" stroke-width="1.5" stroke-dasharray="7 5"/>`;
        if (s.text) out += `<text x="${f(x0 + 10)}" y="${f(s.y + 19)}" font-size="${FONT}" fill="${c.muted}">${esc("[" + s.text + "]")}</text>`;
      }
      return out;
    })
    .join("");
  const barSvg = bars.map((b) => `<rect x="${f(xs[index.get(b.who)] - 6 + b.depth * 5)}" y="${f(b.y0)}" width="12" height="${f(Math.max(8, b.y1 - b.y0))}" rx="3" fill="${c.tint}" stroke="${c.accent}" stroke-width="1.5"/>`).join("");
  const w = Math.round(right - left);
  const h = Math.round(bottom + headH + 20);
  const defs = `<defs><marker id="${id}-s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,1L9,5L0,9z" fill="${c.fg}"/></marker><marker id="${id}-o" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M1,1L9,5L1,9" fill="none" stroke="${c.fg}" stroke-width="1.6"/></marker><marker id="${id}-x" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M1,1L9,9M9,1L1,9" stroke="${c.fg}" stroke-width="1.8"/></marker></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family='${c.font.replace(/'/g, "")}'>${defs}<g transform="translate(${f(-left)},0)">${lifelines.join("")}${frameSvg}${barSvg}${people.map((p, i) => head(p, i, top)).join("")}${people.map((p, i) => head(p, i, bottom)).join("")}${msgs.join("")}${notes.join("")}</g></svg>`;
}
