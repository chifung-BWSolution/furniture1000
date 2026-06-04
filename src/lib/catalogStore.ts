// ============================================================================
// Product Catalog (產品目錄) — front-end only selection store.
// Holds the set of product IDs the user has "uploaded to 產品目錄".
// Persisted in localStorage; the 產品目錄 page reuses the products table
// (Supabase) but only shows products whose id is in this set. No DB change.
// ============================================================================

const STORAGE_KEY = 'fds-product-catalog-ids';

type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota errors */
  }
  listeners.forEach((l) => l(ids));
}

/** Current catalog product IDs. */
export function getCatalogIds(): string[] {
  return read();
}

/** Add product IDs to the catalog (deduped). Returns how many were newly added. */
export function addToCatalog(ids: string[]): number {
  const current = read();
  const set = new Set(current);
  let added = 0;
  for (const id of ids) {
    if (!set.has(id)) { set.add(id); added++; }
  }
  if (added > 0) write(Array.from(set));
  return added;
}

/** Remove product IDs from the catalog. */
export function removeFromCatalog(ids: string[]): void {
  const set = new Set(read());
  let changed = false;
  for (const id of ids) {
    if (set.delete(id)) changed = true;
  }
  if (changed) write(Array.from(set));
}

/** Subscribe to catalog changes. Returns an unsubscribe function. */
export function subscribeCatalog(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
