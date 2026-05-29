/**
 * IndexedDB-based session persistence for Excel preview data.
 * Uses idb-keyval for a simple key-value interface backed by IndexedDB,
 * which has no practical size limit (unlike localStorage's ~5MB cap).
 * This allows us to persist full base64 image data across page refreshes.
 *
 * Fallback: If IndexedDB is unavailable, falls back to localStorage (text-only, images stripped).
 */

import { get, set, del, createStore } from 'idb-keyval';

// Create a dedicated store so we don't pollute the default idb-keyval DB
const sessionStore = createStore('excel-session-db', 'excel-session-store');

const SESSION_KEY = 'excel-preview-session';
const MAPPINGS_KEY = 'excel-preview-mappings';

// Feature detection for IndexedDB
function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Save the full Excel preview session (including images) to IndexedDB.
 * Falls back to localStorage (stripped) if IndexedDB is unavailable.
 */
export async function saveSession(data: any): Promise<void> {
  if (isIndexedDBAvailable()) {
    try {
      await set(SESSION_KEY, data, sessionStore);
      const imageCount = (data?.rows || []).filter((r: any) => r.productImageData || r.lifestyleImageData).length;
      const topLevelImages = data?.images?.length || 0;
      console.log(`[IndexedDB] Saving session with ${imageCount + topLevelImages} images...`, {
        rows: data?.rows?.length,
        topLevelImages,
        rowsWithImages: imageCount,
        manufacturer: data?._manufacturer,
      });
      return;
    } catch (e) {
      console.warn('[IndexedDB] ⚠️ IndexedDB save failed, falling back to localStorage:', e);
    }
  }

  // Fallback: localStorage (strip images to fit 5MB limit)
  try {
    const stripped = stripImagesForLocalStorage(data);
    const json = JSON.stringify(stripped);
    localStorage.setItem(SESSION_KEY, json);
    console.log('[IndexedDB] ⚠️ Saving to localStorage fallback (images stripped)', {
      rows: stripped?.rows?.length,
      sizeKB: Math.round(json.length / 1024),
    });
  } catch (e) {
    console.error('[IndexedDB] ❌ Failed to save session (both IndexedDB and localStorage):', e);
  }
}

/**
 * Load the Excel preview session from IndexedDB (with images).
 * Falls back to localStorage if IndexedDB is unavailable or empty.
 */
export async function loadSession(): Promise<any | null> {
  if (isIndexedDBAvailable()) {
    try {
      const data = await get(SESSION_KEY, sessionStore);
      if (data) {
        const imageCount = (data?.rows || []).filter((r: any) => r.productImageData || r.lifestyleImageData).length;
        const topLevelImages = data?.images?.length || 0;
        console.log(`[IndexedDB] Restore successful. Table is ready.`, {
          rows: data?.rows?.length,
          totalImages: imageCount + topLevelImages,
          rowsWithProductImage: (data?.rows || []).filter((r: any) => r.productImageData).length,
          rowsWithLifestyleImage: (data?.rows || []).filter((r: any) => r.lifestyleImageData).length,
          manufacturer: data?._manufacturer,
        });
        return data;
      }
    } catch (e) {
      console.warn('[IndexedDB] ⚠️ IndexedDB load failed, trying localStorage:', e);
    }
  }

  // Fallback: localStorage
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      console.log('[IndexedDB] Restored from localStorage (fallback, images not available)', {
        rows: parsed?.rows?.length,
        manufacturer: parsed?._manufacturer,
      });
      return parsed;
    }
  } catch (e) {
    console.warn('[IndexedDB] ❌ Failed to restore from localStorage:', e);
  }

  return null;
}

/**
 * Clear the session from both IndexedDB and localStorage.
 * Call this when user clicks Cancel or finishes processing.
 */
export async function clearSession(): Promise<void> {
  console.log('[IndexedDB] 🗑️ Clearing session from all stores');

  if (isIndexedDBAvailable()) {
    try {
      await del(SESSION_KEY, sessionStore);
    } catch (e) {
      console.warn('[IndexedDB] ⚠️ Failed to clear IndexedDB:', e);
    }
  }

  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // ignore
  }
}

/**
 * Save column mapping session.
 */
export async function saveMappings(data: any): Promise<void> {
  if (isIndexedDBAvailable()) {
    try {
      await set(MAPPINGS_KEY, data, sessionStore);
      return;
    } catch (e) {
      // fallback
    }
  }
  try {
    localStorage.setItem(MAPPINGS_KEY, JSON.stringify(data));
  } catch (e) {
    // ignore
  }
}

/**
 * Load column mapping session.
 */
export async function loadMappings(): Promise<any | null> {
  if (isIndexedDBAvailable()) {
    try {
      const data = await get(MAPPINGS_KEY, sessionStore);
      if (data) return data;
    } catch (e) {
      // fallback
    }
  }
  try {
    const raw = localStorage.getItem(MAPPINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Clear column mappings from all stores.
 */
export async function clearMappings(): Promise<void> {
  if (isIndexedDBAvailable()) {
    try {
      await del(MAPPINGS_KEY, sessionStore);
    } catch (e) {
      // ignore
    }
  }
  try {
    localStorage.removeItem(MAPPINGS_KEY);
  } catch (e) {
    // ignore
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function stripImagesForLocalStorage(data: any): any {
  if (!data) return data;

  const { rawArrayBuffer, images, ...rest } = data;

  const strippedRows = (rest.rows || []).map((row: any) => ({
    ...row,
    productImageData: null,
    lifestyleImageData: null,
  }));

  const strippedSheets = (rest.sheets || []).map((sheet: any) => ({
    ...sheet,
    rows: (sheet.rows || []).map((row: any) => ({
      ...row,
      productImageData: null,
      lifestyleImageData: null,
    })),
  }));

  const result = {
    ...rest,
    rows: strippedRows,
    sheets: strippedSheets,
    images: [],
  };

  // If still too large, trim cell values
  const json = JSON.stringify(result);
  if (json.length > 4.5 * 1024 * 1024) {
    result.rows = strippedRows.map((row: any) => ({
      ...row,
      cells: (row.cells || []).map((cell: any) => {
        if (typeof cell === 'string' && cell.length > 500) {
          return cell.substring(0, 500) + '…';
        }
        return cell;
      }),
    }));
  }

  return result;
}
