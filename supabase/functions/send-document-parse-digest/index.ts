import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isSafeEmail, sendEmail } from "../_shared/email.ts";
import {
  aggregateDocumentParseDigest,
  buildDocumentParseDigestEmail,
  getDailyParseDigestRangeHk,
  type DigestAsanaSyncInput,
  type DigestDocumentInput,
} from "../_shared/documentParseDigestEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_RECIPIENTS = [
  "cfb.system@chifung.net",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getConfiguredRecipients(): string[] {
  const raw = Deno.env.get("FDS_DOCUMENT_PARSE_DIGEST_RECIPIENTS")?.trim();
  if (!raw) return [...DEFAULT_RECIPIENTS];
  const parsed = raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => isSafeEmail(s));
  return parsed.length > 0 ? [...new Set(parsed.map((s) => s.toLowerCase()))] : [...DEFAULT_RECIPIENTS];
}

function resolveRecipients(rawTo: unknown): string[] {
  const defaults = getConfiguredRecipients();
  if (rawTo == null || rawTo === "") return defaults;
  const list = Array.isArray(rawTo) ? rawTo : [rawTo];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) continue;
    if (!isSafeEmail(trimmed)) {
      throw new Error(`Invalid recipient email: ${trimmed}`);
    }
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out.length > 0 ? out : defaults;
}

async function authorizeCaller(
  req: Request,
  admin: SupabaseClient,
): Promise<Response | null> {
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== null) {
    const secret = workerSecret.trim();
    if (!secret) return jsonResponse({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.rpc("fds_worker_verify_secret", {
      p_secret: secret,
    });
    if (error || data !== true) return jsonResponse({ error: "Unauthorized" }, 401);
    return null;
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (jwt && serviceRoleKey && jwt === serviceRoleKey) return null;
  if (!jwt) return jsonResponse({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) {
    return jsonResponse({ error: "SUPABASE_ANON_KEY is not configured" }, 500);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: allowed, error: roleError } = await userClient.rpc("bwf_has_role", {
    p_roles: ["admin"],
  });
  if (roleError || allowed !== true) {
    return jsonResponse({ error: "permission_denied" }, 403);
  }
  return null;
}

async function fetchDigestDocuments(
  admin: SupabaseClient,
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<DigestDocumentInput[]> {
  const cols =
    "id, factory_name, doc_type, title, source, status, file_size, page_count, part_count, parts_done, error_message, created_at, modified_date";

  const [createdRes, modifiedRes, outstandingRes] = await Promise.all([
    admin
      .from("supplier_documents")
      .select(cols)
      .is("parent_document_id", null)
      .gte("created_at", rangeStartIso)
      .lt("created_at", rangeEndIso)
      .limit(200),
    admin
      .from("supplier_documents")
      .select(cols)
      .is("parent_document_id", null)
      .gte("modified_date", rangeStartIso)
      .lt("modified_date", rangeEndIso)
      .limit(200),
    admin
      .from("supplier_documents")
      .select(cols)
      .is("parent_document_id", null)
      .in("status", ["failed", "parsing", "uploaded"])
      .limit(200),
  ]);

  if (createdRes.error) throw new Error(`Failed to fetch created docs: ${createdRes.error.message}`);
  if (modifiedRes.error) throw new Error(`Failed to fetch modified docs: ${modifiedRes.error.message}`);
  if (outstandingRes.error) throw new Error(`Failed to fetch outstanding docs: ${outstandingRes.error.message}`);

  const merged = new Map<string, Omit<DigestDocumentInput, "itemCount">>();
  for (const row of [
    ...(createdRes.data ?? []),
    ...(modifiedRes.data ?? []),
    ...(outstandingRes.data ?? []),
  ]) {
    const rec = row as Omit<DigestDocumentInput, "itemCount">;
    merged.set(rec.id, rec);
  }

  const docIds = [...merged.keys()];
  const itemCounts = new Map<string, number>();
  if (docIds.length > 0) {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: items, error: itemErr } = await admin
        .from("extraction_items")
        .select("document_id")
        .in("document_id", docIds)
        .range(from, from + pageSize - 1);
      if (itemErr) throw new Error(`Failed to count extraction items: ${itemErr.message}`);
      const batch = (items ?? []) as Array<{ document_id: string }>;
      for (const item of batch) {
        itemCounts.set(item.document_id, (itemCounts.get(item.document_id) ?? 0) + 1);
      }
      if (batch.length < pageSize) break;
    }
  }

  return [...merged.values()].map((doc) => ({
    ...doc,
    itemCount: itemCounts.get(doc.id) ?? 0,
  }));
}

async function fetchAsanaSyncRows(
  admin: SupabaseClient,
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<DigestAsanaSyncInput[]> {
  const { data, error } = await admin
    .from("fds_asana_attachment_sync")
    .select("status, skip_reason, doc_type, file_name, error_message")
    .gte("updated_at", rangeStartIso)
    .lt("updated_at", rangeEndIso)
    .limit(500);
  if (error) {
    console.warn("[send-document-parse-digest] asana sync query failed:", error.message);
    return [];
  }
  return (data ?? []) as DigestAsanaSyncInput[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const denied = await authorizeCaller(req, admin);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const dryRun = body.dry_run === true || body.preview === true;
  const force = body.force === true;
  const skipIdempotency = body.skip_idempotency === true;

  let recipients: string[];
  try {
    recipients = resolveRecipients(body.to);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Invalid recipients" },
      400,
    );
  }

  let range: ReturnType<typeof getDailyParseDigestRangeHk>;
  try {
    range = getDailyParseDigestRangeHk({
      reportDate: typeof body.report_date === "string" ? body.report_date : undefined,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Invalid report_date" },
      400,
    );
  }

  const [docs, asanaRows] = await Promise.all([
    fetchDigestDocuments(admin, range.rangeStartIso, range.rangeEndIso),
    fetchAsanaSyncRows(admin, range.rangeStartIso, range.rangeEndIso),
  ]);

  const summary = aggregateDocumentParseDigest(docs, asanaRows, range);
  const emailContent = buildDocumentParseDigestEmail(summary, {
    isTest: body.test === true,
  });

  if (dryRun) {
    return jsonResponse({
      ok: true,
      dry_run: true,
      report_date: summary.reportDate,
      recipients,
      has_activity: summary.hasActivity,
      subject: emailContent.subject,
      summary: {
        ...summary,
        documentsCount: summary.documents.length,
      },
      html: emailContent.html,
      text: emailContent.text,
    });
  }

  if (!summary.hasActivity && !force) {
    if (!skipIdempotency) {
      for (const recipient of recipients) {
        await admin.from("fds_document_parse_digest_runs").upsert(
          {
            report_date: summary.reportDate,
            recipient,
            status: "skipped_no_activity",
            docs_total: summary.totalDocs,
            docs_completed: summary.completedCount,
            docs_failed: summary.failedCount,
            items_extracted: summary.totalExtractedItems,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "report_date,recipient" },
        );
      }
    }
    return jsonResponse({
      ok: true,
      report_date: summary.reportDate,
      recipients,
      skipped: "no_activity",
    });
  }

  const results: Array<{
    recipient: string;
    status: "sent" | "skipped_already_sent" | "failed";
    provider?: string;
    provider_id?: string | null;
    error?: string;
  }> = [];

  for (const recipient of recipients) {
    if (!skipIdempotency && !force) {
      const { data: existingRun } = await admin
        .from("fds_document_parse_digest_runs")
        .select("status, provider, provider_id")
        .eq("report_date", summary.reportDate)
        .eq("recipient", recipient)
        .maybeSingle();

      if ((existingRun as { status?: string } | null)?.status === "sent") {
        results.push({
          recipient,
          status: "skipped_already_sent",
          provider: (existingRun as { provider?: string }).provider,
          provider_id: (existingRun as { provider_id?: string | null }).provider_id ?? null,
        });
        continue;
      }
    }

    if (!skipIdempotency) {
      await admin.from("fds_document_parse_digest_runs").upsert(
        {
          report_date: summary.reportDate,
          recipient,
          status: "pending",
          docs_total: summary.totalDocs,
          docs_completed: summary.completedCount,
          docs_failed: summary.failedCount,
          items_extracted: summary.totalExtractedItems,
          error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "report_date,recipient" },
      );
    }

    try {
      const sent = await sendEmail({
        to: [recipient],
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });

      if (!skipIdempotency) {
        await admin.from("fds_document_parse_digest_runs").upsert(
          {
            report_date: summary.reportDate,
            recipient,
            status: "sent",
            provider: sent.provider,
            provider_id: sent.id,
            docs_total: summary.totalDocs,
            docs_completed: summary.completedCount,
            docs_failed: summary.failedCount,
            items_extracted: summary.totalExtractedItems,
            error: null,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "report_date,recipient" },
        );
      }

      results.push({
        recipient,
        status: "sent",
        provider: sent.provider,
        provider_id: sent.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!skipIdempotency) {
        await admin.from("fds_document_parse_digest_runs").upsert(
          {
            report_date: summary.reportDate,
            recipient,
            status: "failed",
            docs_total: summary.totalDocs,
            docs_completed: summary.completedCount,
            docs_failed: summary.failedCount,
            items_extracted: summary.totalExtractedItems,
            error: msg.slice(0, 1000),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "report_date,recipient" },
        );
      }

      results.push({
        recipient,
        status: "failed",
        error: msg,
      });
    }
  }

  const allSucceeded = results.every((r) => r.status !== "failed");
  return jsonResponse(
    {
      ok: allSucceeded,
      report_date: summary.reportDate,
      recipients,
      subject: emailContent.subject,
      results,
    },
    allSucceeded ? 200 : 500,
  );
});
