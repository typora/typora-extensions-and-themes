// Code viewer page (L1, sandboxed): source with line numbers, light syntax colours and plain
// editing; HTML files also get a sandboxed preview of the current buffer.
const view = window.typora.view;
const $ = (id) => document.getElementById(id);
const ta = $("ta");
let ext = "";
let saved = "";
let readonly = true;

const KEYWORDS = {
  c: "if else for while do return function const let var class new import export from default switch case break continue try catch finally throw async await typeof instanceof in of null undefined true false this void static public private protected interface type enum extends implements package func fn pub use mut struct impl match go chan defer range int string bool float double char long short unsigned include define self super as where trait mod crate",
  hash: "if elif else fi for while do done then in def class return import from as with try except finally raise lambda None True False and or not is pass yield async await function local export echo case esac select where group by order having insert into values update set delete create table null limit join on and or not",
};
const kwRe = (list) => `\\b(?:${list.trim().split(/\s+/).join("|")})\\b`;
const FAMILY = {
  c: new RegExp(`(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d[\\w.]*\\b)|(${kwRe(KEYWORDS.c)})`, "g"),
  hash: new RegExp(`(#[^\\n]*|--[^\\n]*)|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*')|(\\b\\d[\\w.]*\\b)|(${kwRe(KEYWORDS.hash)})`, "gi"),
  css: /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(#[0-9a-fA-F]{3,8}\b|\b\d[\d.]*(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)|(@[\w-]+|[\w-]+(?=\s*:(?!:)))/g,
  html: /(<!--[\s\S]*?-->)|("[^"]*"|'[^']*')|(<\/?[A-Za-z][\w:-]*|\/?>)|([\w:@-]+(?==))/g,
};
const CLASSES = {
  html: ["c-cm", "c-str", "c-tag", "c-attr"],
  other: ["c-cm", "c-str", "c-num", "c-kw"],
};
const family = (e) => {
  if (e === "html" || e === "htm" || e === "xml") return "html";
  if (e === "css") return "css";
  if (["py", "sh", "zsh", "ini", "sql", "toml", "yaml", "yml"].includes(e)) return "hash";
  return "c";
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(src) {
  const fam = family(ext);
  const classes = fam === "html" ? CLASSES.html : CLASSES.other;
  const re = FAMILY[fam];
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out += esc(src.slice(last, m.index));
    const g = m.slice(1).findIndex((x) => x !== undefined);
    out += `<span class="${classes[g]}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

function showSize(size) {
  $("info").textContent = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
}

function refresh() {
  const text = ta.value;
  $("hl").innerHTML = highlight(text) + "\n";
  const lines = text.split("\n").length;
  $("gutter").textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  const isDirty = text !== saved;
  $("dirty").hidden = !isDirty;
  $("save").disabled = !isDirty || readonly;
  view.setDirty(isDirty);
}

function syncScroll() {
  $("hl").scrollTop = ta.scrollTop;
  $("hl").scrollLeft = ta.scrollLeft;
  $("gutter").scrollTop = ta.scrollTop;
}

async function save() {
  if (readonly || ta.value === saved) return;
  await view.save(ta.value);
  saved = ta.value;
  showSize(new TextEncoder().encode(saved).length);
  refresh();
}

function mode(name) {
  const src = name === "src";
  $("editor").hidden = !src;
  $("preview").hidden = src;
  $("m-src").setAttribute("aria-pressed", String(src));
  $("m-view").setAttribute("aria-pressed", String(!src));
  if (!src) $("preview").srcdoc = ta.value;
}

view.onOpen(({ name, bytes, ext: e, size, readonly: ro }) => {
  ext = e;
  readonly = ro;
  saved = new TextDecoder().decode(bytes).replace(/^﻿/, "");
  ta.value = saved;
  ta.readOnly = ro;
  $("name").textContent = name;
  showSize(size);
  $("save").hidden = ro;
  $("modes").hidden = !(e === "html" || e === "htm");
  refresh();
  mode("src");
});

ta.addEventListener("input", refresh);
ta.addEventListener("scroll", syncScroll);
ta.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    save();
  } else if (ev.key === "Tab" && !readonly) {
    ev.preventDefault();
    const { selectionStart: s, selectionEnd: e2, value } = ta;
    ta.value = value.slice(0, s) + "  " + value.slice(e2);
    ta.selectionStart = ta.selectionEnd = s + 2;
    refresh();
  }
});
$("save").addEventListener("click", save);
$("m-src").addEventListener("click", () => mode("src"));
$("m-view").addEventListener("click", () => mode("view"));
