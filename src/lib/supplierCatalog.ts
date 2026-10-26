import { supabase } from '@/lib/supabase';
import { canManageSupplierDocuments, uploadSupplierDocument, type DocumentUploadProgress } from '@/lib/supplierDocuments';

export const SUPPLIER_DOCUMENT_BUCKET = 'supplier-documents';

export type CatalogProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'review_required'
  | 'not_applicable';

export type SupplierDocType = 'catalog' | 'price_list' | 'quote' | 'certificate';

export type SupplierCatalogRow = {
  id: string;
  factory_id: string | null;
  factory_name: string;
  doc_type: SupplierDocType;
  document_year: number | null;
  series: string | null;
  product_categories: string[];
  version_label: string | null;
  description: string | null;
  processing_status: CatalogProcessingStatus;
  /** Latest parse job error, when the job failed. */
  error_message?: string | null;
  title?: string | null;
  storage_path: string;
  file_size: number | null;
  created_at: string;
};

const CATALOG_COLUMNS =
  'id, factory_id, factory_name, doc_type, title, document_year, series, product_categories, version_label, description, processing_status, storage_path, file_size, created_at';

export function supplierDocTypeLabel(docType: string | null | undefined): string {
  return docType === 'certificate' ? '證書' : docType === 'price_list' || docType === 'quote' ? '報價單' : '圖冊';
}

export function catalogStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return '待解析';
    case 'processing':
      return '解析中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '解析失敗';
    case 'review_required':
      return '待審核';
    case 'not_applicable':
      return '只保存原檔';
    default:
      return '—';
  }
}

/** What the current status means for the person who just uploaded the file. */
export function catalogStatusDetail(status: string | null | undefined, errorMessage?: string | null): string {
  switch (status) {
    case 'pending':
      return '檔案已保存。解析尚未開始，會在上海時間 23:00 至翌日 09:00 進行。';
    case 'processing':
      return '正在解析這份文件。完成前可以離開此頁。';
    case 'completed':
      return '解析已完成。';
    case 'failed':
      return errorMessage?.trim()
        ? `解析失敗：${errorMessage.trim()}`
        : '解析失敗。原檔仍在，可稍後重試。';
    case 'review_required':
      return '解析已完成，結果需要人工確認後才會入庫。';
    case 'not_applicable':
      return '證書已保存，不會安排 AI 解析。';
    default:
      return '尚未取得處理狀態。';
  }
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function listFactoryCatalogs(factoryId: string): Promise<SupplierCatalogRow[]> {
  const { data, error } = await supabase
    .from('supplier_documents')
    .select(CATALOG_COLUMNS)
    .eq('factory_id', factoryId)
    .in('doc_type', ['catalog', 'price_list', 'quote', 'certificate'])
    .is('parent_document_id', null)
    .order('document_year', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SupplierCatalogRow[];
  if (rows.length === 0) return rows;
  const { data: jobs, error: jobError } = await supabase
    .from('processing_jobs')
    .select('document_id, error, created_at')
    .in('document_id', rows.map((row) => row.id))
    .order('created_at', { ascending: false });
  if (jobError) return rows;
  const errorByDocument = new Map<string, string | null>();
  for (const job of jobs ?? []) {
    const documentId = String(job.document_id);
    if (!errorByDocument.has(documentId)) {
      errorByDocument.set(documentId, job.error ?? null);
    }
  }
  return rows.map((row) => ({
    ...row,
    error_message: errorByDocument.get(row.id) ?? null,
  }));
}

export type CatalogListRow = Omit<
  Pick<
    SupplierCatalogRow,
    'id' | 'factory_id' | 'doc_type' | 'document_year' | 'processing_status' | 'product_categories' | 'created_at' | 'storage_path'
  >,
  'doc_type'
> & { doc_type: SupplierDocType | 'quote' };

export async function listCatalogRows(): Promise<CatalogListRow[]> {
  const canManage = await canManageSupplierDocuments().catch(() => false);
  const docTypes = canManage ? ['catalog', 'price_list', 'quote'] : ['catalog'];
  const { data, error } = await supabase
    .from('supplier_documents')
    .select('id, factory_id, doc_type, document_year, processing_status, product_categories, created_at, storage_path')
    .in('doc_type', docTypes)
    .is('parent_document_id', null);
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogListRow[];
}

/** Enqueue catalog/price_list for the nightly worker only — does not wake parse workers. */
export async function enqueueSupplierCatalogParse(documentId: string): Promise<void> {
  const { error } = await supabase.rpc('fds_supplier_catalog_enqueue_parse', {
    p_document_id: documentId,
  });
  if (error) throw new Error(error.message);
}

export async function uploadSupplierCatalog(input: {
  factoryId: string;
  factoryName: string;
  docType: SupplierDocType;
  file: File;
  year: number;
  series: string;
  productCategories: string[];
  versionLabel?: string;
  description?: string;
  onProgress?: (progress: DocumentUploadProgress) => void;
}): Promise<Pick<SupplierCatalogRow, 'id' | 'title' | 'doc_type' | 'processing_status'>> {
  const isCatalog = input.docType === 'catalog';
  const docLabel = supplierDocTypeLabel(input.docType);
  const series = input.series.trim();
  const categories = input.productCategories.map((item) => item.trim()).filter(Boolean);
  if (!input.factoryId.trim() || !input.factoryName.trim()) throw new Error('請先選擇廠家');
  if (!input.file || (input.file.type !== 'application/pdf' && !input.file.name.toLowerCase().endsWith('.pdf'))) {
    throw new Error(`請上傳 PDF ${docLabel}`);
  }
  if (!Number.isInteger(input.year) || input.year < 1990 || input.year > 2100) {
    throw new Error('請填寫有效年份');
  }
  if (isCatalog && !series) throw new Error('圖冊必須填寫系列');
  if (isCatalog && categories.length === 0) throw new Error('圖冊必須選擇至少一個產品類型');

  const saved = await uploadSupplierDocument({
    file: input.file,
    factoryId: input.factoryId,
    factoryName: input.factoryName,
    docType: input.docType,
    title: input.file.name,
    enqueue: input.docType !== 'certificate',
    metadata: {
      document_year: input.year,
      series,
      product_categories: categories,
      version_label: input.versionLabel?.trim(),
      description: input.description?.trim(),
    },
    onProgress: input.onProgress,
  });
  if (saved.duplicate) throw new Error(`這份${docLabel}已經上傳過，不會覆蓋舊檔`);
  return {
    id: saved.documentId,
    title: input.file.name,
    doc_type: input.docType,
    processing_status: input.docType === 'certificate' ? 'not_applicable' : 'pending',
  };

}

export async function openSupplierCatalog(storagePath: string): Promise<void> {
  const { data, error } = await supabase.storage
    .from(SUPPLIER_DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || '無法建立下載連結');
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}
