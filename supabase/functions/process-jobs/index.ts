import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

/**
 * FDS 2.1 背景任務 worker（Edge 過渡版，C-09）。
 * 呼叫來源：pg_cron（x-worker-secret）或前端已登入的 admin / uploader（Authorization）。
 * 任務狀態一律經 fds_processing_job_* RPC 流轉，Python Worker 之後共用同一套 RPC。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WORKER_NAME = "edge:process-jobs";
const JOB_TYPES = ["parse_pdf"];
const MAX_JOBS_PER_RUN = 2;
const RUN_BUDGET_MS = 110_000;
// Edge isolates cap memory well below what pdf-lib needs for very large files.
const EDGE_MAX_PDF_BYTES = 60 * 1024 * 1024;

type Job = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  document_id: string | null;
  attempts: number;
  max_attempts: number;
};

class NonRetryableError extends Error {}
class JobCancelledError extends Error {}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAuthorized(
  req: Request,
  admin: SupabaseClient,
  url: string,
  anonKey: string,
): Promise<boolean> {
  const secret = req.headers.get("x-worker-secret");
  if (secret) {
    const { data } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    return data === true;
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user?.id) return false;
  const { data } = await userClient.rpc("bwf_has_role", { p_roles: ["admin", "uploader"] });
  return data === true;
}

async function heartbeat(admin: SupabaseClient, jobId: string, progress: number) {
  const { data, error } = await admin.rpc("fds_processing_job_heartbeat", {
    p_job_id: jobId,
    p_progress: progress,
  });
  if (error) throw new Error(`heartbeat failed: ${error.message}`);
  if (data !== "running") throw new JobCancelledError(String(data));
}

async function handleParsePdf(admin: SupabaseClient, job: Job) {
  const documentId = job.document_id ?? String(job.payload.document_id ?? "");
  if (!documentId) throw new NonRetryableError("parse_pdf job has no document_id");

  const { data: doc, error: docErr } = await admin
    .from("supplier_documents")
    .select("id, storage_path, file_size")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr) throw new Error(`document lookup failed: ${docErr.message}`);
  if (!doc) throw new NonRetryableError("document_not_found");

  if (doc.file_size && doc.file_size > EDGE_MAX_PDF_BYTES) {
    throw new NonRetryableError(
      `檔案 ${(doc.file_size / 1024 / 1024).toFixed(1)}MB 超過 Edge 處理上限（${EDGE_MAX_PDF_BYTES / 1024 / 1024}MB），待 Python Worker 處理`,
    );
  }

  await heartbeat(admin, job.id, 0.1);

  const { data: blob, error: dlErr } = await admin.storage
    .from("supplier-documents")
    .download(doc.storage_path);
  if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message ?? "empty"}`);

  await heartbeat(admin, job.id, 0.4);

  let pageCount: number;
  let encrypted = false;
  try {
    const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    pageCount = pdf.getPageCount();
    encrypted = pdf.isEncrypted;
  } catch (err) {
    throw new NonRetryableError(`無法讀取 PDF：${err instanceof Error ? err.message : String(err)}`);
  }

  await heartbeat(admin, job.id, 0.9);

  // Extraction (text / OCR / structuring) lands in later stages of this same job type.
  const { data: done, error: doneErr } = await admin.rpc("fds_processing_job_complete", {
    p_job_id: job.id,
    p_result: { stage: "inspected", page_count: pageCount, encrypted, worker: WORKER_NAME },
    p_document_status: "review",
    p_pages: pageCount,
  });
  if (doneErr) throw new Error(`complete failed: ${doneErr.message}`);
  if (done !== true) throw new JobCancelledError("not running");
}

async function runJob(admin: SupabaseClient, job: Job) {
  try {
    if (job.job_type === "parse_pdf") {
      await handleParsePdf(admin, job);
    } else {
      throw new NonRetryableError(`unsupported job_type: ${job.job_type}`);
    }
    return { id: job.id, status: "succeeded" };
  } catch (err) {
    if (err instanceof JobCancelledError) {
      return { id: job.id, status: "cancelled" };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process-jobs] job ${job.id} failed`, message);
    const { data } = await admin.rpc("fds_processing_job_fail", {
      p_job_id: job.id,
      p_error: message,
      p_retryable: !(err instanceof NonRetryableError),
    });
    return { id: job.id, status: String(data ?? "failed"), error: message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) {
    return jsonResponse({ error: "Supabase not configured" }, 500);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!(await isAuthorized(req, admin, url, anonKey))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const startedAt = Date.now();
  const results: unknown[] = [];

  while (results.length < MAX_JOBS_PER_RUN && Date.now() - startedAt < RUN_BUDGET_MS) {
    const { data: claimed, error } = await admin.rpc("fds_processing_jobs_claim", {
      p_job_types: JOB_TYPES,
      p_limit: 1,
      p_worker: WORKER_NAME,
    });
    if (error) {
      console.error("[process-jobs] claim failed", error.message);
      return jsonResponse({ error: error.message, results }, 500);
    }
    const job = (claimed as Job[] | null)?.[0];
    if (!job) break;
    results.push(await runJob(admin, job));
  }

  return jsonResponse({ processed: results.length, results });
});
