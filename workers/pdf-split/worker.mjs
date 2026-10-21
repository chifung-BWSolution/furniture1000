#!/usr/bin/env node
/**
 * Windows PDF splitter for supplier documents over 60MB.
 * Claims needs_split jobs, cuts the original into ~40MB page ranges with pdf-lib,
 * uploads the parts, and registers them so the existing Edge parse_pdf path can run.
 * The original file stays on the parent document.
 *
 * Restart this process after deploying a new copy. It does not reload itself.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Flags: --once  process at most one job, then exit.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { partStoragePath, PDF_EDGE_MAX_BYTES, splitPdfUnderTarget } from '../../src/lib/pdfSplitCore.mjs';

const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ONCE = process.argv.includes('--once');
const WORKER = `pdf-split-${hostname()}`;
const IDLE_MS = 10_000;

if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function permanent(message) {
  const text = String(message);
  return text.includes('無法拆分') || text.includes('無法再拆') || text.includes('沒有頁面') || text.includes('document_not_found');
}

async function kickEdge() {
  try {
    await fetch(`${URL_}/functions/v1/supabase-functions-process-jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'pdf-split' }),
    });
  } catch (err) {
    console.warn('edge kick failed', err instanceof Error ? err.message : err);
  }
}

async function finish(jobId, result, pages) {
  const done = await db.rpc('fds_processing_job_complete', {
    p_job_id: jobId,
    p_result: result,
    p_pages: pages,
  });
  if (done.error) throw done.error;
}

async function processJob(job) {
  const documentId = job.document_id || job.payload?.document_id;
  if (!documentId) {
    await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: 'missing_document', p_retryable: false });
    return;
  }

  const { data: doc, error } = await db
    .from('supplier_documents')
    .select('id, storage_path, file_size, parent_document_id')
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw error;
  if (!doc) {
    await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: 'document_not_found', p_retryable: false });
    return;
  }
  if (doc.parent_document_id) {
    await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: '分段不能再拆', p_retryable: false });
    return;
  }

  const { count, error: countError } = await db
    .from('supplier_documents')
    .select('id', { count: 'exact', head: true })
    .eq('parent_document_id', doc.id);
  if (countError) throw countError;
  if ((count ?? 0) > 0 || (doc.file_size && doc.file_size <= PDF_EDGE_MAX_BYTES)) {
    await finish(job.id, {
      skipped: (count ?? 0) > 0 ? 'already_split' : 'under_limit',
      parts: count ?? 0,
      worker: WORKER,
    }, null);
    if ((count ?? 0) > 0) await kickEdge();
    return;
  }

  await db.rpc('fds_processing_job_heartbeat', { p_job_id: job.id, p_progress: 0.05 });
  const downloaded = await db.storage.from('supplier-documents').download(doc.storage_path);
  if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? 'download_failed');
  const original = new Uint8Array(await downloaded.data.arrayBuffer());
  const parts = await splitPdfUnderTarget(original);
  const payload = [];
  for (const part of parts) {
    const bytes = Buffer.from(part.bytes);
    const partHash = createHash('sha256').update(bytes).digest('hex');
    const path = partStoragePath(doc.storage_path, part.partIndex, partHash);
    const upload = await db.storage.from('supplier-documents').upload(path, bytes, {
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
  await finish(job.id, { parts: parts.length, page_count: pageCount, worker: WORKER }, pageCount);
  await kickEdge();
  console.log(`split ${doc.id} into ${parts.length} parts (${pageCount} pages)`);
}

async function tick() {
  const { data, error } = await db.rpc('fds_processing_jobs_claim', {
    p_job_types: ['needs_split'],
    p_limit: 1,
    p_worker: WORKER,
    p_max_running: 1,
  });
  if (error) throw error;
  const job = data?.[0];
  if (!job) return false;
  try {
    await processJob(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`job ${job.id} failed: ${message}`);
    await db.rpc('fds_processing_job_fail', {
      p_job_id: job.id,
      p_error: message,
      p_retryable: !permanent(message),
    });
  }
  return true;
}

for (;;) {
  let worked = false;
  try {
    worked = await tick();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
  }
  if (ONCE) break;
  if (!worked) await sleep(IDLE_MS);
}
