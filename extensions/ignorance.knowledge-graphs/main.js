import { createRelations } from "./index/relations.js";
import { createGraphModel } from "./index/graph-model.js";
import { createGraphRefresh } from "./index/graph-refresh.js";
import { createGraphAi } from "./index/graph-ai.js";
import { contentHash, relativePath } from "./index/scan.js";
import { registerDetailSnapshots } from "./index/details.js";
import { createIndex } from "./index/controller.js";

const GRAPH_STORAGE_BYTES = 2 * 1024 * 1024;

export function activate(ctx) {
  const index = createIndex(typora);
  const graphModel = createGraphModel();
  let relationshipIndex;
  let revision;
  let publishedGraph;
  const shareGlobal = async ({ global, info, ...model }, scope) => {
    const localPaths = new Set(model.local.flatMap(({ nodes }) => nodes.map(({ path }) => path).filter(Boolean)));
    const localInfo = Object.fromEntries([...localPaths].filter((path) => Object.hasOwn(info, path)).map((path) => [path, info[path]]));
    const local = { ...model, scope, localInfo };
    if (!global) return local;
    const now = Date.now();
    const sameGraph = publishedGraph?.scope === scope && publishedGraph.global === global && publishedGraph.info === info;
    if (sameGraph && now - publishedGraph.at < 30_000) {
      return { ...local, globalId: publishedGraph.id };
    }

    const serialized = JSON.stringify([global, info]);
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > GRAPH_STORAGE_BYTES) {
      return { ...local, globalNotice: "全局图过大，当前显示局部图" };
    }
    // Different windows can compute the same layout. Keep their snapshot ID equal.
    const id = sameGraph ? publishedGraph.id : await contentHash(serialized);
    await typora.storage.update("graph-workspaces", (previous) => {
      const active = Object.entries(previous ?? {}).filter(([key, value]) => key !== scope && now - value.at < 90_000)
        .sort((a, b) => b[1].at - a[1].at);
      let used = bytes;
      const entries = [[scope, { id, at: now, bytes, graph: global, info }]];
      for (const [key, value] of active) {
        if (entries.length === 4) break;
        if (!Number.isSafeInteger(value.bytes) || used + value.bytes > GRAPH_STORAGE_BYTES) continue;
        entries.push([key, value]);
        used += value.bytes;
      }
      return Object.fromEntries(entries);
    });
    publishedGraph = { scope, global, info, id, at: now };
    return { ...local, globalId: id };
  };
  registerDetailSnapshots(typora, index, ctx.subscriptions, async (records, currentPath, state) => {
    if (revision !== state.revision || !relationshipIndex) {
      relationshipIndex = createRelations(records);
      revision = state.revision;
    }
    const path = relativePath(state.root, currentPath);
    try {
      return { graph: await shareGlobal(graphModel(relationshipIndex, path), state.scope) };
    } catch (error) {
      return { graph: { error: `无法加载图谱：${error.message}` } };
    }
  });
  const graphRefresh = createGraphRefresh(typora, index);
  const refreshTimer = setInterval(() => void graphRefresh.poll().catch((error) => typora.ui.toast(`刷新图谱失败：${error.message}`)), 400);
  const graphAi = createGraphAi(typora, index);
  const aiTimer = setInterval(() => void graphAi.poll().catch((error) => typora.ui.toast(`图谱整理失败：${error.message}`)), 400);
  ctx.subscriptions.push({ dispose() { clearInterval(refreshTimer); clearInterval(aiTimer); } });
  const report = (error) => typora.ui.toast(`图谱索引失败：${error.message}`);
  ctx.subscriptions.push(
    typora.commands.register("rebuild-graph", () => index.rebuild({ announce: true }).catch(report)),
    typora.document.onDidChange(() => index.updateCurrent().catch(report)),
    typora.settings.onDidChange(() => index.rebuild().catch(report)),
  );
  void index.rebuild({ announce: true }).catch(report);
}
