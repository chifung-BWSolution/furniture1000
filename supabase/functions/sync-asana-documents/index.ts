import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";
import {
  buildAsanaStoragePath,
  decideAsanaAttachment,
  extractAsanaDocumentYear,
  selectLatestVersionPerYear,
  type AsanaAttachmentMeta,
} from "../_shared/asanaDocumentFilter.ts";

/**
 * FDS-26：Asana 供應商報價單與傢俬圖冊定時同步 worker。
 *
 * 每小時由 pg_cron (`fds-sync-asana-documents`) 觸發，或由 admin/uploader 手動針對單一廠家觸發：
 * 1. 讀取已啟用的 fds_asana_factory_link（按 attachments_synced_at 最舊優先）
 * 2. 列出每個廠家 Asana task 下的附件（只處理 host=asana 的 .pdf / .xlsx / .xls）
 * 3. 以 asana_attachment_gid 增量跳過已同步／永久略過的附件
 * 4. 下載附件並寫入私有 bucket supplier-documents（<=60MB 算 SHA-256 去重；60-200MB PDF 串流上傳交 needs_split）
 * 5. 呼叫 RPC fds_asana_document_ingest 建 supplier_documents (source='asana') 並排入 parse_pdf / needs_split / parse_excel
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CALLER_ROLES = ["admin", "uploader"];
const ASANA_BASE = "https://app.asana.com/api/1.0";
const BUCKET = "supplier-documents";
const MAX_RETRY_ATTEMPTS = 3;

type LinkRow = {
  id: string;
  factory_id: string;
  factory_name: string;
  asana_task_gid: string;
  enabled: boolean;
};

type TokenRecord = {
  auth_user_id?: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
  asana_user_gid?: string | null;
  asana_user_name?: string | null;
};

const TOKEN_COLUMNS = "auth_user_id,access_token,refresh_token,expires_at,asana_user_gid,asana_user_name";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient(): SupabaseClient {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorize(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== null) {
    const secret = workerSecret.trim();
    if (!secret) return json({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    if (error || data !== true) return json({ error: "Unauthorized" }, 401);
    return null;
  }
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (jwt && serviceKey && jwt === serviceKey) return null;
  if (!jwt || !url || !anonKey) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user?.id) return json({ error: "Unauthorized" }, 401);
  const { data: allowed, error: roleError } = await userClient.rpc("bwf_has_role", { p_roles: CALLER_ROLES });
  if (roleError || allowed !== true) return json({ error: "permission_denied" }, 403);
  return null;
}

async function asanaGet(token: string, path: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function refreshAsanaToken(
  refreshToken: string,
): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number } | null> {
  const clientId = Deno.env.get("ASANA_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("ASANA_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret || !refreshToken) return null;
  const res = await fetch("https://app.asana.com/-/oauth_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) return null;
  return body;
}

async function resolveStoredToken(admin: SupabaseClient, record: TokenRecord | null): Promise<string | null> {
  if (!record?.access_token) return null;
  const expiring = record.expires_at ? new Date(record.expires_at).getTime() < Date.now() + 60_000 : false;
  if (!expiring) return record.access_token;
  if (!record.refresh_token) return null;
  const refreshed = await refreshAsanaToken(record.refresh_token);
  if (!refreshed?.access_token) return null;
  if (record.auth_user_id) {
    await admin.rpc("fds_asana_oauth_save", {
      p_auth_user_id: record.auth_user_id,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token ?? record.refresh_token,
      p_expires_at: refreshed.expires_in
        ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
        : record.expires_at ?? null,
      p_asana_user_gid: record.asana_user_gid ?? null,
      p_asana_user_name: record.asana_user_name ?? null,
    });
  }
  return refreshed.access_token;
}

async function resolveAsanaTokens(req: Request, admin: SupabaseClient): Promise<string[]> {
  const patPrimary = (Deno.env.get("ASANA_ACCESS_TOKEN") ?? "").trim();
  const patSecondary = (Deno.env.get("ASANA_PAT") ?? "").trim();
  const ordered: string[] = [];
  const push = (t: string | null | undefined) => {
    const v = (t ?? "").trim();
    if (v && !ordered.includes(v)) ordered.push(v);
  };

  if (req.headers.get("x-worker-secret") === null) {
    const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
    if (jwt) {
      const { data: userData } = await admin.auth.getUser(jwt);
      if (userData.user?.id) {
        const { data: row } = await admin
          .from("fds_asana_oauth_tokens")
          .select(TOKEN_COLUMNS)
          .eq("auth_user_id", userData.user.id)
          .maybeSingle();
        push(await resolveStoredToken(admin, row as TokenRecord | null));
      }
    }
  }

  // ASANA_PAT (Branding Works Present) and ASANA_ACCESS_TOKEN both access Chi Fung Group BWFS.
  push(patSecondary);
  push(patPrimary);

  const { data: rows } = await admin
    .from("fds_asana_oauth_tokens")
    .select(TOKEN_COLUMNS)
    .not("access_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);
  for (const record of (rows ?? []) as TokenRecord[]) {
    push(await resolveStoredToken(admin, record));
  }
  return ordered;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadToStorage(input: {
  supabaseUrl: string;
  serviceKey: string;
  path: string;
  mimeType: string;
  body: Uint8Array | ReadableStream<Uint8Array>;
}): Promise<void> {
  const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${input.supabaseUrl}/storage/v1/object/${BUCKET}/${encodedPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.serviceKey}`,
      apikey: input.serviceKey,
      "Content-Type": input.mimeType,
      "x-upsert": "true",
    },
    body: input.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`storage_upload_${res.status}:${text.slice(0, 200)}`);
  }
  await res.body?.cancel();
}

async function listTaskAttachments(
  tokens: string[],
  taskGid: string,
): Promise<{ token: string; attachments: AsanaAttachmentMeta[] }> {
  let activeToken = tokens[0];
  let firstPage: { ok: boolean; status: number; body: unknown } | null = null;
  for (const candidate of tokens) {
    activeToken = candidate;
    firstPage = await asanaGet(
      candidate,
      `/tasks/${taskGid}/attachments?limit=100&opt_fields=gid,name,host,size,created_at`,
    );
    if (firstPage.ok || (firstPage.status !== 401 && firstPage.status !== 403)) break;
  }
  if (!firstPage?.ok) {
    throw new Error(`asana_attachments_${firstPage?.status ?? 0}`);
  }

  const all: AsanaAttachmentMeta[] = [];
  const seen = new Set<string>();
  const append = (rows: AsanaAttachmentMeta[]) => {
    for (const row of rows) {
      if (!row?.gid || seen.has(row.gid)) continue;
      seen.add(row.gid);
      all.push(row);
    }
  };

  append(((firstPage.body as { data?: AsanaAttachmentMeta[] })?.data ?? []));
  let offset = (firstPage.body as { next_page?: { offset?: string } | null })?.next_page?.offset ?? null;

  for (let page = 1; page < 5 && offset; page += 1) {
    const next = await asanaGet(
      activeToken,
      `/tasks/${taskGid}/attachments?limit=100&opt_fields=gid,name,host,size,created_at&offset=${encodeURIComponent(offset)}`,
    );
    if (!next.ok) break;
    append(((next.body as { data?: AsanaAttachmentMeta[] })?.data ?? []));
    offset = (next.body as { next_page?: { offset?: string } | null })?.next_page?.offset ?? null;
  }

  // Newest attachments first so backfill prioritizes recent quotations.
  all.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return { token: activeToken, attachments: all };
}

async function fetchPmsFactoryCodes(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const base = pmsProjectUrl();
  const key = pmsServiceRoleKey();
  if (!base || !key) return map;
  try {
    const res = await fetch(`${base}/rest/v1/factories?select=id,factory_code&factory_code=not.is.null&limit=1000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return map;
    const rows = (await res.json().catch(() => [])) as Array<{ id?: string; factory_code?: string }>;
    for (const r of rows) {
      const id = String(r.id ?? "").trim();
      const code = String(r.factory_code ?? "").trim().toUpperCase();
      if (id && code) map.set(id, code);
    }
  } catch {
    // Non-fatal: falls back to link factory_id / name extraction.
  }
  return map;
}

function inferFactoryCode(factoryId: string, factoryName: string, pmsCodes: Map<string, string>): string | null {
  const fromPms = pmsCodes.get(factoryId);
  if (fromPms) return fromPms;
  // Fallback: extract uppercase code token such as "PSLH", "PBD", "MA03", "VOLAB" from factory_name.
  const match = factoryName.match(/\b([A-Z]{2,6}\d{0,3})\b/);
  return match ? match[1] : null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  let admin: SupabaseClient;
  try {
    admin = adminClient();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Server misconfigured" }, 500);
  }

  const denied = await authorize(req, admin);
  if (denied) return denied;

  const tokens = await resolveAsanaTokens(req, admin);
  if (tokens.length === 0) return json({ error: "asana_not_configured" }, 503);

  let body: { link_id?: string; factory_limit?: number; files_per_factory?: number; since?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const factoryLimit = Math.min(Math.max(Number(body.factory_limit) || 10, 1), 25);
  const filesPerFactory = Math.min(Math.max(Number(body.files_per_factory) || 3, 1), 10);
  const sinceIso = typeof body.since === "string" && body.since.trim() ? body.since.trim() : null;

  let linkQuery = admin
    .from("fds_asana_factory_link")
    .select("id, factory_id, factory_name, asana_task_gid, enabled")
    .eq("enabled", true)
    .order("attachments_synced_at", { ascending: true, nullsFirst: true })
    .limit(factoryLimit);
  if (body.link_id) {
    linkQuery = linkQuery.eq("id", body.link_id);
  }

  const { data: links, error: linkErr } = await linkQuery;
  if (linkErr) return json({ error: linkErr.message }, 500);

  const pmsFactoryCodes = await fetchPmsFactoryCodes();

  const summary: Array<{
    link_id: string;
    factory: string;
    task_gid: string;
    scanned: number;
    synced: number;
    duplicates: number;
    skipped: number;
    failed: number;
    error?: string;
  }> = [];

  for (const link of (links ?? []) as LinkRow[]) {
    const stat = {
      link_id: link.id,
      factory: link.factory_name,
      task_gid: link.asana_task_gid,
      scanned: 0,
      synced: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      const { token, attachments } = await listTaskAttachments(tokens, link.asana_task_gid);
      stat.scanned = attachments.length;

      // Load existing sync records for this factory link to skip already-processed attachments.
      const { data: existingRows } = await admin
        .from("fds_asana_attachment_sync")
        .select("asana_attachment_gid, status, attempts")
        .eq("link_id", link.id);
      const existingByGid = new Map<string, { status: string; attempts: number }>();
      for (const r of (existingRows ?? []) as Array<{ asana_attachment_gid: string; status: string; attempts: number }>) {
        existingByGid.set(r.asana_attachment_gid, { status: r.status, attempts: r.attempts });
      }

      let downloadedThisFactory = 0;

      // First pass: decide each attachment and group syncable ones by (docType, year)
      // so same-factory, same-year multiple versions keep ONLY the latest version.
      const syncCandidates: Array<{
        att: AsanaAttachmentMeta;
        docType: "quote" | "catalog";
        year: number;
        decision: Extract<ReturnType<typeof decideAsanaAttachment>, { action: "sync" }>;
      }> = [];

      for (const att of attachments) {
        if (sinceIso && att.created_at && att.created_at < sinceIso) continue;
        const decision = decideAsanaAttachment(att);
        if (decision.action === "ignore") continue;

        const year = extractAsanaDocumentYear(att.name, att.created_at);
        if (decision.action === "skip") {
          const prev = existingByGid.get(att.gid);
          if (!prev || (prev.status !== "synced" && prev.status !== "skipped")) {
            await admin.rpc("fds_asana_attachment_mark", {
              p_link_id: link.id,
              p_factory_id: link.factory_id,
              p_asana_task_gid: link.asana_task_gid,
              p_asana_attachment_gid: att.gid,
              p_file_name: att.name ?? att.gid,
              p_file_ext: decision.ext,
              p_file_size: att.size ?? null,
              p_doc_type: decision.docType,
              p_remote_created_at: att.created_at ?? null,
              p_status: "skipped",
              p_skip_reason: decision.reason,
              p_error: null,
              p_document_year: year,
            });
            stat.skipped += 1;
          }
          continue;
        }
        syncCandidates.push({ att, docType: decision.docType, year, decision });
      }

      const { latest, superseded } = selectLatestVersionPerYear(syncCandidates);

      // Mark older same-year versions as skipped without downloading or parsing them.
      for (const oldItem of superseded) {
        const prev = existingByGid.get(oldItem.att.gid);
        if (prev && prev.status === "skipped") continue;
        await admin.rpc("fds_asana_attachment_mark", {
          p_link_id: link.id,
          p_factory_id: link.factory_id,
          p_asana_task_gid: link.asana_task_gid,
          p_asana_attachment_gid: oldItem.att.gid,
          p_file_name: oldItem.att.name ?? oldItem.att.gid,
          p_file_ext: oldItem.decision.ext,
          p_file_size: oldItem.att.size ?? null,
          p_doc_type: oldItem.docType,
          p_remote_created_at: oldItem.att.created_at ?? null,
          p_status: "skipped",
          p_skip_reason: "superseded_by_newer_version",
          p_error: null,
          p_document_year: oldItem.year,
        });
        stat.skipped += 1;
      }

      for (const item of latest) {
        if (downloadedThisFactory >= filesPerFactory) break;
        const { att, decision, year } = item;

        const prev = existingByGid.get(att.gid);
        if (prev && (prev.status === "synced" || prev.status === "skipped")) continue;
        if (prev && prev.status === "failed" && prev.attempts >= MAX_RETRY_ATTEMPTS) continue;

        try {
          // Fetch a fresh download_url right before downloading (Asana presigned URLs expire quickly).
          const detail = await asanaGet(token, `/attachments/${att.gid}?opt_fields=gid,name,size,download_url,created_at`);
          if (!detail.ok) throw new Error(`asana_attachment_detail_${detail.status}`);
          const detailData = (detail.body as { data?: AsanaAttachmentMeta })?.data;
          const downloadUrl = detailData?.download_url ?? "";
          if (!downloadUrl) throw new Error("asana_download_url_missing");

          const fileRes = await fetch(downloadUrl);
          if (!fileRes.ok || !fileRes.body) throw new Error(`asana_download_${fileRes.status}`);

          let contentHash: string | null = null;
          let storagePath: string;
          let actualSize = Number(detailData?.size ?? att.size ?? 0) || null;

          if (decision.streamUpload) {
            storagePath = buildAsanaStoragePath({
              factoryId: link.factory_id,
              docType: decision.docType,
              ext: decision.ext,
              contentHash: null,
              attachmentGid: att.gid,
            });
            await uploadToStorage({
              supabaseUrl,
              serviceKey,
              path: storagePath,
              mimeType: decision.mimeType,
              body: fileRes.body,
            });
          } else {
            const bytes = new Uint8Array(await fileRes.arrayBuffer());
            actualSize = bytes.byteLength;
            contentHash = await sha256Hex(bytes);
            storagePath = buildAsanaStoragePath({
              factoryId: link.factory_id,
              docType: decision.docType,
              ext: decision.ext,
              contentHash,
              attachmentGid: att.gid,
            });
            await uploadToStorage({
              supabaseUrl,
              serviceKey,
              path: storagePath,
              mimeType: decision.mimeType,
              body: bytes,
            });
          }

          const factoryCode = inferFactoryCode(link.factory_id, link.factory_name, pmsFactoryCodes);
          const { data: ingested, error: ingestErr } = await admin.rpc("fds_asana_document_ingest", {
            p_link_id: link.id,
            p_factory_id: link.factory_id,
            p_factory_name: link.factory_name,
            p_asana_task_gid: link.asana_task_gid,
            p_asana_attachment_gid: att.gid,
            p_file_name: detailData?.name ?? att.name ?? `${att.gid}.${decision.ext}`,
            p_file_ext: decision.ext,
            p_storage_path: storagePath,
            p_file_size: actualSize,
            p_content_hash: contentHash,
            p_doc_type: decision.docType,
            p_remote_created_at: detailData?.created_at ?? att.created_at ?? null,
            p_document_year: year,
            p_factory_code: factoryCode,
          });
          if (ingestErr) throw new Error(`ingest_${ingestErr.message}`);

          downloadedThisFactory += 1;
          if ((ingested as { duplicate?: boolean } | null)?.duplicate) {
            stat.duplicates += 1;
          } else {
            stat.synced += 1;
          }
        } catch (attError) {
          const msg = attError instanceof Error ? attError.message : String(attError);
          console.warn(`[sync-asana-documents] attachment ${att.gid} failed:`, msg);
          await admin.rpc("fds_asana_attachment_mark", {
            p_link_id: link.id,
            p_factory_id: link.factory_id,
            p_asana_task_gid: link.asana_task_gid,
            p_asana_attachment_gid: att.gid,
            p_file_name: att.name ?? att.gid,
            p_file_ext: decision.ext,
            p_file_size: att.size ?? null,
            p_doc_type: decision.docType,
            p_remote_created_at: att.created_at ?? null,
            p_status: "failed",
            p_skip_reason: null,
            p_error: msg,
            p_document_year: year,
          });
          stat.failed += 1;
        }
      }

      await admin
        .from("fds_asana_factory_link")
        .update({ attachments_synced_at: new Date().toISOString() })
        .eq("id", link.id);

      summary.push(stat);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[sync-asana-documents] link ${link.id} (${link.factory_name}) error:`, msg);
      await admin
        .from("fds_asana_factory_link")
        .update({ attachments_synced_at: new Date().toISOString() })
        .eq("id", link.id);
      summary.push({ ...stat, error: msg });
    }
  }

  return json({
    ok: true,
    processed: summary.length,
    totals: {
      synced: summary.reduce((s, r) => s + r.synced, 0),
      duplicates: summary.reduce((s, r) => s + r.duplicates, 0),
      skipped: summary.reduce((s, r) => s + r.skipped, 0),
      failed: summary.reduce((s, r) => s + r.failed, 0),
    },
    results: summary,
  });
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-asana-documents]", error);
    return json({ error: message }, 500);
  }
});
