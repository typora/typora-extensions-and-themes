// Built-in Gantt renderer for slides: reads a Mermaid `gantt` (title, sections,
// tasks with done / active / crit / milestone tags, ids, `after` dependencies,
// dates and durations in days, weeks and hours) and draws an SVG string. Only
// dateFormat YYYY-MM-DD is supported; anything else throws a readable error.
import { palette, esc, textWidth, mix } from "./colors.js";

const DAY = 86400000;
const TAGS = new Set(["done", "active", "crit", "milestone"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DURATION = /^(\d+(?:\.\d+)?)\s*(d|w|h)$/i;
const IGNORED = /^(axisFormat|excludes|includes|todayMarker|tickInterval|weekday|weekend|topAxis|inclusiveEndDates|accTitle|accDescr|click)\b/i;

const day = (s) => Date.parse(s + "T00:00:00Z");
const fmtDay = (ms) => new Date(ms).toISOString().slice(5, 10);
const fmtFull = (ms) => new Date(ms).toISOString().slice(0, 10);
const span = (text) => {
  const m = DURATION.exec(text);
  return m ? Number(m[1]) * { d: 1, w: 7, h: 1 / 24 }[m[2].toLowerCase()] * DAY : null;
};

export function parseGantt(source) {
  const lines = String(source).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
  if (!/^gantt$/i.test(lines.shift() || "")) throw new Error("这不是甘特图。");
  let title = "";
  let section = "";
  const sections = [];
  const tasks = [];
  const byId = new Map();
  for (const line of lines) {
    let m;
    if ((m = /^title\s+(.+)$/i.exec(line))) title = m[1].trim();
    else if ((m = /^dateFormat\s+(.+)$/i.exec(line))) {
      if (m[1].trim() !== "YYYY-MM-DD") throw new Error(`演示里的甘特图只支持 dateFormat YYYY-MM-DD，当前是 ${m[1].trim()}。`);
    } else if (IGNORED.test(line)) continue;
    else if ((m = /^section\s+(.+)$/i.exec(line))) {
      section = m[1].trim();
      if (!sections.includes(section)) sections.push(section);
    } else if ((m = /^(.+?)\s*:\s*(.+)$/.exec(line))) {
      const parts = m[2].split(",").map((s) => s.trim()).filter(Boolean);
      const tags = [];
      while (parts.length && TAGS.has(parts[0].toLowerCase())) tags.push(parts.shift().toLowerCase());
      const datey = (t) => DATE.test(t) || /^after\s/i.test(t) || span(t) !== null;
      let id = "";
      if (parts.length === 3 || (parts.length === 2 && !datey(parts[0]))) id = parts.shift();
      if (!parts.length) throw new Error(`任务「${m[1]}」缺少日期或时长。`);
      const prev = tasks[tasks.length - 1];
      let start;
      if (parts.length === 1) {
        if (!prev) throw new Error(`任务「${m[1]}」缺少开始日期。`);
        start = prev.end;
      } else if (DATE.test(parts[0])) start = day(parts[0]);
      else if (/^after\s/i.test(parts[0])) {
        const ends = parts[0].replace(/^after\s+/i, "").split(/\s+/).map((k) => {
          if (!byId.has(k)) throw new Error(`after ${k}：找不到这个任务 id。`);
          return byId.get(k).end;
        });
        start = Math.max(...ends);
      } else throw new Error(`无法解析任务「${m[1]}」的开始：${parts[0]}`);
      const last = parts[parts.length - 1];
      let end;
      if (DATE.test(last)) end = day(last);
      else if (span(last) !== null) end = start + span(last);
      else throw new Error(`无法解析任务「${m[1]}」的结束：${last}`);
      if (tags.includes("milestone")) end = start;
      const task = { name: m[1].trim(), id, tags, start, end, section, sectionIndex: Math.max(0, sections.indexOf(section)) };
      tasks.push(task);
      if (id) byId.set(id, task);
    } else throw new Error(`无法解析甘特图：${line}`);
  }
  if (!tasks.length) throw new Error("甘特图里没有任务。");
  return { title, sections, tasks };
}


function ticks(min, max) {
  const days = Math.max(1, (max - min) / DAY);
  const step = [1, 2, 7, 14, 30, 60, 90, 180, 365].find((s) => days / s <= 10) || 365;
  const out = [];
  for (let t = min; t <= max + 1; t += step * DAY) out.push(t);
  return out;
}

export function renderGanttSvg(source, theme) {
  const c = palette(theme);
  const { title, sections, tasks } = parseGantt(source);
  const min = Math.min(...tasks.map((t) => t.start));
  const max = Math.max(...tasks.map((t) => Math.max(t.end, t.start + DAY / 2)));
  const labelW = Math.min(240, Math.max(...tasks.map((t) => textWidth(t.name, 16)), 80) + 24);
  const chartW = 760;
  const width = labelW + chartW + 32;
  const rowH = 38;
  const barH = 22;
  const f = (v) => Math.round(v * 10) / 10;
  const x = (ms) => labelW + 8 + ((ms - min) / (max - min || DAY)) * chartW;
  const red = c.dark ? "#F97066" : "#D92D20";
  const out = [];
  let y = 16;
  if (title) {
    out.push(`<text x="8" y="${y + 22}" font-size="26" font-weight="500" fill="${c.fg}">${esc(title)}</text>`);
    y += 44;
  }
  const axisY = y + 6;
  const tk = ticks(min, max);
  // Rows: a section header row, then its tasks.
  const rows = [];
  const grouped = sections.length ? sections : [""];
  for (const s of grouped) {
    const ts = tasks.filter((t) => t.section === s);
    if (!ts.length) continue;
    if (s) rows.push({ header: s });
    ts.forEach((t) => rows.push({ task: t }));
  }
  const bodyTop = axisY + 14;
  const bodyH = rows.length * rowH;
  tk.forEach((t) => {
    out.push(`<line x1="${f(x(t))}" y1="${axisY + 8}" x2="${f(x(t))}" y2="${bodyTop + bodyH}" stroke="${c.grid}" stroke-width="1.5"/>`);
    out.push(`<text x="${f(x(t))}" y="${axisY}" font-size="14" fill="${c.muted}" text-anchor="middle">${esc(tk.length > 1 && (max - min) / DAY > 300 ? fmtFull(t) : fmtDay(t))}</text>`);
  });
  rows.forEach((r, i) => {
    const ry = bodyTop + i * rowH;
    if (r.header) {
      out.push(`<rect x="0" y="${f(ry + 4)}" width="${width}" height="${rowH - 8}" rx="6" fill="${mix(c.bg, c.fg, 0.05)}"/>`);
      out.push(`<text x="10" y="${f(ry + rowH / 2 + 6)}" font-size="16" font-weight="500" fill="${c.fg}">${esc(r.header)}</text>`);
      return;
    }
    const t = r.task;
    const color = t.tags.includes("crit") ? red : c.series[t.sectionIndex % c.series.length];
    const cy = ry + rowH / 2;
    out.push(`<text x="${sections.length ? 22 : 10}" y="${f(cy + 6)}" font-size="16" fill="${c.fg}">${esc(t.name)}</text>`);
    if (t.tags.includes("milestone")) {
      const cx = x(t.start);
      out.push(`<path d="M${f(cx)},${f(cy - 11)}L${f(cx + 11)},${f(cy)}L${f(cx)},${f(cy + 11)}L${f(cx - 11)},${f(cy)}z" fill="${color}"/>`);
      return;
    }
    const x0 = x(t.start);
    const w = Math.max(6, x(t.end) - x0);
    const done = t.tags.includes("done");
    const fill = done ? mix(c.bg, color, 0.35) : t.tags.includes("active") ? mix(c.bg, color, 0.55) : color;
    out.push(`<rect x="${f(x0)}" y="${f(cy - barH / 2)}" width="${f(w)}" height="${barH}" rx="6" fill="${fill}"${t.tags.includes("active") ? ` stroke="${color}" stroke-width="2.5"` : ""}/>`);
    if (done) out.push(`<path d="M${f(x0 + 8)},${f(cy)}l4,4l8,-8" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  });
  const height = bodyTop + bodyH + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" font-family='${c.font.replace(/'/g, "")}'>${out.join("")}</svg>`;
}
