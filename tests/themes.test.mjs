import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { CORS_HEADERS, cacheControlFor, packageContentType } from "../headers.js";
import { MANIFEST, THEMES_DIR, checkManifest, checkThemePackage, packageIds, readManifest, themeHead, themeIds } from "../scripts/lib.mjs";
import { docPage, galleryPage, themePage } from "../scripts/themes-site.mjs";
import { APPEARANCE_SCRIPT, homePage } from "../scripts/site.mjs";

const OFFICIAL = ["ignorance-shiyao.ignorance", "typora.academic", "typora.ash", "typora.han", "typora.monospace", "typora.scribble"];
const manifest = (extra = {}) => ({
  id: "typora.ash",
  name: "Ash",
  version: "1.0.0",
  tags: ["Theme"],
  contributes: { themes: ["themes/ash"] },
  ...extra,
});
const ash = join(THEMES_DIR, "typora.ash");
const site = { assets: { css: "/s.css", js: "/a.js", favicon: "/f.png" }, origin: "https://themes.typora.io", sites: { docs: "https://docs.typora.io", extensions: "https://extensions.typora.io", themes: "https://themes.typora.io", home: "https://v2.typora.io" } };
const theme = {
  id: "typora.ash",
  slug: "typora.ash",
  name: "Ash",
  version: "1.0.0",
  description: "A dark theme.",
  author: "Typora",
  repository: "https://github.com/typora/typora-extensions/tree/main/themes/typora.ash",
  colorSchemes: ["dark"],
  updatedAt: "2026-10-31T00:00:00Z",
  page: "https://themes.typora.io/typora.ash/",
  download: { url: "https://extensions.typora.io/download/typora.ash-1.0.0.typora-theme", size: 40949 },
};

test("every official theme is a valid themes-only package", () => {
  assert.deepEqual(themeIds(), OFFICIAL);
  for (const id of themeIds()) {
    const raw = readManifest(id);
    const dir = join(THEMES_DIR, id);
    assert.deepEqual(checkManifest(raw, dir, id).errors, []);
    assert.deepEqual(checkThemePackage(raw, dir), []);
    for (const path of raw.contributes.themes) assert.equal(themeHead(join(dir, path, "theme.toml")).name, raw.name);
  }
});

test("a theme id is unique across extensions/ and themes/", () => {
  assert.equal(new Set(packageIds()).size, packageIds().length);
  for (const id of themeIds()) assert.equal(existsSync(join(THEMES_DIR, "..", "extensions", id, MANIFEST)), false);
});

test("a package in themes/ holds nothing but themes", () => {
  const fails = (extra, message) => assert.ok(checkThemePackage(manifest(extra), ash).some((e) => e.includes(message)), message);
  assert.deepEqual(checkThemePackage(manifest(), ash), []);
  fails({ main: "main.js" }, "no main");
  fails({ background: "background.js" }, "no background");
  fails({ binaries: {} }, "no binaries");
  fails({ permissions: { clipboard: true } }, "no permissions");
  fails({ tags: [] }, '"Theme"');
  fails({ contributes: { themes: ["themes/ash"], commands: [] } }, "only themes");
  fails({ contributes: {} }, "at least one theme");
  fails({ contributes: { themes: ["themes/missing"] } }, "theme.toml is missing");
});

test("the gallery links each theme by its slug and names its colour scheme", () => {
  const html = galleryPage({ ...site, themes: [theme, { ...theme, slug: "github", name: "GitHub", colorSchemes: ["auto"] }] });
  assert.match(html, /href="\/typora\.ash\/"/);
  assert.match(html, /href="\/github\/"/);
  assert.match(html, /Light &amp; dark/);
});

test("a packaged theme installs through the app; a built-in one offers nothing", () => {
  const page = themePage({ ...site, theme });
  assert.match(page, /href="typora:\/\/extension\/typora\.ash"/);
  assert.match(page, /href="\/download\/typora\.ash-1\.0\.0\.typora-theme"/);
  const builtIn = themePage({ ...site, theme: { ...theme, id: undefined, download: undefined, builtIn: true } });
  assert.match(builtIn, /Built-in with Typora/);
  assert.doesNotMatch(builtIn, /typora:\/\//);
});

test("a theme page has one Install button, with the rest in its menu", () => {
  const page = themePage({ ...site, theme });
  assert.equal(page.match(/class="split"/g).length, 1);
  const menu = page.slice(page.indexOf('class="menu"'), page.indexOf("</details>", page.indexOf('class="menu"')));
  assert.match(menu, /Download<\/span><span class="menu-size">40\.0 KB/);
  assert.match(menu, /Homepage/);
  assert.doesNotMatch(page, /class="btn/);
});

test("the Documents page covers installing, writing and submitting", () => {
  const html = docPage(site);
  for (const id of ["install", "write", "submit", "typora-1"]) assert.match(html, new RegExp(`id="${id}"`));
});

test("the extensions site links the themes site", () => {
  assert.match(homePage({ entries: [], assets: site.assets, origin: "https://extensions.typora.io", sites: { ...site.sites, themes: "https://theme2.typoraio.cn" } }), /href="https:\/\/theme2\.typoraio\.cn\/"/);
});

test("every site has the same header, with its own link selected", () => {
  const extensions = homePage({ entries: [], assets: site.assets, origin: site.sites.extensions, sites: site.sites });
  const themes = galleryPage({ ...site, themes: [] });
  const header = (page) => page.slice(page.indexOf("<header"), page.indexOf("</header>")).replace(' class="active"', "").replace(' aria-current="page"', "").replaceAll(' target="_blank" rel="noreferrer"', "");
  const versions = /<div class="version-options"[^>]*>[\s\S]*?<\/div>/;
  assert.equal(header(extensions).replace(versions, ""), header(themes).replace(versions, ""));
  assert.match(extensions, /<button type="button" data-version-unsupported>1\.0<\/button>/);
  assert.match(extensions, /<dialog class="version-dialog"/);
  assert.match(extensions, /Typora 1\.0 does not support extensions/);
  assert.match(themes, /<a href="\/v1\/">1\.0<\/a>/);
  for (const page of [extensions, themes]) {
    assert.match(page, /<details class="version-switcher">/);
    assert.match(page, /<a href="\/" aria-current="true">2\.0 beta<\/a>/);
  }
  assert.match(extensions, /<li class="active"><a href="https:\/\/extensions\.typora\.io\/"/);
  assert.match(themes, /<li class="active"><a href="https:\/\/themes\.typora\.io\/"/);
  assert.deepEqual([...themes.matchAll(/<li[^>]*><a [^>]*>([^<]+)</g)].map((m) => m[1]), ["Docs", "Extensions", "Themes", "Homepage"]);
  assert.match(themes, /class="appearance"/);
  assert.match(themes, /<a href="https:\/\/themes\.typora\.io\/" aria-current="page">/);
  assert.match(themes, /<a href="https:\/\/extensions\.typora\.io\/" target="_blank" rel="noreferrer">/);
});

/** Runs the head script on a stub page and returns it with the switch's click. */
function appearancePage(hostname, cookie = "") {
  const listeners = {};
  const button = { setAttribute(name, value) { this[name] = String(value); } };
  const root = { dataset: {}, style: {} };
  const document = { cookie, documentElement: root, querySelector: () => button, addEventListener: (type, listener) => (listeners[type] = listener) };
  const matchMedia = () => ({ matches: false, addEventListener() {} });
  vm.runInNewContext(APPEARANCE_SCRIPT.replace(/<\/?script>/g, ""), { document, matchMedia, location: { hostname } });
  return { root, document, button, load: listeners.DOMContentLoaded, toggle: () => listeners.click({ target: { closest: () => true } }) };
}

test("the appearance cookie covers every site on the domain", () => {
  for (const [hostname, domain] of [["themes.typora.io", "typora.io"], ["docs.typoraio.cn", "typoraio.cn"]]) {
    const page = appearancePage(hostname);
    assert.equal(page.root.dataset.theme, "light");
    page.toggle();
    assert.equal(page.root.dataset.theme, "dark");
    assert.match(page.document.cookie, new RegExp(`^typora-appearance=dark; .*domain=${domain.replace(".", "\\.")}; secure$`));
  }
});

test("the appearance cookie needs no domain locally and applies on load", () => {
  const local = appearancePage("localhost");
  local.toggle();
  assert.doesNotMatch(local.document.cookie, /domain=|secure/);
  assert.equal(appearancePage("extensions.typora.io", "a=b; typora-appearance=dark").root.dataset.theme, "dark");
});

test("the switch reports the appearance once the header exists", () => {
  const page = appearancePage("themes.typora.io", "typora-appearance=dark");
  page.button["aria-checked"] = "false";
  page.load();
  assert.equal(page.button["aria-checked"], "true");
  page.toggle();
  assert.equal(page.button["aria-checked"], "false");
});

test("theme packages are served with their own type and cached forever", () => {
  const path = "/download/typora.ash-1.0.0.typora-theme";
  assert.equal(packageContentType(path), "application/x-typora-theme");
  assert.equal(packageContentType("/download/x-1.0.0.typora-extension"), "application/x-typora-extension");
  assert.equal(packageContentType("/index.html"), undefined);
  assert.equal(cacheControlFor(path, 200), "public, max-age=31536000, immutable");
  assert.equal(CORS_HEADERS["access-control-allow-origin"], "*");
});
