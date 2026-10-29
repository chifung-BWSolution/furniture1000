/**
 * 圖冊頁縮圖。兩個來源，先便宜後貴：
 *
 * 1. **Storage 預先產好的縮圖**（`product-images/catalog-thumbs/<doc>/<page>.jpg`）：
 *    夜間解析／cron 用 pdfium 畫好，一頁約 9–25 KB，公開 URL 由 CDN 快取。
 * 2. 沒有預產時才回退到舊做法：向 edge 取整頁 PDF（0.3–1.3 MB）再用 pdf.js 畫，
 *    並存進 IndexedDB（同一部機第二次開啟即時）。
 *
 * 所以「夜間有跑過」的圖冊第一次打開就已經是縮圖；未跑過的仍可用，只是慢一點。
 */
import { createStore, del, get, set } from 'idb-keyval';
import { supabase } from '@/lib/supabase';
import { fetchQuoteCatalogPdf } from '@/lib/quoteCatalogPages';
import { renderQuotePdfThumbnails } from '@/lib/quotationPdfCanvas';

export interface CatalogPageThumb {
  /** 瀏覽器直接載入的圖片（Storage 預產縮圖）。 */
  url?: string;
  /** 瀏覽器即場畫出來的 JPEG data URL（沒有預產縮圖時）。 */
  dataUrl?: string;
  width: number;
  height: number;
}

/** 縮圖最大寬度（px）。A4 直向約 360 × 509，跨頁約 360 × 246。 */
export const CATALOG_THUMB_WIDTH = 360;
const THUMB_QUALITY = 0.72;
/** edge 一次最多 24 頁；圖冊單頁 0.3–1.3 MB，每批 3 頁讓第一排縮圖早點出現。 */
const BATCH_SIZE = 3;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;
const THUMB_BUCKET = 'product-images';

const store = createStore('fds-catalog-thumbs', 'pages');
const INDEX_KEY = '__index__';

type Entry = { thumb: CatalogPageThumb; savedAt: number };
type IndexEntry = { key: string; savedAt: number };

const memory = new Map<string, CatalogPageThumb>();
const inFlight = new Map<string, Promise<CatalogPageThumb | null>>();
const queues = new Map<string, { pageNo: number; resolve: (thumb: CatalogPageThumb | null) => void }[]>();
const timers = new Map<string, number>();
/** 每份圖冊只叫一次「補畫縮圖」，不要在背景狂打 edge。 */
const fillRequested = new Set<string>();

/** 預產縮圖的公開 URL（與 edge `catalog-thumbs` 的路徑一致）。 */
export function catalogThumbUrl(documentId: string, pageNo: number): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const path = `catalog-thumbs/${documentId}/${String(pageNo).padStart(4, '0')}.jpg`;
  return `${base}/storage/v1/object/public/${THUMB_BUCKET}/${path}`;
}

/** 圖片存在就回尺寸（順便讓瀏覽器快取那張圖），不存在回 null。 */
function probeCatalogThumb(url: string): Promise<CatalogPageThumb | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (image.naturalWidth > 0) {
        resolve({ url, width: image.naturalWidth, height: image.naturalHeight });
      } else {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * 背景請 edge 補畫這份圖冊還缺的縮圖（一次幾頁）。同一份圖冊每次開啟只叫一次；
 * 失敗不影響畫面（仍會用回退路徑）。
 */
export function requestCatalogThumbFill(documentId: string): void {
  if (fillRequested.has(documentId)) return;
  fillRequested.add(documentId);
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await supabase.functions.invoke('catalog-thumbs', {
        body: { documentId },
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // 補畫只是加速，失敗照舊用 PDF 回退。
    }
  })();
}

function cacheKey(documentId: string, pageNo: number): string {
  return `${documentId}#${pageNo}`;
}

function available(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** 同步取已快取的縮圖（給第一次 render 用，避免閃一下 loading）。 */
export function peekCatalogPageThumb(documentId: string, pageNo: number): CatalogPageThumb | null {
  return memory.get(cacheKey(documentId, pageNo)) ?? null;
}

async function readStored(documentId: string, pageNo: number): Promise<CatalogPageThumb | null> {
  if (!available()) return null;
  try {
    const entry = await get<Entry>(cacheKey(documentId, pageNo), store);
    if (!entry?.thumb?.dataUrl) return null;
    if (Date.now() - entry.savedAt > TTL_MS) {
      void del(cacheKey(documentId, pageNo), store);
      return null;
    }
    memory.set(cacheKey(documentId, pageNo), entry.thumb);
    return entry.thumb;
  } catch {
    return null;
  }
}

async function writeStored(documentId: string, pageNo: number, thumb: CatalogPageThumb): Promise<void> {
  if (!available()) return;
  const key = cacheKey(documentId, pageNo);
  try {
    const savedAt = Date.now();
    await set(key, { thumb, savedAt } satisfies Entry, store);
    const index = ((await get<IndexEntry[]>(INDEX_KEY, store)) ?? []).filter((item) => item.key !== key);
    index.push({ key, savedAt });
    while (index.length > MAX_ENTRIES) {
      const oldest = index.shift();
      if (oldest) await del(oldest.key, store);
    }
    await set(INDEX_KEY, index, store);
  } catch {
    // 快取只是加速，失敗不影響顯示。
  }
}

/** 最近一次失敗原因（給對話框顯示，不再只是一個壞掉的圖片圖示）。 */
const failures = new Map<string, string>();

export function catalogThumbFailure(documentId: string): string | null {
  for (const [key, message] of failures) {
    if (key.startsWith(`${documentId}#`)) return message;
  }
  return null;
}

export function clearCatalogThumbFailure(documentId: string): void {
  for (const key of [...failures.keys()]) {
    if (key.startsWith(`${documentId}#`)) failures.delete(key);
  }
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|unauthor|請先登入/i.test(message)) return '登入已過期，請重新整理再試';
  if (/abort|network|fetch/i.test(message)) return '網絡中斷，請再試一次';
  if (/429|rate/i.test(message)) return '讀取太頻繁，請稍後再試';
  return message.slice(0, 120) || '縮圖未能讀取';
}

/** 一批失敗時逐頁再試一次：一頁壞不要拖累其餘七頁。 */
async function renderBatch(documentId: string, pageNos: number[]): Promise<Map<number, CatalogPageThumb>> {
  const done = new Map<number, CatalogPageThumb>();
  const bytes = await fetchQuoteCatalogPdf(pageNos.map((pageNo) => ({ documentId, pageNo })));
  const thumbs = await renderQuotePdfThumbnails(bytes, {
    maxWidth: CATALOG_THUMB_WIDTH,
    quality: THUMB_QUALITY,
  });
  pageNos.forEach((pageNo, index) => {
    const thumb = thumbs[index];
    if (thumb) done.set(pageNo, thumb);
  });
  return done;
}

async function flush(documentId: string): Promise<void> {
  const jobs = queues.get(documentId) ?? [];
  queues.delete(documentId);
  for (let start = 0; start < jobs.length; start += BATCH_SIZE) {
    const batch = jobs.slice(start, start + BATCH_SIZE);
    let done = new Map<number, CatalogPageThumb>();
    let batchError: unknown = null;
    try {
      done = await renderBatch(documentId, batch.map((job) => job.pageNo));
    } catch (err) {
      batchError = err;
    }
    for (const job of batch) {
      const thumb = done.get(job.pageNo);
      const key = cacheKey(documentId, job.pageNo);
      if (thumb) {
        memory.set(key, thumb);
        failures.delete(key);
        void writeStored(documentId, job.pageNo, thumb);
        inFlight.delete(key);
        job.resolve(thumb);
        continue;
      }
      // 整批失敗時逐頁重試一次，避免一個壞頁拖累同一批其他頁。
      if (batchError && batch.length > 1) {
        try {
          const single = await renderBatch(documentId, [job.pageNo]);
          const retried = single.get(job.pageNo);
          if (retried) {
            memory.set(key, retried);
            failures.delete(key);
            void writeStored(documentId, job.pageNo, retried);
            inFlight.delete(key);
            job.resolve(retried);
            continue;
          }
        } catch (err) {
          batchError = err;
        }
      }
      failures.set(key, describeError(batchError ?? new Error('這一頁未能讀取')));
      inFlight.delete(key);
      job.resolve(null);
    }
  }
}

/**
 * 一頁縮圖。同一個 tick 內的多個請求會合成一批（每個文件最多 4 頁一次；
 * 圖冊一頁 0.3–1.3 MB，小批才不會開一次彈窗就下載二十 MB），
 * 同一頁重複請求會共用同一個 promise。
 */
export function getCatalogPageThumb(documentId: string, pageNo: number): Promise<CatalogPageThumb | null> {
  const key = cacheKey(documentId, pageNo);
  const cached = memory.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = new Promise<CatalogPageThumb | null>((resolve) => {
    const queue = queues.get(documentId) ?? [];
    queue.push({ pageNo, resolve });
    queues.set(documentId, queue);
    if (!timers.has(documentId)) {
      timers.set(
        documentId,
        window.setTimeout(() => {
          timers.delete(documentId);
          void flush(documentId);
        }, 60),
      );
    }
  });
  inFlight.set(key, promise);
  return promise;
}

/** 先看記憶體／IndexedDB，再看 Storage 有沒有預產縮圖，最後才向 edge 拿整頁來畫。 */
export async function loadCatalogPageThumb(
  documentId: string,
  pageNo: number,
): Promise<CatalogPageThumb | null> {
  const cached = memory.get(cacheKey(documentId, pageNo));
  if (cached) return cached;
  const stored = await readStored(documentId, pageNo);
  if (stored) return stored;

  const prepared = await probeCatalogThumb(catalogThumbUrl(documentId, pageNo));
  if (prepared) {
    memory.set(cacheKey(documentId, pageNo), prepared);
    return prepared;
  }
  // 這份圖冊還缺預產縮圖：請 edge 在背景補幾頁，下一次開啟就會快。
  requestCatalogThumbFill(documentId);
  return getCatalogPageThumb(documentId, pageNo);
}

/** 背景預取（例如下一頁的縮圖），不影響目前畫面。 */
export function primeCatalogPageThumbs(documentId: string, pageNos: number[]): void {
  for (const pageNo of pageNos) {
    if (memory.has(cacheKey(documentId, pageNo))) continue;
    void loadCatalogPageThumb(documentId, pageNo);
  }
}
