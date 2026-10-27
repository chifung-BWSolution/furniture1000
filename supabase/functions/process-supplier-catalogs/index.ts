import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIME_ZONE = "Asia/Shanghai";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function shanghaiHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value);
}

/** 23:00 inclusive through 09:00 exclusive. */
function isCatalogParseWindow(now = new Date()): boolean {
  const hour = shanghaiHour(now);
  return hour >= 23 || hour < 9;
}

function isServiceRole(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders, status: 200 });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isServiceRole(req)) {
    const secret = req.headers.get("x-worker-secret");
    if (!secret) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data, error } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    if (error || data !== true) return json({ error: "Unauthorized" }, 401);
  }

  const now = new Date();
  if (!isCatalogParseWindow(now)) {
    return json({
      ok: true,
      skipped: true,
      reason: "outside_window",
      timezone: TIME_ZONE,
      parsed: 0,
    });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, serviceKey);
  const { data: claimed, error } = await supabase.rpc("fds_supplier_catalog_jobs_claim", {
    p_limit: 20,
  });
  if (error) return json({ error: error.message }, 500);

  const jobs = (claimed ?? []) as Array<{
    id: string;
    document_id: string;
    attempt_count: number;
  }>;
  let parsed = 0;
  let failed = 0;
  for (const job of jobs) {
    const { error: enqueueError } = await supabase.rpc("fds_supplier_document_enqueue_parse", {
      p_document_id: job.document_id,
    });
    if (enqueueError) {
      const terminal = job.attempt_count >= 5
        || /certificate_not_parseable|document_not_found|permission_denied/.test(enqueueError.message);
      const { error: updateError } = await supabase
        .from("supplier_document_jobs")
        .update({
          status: terminal ? "failed" : "pending",
          error_message: enqueueError.message.slice(0, 500),
          finished_at: terminal ? new Date().toISOString() : null,
        })
        .eq("id", job.id);
      if (updateError) return json({ error: updateError.message, parsed, failed }, 500);
      failed += 1;
      continue;
    }
    const { error: updateError } = await supabase
      .from("supplier_document_jobs")
      .update({
        status: "completed",
        error_message: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (updateError) return json({ error: updateError.message, parsed, failed }, 500);
    parsed += 1;
  }

  if (parsed > 0 && url && serviceKey) {
    const kick = fetch(`${url}/functions/v1/supabase-functions-process-jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "supplier-catalogs" }),
    }).then((response) => response.body?.cancel()).catch((err) => {
      console.warn("[process-supplier-catalogs] process-jobs wake failed", err);
    });
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(kick);
    else await kick;
  }

  const { count } = await supabase
    .from("supplier_document_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return json({
    ok: true,
    skipped: false,
    timezone: TIME_ZONE,
    claimed: jobs.length,
    pending: count ?? 0,
    parsed,
    failed,
  });
});
