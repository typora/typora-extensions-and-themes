// Data viewer page (L1, sandboxed): JSON, YAML, TOML and XML as a collapsible tree, or as source.
import { parse as parseToml } from "./smol-toml/index.js";

const view = window.typora.view;
const $ = (id) => document.getElementById(id);
const MAX_TREE_BYTES = 3 * 1024 * 1024;
let model = null;
let text = "";

function node(key, value) {
  if (value === null || value === undefined) return { key, type: "null", value: "null" };
  if (value instanceof Date) return { key, type: "str", value: value.toISOString() };
  if (Array.isArray(value)) return { key, type: "arr", kids: value.map((v, i) => node(i, v)) };
  switch (typeof value) {
    case "object": return { key, type: "obj", kids: Object.entries(value).map(([k, v]) => node(k, v)) };
    case "number": case "bigint": return { key, type: "num", value: String(value) };
    case "boolean": return { key, type: "bool", value: String(value) };
    default: return { key, type: "str", value: JSON.stringify(String(value)) };
  }
}

function xmlNode(el) {
  const kids = [];
  for (const a of el.attributes) kids.push({ key: "@" + a.name, type: "str", value: JSON.stringify(a.value) });
  for (const c of el.childNodes) {
    if (c.nodeType === 1) kids.push(xmlNode(c));
    else if ((c.nodeType === 3 || c.nodeType === 4) && c.nodeValue.trim()) kids.push({ key: "#text", type: "str", value: JSON.stringify(c.nodeValue.trim()) });
  }
  if (kids.length === 1 && kids[0].key === "#text") return { key: el.tagName, type: "str", value: kids[0].value };
  return { key: el.tagName, type: "obj", kids };
}

function parse(ext, source) {
  if (ext === "json") return node(null, JSON.parse(source));
  if (ext === "yaml" || ext === "yml") return node(null, jsyaml.load(source));
  if (ext === "toml") return node(null, parseToml(source));
  if (ext === "xml") {
    const doc = new DOMParser().parseFromString(source, "application/xml");
    const bad = doc.querySelector("parsererror");
    if (bad) throw new Error(bad.textContent.trim());
    return xmlNode(doc.documentElement);
  }
  throw new Error("不支持的类型：" + ext);
}

function span(cls, content) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = content;
  return s;
}

function render(n, depth, open) {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "row";
  const branch = n.kids && n.kids.length > 0;
  const tog = span("tog" + (branch ? "" : " leaf"), branch ? "▸" : "");
  row.append(tog);
  if (n.key !== null) {
    row.append(span(typeof n.key === "number" ? "idx" : "key", String(n.key)), span("sep", ":"));
  }
  if (n.kids) {
    const label = n.type === "arr" ? `[${n.kids.length}]` : `{${n.kids.length}}`;
    row.append(span("count", n.kids.length ? label : n.type === "arr" ? "[]" : "{}"));
  } else row.append(span("v-" + n.type, n.value));
  wrap.append(row);
  if (branch) {
    let box = null;
    const toggle = (force) => {
      const show = force ?? !box;
      if (show && !box) {
        box = document.createElement("div");
        box.className = "kids";
        for (const k of n.kids) box.append(render(k, depth + 1, depth + 1 < 2));
        wrap.append(box);
        tog.textContent = "▾";
      } else if (!show && box) {
        box.remove();
        box = null;
        tog.textContent = "▸";
      }
    };
    tog.addEventListener("click", () => toggle());
    row.addEventListener("dblclick", () => toggle());
    wrap._toggle = toggle;
    if (open) toggle(true);
  }
  return wrap;
}

function setAll(open) {
  const walk = (el, depth) => {
    for (const w of el.children) {
      if (w._toggle) { w._toggle(open); if (open && depth < 6) { const box = w.querySelector(":scope > .kids"); if (box) walk(box, depth + 1); } }
    }
  };
  walk($("tree"), 0);
}

function drawTree() {
  const tree = $("tree");
  tree.replaceChildren();
  if (model) tree.append(render(model, 0, true));
}

function mode(name) {
  const tree = name === "tree";
  $("tree").hidden = !tree;
  $("src").hidden = tree;
  $("expand").hidden = $("collapse").hidden = !tree;
  $("m-tree").setAttribute("aria-pressed", String(tree));
  $("m-src").setAttribute("aria-pressed", String(!tree));
}

view.onOpen(({ name, bytes, ext, size }) => {
  $("name").textContent = name;
  text = new TextDecoder().decode(bytes).replace(/^﻿/, "");
  $("src").textContent = text;
  $("info").textContent = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
  if (size > MAX_TREE_BYTES) {
    $("m-tree").disabled = true;
    $("err").hidden = false;
    $("err").textContent = "文件较大，仅显示源码";
    mode("src");
    return;
  }
  try {
    model = parse(ext, text);
    $("err").hidden = true;
    drawTree();
    mode("tree");
  } catch (e) {
    model = null;
    $("m-tree").disabled = true;
    $("err").hidden = false;
    $("err").textContent = String(e && e.message ? e.message : e);
    mode("src");
  }
});

$("m-tree").addEventListener("click", () => mode("tree"));
$("m-src").addEventListener("click", () => mode("src"));
$("expand").addEventListener("click", () => setAll(true));
$("collapse").addEventListener("click", () => { for (const w of $("tree").firstChild?.querySelectorAll(":scope > .kids > div") ?? []) w._toggle && w._toggle(false); });
