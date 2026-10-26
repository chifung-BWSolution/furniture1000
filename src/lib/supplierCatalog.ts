import { supabase } from '@/lib/supabase';
import { withInsertAuditFields } from '@/lib/pmsAudit';

export const SUPPLIER_DOCUMENT_BUCKET = 'supplier-documents';

export type CatalogProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'review_required'
  | 'not_applicable';

export type SupplierCatalogRow = {
  id: string;
  factory_id: string | null;
  factory_name: string;
  document_year: number | null;
  series: string | null;
  product_categories: string[];
  version_label: string | null;
  description: string | null;
  processing_status: CatalogProcessingStatus;
  storage_path: string;
  file_size: number | null;
  created_at: string;
};

const CATALOG_COLUMNS =
  'id, factory_id, factory_name, document_year, series, product_categories, version_label, description, processing_status, storage_path, file_size, created_at';

export function catalogStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return '待解析';
    case 'processing':
      return '解析中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失敗';
    case 'review_required':
      return '待審核';
    default:
      return '—';
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
    .eq('doc_type', 'catalog')
    .is('parent_document_id', null)
    .order('document_year', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SupplierCatalogRow[];
}

export async function listCatalogRows(): Promise<
  Pick<SupplierCatalogRow, 'factory_id' | 'document_year' | 'processing_status' | 'product_categories'>[]
> {
  const { data, error } = await supabase
    .from('supplier_documents')
    .select('factory_id, document_year, processing_status, product_categories')
    .eq('doc_type', 'catalog')
    .is('parent_document_id', null);
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<
    SupplierCatalogRow,
    'factory_id' | 'document_year' | 'processing_status' | 'product_categories'
  >[];
}

export async function uploadSupplierCatalog(input: {
  factoryId: string;
  factoryName: string;
  file: File;
  year: number;
  series: string;
  productCategories: string[];
  versionLabel?: string;
  description?: string;
}): Promise<void> {
  const series = input.series.trim();
  const categories = input.productCategories.map((item) => item.trim()).filter(Boolean);
  if (!input.file || input.file.type !== 'application/pdf') {
    throw new Error('請上傳 PDF 圖冊');
  }
  if (!Number.isInteger(input.year) || input.year < 1990 || input.year > 2100) {
    throw new Error('請填寫有效年份');
  }
  if (!series) throw new Error('圖冊必須填寫系列');
  if (categories.length === 0) throw new Error('圖冊必須選擇至少一個產品類型');

  const contentHash = await sha256Hex(input.file);
  const { data: existing, error: existingError } = await supabase
    .from('supplier_documents')
    .select('id')
    .eq('factory_id', input.factoryId)
    .eq('doc_type', 'catalog')
    .eq('content_hash', contentHash)
    .is('parent_document_id', null)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.id) {
    throw new Error('這份圖冊已經上傳過，不會覆蓋舊檔');
  }

  const objectPath = `catalogs/${input.factoryId}/${input.year}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(SUPPLIER_DOCUMENT_BUCKET)
    .upload(objectPath, input.file, {
      contentType: 'application/pdf',
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const row = await withInsertAuditFields({
    factory_id: input.factoryId,
    factory_name: input.factoryName,
    doc_type: 'catalog',
    title: input.file.name,
    storage_path: objectPath,
    file_size: input.file.size,
    content_hash: contentHash,
    source: 'upload',
    status: 'uploaded',
    processing_status: 'pending',
    document_year: input.year,
    series,
    product_categories: categories,
    version_label: input.versionLabel?.trim() || null,
    description: input.description?.trim() || null,
    parent_document_id: null,
  });

  const { error: insertError } = await supabase.from('supplier_documents').insert(row);
  if (insertError) {
    await supabase.storage.from(SUPPLIER_DOCUMENT_BUCKET).remove([objectPath]);
    if (insertError.code === '23505') {
      throw new Error('這份圖冊已經上傳過，不會覆蓋舊檔');
    }
    throw new Error(insertError.message);
  }
}

export async function openSupplierCatalog(storagePath: string): Promise<void> {
  const { data, error } = await supabase.storage
    .from(SUPPLIER_DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || '無法建立下載連結');
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}
