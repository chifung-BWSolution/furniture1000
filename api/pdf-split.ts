/**
 * Vercel Function: split already-stored supplier PDFs that are over the Edge limit.
 * Claims one needs_split job, downloads the original from Storage, splits with pdf-lib,
 * uploads the parts, and registers them so Edge parse_pdf can take over.
 *
 * Do not import this module from client code. It reads server-only env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PDF_SPLIT_SECRET
 * Never prefix those with VITE_.
 *
 * Auth: header x-pdf-split-secret, or Authorization: Bearer <PDF_SPLIT_SECRET>.
 * Vercel Cron sends the Bearer token from CRON_SECRET, so that platform value
 * must be the same string as PDF_SPLIT_SECRET. This file does not read CRON_SECRET.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readEnv, secretsMatch } from './pdfSplitSecret.mjs';
import { partStoragePath, PDF_EDGE_MAX_BYTES, splitPdfUnderTarget } from '../src/lib/pdfSplitCore.mjs';

export const maxDuration = 800;

const WORKER = 'vercel:pdf-split';
const BUCKET = 'supplier-documents';

type SplitJob = {
  id: string;
  document_id: string | null;
  payload: { document_id?: string } | null;
};

type SupplierDoc = {
  id: string;
  storage_path: string;
  file_size: number | null;
  parent_document_id: string | null;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

function permanent(message: string): boolean {
  return message.includes('無法拆分')
    || message.includes('無法再拆')
    || message.includes('沒有頁面')
    || message.includes('document_not_found');
}

function providedSecret(req: Request): string | null {
  const header = req.headers.get('x-pdf-split-secret');
  if (header) return header;
  const auth = req.headers.get('authorization');
  const match = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
  return match?.[1] ?? null;
}

function authorized(req: Request): boolean {
  return secretsMatch(providedSecret(req), readEnv(process.env.PDF_SPLIT_SECRET));
}

async function kickEdge(url: string, key: string) {
  try {
    const res = await fetch(`${url}/functions/v1/supabase-functions-process-jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'pdf-split' }),
    });
    await res.body?.cancel();
  } catch (err) {
    console.warn('[pdf-split] edge kick failed', errorMessage(err));
  }
}

async function finish(db: SupabaseClient, jobId: string, result: Record<string, unknown>, pages: number | null) {
  const done = await db.rpc('fds_processing_job_complete', {
    p_job_id: jobId,
    p_result: result,
    p_pages: pages,
  });
  if (done.error) throw done.error;
}

async function processJob(db: SupabaseClient, job: SplitJob, url: string, key: string) {
  const documentId = job.document_id || job.payload?.document_id;
  if (!documentId) {
    await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: 'missing_document', p_retryable: false });
    return { skipped: 'missing_document' };
  }

  const { data, error } = await db
    .from('supplier_documents')
    .select('id, storage_path, file_size, parent_document_id')
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw error;
  const doc = data as SupplierDoc | null;
  if (!doc) {
    await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: 'document_not_found', p_retryable: false });
    return { skipped: 'document_not_found' };
  }
  if (doc.parent_document_id) {
    await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: '分段不能再拆', p_retryable: false });
    return { skipped: 'child' };
  }

  const { count, error: countError } = await db
    .from('supplier_documents')
    .select('id', { count: 'exact', head: true })
    .eq('parent_document_id', doc.id);
  if (countError) throw countError;
  if ((count ?? 0) > 0 || (doc.file_size != null && doc.file_size <= PDF_EDGE_MAX_BYTES)) {
    const skipped = (count ?? 0) > 0 ? 'already_split' : 'under_limit';
    await finish(db, job.id, { skipped, parts: count ?? 0, worker: WORKER }, null);
    if ((count ?? 0) > 0) await kickEdge(url, key);
    return { skipped, parts: count ?? 0 };
  }

  await db.rpc('fds_processing_job_heartbeat', { p_job_id: job.id, p_progress: 0.05 });
  const downloaded = await db.storage.from(BUCKET).download(doc.storage_path);
  if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? 'download_failed');
  const original = new Uint8Array(await downloaded.data.arrayBuffer());
  const parts = await splitPdfUnderTarget(original);
  const payload = [];
  for (const part of parts) {
    const bytes = part.bytes;
    const partHash = createHash('sha256').update(bytes).digest('hex');
    const path = partStoragePath(doc.storage_path, part.partIndex, partHash);
    const upload = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (upload.error) throw upload.error;
    payload.push({
      part_index: part.partIndex,
      page_offset: part.pageOffset,
      page_count: part.pageCount,
      storage_path: path,
      content_hash: partHash,
    });
    await db.rpc('fds_processing_job_heartbeat', {
      p_job_id: job.id,
      p_progress: Math.min(0.9, 0.1 + (part.partIndex / parts.length) * 0.8),
    });
  }

  const registered = await db.rpc('fds_supplier_document_register_parts', {
    p_parent_id: doc.id,
    p_parts: payload,
  });
  if (registered.error) throw registered.error;

  const pageCount = parts.reduce((sum, part) => sum + part.pageCount, 0);
  await finish(db, job.id, { parts: parts.length, page_count: pageCount, worker: WORKER }, pageCount);
  await kickEdge(url, key);
  console.log(`[pdf-split] split ${doc.id} into ${parts.length} parts (${pageCount} pages)`);
  return { parts: parts.length, page_count: pageCount };
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);

  const url = readEnv(process.env.SUPABASE_URL);
  const key = readEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return json({ error: 'Supabase not configured' }, 500);

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('fds_processing_jobs_claim', {
    p_job_types: ['needs_split'],
    p_limit: 1,
    p_worker: WORKER,
    p_max_running: 1,
  });
  if (error) {
    console.error('[pdf-split] claim failed', error.message);
    return json({ error: error.message }, 500);
  }

  const job = (data as SplitJob[] | null)?.[0];
  if (!job) return json({ processed: 0 });

  try {
    const result = await processJob(db, job, url, key);
    return json({ processed: 1, job_id: job.id, ...result });
  } catch (err) {
    const message = errorMessage(err);
    console.error(`[pdf-split] job ${job.id} failed: ${message}`);
    await db.rpc('fds_processing_job_fail', {
      p_job_id: job.id,
      p_error: message,
      p_retryable: !permanent(message),
    });
    return json({ processed: 1, job_id: job.id, failed: true });
  }
}

export function GET(req: Request): Promise<Response> {
  return handle(req);
}

export function POST(req: Request): Promise<Response> {
  return handle(req);
}
