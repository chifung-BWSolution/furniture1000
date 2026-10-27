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

export interface QuoteCatalogPage {
  documentId: string;
  pageNo: number;
  factoryName: string;
  title: string | null;
  documentYear: number | null;
  series: string | null;
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
      documentId,
      pageNo,
      factoryName,
      title: record.title == null ? null : String(record.title),
      documentYear: Number.isInteger(Number(record.documentYear)) ? Number(record.documentYear) : null,
      series: record.series == null ? null : String(record.series),
    });
  }
  return pages.slice(0, QUOTE_CATALOG_PAGE_LIMIT);
}

export function catalogPageKey(page: Pick<QuoteCatalogPage, 'documentId' | 'pageNo'>): string {
  return `${page.documentId}:${page.pageNo}`;
}

export function catalogPageLabel(page: QuoteCatalogPage): string {
  return [page.factoryName, page.documentYear, page.series, page.title, `第 ${page.pageNo} 頁`]
    .filter((part) => part != null && String(part).trim() !== '')
    .join(' · ');
}

export async function listQuoteCatalogs(query: string): Promise<QuoteCatalogOption[]> {
  const { data, error } = await supabase.rpc('fds_list_quote_catalogs', {
    p_query: query.trim() || null,
  });
  if (error) throw new Error(error.message.includes('permission_denied') ? '沒有權限查看圖冊' : error.message);
  return (Array.isArray(data) ? data : []) as QuoteCatalogOption[];
}

export async function fetchQuoteCatalogPdf(pages: QuoteCatalogPage[]): Promise<ArrayBuffer> {
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
  pages: QuoteCatalogPage[],
  showSource: boolean,
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const base = await PDFDocument.load(quotePdf);
  if (pages.length === 0) return base.save();
  const extra = await PDFDocument.load(await fetchQuoteCatalogPdf(pages));
  if (!showSource) {
    const copied = await base.copyPages(extra, extra.getPageIndices());
    copied.forEach((page) => base.addPage(page));
    return base.save();
  }

  const fontBytes = await fetch('/fonts/pdf/NotoSansHK-Fallback-Regular-v1.ttf').then((res) => {
    if (!res.ok) throw new Error('來源標籤字體未能載入');
    return res.arrayBuffer();
  });
  const font = await base.embedFont(fontBytes);
  const sources = extra.getPages();
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i];
    const { width, height } = src.getSize();
    const label = catalogPageLabel(pages[i] ?? {
      documentId: '',
      pageNo: i + 1,
      factoryName: '',
      title: null,
      documentYear: null,
      series: null,
    });
    const band = 18;
    const page = base.addPage([width, height]);
    const scale = height > band ? (height - band) / height : 1;
    const embedded = await base.embedPage(src);
    page.drawPage(embedded, { x: 0, y: band, xScale: scale, yScale: scale });
    const text = label.slice(0, 80);
    try {
      page.drawText(text, { x: 8, y: 5, size: 8, font, color: rgb(0.25, 0.27, 0.3) });
    } catch {
      page.drawText(`p.${pages[i]?.pageNo ?? i + 1}`, { x: 8, y: 5, size: 8, font, color: rgb(0.25, 0.27, 0.3) });
    }
  }
  return base.save();
}
