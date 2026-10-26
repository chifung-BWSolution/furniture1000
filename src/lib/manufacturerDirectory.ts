// ============================================================================
// 廠家目錄資料層（Manufacturer Directory）
//
// 側欄只在「廠家目錄」留下這一頁。廠家分區、廠家登入頁也會同時要廠家名單。
// 目錄表本身只顯示廠家欄位，所以這裡
// 走 edge function 的 `action: 'list'`：只回 factories，不帶 projects／comments。
//
// 相容性：已部署的舊版 edge function 不理會 action，仍會回完整 payload，
// `factories` 欄位一樣在，所以舊版也能用；只有 payload 大小差異。
// ============================================================================
import { supabase } from '@/lib/supabase';

export interface DirectoryFactory {
  id: string;
  display_name: string;
  factory_code: string | null;
  contact_person: string | null;
  phone: string | null;
  location: string | null;
  project_number: number | null;
  working_folder: string | null;
  join_date: string | null;
  created_at: string | null;
  supplier_kind?: 'furniture' | 'material' | 'both' | null;
  used_this_year?: boolean;
  catalog_year?: number | null;
  quote_pdf_year?: number | null;
  catalog_file?: DirectoryDocumentLink | null;
  quote_file?: DirectoryDocumentLink | null;
}

export interface DirectoryDocumentLink {
  id: string;
  storage_path: string;
  document_year: number | null;
  created_at: string | null;
}

/** 前端實際呼叫的 slug 在前；裸 slug 是同源的舊 alias。 */
const DIRECTORY_SLUGS = [
  'supabase-functions-fetch-manufacturer-directory',
  'fetch-manufacturer-directory',
];

/** 廠家名單變動不快，60 秒內共用同一份結果。 */
const CACHE_TTL_MS = 60_000;

let cache: { rows: DirectoryFactory[]; at: number } | null = null;
let inflight: Promise<DirectoryFactory[]> | null = null;

function statusOf(error: unknown): number | null {
  const context = (error as { context?: { status?: number } } | null)?.context;
  return typeof context?.status === 'number' ? context.status : null;
}

function toRows(payload: unknown): DirectoryFactory[] {
  const data = payload as { factories?: DirectoryFactory[] } | null;
  return Array.isArray(data?.factories) ? data.factories : [];
}

/**
 * 舊的裸 slug 只回廠家主檔，沒有 supplier_kind。
 * 那種結果會讓類型全部變成「—」、今年報價全部變成「無」，不能拿來畫這張表。
 */
function includesDirectorySignals(payload: unknown): boolean {
  const factories = (payload as { factories?: Array<Record<string, unknown>> } | null)?.factories;
  if (!Array.isArray(factories) || factories.length === 0) return false;
  return Object.prototype.hasOwnProperty.call(factories[0], 'supplier_kind');
}

/** 只有「不支援這個 action」類的回應才值得改用完整 payload。 */
const FALLBACK_STATUSES = new Set([400, 404, 405, 501]);

async function invokeDirectory(body: Record<string, unknown>): Promise<DirectoryFactory[]> {
  let lastError: unknown = null;
  let plainRows: DirectoryFactory[] | null = null;

  for (const slug of DIRECTORY_SLUGS) {
    try {
      const { data, error } = await supabase.functions.invoke(slug, { body });
      if (error) {
        lastError = error;
        const status = statusOf(error);
        if (status === 401 || status === 403) throw error;
        continue;
      }
      const payload = data as { error?: string } | null;
      if (payload?.error) {
        lastError = new Error(payload.error);
        continue;
      }
      const rows = toRows(data);
      if (includesDirectorySignals(data)) return rows;
      plainRows = rows;
    } catch (err) {
      lastError = err;
      const status = statusOf(err);
      if (status === 401 || status === 403) throw err;
    }
  }

  if (plainRows) return plainRows;
  throw lastError instanceof Error ? lastError : new Error('廠家目錄載入失敗');
}

async function loadDirectory(): Promise<DirectoryFactory[]> {
  try {
    return await invokeDirectory({ action: 'list' });
  } catch (err) {
    // 線上的 edge function 還沒有 `action: 'list'`（或 slug 不存在）時，
    // 退回原本的完整 payload — 結果相同，只是慢一點。
    const status = statusOf(err);
    if (status === null || !FALLBACK_STATUSES.has(status)) throw err;
    console.warn('[manufacturerDirectory] list action unavailable, falling back to full payload', err);
    return invokeDirectory({});
  }
}

/**
 * 讀取廠家目錄。同一時間內的並行呼叫共用同一個 request，
 * 60 秒內的重複讀取直接用快取。
 */
export async function loadManufacturerDirectory(options: { force?: boolean } = {}): Promise<DirectoryFactory[]> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  if (inflight) return inflight;

  inflight = loadDirectory()
    .then((rows) => {
      cache = { rows, at: Date.now() };
      return rows;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** 廠家資料有變動時叫它，下次讀取會重新抓。 */
export function clearManufacturerDirectoryCache(): void {
  cache = null;
}
