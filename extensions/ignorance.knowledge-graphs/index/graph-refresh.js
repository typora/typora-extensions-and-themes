import { cacheFile } from "./store.js";

export const REFRESH_PREFIX = "graph-refresh-";
export const REFRESH_DONE = "graph-refresh-done";
const TIMEOUT = 60_000;
const KEPT_RESPONSES = 16;

export function createGraphRefresh(api, index) {
  let running = false;

  async function poll() {
    if (running) return;
    running = true;
    try {
      const keys = (await api.storage.keys()).filter((key) => key.startsWith(REFRESH_PREFIX) && key !== REFRESH_DONE);
      if (!keys.length) return;
      const root = (await api.workspace.folders())[0];
      const scope = root ? await cacheFile(root) : undefined;
      const readPending = async (keys) => {
        const fresh = [];
        for (const key of keys) {
          const request = await api.storage.get(key);
          if (!request) continue;
          if (Date.now() - request.at > TIMEOUT) await api.storage.remove(key);
          else if (scope && request.scope === scope) fresh.push(key);
        }
        return fresh;
      };
      const candidates = await readPending(keys);
      if (!candidates.length) return;
      await api.runtime.lock(`graph-refresh:${scope}`, async () => {
        const fresh = await readPending(candidates);
        if (!fresh.length) return;
        let error = "";
        try {
          await index.rebuild({ expectedScope: scope });
        } catch (failure) {
          error = failure.message;
        }
        await api.storage.update(REFRESH_DONE, (previous) => {
          const now = Date.now();
          const entries = Object.entries(previous ?? {}).filter(([key, item]) => !fresh.includes(key) && now - item.at < TIMEOUT);
          entries.push(...fresh.map((key) => [key, { error, at: now }]));
          return Object.fromEntries(entries.slice(-Math.max(KEPT_RESPONSES, fresh.length)));
        });
        for (const key of fresh) await api.storage.remove(key);
      });
    } finally {
      running = false;
    }
  }

  return { poll };
}
