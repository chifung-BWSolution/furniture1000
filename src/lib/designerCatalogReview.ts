// Designer PDF catalogues reuse the factory wizard parser (AIProcessorView →
// gemini-pdf-catalog) and the same existing-category matcher. Parsed rows are
// stored as pending review and do not enter products until an admin approves them.
import { supabase } from '@/lib/supabase';
import { uploadImageSourceToStorage } from '@/lib/imageStorage';
import {
  isPdfFile,
  SUPPLIER_DOCUMENT_MAX_BYTES,
} from '@/lib/supplierDocuments';
import {
  categorySelectorValue,
  fetchProductCategoryPairs,
  matchExistingProductCategory,
  type ProductCategoryPair,
} from '@/lib/productCategoryOptions';
import {
  assignUploadCategories,
  classifyProductsByExistingCategories,
} from '@/lib/uploadProductCategory';

export const DESIGNER_CATALOG_BUCKET = 'designer-catalog-pdfs';

export type DesignerBatchStatus = 'parsing' | 'pending' | 'partial' | 'approved' | 'rejected' | 'failed';
export type DesignerItemStatus = 'pending' | 'approved' | 'rejected';

export interface DesignerCatalogBatch {
  id: string;
  uploader_id: string;
  uploader_email: string | null;
  uploader_name: string | null;
  factory_id: string | null;
  factory_name: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  status: DesignerBatchStatus;
  error_message: string | null;
  created_at: string;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  item_count: number;
}

export interface DesignerCatalogItem {
  id: string;
  batch_id: string;
  seq: number;
  status: DesignerItemStatus;
  title: string;
  description: string;
  model_number: string;
  material: string;
  color: string;
  dimensions_text: string;
  width_mm: number | null;
  depth_mm: number | null;
  height_mm: number | null;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  page_no: number | null;
  level1_category: string | null;
  level2_category: string | null;
  product_category_id: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  approved_product_id: string | null;
}

export interface DesignerCatalogItemPatch {
  title?: string;
  description?: string;
  model_number?: string;
  material?: string;
  color?: string;
  dimensions_text?: string;
  width_mm?: number | null;
  depth_mm?: number | null;
  height_mm?: number | null;
  price?: number | null;
  currency?: string | null;
  product_category_id?: string | null;
}

const BATCH_COLUMNS = [
  'id', 'uploader_id', 'uploader_email', 'uploader_name', 'factory_id', 'factory_name',
  'storage_path', 'file_name', 'file_size', 'status', 'error_message', 'created_at',
].join(', ');

const ITEM_COLUMNS = [
  'id', 'batch_id', 'seq', 'status', 'title', 'description', 'model_number', 'material', 'color',
  'dimensions_text', 'width_mm', 'depth_mm', 'height_mm', 'price', 'currency', 'image_url', 'page_no',
  'level1_category', 'level2_category', 'product_category_id', 'rejection_reason', 'reviewed_at',
  'approved_product_id',
].join(', ');

function rpcErrorMessage(message: string): string {
  if (message.includes('permission_denied')) return '沒有權限';
  if (message.includes('factory_required')) return '請選擇或輸入廠家';
  if (message.includes('storage_object_missing')) return 'PDF 未成功上傳，請重試';
  if (message.includes('storage_path_invalid')) return 'PDF 路徑無效';
  if (message.includes('file_too_large')) return '檔案超過 200MB';
  if (message.includes('batch_not_found') || message.includes('item_not_found')) return '找不到這筆上載';
  if (message.includes('batch_already_submitted')) return '這份目錄已經送出';
  if (message.includes('category_unknown')) return '分類不在現有產品分類裡';
  if (message.includes('category_required') || message.includes('item_not_pending')) return '只可以審核仍在待審、而且已有分類的產品';
  if (message.includes('reason_required')) return '拒絕時必須填寫原因';
  if (message.includes('items_invalid') || message.includes('fields_invalid')) return '產品資料格式不正確';
  return message;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

async function mapBatches(rows: Array<Record<string, unknown>>): Promise<DesignerCatalogBatch[]> {
  const ids = rows.map((row) => String(row.id));
  const counts = new Map<string, { pending: number; approved: number; rejected: number }>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('designer_catalog_items')
      .select('batch_id, status')
      .in('batch_id', ids);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = String(row.batch_id);
      const cur = counts.get(id) ?? { pending: 0, approved: 0, rejected: 0 };
      if (row.status === 'pending') cur.pending += 1;
      else if (row.status === 'approved') cur.approved += 1;
      else if (row.status === 'rejected') cur.rejected += 1;
      counts.set(id, cur);
    }
  }
  return rows.map((row) => {
    const tally = counts.get(String(row.id)) ?? { pending: 0, approved: 0, rejected: 0 };
    return {
      ...(row as unknown as DesignerCatalogBatch),
      pending_count: tally.pending,
      approved_count: tally.approved,
      rejected_count: tally.rejected,
      item_count: tally.pending + tally.approved + tally.rejected,
    };
  });
}

export async function listMyDesignerCatalogs(): Promise<DesignerCatalogBatch[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const uid = userData.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('designer_catalog_batches')
    .select(BATCH_COLUMNS)
    .eq('uploader_id', uid)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return mapBatches((data ?? []) as unknown as Array<Record<string, unknown>>);
}

export async function listDesignerCatalogBatches(): Promise<DesignerCatalogBatch[]> {
  const { data, error } = await supabase
    .from('designer_catalog_batches')
    .select(BATCH_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return mapBatches((data ?? []) as unknown as Array<Record<string, unknown>>);
}

export async function listDesignerCatalogItems(batchId: string): Promise<DesignerCatalogItem[]> {
  const { data, error } = await supabase
    .from('designer_catalog_items')
    .select(ITEM_COLUMNS)
    .eq('batch_id', batchId)
    .order('seq')
    .limit(400);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DesignerCatalogItem[];
}

export async function designerCatalogPdfUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DESIGNER_CATALOG_BUCKET)
    .createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? '無法開啟 PDF');
  return data.signedUrl;
}

export async function submitDesignerCatalogPdf(input: {
  file: File;
  factoryId?: string | null;
  factoryName: string;
  onProgress?: (message: string) => void;
}): Promise<{ batchId: string; count: number }> {
  const factoryName = input.factoryName.trim();
  if (!factoryName) throw new Error('請選擇或輸入廠家');
  if (!isPdfFile(input.file)) throw new Error('只接受 PDF 檔');
  if (input.file.size > SUPPLIER_DOCUMENT_MAX_BYTES) throw new Error('檔案超過 200MB');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error(userError?.message ?? '請先登入');

  input.onProgress?.('正在保存原始 PDF…');
  const hash = await sha256Hex(input.file);
  const storagePath = `${userData.user.id}/${hash}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(DESIGNER_CATALOG_BUCKET)
    .upload(storagePath, input.file, { contentType: 'application/pdf', upsert: false });
  const alreadyStored = !!uploadError && /exists|duplicate|409/i.test(uploadError.message);
  if (uploadError && !alreadyStored) throw new Error(`上傳失敗：${uploadError.message}`);

  const { data: created, error: createError } = await supabase.rpc('fds_designer_catalog_batch_create', {
    p_storage_path: storagePath,
    p_factory_id: input.factoryId || null,
    p_factory_name: factoryName,
    p_file_name: input.file.name,
    p_file_size: input.file.size,
    p_content_hash: hash,
  });
  if (createError) throw new Error(rpcErrorMessage(createError.message));
  const batchId = String((created as { batchId?: string } | null)?.batchId ?? '');
  if (!batchId) throw new Error('無法建立待審批次');

  try {
    input.onProgress?.('正在解析目錄…');
    const pairs = await fetchProductCategoryPairs();
    const base64Data = await readDataUrl(input.file);
    const { analyzePDFCatalogBatched } = await import('@/components/dashboard/AIProcessorView');
    const parsed = await analyzePDFCatalogBatched(
      [{
        id: `designer-${hash.slice(0, 8)}`,
        file: input.file,
        name: input.file.name,
        type: 'application/pdf',
        thumbnail: '',
        base64Data,
        mimeType: 'application/pdf',
      }],
      [],
      'gemini-2.5-flash',
      (progress) => input.onProgress?.(progress.message),
      () => undefined,
      factoryName,
      pairs,
      '',
    );
    const classified = await classifyProductsByExistingCategories(parsed, pairs);
    const assigned = assignUploadCategories(parsed, pairs, '', classified);
    input.onProgress?.(`正在整理 ${assigned.length} 件產品…`);
    const items = await buildPendingItems(assigned, pairs, batchId);
    const { data: submitted, error: submitError } = await supabase.rpc('fds_designer_catalog_items_submit', {
      p_batch_id: batchId,
      p_items: items,
    });
    if (submitError) throw new Error(rpcErrorMessage(submitError.message));
    const count = Number((submitted as { inserted?: number } | null)?.inserted ?? 0);
    if (count === 0) throw new Error('沒有解析到產品');
    return { batchId, count };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.rpc('fds_designer_catalog_batch_fail', {
      p_batch_id: batchId,
      p_message: message.slice(0, 500),
    });
    throw err instanceof Error ? err : new Error(message);
  }
}

async function buildPendingItems(
  products: Array<{
    id: string;
    title: string;
    description: string;
    tags: string[];
    price: number;
    material: string;
    dimensions: string;
    page_number: number;
    productCategory: string;
    categoryLevel1?: string | null;
    cropped_image_url?: string;
    modelNumber?: string;
    color?: string | null;
    dimensionLMm?: number | null;
    dimensionWMm?: number | null;
    dimensionHMm?: number | null;
  }>,
  pairs: ProductCategoryPair[],
  batchId: string,
) {
  const items = [];
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const pair = matchExistingProductCategory(pairs, product.productCategory, product.categoryLevel1);
    let imageUrl: string | null = null;
    if (product.cropped_image_url) {
      try {
        imageUrl = await uploadImageSourceToStorage(product.cropped_image_url, `dcat-${batchId}-${index + 1}`, 'primary');
      } catch (err) {
        console.warn('[designerCatalog] image upload skipped:', err);
      }
    }
    items.push({
      title: product.title,
      description: product.description,
      model_number: product.modelNumber || '',
      material: product.material || '',
      color: product.color || '',
      dimensions_text: product.dimensions || '',
      width_mm: finite(product.dimensionLMm),
      depth_mm: finite(product.dimensionWMm),
      height_mm: finite(product.dimensionHMm),
      price: product.price > 0 ? product.price : null,
      image_url: imageUrl,
      page_no: product.page_number > 0 ? product.page_number : null,
      product_category_id: pair?.id ?? null,
      category_label: pair ? categorySelectorValue(pair) : '',
      tags: product.tags ?? [],
    });
  }
  return items;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('無法讀取 PDF'));
    reader.readAsDataURL(file);
  });
}

export async function updateDesignerCatalogItem(itemId: string, fields: DesignerCatalogItemPatch): Promise<void> {
  const { error } = await supabase.rpc('fds_designer_catalog_item_update', {
    p_item_id: itemId,
    p_fields: fields,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
}

export async function setDesignerCatalogCategory(itemIds: string[], categoryId: string): Promise<number> {
  const { data, error } = await supabase.rpc('fds_designer_catalog_items_set_category', {
    p_item_ids: itemIds,
    p_category_id: categoryId,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
  return Number((data as { updated?: number } | null)?.updated ?? 0);
}

export async function decideDesignerCatalogItems(
  itemIds: string[],
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<{ approved: number; rejected: number; blocked: number }> {
  const { data, error } = await supabase.rpc('fds_designer_catalog_items_decide', {
    p_item_ids: itemIds,
    p_decision: decision,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
  const row = (data ?? {}) as { approved?: number; rejected?: number; blocked?: number };
  return {
    approved: Number(row.approved ?? 0),
    rejected: Number(row.rejected ?? 0),
    blocked: Number(row.blocked ?? 0),
  };
}

export function categoryLabel(item: Pick<DesignerCatalogItem, 'level1_category' | 'level2_category'>): string {
  const level1 = item.level1_category?.trim() || '';
  const level2 = item.level2_category?.trim() || '';
  if (level1 && level2) return `${level1} / ${level2}`;
  return level2 || level1;
}
