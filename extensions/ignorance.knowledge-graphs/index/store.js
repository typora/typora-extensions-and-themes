import { contentHash } from "./scan.js";

const VERSION = 2;
const MAX_CACHE_BYTES = 100 * 1024 * 1024;

export async function cacheFile(root) {
  return `index-${await contentHash(root)}.json`;
}

export async function loadIndex(storage, key) {
  let source;
  try {
    source = await storage.files.readText(key);
  } catch (error) {
    if (storage.files.list && !(await storage.files.list()).includes(key)) return undefined;
    throw error;
  }
  if (!source) return undefined;
  try {
    const data = JSON.parse(source);
    return data.version === VERSION && Array.isArray(data.entries) ? data : undefined;
  } catch {
    return undefined;
  }
}

export async function saveIndex(storage, key, data) {
  const serialized = JSON.stringify({ ...data, version: VERSION });
  if (new TextEncoder().encode(serialized).length > MAX_CACHE_BYTES) {
    throw new Error("索引缓存超过 100 MB");
  }
  await storage.files.write(key, serialized);
}
