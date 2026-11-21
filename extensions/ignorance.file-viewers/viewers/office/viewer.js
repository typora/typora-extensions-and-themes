// Office viewer page (L1, sandboxed, read-only): .docx as a document, .xlsx as sheet tabs,
// .pptx as a grid of slide text cards.
import { parsePptx, parseXlsx, columnName } from "./core.js";

const view = window.typora.view;
const $ = (id) => document.getElementById(id);
const MAX_ROWS = 5000;
const MAX_COLS = 60;

const show = (id) => {
  for (const k of ["doc", "sheet", "slides", "err"]) $(k).hidden = k !== id;
};
const size = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

async function unzipText(bytes, wanted) {
  const zip = await JSZip.loadAsync(bytes);
  const files = {};
  await Promise.all(
    Object.keys(zip.files)
      .filter((p) => !zip.files[p].dir && wanted(p))
      .map(async (p) => { files[p] = await zip.files[p].async("string"); }),
  );
  return files;
}

const DOC_STYLE = `<style>
:root{color-scheme:light dark}
body{font:14px/1.7 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 24px;color:CanvasText;background:Canvas}
h1,h2,h3,h4{line-height:1.3}table{border-collapse:collapse}td,th{border:1px solid color-mix(in srgb,CanvasText 20%,Canvas);padding:4px 10px}
img{max-width:100%}</style>`;

async function showDocx(bytes) {
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  $("doc").srcdoc = `<!doctype html><meta charset="utf-8">${DOC_STYLE}${result.value || "<p>（空文档）</p>"}`;
  show("doc");
}

function renderSheet(sheet) {
  const rows = sheet.rows.slice(0, MAX_ROWS);
  const cols = Math.min(MAX_COLS, Math.max(1, ...rows.map((r) => r.length)));
  const table = el("table");
  const head = el("tr");
  head.append(el("th", "rn", ""));
  for (let c = 0; c < cols; c++) head.append(el("th", "", columnName(c)));
  table.append(head);
  rows.forEach((row, i) => {
    const tr = el("tr");
    tr.append(el("td", "rn", String(i + 1)));
    for (let c = 0; c < cols; c++) {
      const v = row[c] ?? "";
      tr.append(el("td", v !== "" && !isNaN(Number(v)) ? "num" : "", v));
    }
    table.append(tr);
  });
  $("sheet").replaceChildren(table);
  show("sheet");
}

async function showXlsx(bytes) {
  const files = await unzipText(bytes, (p) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(p));
  const sheets = parseXlsx(files);
  if (!sheets.length) throw new Error("没有找到工作表");
  const tabs = $("tabs");
  tabs.replaceChildren();
  sheets.forEach((s, i) => {
    const b = el("button", "", s.name);
    b.type = "button";
    b.setAttribute("aria-pressed", String(i === 0));
    b.addEventListener("click", () => {
      for (const o of tabs.children) o.setAttribute("aria-pressed", String(o === b));
      renderSheet(s);
    });
    tabs.append(b);
  });
  tabs.hidden = sheets.length < 2;
  renderSheet(sheets[0]);
}

async function showPptx(bytes) {
  const files = await unzipText(bytes, (p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  const slides = parsePptx(files);
  if (!slides.length) throw new Error("没有找到幻灯片");
  const grid = $("slides");
  grid.replaceChildren();
  slides.forEach((s, i) => {
    const card = el("div", "slide");
    card.append(el("div", "no", String(i + 1)));
    if (s.title) card.append(el("h3", "", s.title));
    for (const p of s.paras) card.append(el("p", "", p));
    grid.append(card);
  });
  show("slides");
}

view.onOpen(async ({ name, bytes, ext, size: n }) => {
  $("name").textContent = name;
  $("info").textContent = size(n);
  $("icon").dataset.kind = ext;
  try {
    if (ext === "docx") await showDocx(bytes);
    else if (ext === "xlsx") await showXlsx(bytes);
    else if (ext === "pptx") await showPptx(bytes);
    else throw new Error("不支持的类型：" + ext);
  } catch (e) {
    $("err").textContent = `无法预览：${e && e.message ? e.message : e}`;
    show("err");
  }
});
