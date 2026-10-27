import { supabase } from '@/lib/supabase';
import { requireUserAccessToken } from '@/lib/invokeEdgeFunction';

export const QUOTE_CATALOG_PAGE_LIMIT = 24;

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
}

export const CATALOG_TOP_HALF: QuoteCatalogCrop = { x: 0, y: 0, width: 1, height: 0.5 };
export const CATALOG_BOTTOM_HALF: QuoteCatalogCrop = { x: 0, y: 0.5, width: 1, height: 0.5 };

export function newCatalogPageId(): string {
  return crypto.randomUUID();
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
    pages.push({
      id: String(record.id ?? '').trim() || `page-${documentId}-${pageNo}-${pages.length}`,
      documentId,
      pageNo,
      factoryName,
      title: record.title == null ? null : String(record.title),
      documentYear: Number.isInteger(Number(record.documentYear)) ? Number(record.documentYear) : null,
      series: record.series == null ? null : String(record.series),
      crop: parseCatalogCrop(record.crop),
    });
  }
  return pages.slice(0, QUOTE_CATALOG_PAGE_LIMIT);
}

export function catalogPageKey(page: Pick<QuoteCatalogPage, 'id'>): string {
  return page.id;
}

export function catalogPageLabel(page: Omit<QuoteCatalogPage, 'id'>): string {
  const pageLabel = page.crop ? `第 ${page.pageNo} 頁框選` : `第 ${page.pageNo} 頁`;
  return [page.factoryName, page.documentYear, page.series, page.title, pageLabel]
    .filter((part) => part != null && String(part).trim() !== '')
    .join(' · ');
}

/** PDF user space, origin at the bottom-left. */
export function catalogCropBox(pageWidth: number, pageHeight: number, crop: QuoteCatalogCrop | null | undefined) {
  if (!crop) return undefined;
  const left = crop.x * pageWidth;
  const right = Math.min(pageWidth, (crop.x + crop.width) * pageWidth);
  const top = (1 - crop.y) * pageHeight;
  const bottom = Math.max(0, top - crop.height * pageHeight);
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

/** Quote PDF first, then the selected catalog pages. Source labels are optional. */
export async function appendQuoteCatalogPages(
  quotePdf: ArrayBuffer,
  pages: Omit<QuoteCatalogPage, 'id'>[],
  showSource: boolean,
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const base = await PDFDocument.load(quotePdf);
  if (showSource) {
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    base.registerFontkit(fontkit);
  }
  if (pages.length === 0) return base.save();
  const extra = await PDFDocument.load(await fetchQuoteCatalogPdf(pages));
  const font = showSource
    ? await base.embedFont(await fetch('/fonts/pdf/NotoSansHK-Fallback-Regular-v1.ttf').then((res) => {
      if (!res.ok) throw new Error('來源標籤字體未能載入');
      return res.arrayBuffer();
    }))
    : null;
  const sources = extra.getPages();
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i];
    const { width, height } = src.getSize();
    const meta = pages[i];
    const box = catalogCropBox(width, height, meta?.crop);
    const embedded = await base.embedPage(src, box);
    const band = showSource ? 18 : 0;
    const page = base.addPage([embedded.width, embedded.height + band]);
    page.drawPage(embedded, { x: 0, y: band });
    if (!font) continue;
    const label = catalogPageLabel(meta ?? {
      documentId: '',
      pageNo: i + 1,
      factoryName: '',
      title: null,
      documentYear: null,
      series: null,
      crop: null,
    });
    try {
      page.drawText(label.slice(0, 80), { x: 8, y: 5, size: 8, font, color: rgb(0.25, 0.27, 0.3) });
    } catch {
      page.drawText(`p.${meta?.pageNo ?? i + 1}`, { x: 8, y: 5, size: 8, font, color: rgb(0.25, 0.27, 0.3) });
    }
  }
  return base.save();
}
