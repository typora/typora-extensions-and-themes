// Colours for the built-in chart and flowchart renderers, derived from the
// Typora view theme so slides match the Ignorance palette in light and dark.

export function mix(a, b, t) {
  const pa = toRgb(a);
  const pb = toRgb(b);
  if (!pa || !pb) return a;
  return "#" + pa.map((v, i) => Math.round(v * (1 - t) + pb[i] * t).toString(16).padStart(2, "0")).join("");
}

function toRgb(color) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color || "");
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color || "");
  if (rgb) return rgb[1].split(/[\s,/]+/).slice(0, 3).map(Number);
  return null;
}

function cssVar(theme, name, fallback) {
  const value = theme?.vars?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// Series colours: the accent first, then the Ignorance chart hues.
const LIGHT_SERIES = ["#D97706", "#0F8A72", "#B6548C", "#2F8DBD", "#C9561B", "#7867C9", "#6F7A29"];
const DARK_SERIES = ["#F2B84B", "#4FC3A5", "#D889B6", "#67B7DC", "#E9865A", "#A79BE6", "#AEB95E"];

export function palette(theme) {
  const dark = Boolean(theme?.dark);
  const fg = theme?.foreground || cssVar(theme, "--typora-foreground", dark ? "#E5E9F0" : "#1F2937");
  const bg = theme?.background || cssVar(theme, "--typora-background", dark ? "#0F172A" : "#FAF8F4");
  const accent = theme?.accent || cssVar(theme, "--typora-accent", dark ? "#6F9AF4" : "#356FD8");
  const border = theme?.border || cssVar(theme, "--typora-border", mix(bg, fg, 0.12));
  return {
    dark,
    fg,
    bg,
    accent,
    border,
    muted: mix(fg, bg, 0.4),
    grid: mix(bg, fg, 0.08),
    line: mix(bg, fg, 0.4),
    tint: mix(bg, accent, dark ? 0.18 : 0.1),
    series: [accent, ...(dark ? DARK_SERIES : LIGHT_SERIES)],
    font: cssVar(theme, "--typora-font", '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'),
  };
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Rough text width: CJK glyphs are one em, Latin about 0.58 em.
export function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) w += ch.charCodeAt(0) > 255 ? size : size * 0.58;
  return w;
}
