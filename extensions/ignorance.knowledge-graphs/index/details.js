const CONTEXT_KEY = "detail-contexts";
const MAX_CONTEXTS = 8;
const MAX_AGE = 90_000;

export function registerDetailSnapshots(api, index, subscriptions, compute) {
  let disposed = false;
  let inFlight = false;
  let invalidated = true;
  let lastContext;
  let lastPath;
  let lastResult;
  let lastWrittenContext;
  let lastWrite = 0;

  async function refresh() {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      const info = await api.document.info();
      if (!info?.path) return;
      if (info.path !== lastPath || invalidated) {
        invalidated = false;
        const blocks = await api.document.getBlocks();
        if ((await api.document.info())?.path !== info.path) {
          invalidated = true;
          return;
        }
        lastContext = blocks[0]?.id;
        lastPath = info.path;
      }
      if (!lastContext) return;
      const state = await index.state();
      const detail = state.status === "ready"
        ? await compute(state.records, info.path, state)
        : { status: state.status, message: state.message };
      if ((await api.document.info())?.path !== info.path) {
        invalidated = true;
        return;
      }
      const now = Date.now();
      const serialized = JSON.stringify(detail);
      const key = lastContext;
      if (key === lastWrittenContext && serialized === lastResult && now - lastWrite < 30_000) return;
      await api.storage.update(CONTEXT_KEY, (previous) => {
        const active = Object.entries(previous ?? {}).filter(([id, value]) => id !== key && now - value.updated < MAX_AGE)
          .sort((a, b) => b[1].updated - a[1].updated).slice(0, MAX_CONTEXTS - 1);
        return Object.fromEntries([[key, { updated: now, ...detail }], ...active]);
      });
      lastWrittenContext = key;
      lastResult = serialized;
      lastWrite = now;
    } finally {
      inFlight = false;
    }
  }

  function schedule() {
    void refresh().catch((error) => api.ui.toast(`侧栏更新失败：${error.message}`));
  }

  const timer = setInterval(schedule, 2500);
  subscriptions.push(index.onChange(() => {
    invalidated = true;
    schedule();
  }), {
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  });
  schedule();
}
