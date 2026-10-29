/**
 * 圖冊頁縮圖（伺服器端）：把圖冊頁畫成 ~360px JPEG，存進
 * `product-images/catalog-thumbs/<document_id>/<page>.jpg`。
 *
 * 為甚麼要預先產生：圖冊一頁 0.3–1.3 MB，前端要「整頁 PDF 下載 + 自己畫」才看得到
 * 縮圖，開一屏 12 頁要抓十幾 MB。夜間解析已經處理過同一份 PDF，順便把縮圖畫好，
 * 之後報價附件選擇器只抓 9–25 KB 的 JPEG（公開 Storage，瀏覽器與 CDN 都會快取）。
 *
 * 記憶體分工：Edge 只有 256MB，而圖冊一份 70–120MB。**不要**在這裡載入整份 PDF
 * （pdf-lib 解析 + pdfium WASM 會直接 546 WORKER_RESOURCE_LIMIT）。抽頁交
 * `quote-catalog-pages`（它本來就做這件事），這裡只收結果的小 PDF 再畫。
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PDFiumLibrary } from "npm:@hyzyla/pdfium@2.1.7";
import jpeg from "npm:jpeg-js@0.4.4";

export const CATALOG_THUMB_BUCKET = "product-images";
export const CATALOG_THUMB_PREFIX = "catalog-thumbs";
/** 縮圖最大寬度（px）。 */
export const CATALOG_THUMB_WIDTH = 360;
export const CATALOG_THUMB_QUALITY = 72;
/**
 * 一次請求最多畫幾頁。實測（FDS2.0 分支、73MB 圖冊）：**1 頁穩定**（約 3.5 秒，多數是
 * 抽頁那份 PDF 的下載 + pdfium WASM 初始化），2 頁偶爾成功，4 頁必 546
 * WORKER_RESOURCE_LIMIT（Edge CPU 上限）。所以一次 1 頁，缺的由夜間 cron 每 2 分鐘補。
 */
export const CATALOG_THUMB_BATCH = 1;
const EXTRACT_SLUG = "supabase-functions-quote-catalog-pages";

export function catalogThumbObjectPath(documentId: string, pageNo: number): string {
  return `${CATALOG_THUMB_PREFIX}/${documentId}/${String(pageNo).padStart(4, "0")}.jpg`;
}

export function catalogThumbPublicUrl(supabaseUrl: string, documentId: string, pageNo: number): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${CATALOG_THUMB_BUCKET}/${catalogThumbObjectPath(documentId, pageNo)}`;
}

function thumbPageFromName(name: string): number | null {
  const match = /^(\d+)\.jpg$/.exec(name);
  if (!match) return null;
  const pageNo = Number(match[1]);
  return Number.isInteger(pageNo) && pageNo > 0 ? pageNo : null;
}

/** 已經有縮圖的頁碼（Storage 目錄即索引，不需要新表）。 */
export async function listCatalogThumbPages(
  admin: SupabaseClient,
  documentId: string,
): Promise<number[]> {
  const pages: number[] = [];
  for (let offset = 0; offset < 2000; offset += 1000) {
    const { data, error } = await admin.storage
      .from(CATALOG_THUMB_BUCKET)
      .list(`${CATALOG_THUMB_PREFIX}/${documentId}`, { limit: 1000, offset });
    if (error) throw new Error(`thumb list failed: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      const pageNo = thumbPageFromName(row.name);
      if (pageNo) pages.push(pageNo);
    }
    if (rows.length < 1000) break;
  }
  return pages.sort((a, b) => a - b);
}

export interface CatalogThumbRenderResult {
  pageNo: number;
  bytes: number;
}

/** 由小到大找還沒畫的頁，最多 `batch` 頁。 */
export function pickMissingPages(
  pageCount: number,
  existing: Iterable<number>,
  batch = CATALOG_THUMB_BATCH,
): number[] {
  const have = new Set(existing);
  const missing: number[] = [];
  for (let pageNo = 1; pageNo <= pageCount && missing.length < batch; pageNo += 1) {
    if (!have.has(pageNo)) missing.push(pageNo);
  }
  return missing;
}

/** 經 `quote-catalog-pages` 抽出指定頁（service role 呼叫，不需要使用者 JWT）。 */
async function extractCatalogPages(
  supabaseUrl: string,
  serviceKey: string,
  documentId: string,
  pageNos: number[],
): Promise<Uint8Array> {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/${EXTRACT_SLUG}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ pages: pageNos.map((pageNo) => ({ documentId, pageNo })) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`page extract failed: HTTP ${res.status} ${text.slice(0, 160)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * 把指定頁碼畫成縮圖並上傳。上傳用 upsert，重跑同一頁不會產生重複檔案。
 */
export async function renderCatalogThumbs(
  admin: SupabaseClient,
  options: {
    documentId: string;
    pageNos: number[];
    supabaseUrl: string;
    serviceKey: string;
    /** 已有抽好的 PDF（測試或呼叫端已抽頁）時可直接給。 */
    pdfBytes?: Uint8Array;
  },
): Promise<CatalogThumbRenderResult[]> {
  const pages = [...new Set(options.pageNos)].filter((pageNo) => Number.isInteger(pageNo) && pageNo > 0);
  if (pages.length === 0) return [];

  const pdfBytes = options.pdfBytes
    ?? await extractCatalogPages(options.supabaseUrl, options.serviceKey, options.documentId, pages);

  const library = await PDFiumLibrary.init();
  const results: CatalogThumbRenderResult[] = [];
  try {
    const document = await library.loadDocument(pdfBytes);
    try {
      const pageCount = document.getPageCount();
      for (let index = 0; index < pages.length && index < pageCount; index += 1) {
        const pageNo = pages[index];
        const page = document.getPage(index);
        const size = page.getSize();
        const width = CATALOG_THUMB_WIDTH;
        const height = Math.max(1, Math.round((size.height / Math.max(1, size.width)) * width));
        const image = await page.render({
          width,
          height,
          render: async (renderOptions) => jpeg.encode(
            {
              data: renderOptions.data,
              width: renderOptions.width,
              height: renderOptions.height,
            },
            CATALOG_THUMB_QUALITY,
          ).data,
        });
        const path = catalogThumbObjectPath(options.documentId, pageNo);
        const { error } = await admin.storage.from(CATALOG_THUMB_BUCKET).upload(path, image.data, {
          contentType: "image/jpeg",
          upsert: true,
          cacheControl: "31536000",
        });
        if (error) throw new Error(`thumb upload failed (page ${pageNo}): ${error.message}`);
        results.push({ pageNo, bytes: image.data.length });
      }
    } finally {
      document.destroy();
    }
  } finally {
    library.destroy();
  }
  return results;
}
