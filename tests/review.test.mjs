import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { packageFiles } from "../scripts/lib.mjs";
import { analyzeCss, analyzeHtml, analyzeSource, checkCode, originAllowed } from "../scripts/review/code.mjs";
import { checkFiles } from "../scripts/review/files.mjs";
import { Findings } from "../scripts/review/findings.mjs";
import { gate, skeleton } from "../scripts/review/gate.mjs";
import { md } from "../scripts/review/github.mjs";
import { nestedQuantifier } from "../scripts/review/regex.mjs";
import { assess } from "../scripts/review/risk.mjs";
import { contrast, parseColor, themeVars } from "../scripts/review/theme.mjs";
import { parseSource, samePublished, untar } from "../scripts/review/vendor.mjs";
import { sha256Hex } from "../scripts/lib.mjs";
import { classify } from "../scripts/pr-check.mjs";
import { expandSnippet, fences } from "../scripts/harness/harness.mjs";

const rules = (text) => analyzeSource(text).hits.map((h) => h.rule);

test("code rules catch strings turned into code, however they are spelt", () => {
  assert.deepEqual(rules("eval(x)"), ["code/eval"]);
  assert.deepEqual(rules("(0, eval)(x)"), ["code/eval"]);
  assert.deepEqual(rules("globalThis.eval(x)"), ["code/eval"]);
  assert.deepEqual(rules("new Function('return 1')"), ["code/function-constructor"]);
  assert.deepEqual(rules("self.Function('a')"), ["code/function-constructor"]);
  assert.deepEqual(rules("setTimeout('alert(1)', 10)"), ["code/string-timer"]);
  assert.deepEqual(rules("setTimeout(() => 1, 10)"), []);
  assert.deepEqual(rules("window[name](x)"), ["code/global-reflection"]);
  assert.deepEqual(rules("import(spec)"), ["code/dynamic-import"]);
  assert.deepEqual(rules("String.fromCharCode(104,116,116,112,115,58,47,47,101)"), ["code/charcode"]);
  // Converting bytes is ordinary.
  assert.deepEqual(rules("String.fromCharCode(...bytes.subarray(0, 10))"), []);
  // Words in strings and comments are not code.
  assert.deepEqual(rules("// eval(x)\nconst s = 'new Function(';"), []);
});

test("obfuscated and encoded sources are flagged", () => {
  const names = Array.from({ length: 25 }, (_, i) => `const _0x${(0xabc + i).toString(16)} = ${i};`).join("\n");
  assert.ok(rules(names).includes("code/obfuscated"));
  const blob = Array.from({ length: 3000 }, (_, i) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[(i * 7919) % 64]).join("");
  assert.ok(rules(`const payload = "${blob}";`).includes("code/encoded-blob"));
});

test("SDK use is followed through aliases and destructuring", () => {
  const { api, fetches, spawns } = analyzeSource(`
    const view = window.typora.view;
    const { net, process: proc } = typora;
    view.fetch("https://a.example/x");
    net.fetch(\`https://b.example/\${path}\`);
    proc.spawn("git", ["status"]);
    proc.spawn(typora.process.shell);
    typora.workspace.readFile("x");
  `);
  const paths = api.map((a) => a.path);
  assert.ok(paths.includes("typora.view.fetch"));
  assert.ok(paths.includes("typora.net.fetch"));
  assert.ok(paths.includes("typora.workspace.readFile"));
  assert.deepEqual(fetches.map((f) => f.url), ["https://a.example/x", "https://b.example/"]);
  assert.deepEqual(spawns.map((s) => s.command), ["git", "$shell"]);
});

test("import(new URL(…, document.baseURI)) is a fixed file", () => {
  const { imports, hits } = analyzeSource('import(new URL("vendor/lib.js", document.baseURI).href)');
  assert.deepEqual(hits, []);
  assert.deepEqual(imports.map((i) => [i.spec, i.base]), [["./vendor/lib.js", "document"]]);
});

test("pages: what the CSP blocks is an error", () => {
  const { refs, hits } = analyzeHtml(`
    <script src="__typora/view.js"></script>
    <script type="application/json" id="data">{"a":1}</script>
    <script>alert(1)</script>
    <button onclick="go()">Go</button>
    <img src="https://tracker.example/p.gif">
  `);
  assert.deepEqual(hits.map((h) => h.rule).sort(), ["html/inline-handler", "html/inline-script"]);
  assert.deepEqual(refs.map((r) => r.ref), ["__typora/view.js", "https://tracker.example/p.gif"]);
  assert.deepEqual(analyzeCss("a{background:url(https://x.example/a.png)} input[value^='a']{color:red} b{background:url(img/a.png)}").map((h) => h.rule), ["css/remote", "css/value-selector"]);
});

test("network origins: exact, wildcard and the user's server", () => {
  assert.equal(originAllowed(["https://kroki.io"], "https://kroki.io"), true);
  assert.equal(originAllowed(["https://kroki.io"], "https://evil.io"), false);
  assert.equal(originAllowed(["https://*.example.com"], "https://api.example.com"), true);
  assert.equal(originAllowed(["https://*.example.com"], "https://example.com.evil.io"), false);
  assert.equal(originAllowed(["{config.server}"], "https://anything.io"), true);
});

/** A package folder in a temp dir: { path: text }. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "typora-review-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

test("a package: undeclared and unused permissions, missing and miscased files", () => {
  const dir = fixture({
    "main.js": 'import { x } from "./lib/Util.js";\ntypora.workspace.folders();\ntypora.process.spawn("curl", []);\n',
    "lib/util.js": "export const x = 1;\n",
    "page.html": '<script src="__typora/view.js"></script><script src="missing.js"></script>',
    "background.js": "typora.ai.complete({});\n",
  });
  try {
    const manifest = { id: "me.tool", main: "main.js", background: "background.js", permissions: { network: ["https://a.example"], process: ["git"], ai: true } };
    const findings = new Findings();
    checkCode({ id: "me.tool", dir, manifest, files: packageFiles(dir), vendored: new Map(), findings });
    const got = findings.items.filter((f) => f.level !== "info").map((f) => `${f.level} ${f.rule}`);
    assert.ok(got.includes("error graph/case"), got.join("\n"));
    assert.ok(got.includes("error graph/missing"));
    assert.ok(got.includes("error api/undeclared")); // workspace
    assert.ok(got.includes("error api/process")); // curl is not git
    assert.ok(got.includes("error api/context")); // ai in background
    assert.ok(got.includes("warn api/unused-permission")); // network
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("files: programs, disguised WebAssembly, credentials, fonts without a license", () => {
  const dir = fixture({
    "helper.bin": "x",
    "data.json": "\u0000asm",
    "main.js": 'const key = "AKIAABCDEFGHIJKLMNOP";\n',
    "fonts/a.woff2": "wOF2",
  });
  try {
    const findings = new Findings();
    checkFiles({ id: "me.tool", dir, manifest: { id: "me.tool" }, files: packageFiles(dir), vendored: new Map(), findings });
    const got = findings.items.map((f) => f.rule).sort();
    assert.deepEqual(got, ["files/disguised", "files/font-license", "files/program", "files/secret"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("regexes that repeat a repetition are refused", () => {
  assert.equal(nestedQuantifier("(a+)+$"), "(a+)+");
  assert.equal(nestedQuantifier("(\\w*\\s?)*x"), "(\\w*\\s?)*");
  assert.equal(nestedQuantifier("==([^=]+)=="), null);
  assert.equal(nestedQuantifier("(ab){2,3}c+"), null);
});

test("vendored sources: npm and URL forms, tarballs read back", () => {
  assert.deepEqual(parseSource("npm:@xterm/xterm@6.0.0/lib/xterm.js"), { kind: "npm", name: "@xterm/xterm", version: "6.0.0", path: "lib/xterm.js" });
  assert.deepEqual(parseSource("npm:marked@16.4.2/lib/"), { kind: "npm", name: "marked", version: "16.4.2", path: "lib/" });
  assert.equal(parseSource("http://insecure.example/x.js"), null);
  const header = (name, size) => {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write(size.toString(8).padStart(11, "0"), 124);
    h.write("0", 156);
    return h;
  };
  const body = Buffer.from("hello");
  const tar = Buffer.concat([header("package/a.txt", body.length), body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]);
  const files = untar(tar);
  // Only a last-line source map comment may be left out.
  const published = Buffer.from("var a = 1;\n//# sourceMappingURL=a.js.map\n");
  assert.equal(samePublished(sha256Hex(Buffer.from("var a = 1;\n")), published), true);
  assert.equal(samePublished(sha256Hex(Buffer.from("var a = 2;\n")), published), false);
  assert.equal(files.get("package/a.txt").toString(), "hello");
});

const base = { ids: ["typora.mermaid", "ignorance.advanced"], names: new Map([["typora.mermaid", "Mermaid"], ["ignorance.advanced", "Ignorance Advanced"]]) };
const owners = { maintainers: ["boss"], reserved: ["typora"], namespaces: { typora: ["@maintainers"], ignorance: ["ignorance-shiyao"] } };
const pr = (extra) => ({ author: "someone", association: "CONTRIBUTOR", labels: [], body: "", ...extra });

test("gate: tooling, one package, namespaces", () => {
  const files = [{ filename: "extensions/typora.mermaid/mermaid.js" }, { filename: "scripts/validate.mjs" }];
  const manifests = new Map([["typora.mermaid", { name: "Mermaid" }]]);
  const outsider = gate({ pr: pr(), files, manifests, base, owners });
  assert.deepEqual(outsider.findings.map((f) => `${f.level} ${f.rule}`).sort(), ["error gate/tooling", "review gate/not-owner"]);
  assert.equal(outsider.facts.notOwner, true);
  const squatter = gate({ pr: pr(), files: [{ filename: "extensions/typora.new/main.js" }], manifests: new Map([["typora.new", {}]]), base, owners });
  assert.deepEqual(squatter.findings.filter((f) => f.level === "error").map((f) => f.rule), ["gate/namespace"]);
  const boss = gate({ pr: pr({ author: "boss" }), files, manifests, base, owners });
  assert.equal(boss.findings.filter((f) => f.level === "error").length, 0);
  const owner = gate({ pr: pr({ author: "ignorance-shiyao" }), files: [{ filename: "extensions/ignorance.advanced/main.js" }], manifests: new Map([["ignorance.advanced", {}]]), base, owners });
  assert.deepEqual(owner.findings, []);
});

test("gate: look-alikes and undocumented permissions", () => {
  const files = [{ filename: "extensions/typ0ra.diagram/main.js" }];
  const manifests = new Map([["typ0ra.diagram", { name: "MERMAID", permissions: { network: ["https://x.io"] } }]]);
  const result = gate({ pr: pr({ association: "FIRST_TIME_CONTRIBUTOR" }), files, manifests, base, owners });
  const rules = result.findings.map((f) => f.rule);
  assert.ok(rules.includes("gate/confusable"));
  assert.ok(rules.includes("gate/new-namespace"));
  assert.ok(rules.includes("gate/undocumented-permission"));
  assert.ok(result.labels.includes("first-time-author"));
  assert.ok(result.labels.includes("perm:network"));
  assert.equal(skeleton("Typ0ra"), skeleton("typora"));
});

test("risk follows permissions and how they change", () => {
  const rows = [{ id: "a.b", facts: { widened: true, added: ["network `https://x.io`"], permissions: { network: ["https://x.io"] }, tierNow: "L2", sensitive: true } }];
  assert.equal(assess({ rows }).level, "critical");
  assert.equal(assess({ rows: [{ id: "a.b", facts: { widened: false, added: [], permissions: {}, tierNow: "L0", sensitive: false } }] }).level, "low");
  assert.equal(assess({ findings: [{ level: "review", rule: "x" }] }).level, "high");
});

test("theme colors and contrast", () => {
  const vars = themeVars('name = "X"\n[vars]\nbg = "#ffffff"\ntext = "#333"\n[vars.dark]\nbg = "#222222"\n[[fonts]]\nfamily = "A"\n');
  assert.equal(vars.vars.text, "#333");
  assert.equal(vars["vars.dark"].bg, "#222222");
  assert.equal(contrast(parseColor("#000"), parseColor("#fff")).toFixed(0), "21");
  assert.deepEqual(parseColor("rgba(255, 0, 0, 0.5)"), [255, 0, 0, 0.5]);
});

test("changed paths split into packages and tooling", () => {
  assert.deepEqual(classify(["extensions/a.b/main.js", "themes/c.d/x.css", "themes/built-in/x", "scripts/lib.mjs"]), {
    ids: ["a.b", "c.d"],
    tooling: ["themes/built-in/x", "scripts/lib.mjs"],
  });
});

test("harness examples come from fences, snippets expanded", () => {
  assert.equal(expandSnippet("[{{1:Author}}] {{2}} ${3:x}"), "[Author]  x");
  assert.deepEqual(fences("text\n```mermaid\ngraph LR\n```\n~~~d2 x\na -> b\n~~~\n"), [
    { lang: "mermaid", source: "graph LR" },
    { lang: "d2", source: "a -> b" },
  ]);
});

test("text from a pull request cannot mention, link or break tables", () => {
  assert.equal(md("@team [x](http://e) | <img>"), "@​team \\[x\\](http://e) \\| \\<img\\>");
});
