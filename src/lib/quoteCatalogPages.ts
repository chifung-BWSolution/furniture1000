import { supabase } from '@/lib/supabase';
import { requireUserAccessToken } from '@/lib/invokeEdgeFunction';

export const QUOTE_CATALOG_PAGE_LIMIT = 24;

/**
 * 圖冊常見是把「左、右兩個直向版面」印在同一張 PDF 頁（跨頁）。
 * 寬高比大於此值就當作跨頁：A4 直向約 0.71，左右並排的跨頁約 1.41。
 */
export const CATALOG_SPREAD_ASPECT = 1.15;

export interface QuoteCatalogOption {
  id: string;
  factory_name: string;
  title: string | null;
  document_year: number | null;
  series: string | null;
  product_categories: string[];
  version_label: string | null;
  page_count: number | null;
}

/** Top-left origin, each edge is a fraction of the page from 0 to 1. */
export interface QuoteCatalogCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 跨頁只取其中一個直向版面。 */
export type QuoteCatalogSplit = 'left' | 'right';

export interface QuoteCatalogPage {
  id: string;
  documentId: string;
  pageNo: number;
  factoryName: string;
  title: string | null;
  documentYear: number | null;
  series: string | null;
  /** Missing or null means the whole page. */
  crop?: QuoteCatalogCrop | null;
  /** 跨頁的左／右半；null 或 undefined 代表整頁（跨頁＝左＋右兩張）。 */
  split?: QuoteCatalogSplit | null;
}

export const CATALOG_TOP_HALF: QuoteCatalogCrop = { x: 0, y: 0, width: 1, height: 0.5 };
export const CATALOG_BOTTOM_HALF: QuoteCatalogCrop = { x: 0, y: 0.5, width: 1, height: 0.5 };
/** 跨頁的左頁／右頁，仍然是直向版面。 */
export const CATALOG_SPLIT_LEFT: QuoteCatalogCrop = { x: 0, y: 0, width: 0.5, height: 1 };
export const CATALOG_SPLIT_RIGHT: QuoteCatalogCrop = { x: 0.5, y: 0, width: 0.5, height: 1 };

export function newCatalogPageId(): string {
  return crypto.randomUUID();
}

/** 寬比高大一截 → 這張 PDF 頁其實是左右兩個直向版面。 */
export function isSpreadSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  return width / height > CATALOG_SPREAD_ASPECT;
}

export function catalogSplitCrop(split: QuoteCatalogSplit | null | undefined): QuoteCatalogCrop | null {
  if (split === 'left') return { ...CATALOG_SPLIT_LEFT };
  if (split === 'right') return { ...CATALOG_SPLIT_RIGHT };
  return null;
}

/** 實際要送進 PDF 的裁切框：明確框選優先，其次跨頁左／右半，最後整頁（null）。 */
export function catalogPageCrop(
  page: { crop?: QuoteCatalogCrop | null; split?: QuoteCatalogSplit | null },
): QuoteCatalogCrop | null {
  return parseCatalogCrop(page.crop) ?? catalogSplitCrop(page.split);
}

/**
 * 一張 PDF 頁在附錄裡要輸出哪幾塊（依左上原點的比例表示）。
 *
 * - 有框選：只出框選那一塊。
 * - 跨頁整頁：拆成左、右兩個直向版面各一張。
 * - 單頁：整頁一張。
 */
export function catalogPagePieces(
  page: { crop?: QuoteCatalogCrop | null; split?: QuoteCatalogSplit | null },
  displayWidth: number,
  displayHeight: number,
): (QuoteCatalogCrop | null)[] {
  const crop = parseCatalogCrop(page.crop);
  if (crop) return [crop];
  if (!isSpreadSize(displayWidth, displayHeight)) return [null];
  const split = catalogSplitCrop(page.split);
  return split ? [split] : [{ ...CATALOG_SPLIT_LEFT }, { ...CATALOG_SPLIT_RIGHT }];
}

/**
 * 把附件清單裡「跨頁但還是整頁」的舊資料換成左、右兩列。
 * 只處理指定文件（該文件的版面才剛判斷出來）；已在別的文件或已有框選／已拆過的保持原狀。
 */
export function splitSpreadAttachments(
  pages: QuoteCatalogPage[],
  documentId: string,
): QuoteCatalogPage[] {
  let changed = false;
  const next: QuoteCatalogPage[] = [];
  for (const page of pages) {
    if (page.documentId !== documentId || page.split || parseCatalogCrop(page.crop)) {
      next.push(page);
      continue;
    }
    changed = true;
    next.push({ ...page, id: newCatalogPageId(), split: 'left' });
    next.push({ ...page, id: newCatalogPageId(), split: 'right' });
  }
  if (!changed) return pages;
  return next.slice(0, QUOTE_CATALOG_PAGE_LIMIT);
}

export function parseCatalogCrop(value: unknown): QuoteCatalogCrop | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width < 0.02 || height < 0.02) return null;
  const left = Math.min(1, Math.max(0, x));
  const top = Math.min(1, Math.max(0, y));
  const right = Math.min(1, Math.max(left, left + width));
  const bottom = Math.min(1, Math.max(top, top + height));
  if (right - left < 0.02 || bottom - top < 0.02) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const SLUGS = ['supabase-functions-quote-catalog-pages', 'quote-catalog-pages'];

export function parseQuoteCatalogPages(value: unknown): QuoteCatalogPage[] {
  if (!Array.isArray(value)) return [];
  const pages: QuoteCatalogPage[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const documentId = String(record.documentId ?? '').trim();
    const pageNo = Number(record.pageNo);
    const factoryName = String(record.factoryName ?? '').trim();
    if (!documentId || !Number.isInteger(pageNo) || pageNo < 1 || !factoryName) continue;
    const split = record.split === 'left' || record.split === 'right' ? record.split : null;
    pages.push({
      id: String(record.id ?? '').trim() || `page-${documentId}-${pageNo}-${pages.length}`,
      documentId,
      pageNo,
      factoryName,
      title: record.title == null ? null : String(record.title),
      documentYear: Number.isInteger(Number(record.documentYear)) ? Number(record.documentYear) : null,
      series: record.series == null ? null : String(record.series),
      crop: parseCatalogCrop(record.crop),
      split: split && !parseCatalogCrop(record.crop) ? split : null,
    });
  }
  return pages.slice(0, QUOTE_CATALOG_PAGE_LIMIT);
}

export function catalogPageKey(page: Pick<QuoteCatalogPage, 'id'>): string {
  return page.id;
}

export function catalogPageLabel(page: Omit<QuoteCatalogPage, 'id'>): string {
  const crop = parseCatalogCrop(page.crop);
  const split = crop ? null : page.split === 'left' || page.split === 'right' ? page.split : null;
  const pageLabel = split === 'left'
    ? `第 ${page.pageNo} 頁左半`
    : split === 'right'
      ? `第 ${page.pageNo} 頁右半`
      : crop
        ? `第 ${page.pageNo} 頁框選`
        : `第 ${page.pageNo} 頁`;
  return [page.factoryName, page.documentYear, page.series, page.title, pageLabel]
    .filter((part) => part != null && String(part).trim() !== '')
    .join(' · ');
}

/** `90 / -90 / 450` → `0 / 270 / 90`。 */
export function normalizePageRotation(angle: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(angle)) return 0;
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

/**
 * PDF user space, origin at the bottom-left.
 *
 * `rotation` 是來源頁的 /Rotate：框選比例是「看到的方向」（已轉正），
 * 所以要按 /Rotate 換算回 PDF 頁面座標，嵌進新頁後再把同一 /Rotate 套回去。
 */
export function catalogCropBox(
  pageWidth: number,
  pageHeight: number,
  crop: QuoteCatalogCrop | null | undefined,
  rotation = 0,
) {
  if (!crop) return undefined;
  const swap = normalizePageRotation(rotation) % 180 === 90;
  const displayWidth = swap ? pageHeight : pageWidth;
  const displayHeight = swap ? pageWidth : pageHeight;
  const leftFr = Math.min(1, Math.max(0, crop.x));
  const topFr = Math.min(1, Math.max(0, crop.y));
  const rightFr = Math.min(1, Math.max(leftFr, crop.x + crop.width));
  const bottomFr = Math.min(1, Math.max(topFr, crop.y + crop.height));
  let left: number;
  let right: number;
  let bottom: number;
  let top: number;
  switch (normalizePageRotation(rotation)) {
    case 90:
      // 看到的方向：x 對應 PDF 的 y、y 對應 PDF 的 x。
      left = topFr * pageWidth;
      right = bottomFr * pageWidth;
      bottom = leftFr * pageHeight;
      top = rightFr * pageHeight;
      break;
    case 180:
      left = (1 - rightFr) * pageWidth;
      right = (1 - leftFr) * pageWidth;
      // 轉 180° 後「看到的上方」是 PDF 的下方。
      bottom = topFr * pageHeight;
      top = bottomFr * pageHeight;
      break;
    case 270:
      left = (1 - bottomFr) * pageWidth;
      right = (1 - topFr) * pageWidth;
      bottom = (1 - rightFr) * pageHeight;
      top = (1 - leftFr) * pageHeight;
      break;
    default:
      left = leftFr * displayWidth;
      right = rightFr * displayWidth;
      bottom = (1 - bottomFr) * displayHeight;
      top = (1 - topFr) * displayHeight;
      break;
  }
  if (right - left < 1 || top - bottom < 1) return undefined;
  return { left, bottom, right, top };
}

export async function listQuoteCatalogs(query: string): Promise<QuoteCatalogOption[]> {
  const { data, error } = await supabase.rpc('fds_list_quote_catalogs', {
    p_query: query.trim() || null,
  });
  if (error) throw new Error(error.message.includes('permission_denied') ? '沒有權限查看圖冊' : error.message);
  return (Array.isArray(data) ? data : []) as QuoteCatalogOption[];
}

export async function fetchQuoteCatalogPdf(
  pages: Pick<QuoteCatalogPage, 'documentId' | 'pageNo'>[],
): Promise<ArrayBuffer> {
  const token = await requireUserAccessToken();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const body = JSON.stringify({
    pages: pages.map((page) => ({ documentId: page.documentId, pageNo: page.pageNo })),
  });
  let lastError = '圖冊頁未能讀取';
  for (const slug of SLUGS) {
    const res = await fetch(`${supabaseUrl}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body,
    });
    if (res.status === 404) continue;
    if (!res.ok) {
      const text = await res.text();
      try {
        lastError = (JSON.parse(text) as { error?: string }).error || lastError;
      } catch {
        lastError = text.slice(0, 180) || lastError;
      }
      if (lastError === 'permission_denied') lastError = '沒有權限讀取圖冊頁';
      if (lastError === 'page_out_of_range') lastError = '所選頁碼超出圖冊頁數';
      if (lastError === 'catalog_not_found') lastError = '找不到這份圖冊';
      throw new Error(lastError);
    }
    return res.arrayBuffer();
  }
  throw new Error(lastError);
}

function catalogSourceKey(page: Pick<QuoteCatalogPage, 'documentId' | 'pageNo'>): string {
  return `${page.documentId}#${page.pageNo}`;
}

type CatalogSourcePage = {
  page: import('pdf-lib').PDFPage;
  rotation: 0 | 90 | 180 | 270;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
};

/** 同一頁的左半／右半共用一次下載：重複的頁只送一次給 edge。 */
async function loadCatalogSourcePages(
  pages: Pick<QuoteCatalogPage, 'documentId' | 'pageNo'>[],
): Promise<Map<string, CatalogSourcePage>> {
  const { PDFDocument } = await import('pdf-lib');
  const unique: Pick<QuoteCatalogPage, 'documentId' | 'pageNo'>[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const key = catalogSourceKey(page);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ documentId: page.documentId, pageNo: page.pageNo });
  }
  const doc = await PDFDocument.load(await fetchQuoteCatalogPdf(unique), { ignoreEncryption: true });
  const sources = doc.getPages();
  const byKey = new Map<string, CatalogSourcePage>();
  unique.forEach((entry, index) => {
    const source = sources[index];
    if (!source) return;
    const rotation = normalizePageRotation(source.getRotation().angle);
    const { width, height } = source.getSize();
    byKey.set(catalogSourceKey(entry), {
      page: source,
      rotation,
      width,
      height,
      displayWidth: rotation % 180 === 90 ? height : width,
      displayHeight: rotation % 180 === 90 ? width : height,
    });
  });
  return byKey;
}

type CatalogPdfDocument = import('pdf-lib').PDFDocument;

async function drawCatalogPieces(
  target: CatalogPdfDocument,
  sources: Map<string, CatalogSourcePage>,
  pages: QuoteCatalogPage[],
): Promise<void> {
  const { degrees } = await import('pdf-lib');
  for (const entry of pages) {
    const source = sources.get(catalogSourceKey(entry));
    if (!source) continue;
    const pieces = catalogPagePieces(entry, source.displayWidth, source.displayHeight);
    for (const piece of pieces) {
      const box = catalogCropBox(source.width, source.height, piece, source.rotation);
      const embedded = await target.embedPage(source.page, box);
      const page = target.addPage([embedded.width, embedded.height]);
      page.drawPage(embedded, { x: 0, y: 0 });
      // 來源頁自己帶 /Rotate 時內容本身沒有轉，套回同一個 /Rotate 才會正立。
      if (source.rotation !== 0) page.setRotation(degrees(source.rotation));
    }
  }
}

/** Quote PDF first, then the selected catalog pages, cropped and scaled to their own size. */
export async function appendQuoteCatalogPages(
  quotePdf: ArrayBuffer,
  pages: Omit<QuoteCatalogPage, 'id'>[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const base = await PDFDocument.load(quotePdf);
  if (pages.length === 0) return base.save();
  const sources = await loadCatalogSourcePages(pages);
  await drawCatalogPieces(base, sources, pages as QuoteCatalogPage[]);
  return base.save();
}

/**
 * 單一附件的預覽：只回它在附錄裡的那一張（已裁切、已轉正），
 * 讓對話框看到的形狀跟報價 PDF 一致（跨頁看到的是直向的其中一版）。
 */
export async function buildQuoteCatalogPiecePdf(page: QuoteCatalogPage): Promise<ArrayBuffer> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const sources = await loadCatalogSourcePages([page]);
  await drawCatalogPieces(out, sources, [page]);
  const bytes = await out.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
