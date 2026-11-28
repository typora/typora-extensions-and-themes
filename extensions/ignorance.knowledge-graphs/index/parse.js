import "../vendor/js-yaml.js";

const yaml = globalThis.jsyaml;
const TAG = /(?:^|(?<=[\s([，。]))#([\p{L}\p{N}\p{M}_/-]+)/gu;
const LINK = /!?\[\[([^\]\n]+)\]\]|!?\[((?:\\.|[^\]\\])*)\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^()\s]|\([^()]*\))+))(?:\s+["'][^\n]*["'])?\s*\)/gu;
const INLINE_CODE = /(?<ticks>`+)(?!`)[^]*?(?<!`)\k<ticks>(?!`)/g;
const FENCE = /^\s*(?:>\s*|(?:[-+*]|\d+[.)])\s+)*(`{3,}|~{3,})(.*)$/;
const TASK = /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s+(.*)|\s*)$/;
const INLINE_FIELD = /^(?:\s*[-*+]\s+)?([^:#\[\]\n][^:\n]{0,80})::\s*(.*)$/;
const DATE = /\d{4}-\d{2}-\d{2}/;
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

export function indexTerms(text) {
  const terms = [];
  for (const { segment, isWordLike } of segmenter.segment(text.normalize("NFKC").toLowerCase())) {
    if (isWordLike) terms.push(segment);
  }
  return terms;
}

function plainValue(value, ancestors = new Set(), depth = 0) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object" || ancestors.has(value) || depth > 20) return null;
  ancestors.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => plainValue(item, ancestors, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValue(item, ancestors, depth + 1)]));
  ancestors.delete(value);
  return result;
}

function frontMatter(lines) {
  const first = /^\uFEFF?---\s*$/.test(lines[0]);
  const closing = first ? lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) : -1;
  if (closing < 0) return { properties: [], offset: 0, diagnostics: [] };
  try {
    const data = yaml.load(lines.slice(1, closing).join("\n"), { schema: yaml.JSON_SCHEMA });
    if (data != null && (typeof data !== "object" || Array.isArray(data))) throw new Error("需要键值映射");
    return { properties: Object.entries(plainValue(data ?? {})), offset: closing + 1, diagnostics: [] };
  } catch (error) {
    return { properties: [], offset: closing + 1, diagnostics: [`Front Matter：${error.reason ?? error.message}`] };
  }
}

function tagsIn(line) {
  return [...line.matchAll(TAG)].map((match) => match[1]);
}

export function parseVaultTask(line, heading, number) {
  const match = TASK.exec(line);
  if (!match) return null;
  const [, state, text = ""] = match;
  const flag = (marker) => new RegExp(`${marker}\\s*(${DATE.source})`, "iu").exec(text)?.[1] ?? null;
  const priority = text.includes("⏫") ? "high" : text.includes("🔼") ? "medium" : text.includes("🔽") ? "low" : null;
  return {
    text, completed: state !== " ", heading, line: number,
    due: flag("📅") ?? flag("\\bdue:"),
    scheduled: flag("⏳"), start: flag("🛫"), done: flag("✅"),
    priority, tags: tagsIn(text),
  };
}

function readLink(match, line, context) {
  const [, wiki, label, angle, markdown] = match;
  const [destination, alias] = wiki ? wiki.split("|", 2) : [angle ?? markdown, label];
  const hash = destination.indexOf("#");
  const target = (hash < 0 ? destination : destination.slice(0, hash)).trim();
  return { target, heading: hash < 0 ? "" : destination.slice(hash + 1), label: alias ?? destination, line, context, source: match[0], wiki: wiki !== undefined };
}

function plainBody(lines) {
  const source = lines.join("\n");
  return source.replace(INLINE_CODE, (part) => part.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, (part) => part.replace(/[^\n]/g, " "))
    .split("\n");
}

export function parseVaultNote(path, markdown) {
  const lines = markdown.split(/\r\n|\n|\r/);
  const { properties, offset, diagnostics } = frontMatter(lines);
  const attributes = new Map(properties);
  const headings = [];
  const links = [];
  const tasks = [];
  const tags = new Set();
  const tagValues = attributes.get("tags");
  for (const tag of (Array.isArray(tagValues) ? tagValues : String(tagValues ?? "").split(/[,\s]+/))) {
    if (typeof tag === "string" && tag.trim()) tags.add(tag.trim().replace(/^#/, ""));
  }
  let fence;
  let math = false;
  let heading = "";
  const scoped = lines.slice(offset).map((line) => {
    const marker = FENCE.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return "";
    }
    if (marker) {
      fence = marker[1];
      return "";
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      math = !math;
      return "";
    }
    return math ? "" : line;
  });
  const searchable = plainBody(scoped);
  for (const [index, line] of searchable.entries()) {
    const lineNumber = offset + index + 1;
    const title = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (title) {
      heading = title[2];
      headings.push({ level: title[1].length, text: heading, line: lineNumber });
    }
    for (const tag of tagsIn(line)) tags.add(tag);
    for (const match of line.matchAll(LINK)) links.push(readLink(match, lineNumber, line));
    const task = parseVaultTask(line, heading, lineNumber);
    if (task) tasks.push(task);
    const field = INLINE_FIELD.exec(line);
    if (field) {
      const key = field[1].trim();
      if (key && !attributes.has(key)) {
        const value = field[2].trim();
        const scalar = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : value;
        attributes.set(key, scalar);
      }
    }
  }

  const normalizedPath = path.replaceAll("\\", "/");
  const name = normalizedPath.split("/").at(-1).replace(/\.markdown$|\.md$/i, "");
  const body = searchable.join("\n").trim();
  return { path: normalizedPath, name, headings, properties: Object.fromEntries(attributes), tags: [...tags],
    links, tasks, body, terms: indexTerms(body), diagnostics };
}
