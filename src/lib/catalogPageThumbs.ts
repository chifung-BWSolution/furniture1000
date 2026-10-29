/**
 * 圖冊頁縮圖：向 edge 取抽取頁 → pdf.js 畫成小尺寸 JPEG → IndexedDB 快取。
 *
 * 為甚麼要這樣做：報價附件的圖冊選擇器要同時顯示十幾頁。直接下載整頁 PDF
 * （一頁約 0.3–1 MB）再在瀏覽器畫，開一次要十幾 MB；縮圖版一頁約 15–25 KB，
 * 而且第二次打開（同一部機）直接由 IndexedDB 取，不再打 edge。
 *
 * 快取是盡力而為：IndexedDB 不可用或失敗時照樣向 edge 取，只是慢一點。
 */
import { createStore, del, get, set } from 'idb-keyval';
import { fetchQuoteCatalogPdf } from '@/lib/quoteCatalogPages';
import { renderQuotePdfThumbnails } from '@/lib/quotationPdfCanvas';

export interface CatalogPageThumb {
  dataUrl: string;
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

const store = createStore('fds-catalog-thumbs', 'pages');
const INDEX_KEY = '__index__';

type Entry = { thumb: CatalogPageThumb; savedAt: number };
type IndexEntry = { key: string; savedAt: number };

const memory = new Map<string, CatalogPageThumb>();
const inFlight = new Map<string, Promise<CatalogPageThumb | null>>();
const queues = new Map<string, { pageNo: number; resolve: (thumb: CatalogPageThumb | null) => void }[]>();
const timers = new Map<string, number>();

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

/** 先讀 IndexedDB（不快取記憶體以外的東西），沒有才排隊產生。 */
export async function loadCatalogPageThumb(
  documentId: string,
  pageNo: number,
): Promise<CatalogPageThumb | null> {
  const cached = memory.get(cacheKey(documentId, pageNo));
  if (cached) return cached;
  const stored = await readStored(documentId, pageNo);
  if (stored) return stored;
  return getCatalogPageThumb(documentId, pageNo);
}

/** 背景預取（例如下一頁的縮圖），不影響目前畫面。 */
export function primeCatalogPageThumbs(documentId: string, pageNos: number[]): void {
  for (const pageNo of pageNos) {
    if (memory.has(cacheKey(documentId, pageNo))) continue;
    void loadCatalogPageThumb(documentId, pageNo);
  }
}
