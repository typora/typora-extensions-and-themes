// Pure parsers for the XML inside .xlsx and .pptx packages. `files` maps a path in the
// zip to its text, so these run the same in the viewer page and in node tests.

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
export const unescapeXml = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (m, dec, hex) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[m]);

/** Joins every <t> run inside a fragment (rich text and plain text alike). */
const runs = (xml, tag) => {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  let out = "";
  let m;
  while ((m = re.exec(xml))) out += unescapeXml(m[1]);
  return out;
};

export function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function columnName(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const attr = (tagText, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tagText);
  return m ? unescapeXml(m[1]) : null;
};

export function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) out.push(runs(m[1], "t"));
  return out;
}

export function parseSheet(xml, strings) {
  const rows = [];
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cellRe.exec(xml))) {
    const head = m[1];
    const ref = attr(head, "r");
    if (!ref) continue;
    const type = attr(head, "t");
    const body = m[2] ?? "";
    const v = /<v>([\s\S]*?)<\/v>/.exec(body);
    let value = "";
    if (type === "s" && v) value = strings[+v[1]] ?? "";
    else if (type === "inlineStr") value = runs(body, "t");
    else if (type === "b" && v) value = v[1] === "1" ? "TRUE" : "FALSE";
    else if (v) value = unescapeXml(v[1]);
    if (value === "") continue;
    const r = parseInt(ref.replace(/[^0-9]/g, ""), 10) - 1;
    (rows[r] ??= [])[columnIndex(ref)] = value;
  }
  return Array.from(rows, (row) => row ?? []);
}

const target = (rels, id) => {
  const re = /<Relationship\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(rels))) if (attr(m[1], "Id") === id) return attr(m[1], "Target");
  return null;
};

export function parseXlsx(files) {
  const wb = files["xl/workbook.xml"] ?? "";
  const rels = files["xl/_rels/workbook.xml.rels"] ?? "";
  const strings = sharedStrings(files["xl/sharedStrings.xml"]);
  const sheets = [];
  const re = /<sheet\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(wb))) {
    const name = attr(m[1], "name");
    const rid = attr(m[1], "r:id");
    const t = rid && target(rels, rid);
    if (!t) continue;
    const path = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
    sheets.push({ name, rows: parseSheet(files[path] ?? "", strings) });
  }
  return sheets;
}

export function parsePptx(files) {
  const names = Object.keys(files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  return names.map((p) => {
    const xml = files[p];
    let title = "";
    const paras = [];
    const shapeRe = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    let s;
    while ((s = shapeRe.exec(xml))) {
      const isTitle = /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(s[0]);
      const paraRe = /<a:p\b[\s\S]*?<\/a:p>/g;
      let q;
      while ((q = paraRe.exec(s[0]))) {
        const text = runs(q[0], "a:t").trim();
        if (!text) continue;
        if (isTitle && !title) title = text;
        else paras.push(text);
      }
    }
    return { title, paras };
  });
}
