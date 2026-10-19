import { invokeEdgeFunctionDirect } from '@/lib/invokeEdgeFunction';
import { renderPdfPageToJpegBlob } from '@/lib/floorPlanPdf';

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourcePageRequest {
  documentId: string;
  pageNo?: number | null;
  productId?: string | null;
}

export interface RenderedSourcePage {
  imageUrl: string;
  title: string | null;
  pageNo: number | null;
  highlight: NormRect | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Gemini boxes are [ymin, xmin, ymax, xmax] on a 0–1000 grid. {x,y,w,h} is already 0–1. */
export function normalizeBbox(bbox: unknown): NormRect | null {
  if (!bbox) return null;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const [ymin, xmin, ymax, xmax] = bbox.map(Number);
    if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
    const scale = Math.max(Math.abs(ymin), Math.abs(xmin), Math.abs(ymax), Math.abs(xmax)) > 1 ? 1000 : 1;
    return rect(xmin / scale, ymin / scale, (xmax - xmin) / scale, (ymax - ymin) / scale);
  }
  if (typeof bbox === 'object') {
    const o = bbox as Record<string, unknown>;
    if ('x' in o && 'w' in o) return rect(Number(o.x), Number(o.y), Number(o.w), Number(o.h));
    if ('xmin' in o && 'ymin' in o) return normalizeBbox([o.ymin, o.xmin, o.ymax, o.xmax]);
  }
  return null;
}

function rect(x: number, y: number, w: number, h: number): NormRect | null {
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const cx = clamp01(x);
  const cy = clamp01(y);
  return { x: cx, y: cy, w: Math.min(w, 1 - cx), h: Math.min(h, 1 - cy) };
}

function errorText(message: string): string {
  if (message.includes('permission_denied')) return '沒有權限開啟這份原文';
  if (message.includes('source_not_linked')) return '這份文件沒有連到此產品';
  if (message.includes('document_not_found')) return '找不到原文';
  return message;
}

export async function renderSourcePage(input: SourcePageRequest): Promise<RenderedSourcePage> {
  const body = {
    document_id: input.documentId,
    page_no: input.pageNo ?? null,
    product_id: input.productId ?? null,
  };
  let { data, error, status } = await invokeEdgeFunctionDirect<{
    url?: string;
    title?: string | null;
    page_no?: number | null;
    bbox?: unknown;
    error?: string;
  }>('supabase-functions-source-page', body, { timeoutMs: 60_000 });
  if (status === 404) {
    ({ data, error, status } = await invokeEdgeFunctionDirect('source-page', body, { timeoutMs: 60_000 }));
  }
  if (error || !data?.url) throw new Error(errorText(error?.message ?? '無法開啟原文'));

  const pageNo = data.page_no ?? input.pageNo ?? 1;
  const rendered = await renderPdfPageToJpegBlob(data.url, pageNo > 0 ? pageNo : 1, { scale: 1.6, quality: 0.86 });
  return {
    imageUrl: URL.createObjectURL(rendered.blob),
    title: data.title ?? null,
    pageNo,
    highlight: normalizeBbox(data.bbox),
  };
}
