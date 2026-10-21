/**
 * IndexedDB cache for GLB previews.
 *
 * Every product open used to download the whole GLB again through a signed URL.
 * Storage paths are content-addressed (`uploaded/<id>/<sha256>.glb`,
 * `generated/<id>/<sha256>.glb`, `generated/tripo/<job uuid>/model.glb`), so a
 * blob can be reused safely for the same path. The cache is best-effort: any
 * failure simply falls back to the network download.
 */
import { createStore, del, get, set } from 'idb-keyval';

const store = createStore('fds-model-preview', 'glb');

/** Leave large supplier/Tripo models alone: filling IndexedDB is worse than a slow load. */
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_ENTRIES = 6;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const INDEX_KEY = '__index__';

type Entry = { blob: Blob; savedAt: number };
type IndexEntry = { key: string; savedAt: number };

function available(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export async function readCachedGlb(storagePath: string): Promise<Blob | null> {
  if (!available()) return null;
  try {
    const entry = await get<Entry>(storagePath, store);
    if (!entry?.blob) return null;
    if (Date.now() - entry.savedAt > TTL_MS) {
      void del(storagePath, store);
      return null;
    }
    return entry.blob;
  } catch {
    return null;
  }
}

export async function writeCachedGlb(storagePath: string, blob: Blob): Promise<void> {
  if (!available() || blob.size === 0 || blob.size > MAX_BYTES) return;
  try {
    const savedAt = Date.now();
    await set(storagePath, { blob, savedAt } satisfies Entry, store);
    const index = ((await get<IndexEntry[]>(INDEX_KEY, store)) ?? []).filter((item) => item.key !== storagePath);
    index.push({ key: storagePath, savedAt });
    while (index.length > MAX_ENTRIES) {
      const oldest = index.shift();
      if (oldest) await del(oldest.key, store);
    }
    await set(INDEX_KEY, index, store);
  } catch {
    // Cache is an optimisation only.
  }
}

export async function evictCachedGlb(storagePath: string): Promise<void> {
  if (!available()) return;
  try {
    await del(storagePath, store);
    const index = ((await get<IndexEntry[]>(INDEX_KEY, store)) ?? []).filter((item) => item.key !== storagePath);
    await set(INDEX_KEY, index, store);
  } catch {
    // ignore
  }
}
