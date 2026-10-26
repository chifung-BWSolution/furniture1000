// ============================================================================
// FDS 2.1 供應商文件（F-AI-001 / F-PLT-001 / F-PLT-004）
// 原始 PDF 存私有 bucket supplier-documents；文件與任務只經 fds_* RPC 寫入。
// 只有 admin / uploader 讀得到（RLS + storage policy），供應商主檔仍在 PMS factories。
// ============================================================================
import { uploadDocumentChunks, type DocumentUploadProgress } from '@/lib/resumableDocumentUpload';
export type { DocumentUploadProgress } from '@/lib/resumableDocumentUpload';
import { PDF_EDGE_MAX_BYTES } from '@/lib/pdfSplitLimits';
import { supabase } from '@/lib/supabase';

export { PDF_EDGE_MAX_BYTES };

export const SUPPLIER_DOCUMENTS_BUCKET = 'supplier-documents';
export const SUPPLIER_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

export type SupplierDocumentStatus = 'uploaded' | 'parsing' | 'review' | 'ready' | 'failed';
export type ProcessingJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProcessingJobSummary {
  id: string;
  job_type: string;
  status: ProcessingJobStatus;
  progress: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  run_after: string;
  created_at: string;
  finished_at: string | null;
  /** parse_pdf checkpoint: which phase and the next page to process. */
  state: {
    phase?: 'extract' | 'classify' | 'structure';
    cursor?: number;
    page_count?: number;
    units?: unknown[];
  } | null;
  pages: number | null;
  ocr_pages: number | null;
  tokens: number | null;
  cost_actual: number | null;
  result: {
    page_count?: number;
    segments?: number;
    items?: number;
    needs_attention?: number;
    currency_suggestion?: string | null;
    empty_pages?: number;
    duration_seconds?: number;
    cost_usd?: number;
    success_rate?: number;
    tokens?: number;
    ocr_pages?: number;
    ocr?: Partial<Record<'done' | 'failed' | 'skipped' | 'unsupported', number>>;
  } | null;
}

export type PageType = 'cover' | 'toc' | 'product' | 'price_table' | 'terms' | 'other';

export interface DocumentSegment {
  id: string;
  seq: number;
  start_page: number;
  end_page: number;
  kind: PageType;
  title: string | null;
}

export interface SupplierDocument {
  id: string;
  factory_id: string | null;
  factory_name: string;
  doc_type: 'quote' | 'catalog' | 'price_list' | 'certificate';
  title: string | null;
  storage_path: string;
  file_size: number | null;
  page_count: number | null;
  currency: string | null;
  source: 'upload' | 'ai_processor';
  status: SupplierDocumentStatus;
  error_message: string | null;
  parent_document_id: string | null;
  part_index: number | null;
  page_offset: number;
  part_count: number | null;
  parts_done: number | null;
  created_at: string;
  modified_date: string;
  processing_jobs: ProcessingJobSummary[];
}

export interface UploadSupplierDocumentInput {
  file: File;
  factoryId?: string | null;
  factoryName?: string | null;
  title?: string | null;
  docType?: 'quote' | 'catalog' | 'price_list' | 'certificate';
  metadata?: { document_year: number; series?: string; product_categories?: string[]; version_label?: string; description?: string };
  currency?: string | null;
  source?: 'upload' | 'ai_processor';
  /** false = archive the original only; parsing can be started later from the panel. */
  enqueue?: boolean;
  onProgress?: (progress: DocumentUploadProgress) => void;
}

export interface UploadSupplierDocumentResult {
  documentId: string;
  jobId: string | null;
  duplicate: boolean;
  partCount?: number;
  /** worker = needs_split queued for the Vercel pdf-split function; browser retained for older callers. */
  splitMode?: 'browser' | 'worker';
}

const DOCUMENT_COLUMNS = [
  'id', 'factory_id', 'factory_name', 'doc_type', 'title', 'storage_path', 'file_size',
  'page_count', 'currency', 'source', 'status', 'error_message', 'parent_document_id', 'part_index',
  'page_offset', 'part_count', 'parts_done', 'created_at', 'modified_date',
  'processing_jobs(id, job_type, status, progress, attempts, max_attempts, error, run_after, created_at, finished_at, pages, ocr_pages, tokens, cost_actual, state:payload->state, result)',
].join(', ');

export const ACTIVE_JOB_STATUSES: ProcessingJobStatus[] = ['queued', 'running'];

export function latestJob(doc: SupplierDocument): ProcessingJobSummary | null {
  return doc.processing_jobs[0] ?? null;
}

export function hasActiveJob(doc: SupplierDocument): boolean {
  return doc.processing_jobs.some((j) => ACTIVE_JOB_STATUSES.includes(j.status));
}

/** Parent stays in progress while any part is still parsing, even if its own split job already finished. */
export function documentWorkInProgress(doc: SupplierDocument): boolean {
  if ((doc.part_count ?? 0) > 0 && doc.status === 'parsing' && (doc.parts_done ?? 0) < (doc.part_count ?? 0)) {
    return true;
  }
  return hasActiveJob(doc);
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function storageKeySegment(value: string | null | undefined): string {
  const cleaned = String(value ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 60) || 'unassigned';
}

async function sha256HexBytes(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(file: File): Promise<string> {
  return sha256HexBytes(await file.arrayBuffer());
}

function rpcErrorMessage(message: string): string {
  if (message.includes('permission_denied')) return '沒有權限（只限 admin／傢俬組）';
  if (message.includes('storage_object_missing')) return '原始檔未成功上傳，請重試';
  if (message.includes('document_not_found')) return '找不到文件';
  return message;
}

export async function canManageSupplierDocuments(): Promise<boolean> {
  const { data, error } = await supabase.rpc('bwf_has_role', { p_roles: ['admin', 'uploader'] });
  if (error) {
    console.warn('[supplierDocuments] role check failed:', error.message);
    return false;
  }
  return data === true;
}

async function uploadOriginalPdf(input: UploadSupplierDocumentInput, path: string): Promise<void> {
  const getSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error('登入已失效，請重新登入後上載');
    return data.session;
  };
  const session = await getSession();
  try {
    await uploadDocumentChunks({
      file: input.file, path, bucket: SUPPLIER_DOCUMENTS_BUCKET,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      userId: session.user.id,
      getToken: async () => (await getSession()).access_token,
      onProgress: input.onProgress,
    });
  } catch (error) {
    // A TUS 409 can mean a competing upload, not an existing object. Confirm the
    // final immutable hash path exists before allowing the document RPC to run.
    const { data, error: infoError } = await supabase.storage.from(SUPPLIER_DOCUMENTS_BUCKET).info(path);
    if (infoError || !data || data.size !== input.file.size) {
      throw new Error(`上傳失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function uploadSupplierDocument(
  input: UploadSupplierDocumentInput,
): Promise<UploadSupplierDocumentResult> {
  const { file } = input;
  if (!isPdfFile(file)) throw new Error('只接受 PDF 檔');
  if (file.size > SUPPLIER_DOCUMENT_MAX_BYTES) {
    throw new Error(`檔案超過 ${SUPPLIER_DOCUMENT_MAX_BYTES / 1024 / 1024}MB 上限`);
  }

  const oversized = file.size > PDF_EDGE_MAX_BYTES;
  input.onProgress?.({ phase: 'preparing', uploadedBytes: 0, totalBytes: file.size });
  // Yield so the preparation state paints before hashing a large document.
  await new Promise(resolve => setTimeout(resolve, 0));
  const hash = await sha256Hex(file);
  const folder = storageKeySegment(input.factoryId || input.factoryName);
  const path = input.metadata ? `${folder}/${input.docType ?? 'quote'}/${hash}.pdf` : `${folder}/${hash}.pdf`;
  await uploadOriginalPdf(input, path);
  input.onProgress?.({ phase: 'registering', uploadedBytes: file.size, totalBytes: file.size });

  // The existing enqueue RPC routes large originals to needs_split. Upload never wakes a worker.
  const enqueue = input.docType !== 'certificate' && (input.enqueue ?? true);
  const { data, error } = await supabase.rpc('fds_supplier_document_create', {
    p_storage_path: path,
    p_factory_id: input.factoryId || null,
    p_factory_name: input.factoryName || '',
    p_title: input.title ?? file.name.replace(/\.pdf$/i, ''),
    p_doc_type: input.docType ?? 'quote',
    p_currency: input.currency || null,
    p_content_hash: hash,
    p_source: input.source ?? 'upload',
    p_enqueue: enqueue,
    ...(input.metadata ? { p_metadata: input.metadata } : {}),
  });
  if (error) throw new Error(rpcErrorMessage(error.message));

  const result = data as UploadSupplierDocumentResult;
  input.onProgress?.({ phase: 'complete', uploadedBytes: file.size, totalBytes: file.size });
  return oversized && enqueue ? { ...result, splitMode: 'worker' } : result;
}

export async function listSupplierDocuments(opts: {
  factoryId?: string | null;
  factoryName?: string | null;
  limit?: number;
} = {}): Promise<SupplierDocument[]> {
  let query = supabase
    .from('supplier_documents')
    .select(DOCUMENT_COLUMNS)
    .is('parent_document_id', null)
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'processing_jobs', ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.factoryId) query = query.eq('factory_id', opts.factoryId);
  else if (opts.factoryName?.trim()) query = query.eq('factory_name', opts.factoryName.trim());

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SupplierDocument[];
}

export async function listDocumentSegments(documentId: string): Promise<DocumentSegment[]> {
  const { data, error } = await supabase
    .from('supplier_document_segments')
    .select('id, seq, start_page, end_page, kind, title')
    .eq('document_id', documentId)
    .order('seq');
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentSegment[];
}

export async function enqueueSupplierDocumentParse(documentId: string): Promise<void> {
  const { data, error } = await supabase.rpc('fds_supplier_document_enqueue_parse', {
    p_document_id: documentId,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
}

export async function cancelSupplierDocumentParts(documentId: string): Promise<void> {
  const { error } = await supabase.rpc('fds_supplier_document_cancel_parts', {
    p_document_id: documentId,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
}

export async function cancelProcessingJob(jobId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fds_processing_job_cancel', { p_job_id: jobId });
  if (error) throw new Error(rpcErrorMessage(error.message));
  return (data as { cancelled?: boolean } | null)?.cancelled === true;
}

export async function getSupplierDocumentDownloadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SUPPLIER_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? '無法產生下載連結');
  return data.signedUrl;
}
