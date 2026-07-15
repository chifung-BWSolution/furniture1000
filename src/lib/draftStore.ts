/**
 * IndexedDB-based draft storage for quotation drafts.
 *
 * Each draft is keyed by `quote_id` (or a temp key for new quotes).
 * On open, the editor checks here first; if a draft exists it hydrates from
 * the local cache instead of hitting the API.
 */

const DB_NAME = 'bwf_quote_drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

/** Composite IndexedDB key scoped to the logged-in user. */
export function makeDraftKey(
  userEmail: string | null | undefined,
  quoteId: string,
): string {
  const email = userEmail?.trim().toLowerCase() || 'anonymous';
  const id = quoteId?.trim() || 'NEW';
  return `${email}::${id}`;
}

export interface DraftData {
  quoteId: string; // IndexedDB key — use makeDraftKey(userEmail, rawQuoteId)
  updatedAt: number; // Date.now()
  formData: Record<string, unknown>;
  companyInfo: Record<string, unknown>;
  clientInfo: Record<string, unknown>;
  quoteMeta: Record<string, unknown>;
  deliveryDetails: string;
  termsContent: Record<string, unknown>;
  items: Record<string, unknown>[];
  subtotal: number;
  discountNote?: string;
  installationFee?: Record<string, unknown>;
  gpSummary?: { ship?: number; installation?: number };
  /** Last applied cost multiplier (e.g. 2.3). */
  priceMultiplier?: number | string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'quoteId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Save (or overwrite) a draft for the given quoteId */
export async function saveDraft(draft: DraftData): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(draft);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Load a draft by quoteId. Returns null if not found. */
export async function loadDraft(quoteId: string): Promise<DraftData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(quoteId);
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** Delete a draft (e.g. after successful submission) */
export async function deleteDraft(quoteId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(quoteId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** List all saved drafts (for debug / future drafts list view) */
export async function listDrafts(): Promise<DraftData[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}
