// ============================================================================
// FDS 2.1 AI 提取審核（F-AI-004 / T-304）
// process-jobs 把每段 PDF 轉成 extraction_items（raw_json＝AI 原值）；人工只改 corrected_json，
// 審核狀態經 fds_extraction_item_review / _batch RPC 寫入。審核通過才可進入正式產品／報價（BR-02）。
// ============================================================================
import { supabase } from '@/lib/supabase';
import { getSupplierDocumentDownloadUrl, type SupplierDocumentStatus } from '@/lib/supplierDocuments';

export type ExtractionStatus = 'pending' | 'approved' | 'rejected';
export type ImageType = 'main' | 'detail' | 'dimension' | 'fabric' | 'logo' | 'other';

export interface ExtractedProduct {
  page?: number;
  name?: string;
  model?: string | null;
  series?: string | null;
  category?: string | null;
  width_mm?: number | null;
  depth_mm?: number | null;
  height_mm?: number | null;
  dimensions_text?: string | null;
  material?: string | null;
  colors?: string[];
  description?: string | null;
  unit?: string | null;
  moq?: number | null;
  price?: number | null;
  price_text?: string | null;
  currency?: string | null;
  other_prices?: { label: string; price: number }[];
  valid_from?: string | null;
  valid_to?: string | null;
  lead_time_days?: number | null;
  confidence?: number;
  uncertain_fields?: string[];
}

export interface ExtractionItem {
  id: string;
  document_id: string;
  segment_id: string | null;
  seq: number;
  page_no: number | null;
  raw_json: ExtractedProduct;
  corrected_json: Partial<ExtractedProduct> | null;
  confidence: number | null;
  flags: string[];
  needs_attention: boolean;
  main_image_id: string | null;
  image_ids: string[];
  status: ExtractionStatus;
  review_note: string | null;
  reviewed_at: string | null;
  imported_product_id: string | null;
}

export interface ExtractionImage {
  id: string;
  page_no: number;
  public_url: string;
  width: number | null;
  height: number | null;
  image_type: ImageType;
}

export interface ReviewDocument {
  id: string;
  factory_name: string;
  title: string | null;
  doc_type: 'quote' | 'catalog';
  currency: string | null;
  status: SupplierDocumentStatus;
  storage_path: string;
  page_count: number | null;
  created_at: string;
  pending: { count: number }[];
  total: { count: number }[];
}

/** Fields a reviewer can correct, in display order. */
export const EDITABLE_FIELDS: { key: keyof ExtractedProduct; label: string; kind: 'text' | 'number' | 'date' | 'list' }[] = [
  { key: 'name', label: '名稱', kind: 'text' },
  { key: 'model', label: '型號', kind: 'text' },
  { key: 'series', label: '系列', kind: 'text' },
  { key: 'category', label: '類別', kind: 'text' },
  { key: 'width_mm', label: '闊 W (mm)', kind: 'number' },
  { key: 'depth_mm', label: '深 D (mm)', kind: 'number' },
  { key: 'height_mm', label: '高 H (mm)', kind: 'number' },
  { key: 'material', label: '材質', kind: 'text' },
  { key: 'colors', label: '顏色（逗號分隔）', kind: 'list' },
  { key: 'price', label: '成本價', kind: 'number' },
  { key: 'currency', label: '幣種', kind: 'text' },
  { key: 'unit', label: '單位', kind: 'text' },
  { key: 'moq', label: 'MOQ', kind: 'number' },
  { key: 'lead_time_days', label: '交貨期（天）', kind: 'number' },
  { key: 'valid_from', label: '有效期由', kind: 'date' },
  { key: 'valid_to', label: '有效期至', kind: 'date' },
  { key: 'description', label: '描述', kind: 'text' },
];

export const FLAG_LABELS: Record<string, string> = {
  missing_model: '缺型號',
  missing_price: '缺價格',
  catalog_no_price: '目錄無價格',
  price_not_in_source: '價格不在原文',
  currency_missing: '缺幣種',
  currency_from_document: '幣種沿用文件',
  dimension_suspicious: '尺寸可疑',
  duplicate_model: '型號重複',
  merged_across_parts: '跨段合併',
  ai_uncertain: 'AI 不確定',
  low_confidence: '低置信度',
};

const ITEM_COLUMNS = [
  'id', 'document_id', 'segment_id', 'seq', 'page_no', 'raw_json', 'corrected_json', 'confidence',
  'flags', 'needs_attention', 'main_image_id', 'image_ids', 'status', 'review_note', 'reviewed_at',
  'imported_product_id',
].join(', ');

function rpcErrorMessage(message: string): string {
  if (message.includes('permission_denied')) return '沒有權限（只限 admin／傢俬組）';
  if (message.includes('item_already_imported')) return '此項已匯入產品，不能再修改';
  if (message.includes('image_not_linked')) return '所選圖片不屬於此產品';
  if (message.includes('item_not_found')) return '找不到提取項目';
  if (message.includes('price_needs_confirmation')) {
    return '報價單的價格未確認。請先在修正欄填上原文核對後的價格，再按通過。目錄可以沒有價格。';
  }
  if (message.includes('price_not_reviewed')) return '未審核的價格不能寫成正式價';
  return message;
}

/** AI value overlaid with the reviewer's corrections. */
export function effectiveProduct(item: ExtractionItem): ExtractedProduct {
  return { ...item.raw_json, ...(item.corrected_json ?? {}) };
}

export function isCorrected(item: ExtractionItem, key: keyof ExtractedProduct): boolean {
  return !!item.corrected_json && Object.prototype.hasOwnProperty.call(item.corrected_json, key);
}

export async function listReviewDocuments(): Promise<ReviewDocument[]> {
  const { data, error } = await supabase
    .from('supplier_documents')
    .select('id, factory_name, title, doc_type, currency, status, storage_path, page_count, created_at, pending:extraction_items(count), total:extraction_items(count)')
    .eq('pending.status', 'pending')
    .is('parent_document_id', null)
    .in('status', ['review', 'ready', 'parsing'])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ReviewDocument[]).filter((d) => (d.total[0]?.count ?? 0) > 0);
}

export async function listExtractionItems(documentId: string): Promise<ExtractionItem[]> {
  const { data, error } = await supabase
    .from('extraction_items')
    .select(ITEM_COLUMNS)
    .eq('document_id', documentId)
    .order('seq')
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ExtractionItem[];
}

export async function listExtractionImages(documentId: string): Promise<ExtractionImage[]> {
  const { data, error } = await supabase
    .from('supplier_document_images')
    .select('id, page_no, public_url, width, height, image_type')
    .eq('document_id', documentId)
    .order('page_no');
  if (error) throw new Error(error.message);
  return (data ?? []) as ExtractionImage[];
}

export async function reviewExtractionItem(input: {
  itemId: string;
  status: ExtractionStatus;
  corrected?: Partial<ExtractedProduct> | null;
  mainImageId?: string | null;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('fds_extraction_item_review', {
    p_item_id: input.itemId,
    p_status: input.status,
    p_corrected: input.corrected ?? null,
    p_main_image_id: input.mainImageId ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
}

export async function reviewExtractionItemsBatch(
  itemIds: string[],
  status: ExtractionStatus,
): Promise<{ updated: number; blocked: number }> {
  if (itemIds.length === 0) return { updated: 0, blocked: 0 };
  const { data, error } = await supabase.rpc('fds_extraction_items_review_batch', {
    p_item_ids: itemIds,
    p_status: status,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
  const row = (data ?? {}) as { updated?: number; blocked?: number };
  return { updated: Number(row.updated ?? 0), blocked: Number(row.blocked ?? 0) };
}

/** Opens the original PDF at the item's page (signed URL, browser PDF viewer honours #page). */
export async function openSourcePage(storagePath: string, pageNo: number | null): Promise<void> {
  const url = await getSupplierDocumentDownloadUrl(storagePath);
  window.open(pageNo ? `${url}#page=${pageNo}` : url, '_blank', 'noopener');
}
