import { parseVaultNote } from "./parse.js";
import { contentHash, excludedPath, relativePath, scanNotes } from "./scan.js";
import { cacheFile, loadIndex, saveIndex } from "./store.js";

export function createIndex(api) {
  const inFlight = new Map();
  const memory = new Map();
  const persisted = new Map();
  const listeners = new Set();
  const failed = new Set();
  const recordLists = new WeakMap();

  function exclusions() {
    return String(api.settings.get("excludeFolders") ?? "").split(/[,，\n]/);
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  async function readSnapshot(key) {
    const revision = await api.storage.get(key + "-revision");
    const local = memory.get(key);
    if (local && local.baseRevision === revision) return local.data;
    memory.delete(key);
    const cached = persisted.get(key);
    if (revision && cached?.revision === revision) return cached;
    const data = await loadIndex(api.storage, key);
    if (data) persisted.set(key, data);
    return data;
  }

  async function writeSnapshot(key, data) {
    const baseRevision = await api.storage.get(key + "-revision");
    memory.set(key, { data, baseRevision });
    await saveIndex(api.storage, key, data);
    await api.storage.set(key + "-revision", data.revision);
    persisted.set(key, data);
    memory.delete(key);
  }

  async function rebuild({ announce = false, expectedScope } = {}) {
    const root = (await api.workspace.folders())[0];
    if (!root) {
      if (expectedScope) throw new Error("工作区已切换，请再次刷新");
      if (announce) await api.ui.toast("请先打开工作区文件夹");
      return;
    }
    const key = await cacheFile(root);
    if (expectedScope && key !== expectedScope) throw new Error("工作区已切换，请再次刷新");
    if (inFlight.has(key)) return inFlight.get(key);
    failed.delete(key);
    const pending = api.runtime.lock(key, async () => {
      const started = performance.now();
      const excluded = exclusions();
      let old;
      let cacheReadError;
      try {
        old = await readSnapshot(key);
      } catch (error) {
        cacheReadError = error.message;
      }
      const result = await scanNotes(api.workspace, root, old, { exclude: excluded });
      result.excluded = excluded;
      result.revision = globalThis.crypto.randomUUID();
      let cacheError;
      try {
        await writeSnapshot(key, result);
      } catch (error) {
        cacheError = error.message;
      }
      const elapsed = Math.round(performance.now() - started);
      const notices = [`已索引 ${result.entries.length} 个文件，${elapsed} 毫秒`];
      if (result.limit) notices.push("最多只读取前 5,000 个文件");
      if (result.depthLimit) notices.push("已达到 Typora 的 8 层目录扫描范围");
      else if (announce) notices.push("Typora 最多读取 8 层目录");
      if (result.unreadable.length) notices.push(`${result.unreadable.length} 个文件读取失败`);
      if (cacheReadError) notices.push(`缓存无法读取，已重新扫描：${cacheReadError}`);
      if (cacheError) notices.push(`缓存未写入：${cacheError}`);
      if (announce) notices.push(`复用 ${result.reused} 个文件的解析缓存`);
      if (announce || notices.length > 1) await api.ui.toast(notices.join("。"));
      return result;
    }).catch((error) => {
      failed.add(key);
      throw error;
    }).finally(() => {
      inFlight.delete(key);
      notify();
    });
    inFlight.set(key, pending);
    return pending;
  }

  async function state() {
    const root = (await api.workspace.folders())[0];
    if (!root) return { status: "no-workspace", records: [] };
    const key = await cacheFile(root);
    if (inFlight.has(key)) return { status: "indexing", records: [] };
    // An unreadable cache can be reconstructed from the workspace.
    const existing = await readSnapshot(key).catch(() => undefined);
    if (!existing || JSON.stringify(existing.excluded) !== JSON.stringify(exclusions())) {
      if (failed.has(key)) return { status: "error", records: [], message: "工作区索引失败，请执行「重建索引」" };
      void rebuild({ announce: !existing }).catch((error) => api.ui.toast(`无法建立索引：${error.message}`));
      return { status: "indexing", records: [] };
    }
    let records = recordLists.get(existing);
    if (!records) {
      records = existing.entries.map(({ note, live }) => live ?? note);
      recordLists.set(existing, records);
    }
    return { status: "ready", root, scope: key, revision: existing.revision, records };
  }

  async function updateCurrent() {
    const root = (await api.workspace.folders())[0];
    const info = await api.document.info();
    if (!root || !info?.path) return;
    const path = relativePath(root, info.path);
    if (!path || !/\.(?:md|markdown)$/i.test(path) || excludedPath(path, exclusions())) return;
    const markdown = await api.editor.getMarkdown();
    const digest = await contentHash(markdown);
    if ((await api.document.info())?.path !== info.path) return;
    const key = await cacheFile(root);
    await api.runtime.lock(key, async () => {
      const existing = await readSnapshot(key);
      if (!existing) return;
      const position = existing.entries.findIndex((item) => item.note.path === path);
      if (position < 0) return;
      const entry = { ...existing.entries[position] };
      if (digest === entry.hash) {
        if (!entry.live) return;
        delete entry.live;
        delete entry.liveHash;
      } else {
        if (entry.liveHash === digest) return;
        entry.live = parseVaultNote(path, markdown);
        entry.liveHash = digest;
      }
      const entries = [...existing.entries];
      entries[position] = entry;
      const updated = { ...existing, entries, revision: globalThis.crypto.randomUUID() };
      try {
        await writeSnapshot(key, updated);
      } catch (error) {
        await api.ui.toast(`索引缓存未写入：${error.message}`);
      }
    });
    notify();
  }

  function onChange(listener) {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  }

  return { rebuild, state, updateCurrent, onChange };
}
