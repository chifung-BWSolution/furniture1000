import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildGenerationRequest,
  CREDIT_QUOTA_MESSAGE,
  DESIGN_GENERATION_MISSING_MESSAGE,
  GENERATION_SCOPES,
  missingScopes,
  PRODUCT_SELECT_COLUMNS,
  RECONNECT_PROFILE_MESSAGE,
  type ProductRow,
} from "./generation.ts";
import {
  exportFormatBody,
  pickDownloadUrl,
  type CanvaExportFormat,
  type CanvaExportJob,
} from "./exports.ts";

/**
 * FDS 2.1 Day 9 — Canva PPT（T-901，F-AI-009）
 *
 * 決議：使用 chifung.login 帳戶；OAuth Authorization-Code + PKCE；
 * 未取得有效權限不得使用他人 Canva 資料（design:content:write 綁定該授權使用者）。
 *
 * actions（JSON body）：
 * - status      → { configured, client_id?, connected, account_name?, expires_at? }
 * - exchange    → { code, code_verifier, redirect_uri } 換 token 並存 canva_connections
 * - disconnect  → 刪掉本人授權
 * - import      → （舊版）Design Imports PPTX
 * - probe       → PoC：檢查 scope／連線
 * - save_draft  → { brief, product_ids?, session_id?, parent_id? }
 * - generation_status → { session_id } read Canva job and persist current status
 * - create_native → { session_id } Canva AI design generation（POST /generations）
 * - export_pptx / export_pdf / export_design → { session_id, format? } Canva export + 審計列（T-903）
 *
 * Secrets：CANVA_CLIENT_ID、CANVA_CLIENT_SECRET、CANVA_BASE_URL（可選，
 * 預設 https://api.canva.com/rest/v1）。token 只能在 canva_connections
 * （無 RLS policy → 僅 service role）與本 function 內出現。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IMPORT_ROLES = ["admin", "uploader"]; // 決議：共用 chifung.login 帳戶的匯入只給這兩個角色
const API_BASE = (Deno.env.get("CANVA_BASE_URL") ?? "https://api.canva.com/rest/v1").replace(/\/$/, "");
const POLL_INTERVAL_MS = 3000;
const POLL_BUDGET_MS = 105_000; // leave headroom below the 150s edge wall clock

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SESSION_ERROR_MAX = 1500;

function clipCanvaError(text: string, fallback: string): string {
  const body = text.replace(/\s+/g, " ").trim() || fallback;
  return body.length > SESSION_ERROR_MAX ? body.slice(0, SESSION_ERROR_MAX) : body;
}

function logCanvaFailure(label: string, status: number | undefined, body: string): void {
  console.error(label, status ?? "", body.slice(0, SESSION_ERROR_MAX));
}

function missingExportScopes(scope: string | null | undefined): string[] {
  return missingScopes(scope, ["design:content:read"]);
}

async function fetchDesignGeneration(
  accessToken: string,
  on401?: () => Promise<string | null>,
): Promise<{ ok: true; raw: string } | { ok: false; status: number; message: string; raw: string }> {
  let token = accessToken;
  let res = await canvaAuthedFetch(token, "/users/me/capabilities");
  if (res.status === 401 && on401) {
    const next = await on401();
    if (next) {
      token = next;
      res = await canvaAuthedFetch(token, "/users/me/capabilities");
    }
  }
  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    logCanvaFailure("canva capabilities failed", res.status, raw);
    return { ok: false, status: res.status, message: clipCanvaError(raw, `capabilities_${res.status}`), raw };
  }
  let capabilities: string[] = [];
  try {
    const body = JSON.parse(raw) as { capabilities?: string[] };
    capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  } catch {
    return { ok: false, status: res.status, message: "無法讀取 Canva 帳戶能力。", raw };
  }
  if (!capabilities.includes("design_generation")) {
    return { ok: false, status: 403, message: DESIGN_GENERATION_MISSING_MESSAGE, raw };
  }
  return { ok: true, raw };
}

async function pollCanvaJob<T>(
  accessToken: string,
  path: string,
  isDone: (job: T | null) => boolean,
  on401?: () => Promise<string | null>,
): Promise<T | null> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  let token = accessToken;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await canvaAuthedFetch(token, path);
    if (poll.status === 401 && on401) {
      const next = await on401();
      if (next) token = next;
      continue;
    }
    if (!poll.ok) continue;
    const body = await poll.json();
    const job = (body?.job ?? body) as T;
    if (isDone(job)) return job;
  }
  return null;
}

async function loadProductsForSession(
  service: ReturnType<typeof createClient>,
  productIds: string[],
): Promise<{ products: ProductRow[]; error?: string }> {
  if (productIds.length === 0) return { products: [] };
  const { data, error } = await service
    .from("products")
    .select(PRODUCT_SELECT_COLUMNS)
    .in("id", productIds.slice(0, 50));
  if (error || !data) {
    console.error(
      "loadProductsForSession failed",
      error?.code,
      error?.message,
      error?.details,
      error?.hint,
    );
    return { products: [], error: error?.message ?? "products_query_failed" };
  }
  const byId = new Map((data as ProductRow[]).map((product) => [product.id, product]));
  return {
    products: productIds.map((id) => byId.get(id)).filter(Boolean) as ProductRow[],
  };
}

function canvaApiUrl(path: string): string {
  if (!path.startsWith("/") || path.includes("..") || path.includes("\\") || path.includes("://")) {
    throw new Error("invalid_canva_path");
  }
  return `${API_BASE}${path}`;
}

async function canvaAuthedFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = canvaApiUrl(path);
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}


interface TokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  account_name: string | null;
}

/** OAuth redirect must come back to this app's presentation page. */
function allowedCanvaRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const path = url.pathname.replace(/\/$/, "");
  if (path !== "/fds/pm/presentation") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

function basicCredentials(): string | null {
  const id = Deno.env.get("CANVA_CLIENT_ID") ?? "";
  const secret = Deno.env.get("CANVA_CLIENT_SECRET") ?? "";
  if (!id || !secret) return null;
  return btoa(`${id}:${secret}`);
}

async function tokenRequest(
  credentials: string,
  grantType: string,
  params: Record<string, string>,
): Promise<{
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}> {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: grantType, ...params }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: body?.error ?? `token_http_${res.status}`, error_description: body?.error_description };
  return body;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const action = String(body.action ?? "");

  const credentials = basicCredentials();
  const clientId = Deno.env.get("CANVA_CLIENT_ID") ?? "";

  // ── status：任何有 PMS SSO 登入的職員都可看（設定 UI 需要 client_id） ──
  if (action === "status") {
    const { data } = await service
      .from("canva_connections")
      .select("access_token,refresh_token,expires_at,scope,account_name,connected_at")
      .eq("staff_id", userId)
      .maybeSingle();
    return json({
      configured: Boolean(clientId),
      client_id: clientId || undefined,
      connected: Boolean(data?.access_token),
      account_name: (data as TokenRow | null)?.account_name ?? null,
      scope: (data as TokenRow | null)?.scope ?? null,
      expires_at: (data as TokenRow | null)?.expires_at ?? null,
    });
  }

  const { data: canImport } = await userClient.rpc("bwf_has_role", { p_roles: IMPORT_ROLES });
  if (!canImport) return json({ error: "permission_denied" }, 403);

  // ── exchange：PKCE code → token ─────────────────────────────────────
  if (action === "exchange") {
    if (!credentials) return json({ error: "canva_not_configured" }, 500);
    const code = String(body.code ?? "");
    const verifier = String(body.code_verifier ?? "");
    const redirectUri = String(body.redirect_uri ?? "");
    if (!code || !verifier || !redirectUri) return json({ error: "invalid_request" }, 400);
    if (!allowedCanvaRedirect(redirectUri)) return json({ error: "redirect_uri_rejected" }, 400);
    const token = await tokenRequest(credentials, "authorization_code", {
      code, code_verifier: verifier, redirect_uri: redirectUri,
    });
    if (!token.access_token) {
      return json({ error: token.error ?? "token_failed", description: token.error_description ?? null }, 400);
    }
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
    // account_name 只在 profile:read 有 scope 時拿（拿不到也不擋）
    let accountName: string | null = null;
    try {
      const me = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (me.ok) {
        const meJson = await me.json();
        accountName = [meJson?.profile?.given_name, meJson?.profile?.family_name]
          .filter(Boolean)
          .join(" ") || meJson?.profile?.display_name || null;
      }
    } catch {
      /* non-fatal */
    }
    const { error: upsertErr } = await service.from("canva_connections").upsert({
      staff_id: userId,
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      expires_at: expiresAt,
      scope: token.scope ?? null,
      account_name: accountName,
      updated_at: new Date().toISOString(),
    });
    if (upsertErr) return json({ error: upsertErr.message }, 500);
    return json({
      connected: true,
      account_name: accountName,
      expires_at: expiresAt,
    });
  }

  // ── disconnect ──────────────────────────────────────────────────────
  if (action === "disconnect") {
    await service.from("canva_connections").delete().eq("staff_id", userId);
    return json({ connected: false });
  }

  // ── import：Design Imports（PptxGenJS 產物 → 可編輯 Canva 設計） ─────
  if (action === "import") {
    if (!credentials) return json({ error: "canva_not_configured" }, 500);
    const base64 = String(body.pptx_base64 ?? "").replace(/\s/g, "");
    if (!base64) return json({ error: "pptx_required" }, 400);
    const fileName = String(body.file_name ?? "product-briefing.pptx").slice(0, 48);
    const titleRaw = String(body.title ?? fileName.replace(/\.pptx$/i, ""));
    // 規範：title_base64，最長 50 字（未解碼長度）
    const title = titleRaw.length > 50 ? titleRaw.slice(0, 50) : titleRaw;
    const productIds = Array.isArray(body.product_ids)
      ? (body.product_ids as unknown[]).map(String).slice(0, 50)
      : [];

    const row = await loadAndRefreshToken(service, userId, credentials);
    if ("error" in row) return json({ error: row.error }, 401);

    const importMeta = {
      title_base64: btoa(String.fromCharCode(...new TextEncoder().encode(title))),
      mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    let res = await fetch(`${API_BASE}/imports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${row.access_token}`,
        "Content-Type": "application/octet-stream",
        "Import-Metadata": JSON.stringify(importMeta),
      },
      body: bin,
    });
    if (res.status === 401) {
      const refreshed = await refreshToken(service, userId, credentials, row.refresh_token);
      if (refreshed) {
        row.access_token = refreshed.access_token;
        res = await fetch(`${API_BASE}/imports`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${row.access_token}`,
            "Content-Type": "application/octet-stream",
            "Import-Metadata": JSON.stringify(importMeta),
          },
          body: bin,
        });
      }
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ error: `canva_import_failed_${res.status}`, detail: detail.slice(0, 500) }, 502);
    }
    const created = (await res.json())?.job as { id: string; status: string } | undefined;
    if (!created?.id) return json({ error: "canva_import_no_job" }, 502);

    // 輪詢至 success / failed（時間預算內）
    const deadline = Date.now() + POLL_BUDGET_MS;
    let job: { status?: string; result?: { designs?: { id: string; title?: string; urls?: { edit_url?: string; view_url?: string } }[] }; error?: { code: string; message: string } } | null = null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const poll = await fetch(`${API_BASE}/imports/${created.id}`, {
        headers: { Authorization: `Bearer ${row.access_token}` },
      });
      if (poll.status === 401) {
        const refreshed = await refreshToken(service, userId, credentials, row.refresh_token);
        if (!refreshed) return json({ error: "canva_token_expired" }, 401);
        row.access_token = refreshed.access_token;
        continue;
      }
      if (!poll.ok) continue;
      job = (await poll.json())?.job ?? null;
      if (job?.status !== "in_progress") break;
    }
    if (!job) return json({ error: "canva_import_timeout", job_id: created.id }, 504);
    if (job.status === "failed") {
      return json({ error: "canva_import_rejected", detail: job.error?.message ?? job.error?.code ?? null }, 502);
    }
    const design = job.result?.designs?.[0];
    if (!design?.id) return json({ error: "canva_import_no_design" }, 502);

    await service.from("canva_imports").insert({
      staff_id: userId,
      design_id: design.id,
      title: design.title ?? title,
      file_name: fileName,
      product_ids: productIds,
      edit_url: design.urls?.edit_url ?? null,
    });
    const { data: historyRows } = await service
      .from("canva_imports")
      .select("design_id,title,edit_url,created_at")
      .eq("staff_id", userId)
      .order("created_at", { ascending: false })
      .limit(8);

    return json({
      design_id: design.id,
      title: design.title ?? title,
      edit_url: design.urls?.edit_url ?? null,
      view_url: design.urls?.view_url ?? null,
      history: historyRows ?? [],
    });
  }

  if (!credentials) return json({ error: "canva_not_configured" }, 500);

  // ── probe：連線、scope，以及 design_generation capability ──────────
  if (action === "probe") {
    const { data: conn } = await service
      .from("canva_connections")
      .select("scope,account_name,expires_at")
      .eq("staff_id", userId)
      .maybeSingle();
    const scopeStr = (conn as { scope?: string } | null)?.scope ?? null;
    const miss = missingScopes(scopeStr, GENERATION_SCOPES);
    const connected = Boolean(conn);
    let designGeneration = false;
    let capabilityError = "";
    if (connected && !miss.includes("profile:read") && !miss.includes("design:content:write")) {
      const tokenRow = await loadAndRefreshToken(service, userId, credentials);
      if (!("error" in tokenRow)) {
        const capability = await fetchDesignGeneration(tokenRow.access_token, async () => {
          const refreshed = await refreshToken(service, userId, credentials, tokenRow.refresh_token);
          return refreshed?.access_token ?? null;
        });
        designGeneration = capability.ok;
        if (!capability.ok) capabilityError = capability.message;
      }
    }
    const ready = connected && miss.length === 0 && designGeneration;
    return json({
      ok: ready,
      connected,
      account_name: (conn as { account_name?: string } | null)?.account_name ?? null,
      scopes: scopeStr,
      missing_scopes: miss,
      design_generation: designGeneration,
      message:
        !connected
          ? "請先連接 Canva。"
          : miss.includes("profile:read")
            ? RECONNECT_PROFILE_MESSAGE
            : miss.length > 0
              ? `請解除連接後重新連接 Canva。缺少授權：${miss.join(", ")}。`
              : capabilityError || (designGeneration ? "可以 AI 生成簡報。" : DESIGN_GENERATION_MISSING_MESSAGE),
    });
  }

  // ── save_draft ────────────────────────────────────────────────────
  if (action === "save_draft") {
    const brief = (body.brief && typeof body.brief === "object" ? body.brief : {}) as Record<string, unknown>;
    const productIds = Array.isArray(body.product_ids)
      ? (body.product_ids as unknown[]).map(String).slice(0, 50)
      : [];
    const sessionId = body.session_id ? String(body.session_id) : null;
    const parentId = body.parent_id ? String(body.parent_id) : null;
    const versionNote = body.version_note != null ? String(body.version_note).slice(0, 500) : null;
    const now = new Date().toISOString();
    if (sessionId) {
      const { data: existing } = await service
        .from("canva_design_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("staff_id", userId)
        .maybeSingle();
      if (!existing?.id) return json({ error: "session_not_found" }, 404);
      const patch: Record<string, unknown> = {
        brief,
        product_ids: productIds,
        updated_at: now,
      };
      if (versionNote != null) patch.version_note = versionNote;
      const { data: saved, error: updErr } = await service.from("canva_design_sessions")
        .update(patch).eq("id", sessionId).eq("staff_id", userId)
        .neq("status", "creating").select("id").maybeSingle();
      if (!updErr && !saved) return json({ error: "create_in_progress", message: "Canva 任務進行中，請等待完成後再儲存。" }, 409);
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ session_id: sessionId });
    }

    let rootId: string | null = null;
    let contentVersion = 1;
    if (parentId) {
      const { data: parent } = await service
        .from("canva_design_sessions")
        .select("id,root_id,content_version")
        .eq("id", parentId)
        .eq("staff_id", userId)
        .maybeSingle();
      if (!parent?.id) return json({ error: "parent_not_found" }, 404);
      rootId = (parent.root_id as string | null) ?? parent.id;
    }

    let inserted: { id: string } | null = null;
    let insErr: { message: string; code?: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (rootId) {
        const { data: siblings, error: sibErr } = await service
          .from("canva_design_sessions")
          .select("content_version")
          .eq("root_id", rootId);
        if (sibErr) return json({ error: sibErr.message }, 500);
        const maxV = (siblings ?? []).reduce(
          (m, r) => Math.max(m, Number((r as { content_version?: number }).content_version ?? 1)),
          1,
        );
        contentVersion = maxV + 1;
      }
      const result = await service
        .from("canva_design_sessions")
        .insert({
          staff_id: userId,
          parent_id: parentId,
          root_id: rootId,
          content_version: contentVersion,
          version_note: versionNote,
          status: "draft",
          brief,
          product_ids: productIds,
          updated_at: now,
        })
        .select("id")
        .single();
      if (!result.error && result.data?.id) {
        inserted = { id: String(result.data.id) };
        insErr = null;
        break;
      }
      insErr = {
        message: result.error?.message ?? "insert_failed",
        code: result.error?.code,
      };
      const conflict = rootId != null && insErr.code === "23505";
      if (!conflict || attempt === 4) break;
    }
    if (insErr || !inserted) return json({ error: insErr?.message ?? "insert_failed" }, 500);
    const newId = inserted.id as string;
    if (!parentId) {
      await service.from("canva_design_sessions").update({ root_id: newId }).eq("id", newId);
    }
    return json({ session_id: newId, content_version: contentVersion, root_id: rootId ?? newId });
  }

  // Observe the existing task: never start or retry a paid Canva generation here.
  if (action === "generation_status") {
    const { data: session, error } = await service.from("canva_design_sessions")
      .select("*").eq("id", String(body.session_id ?? "")).eq("staff_id", userId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!session) return json({ error: "session_not_found" }, 404);
    if (session.canva_design_id && session.status !== "creating") {
      const tokenRow = await loadAndRefreshToken(service, userId, credentials);
      if ("error" in tokenRow) return json({ ...session, thumbnail_url: null });
      const path = `/designs/${encodeURIComponent(session.canva_design_id)}`;
      let response = await canvaAuthedFetch(tokenRow.access_token, path);
      if (response.status === 401 && tokenRow.refresh_token) {
        const next = await refreshToken(service, userId, credentials, tokenRow.refresh_token);
        if (next) response = await canvaAuthedFetch(next.access_token, path);
      }
      const metadata = response.ok ? await response.json() : null;
      // Signed URLs are ephemeral: return a fresh URL without persisting it or
      // changing the session's updated_at / recent-design ordering.
      return json({ ...session, thumbnail_url: metadata?.design?.thumbnail?.url ?? null });
    }
    if (session.status !== "creating" || !session.populate_report?.generation_job_id) return json(session);
    const tokenRow = await loadAndRefreshToken(service, userId, credentials);
    if ("error" in tokenRow) return json({ error: tokenRow.error }, 401);
    const jobId = String(session.populate_report.generation_job_id);
    const path = `/generations/${encodeURIComponent(jobId)}`;
    let response = await canvaAuthedFetch(tokenRow.access_token, path);
    if (response.status === 401 && tokenRow.refresh_token) {
      const next = await refreshToken(service, userId, credentials, tokenRow.refresh_token);
      if (next) response = await canvaAuthedFetch(next.access_token, path);
    }
    if (!response.ok) {
      const detail = clipCanvaError(await response.text(), `canva_status_${response.status}`);
      return json({ error: "canva_status_unavailable", message: detail }, 502);
    }
    const jobBody = await response.json();
    const job = jobBody?.job ?? jobBody;
    const report = {
      ...session.populate_report,
      generation_status: job.status ?? "unknown",
      generation_checked_at: new Date().toISOString(),
    };
    const patch: Record<string, unknown> = { populate_report: report, updated_at: new Date().toISOString() };
    if (job.status === "failed") {
      patch.status = "failed";
      patch.error = clipCanvaError(job.error?.message || job.error?.code || "Canva 生成失敗", "canva_generation_failed");
    } else if (job.status === "success") {
      const design = job.result?.design;
      if (!design?.id) {
        patch.status = "failed";
        patch.error = "Canva 生成完成但沒有設計。";
      } else {
        Object.assign(patch, {
          status: "ready", generation_mode: "ai", brand_template_id: null,
          canva_design_id: design.id,
          edit_url: design.urls?.edit_url ?? design.url ?? null,
          view_url: design.urls?.view_url ?? null,
          thumbnail_url: design.thumbnail?.url ?? null,
          error: null,
        });
      }
    }
    // Concurrent status reads cannot overwrite a terminal result with an older response.
    const { data: updated, error: updateError } = await service.from("canva_design_sessions")
      .update(patch).eq("id", session.id).eq("staff_id", userId).eq("status", "creating")
      .select("*").maybeSingle();
    if (updateError) return json({ error: updateError.message }, 500);
    if (updated) return json(updated);
    const { data: current, error: readError } = await service.from("canva_design_sessions")
      .select("*").eq("id", session.id).eq("staff_id", userId).maybeSingle();
    if (readError) return json({ error: readError.message }, 500);
    return current ? json(current) : json({ error: "session_not_found" }, 404);
  }

  if (action === "design_pages") {
    const { data: session, error } = await service.from("canva_design_sessions")
      .select("id, canva_design_id")
      .eq("id", String(body.session_id ?? ""))
      .eq("staff_id", userId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!session) return json({ error: "session_not_found" }, 404);
    if (!session.canva_design_id) return json({ pages: [] });
    const tokenRow = await loadAndRefreshToken(service, userId, credentials);
    if ("error" in tokenRow) return json({ error: tokenRow.error }, 401);
    const path = `/designs/${encodeURIComponent(session.canva_design_id)}/pages?offset=1&limit=200`;
    let response = await canvaAuthedFetch(tokenRow.access_token, path);
    if (response.status === 401 && tokenRow.refresh_token) {
      const next = await refreshToken(service, userId, credentials, tokenRow.refresh_token);
      if (next) response = await canvaAuthedFetch(next.access_token, path);
    }
    if (!response.ok) {
      const detail = clipCanvaError(await response.text(), `canva_pages_${response.status}`);
      return json({ error: "canva_pages_unavailable", message: detail }, 502);
    }
    const listed = await response.json();
    const items = Array.isArray(listed?.items) ? listed.items : [];
    const pages = items.map((item: { page_number?: number; index?: number; thumbnail?: { url?: string } }, i: number) => {
      const raw = Number(item.page_number ?? item.index);
      const page = Number.isFinite(raw) && raw >= 1 ? raw : i + 1;
      const url = item.thumbnail?.url;
      return { page, thumbnail_url: typeof url === "string" && url.startsWith("https://") ? url : null };
    }).sort((a: { page: number }, b: { page: number }) => a.page - b.page);
    return json({ pages });
  }

  // ── create_native：Canva AI design generation（POST /generations）──
  if (action === "create_native") {
    const sessionId = String(body.session_id ?? "");
    if (!sessionId) return json({ error: "session_id_required" }, 400);
    const { data: session, error: sessErr } = await service
      .from("canva_design_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("staff_id", userId)
      .maybeSingle();
    if (sessErr) return json({ error: sessErr.message }, 500);
    if (!session) return json({ error: "session_not_found" }, 404);

    if (session.status === "creating") {
      // A repeated click must observe the existing task, never create a second paid job.
      return json(session);
    }
    if (session.canva_design_id) {
      return json({
        error: "design_already_exists",
        message: "此草稿已有 Canva 設計；請用「新版本」建立另一條設計鏈，勿覆蓋 Canva 內修改。",
        edit_url: session.edit_url,
        session_id: sessionId,
      }, 409);
    }

    const { data: connScope } = await service
      .from("canva_connections")
      .select("scope")
      .eq("staff_id", userId)
      .maybeSingle();
    const scopeStr = (connScope as { scope?: string } | null)?.scope ?? null;
    const miss = missingScopes(scopeStr, GENERATION_SCOPES);
    if (miss.includes("design:content:write") || miss.includes("profile:read")) {
      const message = miss.includes("profile:read")
        ? RECONNECT_PROFILE_MESSAGE
        : "目前的 Canva 授權缺少 design:content:write。請解除連接後重新連接 Canva。";
      return json({ error: "missing_scope", message, missing_scopes: miss }, 403);
    }

    const tokenRow = await loadAndRefreshToken(service, userId, credentials);
    if ("error" in tokenRow) return json({ error: tokenRow.error }, 401);

    const on401 = async () => {
      const refreshed = await refreshToken(service, userId, credentials, tokenRow.refresh_token);
      if (refreshed) {
        tokenRow.access_token = refreshed.access_token;
        return refreshed.access_token;
      }
      return null;
    };

    const { data: claimed, error: claimErr } = await service
      .from("canva_design_sessions")
      .update({ status: "creating", error: null, populate_report: null, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("staff_id", userId)
      .is("canva_design_id", null)
      .neq("status", "creating")
      .select("*")
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      const { data: current } = await service
        .from("canva_design_sessions")
        .select("canva_design_id,edit_url")
        .eq("id", sessionId)
        .eq("staff_id", userId)
        .maybeSingle();
      if (current?.canva_design_id) {
        return json({
          error: "design_already_exists",
          message: "此草稿已有 Canva 設計；請用「新版本」建立另一條設計鏈，勿覆蓋 Canva 內修改。",
          edit_url: current.edit_url,
          session_id: sessionId,
        }, 409);
      }
      return json({ error: "create_in_progress" }, 409);
    }

    const brief = (claimed.brief ?? {}) as Record<string, unknown>;
    const loaded = await loadProductsForSession(service, (claimed.product_ids ?? []) as string[]);
    const request = buildGenerationRequest(brief, loaded.products);
    const report: Record<string, unknown> = { ...request.report };
    if (loaded.error) report.product_load_error = loaded.error;

    const failGeneration = async (
      errorText: string,
      response: Record<string, unknown>,
      status: number,
    ) => {
      await service
        .from("canva_design_sessions")
        .update({
          status: "failed",
          error: clipCanvaError(errorText, "canva_generation_failed"),
          generation_mode: "ai",
          brand_template_id: null,
          populate_report: report,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      return json(response, status);
    };

    const capability = await fetchDesignGeneration(tokenRow.access_token, on401);
    if (!capability.ok) {
      logCanvaFailure("design_generation capability", capability.status, capability.raw || capability.message);
      const httpStatus = capability.status === 401 ? 401 : capability.status === 403 ? 403 : 502;
      return await failGeneration(
        `${capability.message}\n${capability.raw}`,
        {
          error: capability.status === 403 ? "design_generation_unavailable" : "canva_capabilities_failed",
          message: capability.message,
        },
        httpStatus,
      );
    }

    // Upload selected photos to the connected user's library. Generation still
    // receives text only; asset IDs are retained for manual placement.
    const draft = brief.presentationDraft as { productDrafts?: Record<string, { displayName?: string; imageUrl?: string; sampleImageUrl?: string }> } | undefined;
    const assets: Record<string, unknown>[] = [];
    const previousAssets = Array.isArray(session.populate_report?.product_assets)
      ? session.populate_report.product_assets as { product_id?: string; url?: string; asset_id?: string; name?: string }[] : [];
    const imageInputs = new Map(Object.entries(draft?.productDrafts ?? {}).filter(([id]) => ((claimed.product_ids ?? []) as string[]).includes(id)));
    if (typeof brief.coverImageUrl === 'string') imageInputs.set('cover', { displayName: '封面', imageUrl: brief.coverImageUrl });
    if (typeof brief.floorImageUrl === 'string') imageInputs.set('floor', { displayName: '整體平面圖', imageUrl: brief.floorImageUrl });
    const zones = (brief.presentationDraft as { zones?: { id: string; name: string; imageUrl?: string }[] } | undefined)?.zones;
    for (const zone of zones ?? []) if (zone.imageUrl) imageInputs.set(`zone-${zone.id}`, { displayName: zone.name, imageUrl: zone.imageUrl });
    for (const [productId, photo] of imageInputs) {
      const url = photo?.sampleImageUrl || photo?.imageUrl;
      const name = `FDS ${sessionId.slice(0, 8)} ${photo?.displayName || productId}`.slice(0, 255);
      if (!url || !/^https:\/\//i.test(url)) {
        assets.push({ product_id: productId, name, error: 'missing_https_image' });
        continue;
      }
      const previous = previousAssets.find((asset) => asset.product_id === productId && asset.url === url && asset.asset_id);
      if (previous) {
        assets.push(previous);
        continue;
      }
      try {
        if (missingScopes(scopeStr, ['asset:write']).length) throw new Error('missing_asset_write_scope_reconnect_canva');
        const options = {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name }),
        };
        let upload = await canvaAuthedFetch(tokenRow.access_token, '/url-asset-uploads', options);
        if (upload.status === 401) {
          const next = await on401();
          if (next) upload = await canvaAuthedFetch(next, '/url-asset-uploads', options);
        }
        if (!upload.ok) throw new Error(`asset_upload_${upload.status}`);
        const created = await upload.json();
        if (!created?.job?.id) throw new Error('asset_upload_no_job');
        const job = await pollCanvaJob<{ status?: string; asset?: { id?: string } }>(
          tokenRow.access_token, `/url-asset-uploads/${encodeURIComponent(created.job.id)}`,
          (value) => value?.status === 'success' || value?.status === 'failed', on401,
        );
        if (!job?.asset?.id) throw new Error('asset_upload_failed');
        assets.push({ product_id: productId, name, asset_id: job.asset.id, url });
      } catch (error) {
        assets.push({ product_id: productId, name, url, error: String(error) });
      }
      report.product_assets = assets;
      await service.from('canva_design_sessions').update({ populate_report: report, updated_at: new Date().toISOString() }).eq('id', sessionId);
    }
    report.product_assets = assets;
    const payload = {
      brief: request.brief,
      design_type: request.design_type,
      outline: request.outline,
    };
    let res = await canvaAuthedFetch(tokenRow.access_token, "/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401 && tokenRow.refresh_token) {
      const next = await on401();
      if (next) {
        res = await canvaAuthedFetch(next, "/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logCanvaFailure("canva generations failed", res.status, detail);
      let code = "";
      try {
        code = String((JSON.parse(detail) as { code?: string }).code ?? "");
      } catch {
        code = "";
      }
      const credit = res.status === 429 && code === "credit_quota_exceeded";
      const message = credit ? CREDIT_QUOTA_MESSAGE : clipCanvaError(detail, `canva_generation_${res.status}`);
      return await failGeneration(
        credit ? `${CREDIT_QUOTA_MESSAGE}\n${detail}` : detail,
        {
          error: credit ? "credit_quota_exceeded" : `canva_generation_failed_${res.status}`,
          message,
        },
        credit ? 429 : 502,
      );
    }

    const created = await res.json().catch(() => null) as { job?: { id?: string } } | null;
    const jobId = created?.job?.id;
    if (!jobId) {
      const raw = JSON.stringify(created ?? {});
      logCanvaFailure("canva generations no job", res.status, raw);
      return await failGeneration(
        raw,
        { error: "canva_generation_no_job", message: "Canva 沒有回傳生成工作。" },
        502,
      );
    }
    report.generation_job_id = jobId;
    report.generation_status = "accepted";
    const { error: progressError } = await service.from("canva_design_sessions")
      .update({ generation_mode: "ai", populate_report: report, updated_at: new Date().toISOString() })
      .eq("id", sessionId).eq("status", "creating");
    if (progressError) return json({ error: progressError.message }, 500);

    return json({ ...claimed, populate_report: report });
  }

  // ── export_design / export_pptx / export_pdf（T-903）────────────────
  if (action === "export_design" || action === "export_pptx" || action === "export_pdf") {
    const sessionId = String(body.session_id ?? "");
    if (!sessionId) return json({ error: "session_id_required" }, 400);
    let format: CanvaExportFormat = "pptx";
    if (action === "export_pdf") format = "pdf";
    else if (action === "export_design") {
      const f = String(body.format ?? "pptx");
      format = f === "pdf" ? "pdf" : "pptx";
    }
    const exportResult = await runCanvaSessionExport({
      service,
      userId,
      credentials,
      sessionId,
      format,
    });
    if ("error" in exportResult) {
      return json(exportResult.body, exportResult.status);
    }
    return json(exportResult.body);
  }

  return json({ error: "unknown_action" }, 400);
});

const EXPORT_URL_TTL_MS = 24 * 60 * 60 * 1000;

async function runCanvaSessionExport(opts: {
  service: ReturnType<typeof createClient>;
  userId: string;
  credentials: string;
  sessionId: string;
  format: CanvaExportFormat;
}): Promise<
  | { body: Record<string, unknown> }
  | { error: true; status: number; body: Record<string, unknown> }
> {
  const { service, userId, credentials, sessionId, format } = opts;
  const { data: session, error: sessErr } = await service
    .from("canva_design_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("staff_id", userId)
    .maybeSingle();
  if (sessErr) return { error: true, status: 500, body: { error: sessErr.message } };
  if (!session?.canva_design_id) return { error: true, status: 400, body: { error: "design_not_ready" } };

  const { data: connScope } = await service
    .from("canva_connections")
    .select("scope")
    .eq("staff_id", userId)
    .maybeSingle();
  const miss = missingExportScopes((connScope as { scope?: string } | null)?.scope ?? null);
  if (miss.includes("design:content:read")) {
    return { error: true, status: 403, body: { error: "missing_scope", missing_scopes: miss } };
  }

  const tokenRow = await loadAndRefreshToken(service, userId, credentials);
  if ("error" in tokenRow) return { error: true, status: 401, body: { error: tokenRow.error } };

  await service
    .from("canva_design_sessions")
    .update({ status: "exporting", export_error: null, updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  const exportPayload = {
    design_id: session.canva_design_id,
    format: exportFormatBody(format),
  };

  let res = await canvaAuthedFetch(tokenRow.access_token, "/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exportPayload),
  });
  if (res.status === 401 && tokenRow.refresh_token) {
    const refreshed = await refreshToken(service, userId, credentials, tokenRow.refresh_token);
    if (refreshed) {
      res = await canvaAuthedFetch(refreshed.access_token, "/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportPayload),
      });
    }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const errText = `export_start_${res.status}`;
    await service.from("canva_design_exports").insert({
      session_id: sessionId,
      staff_id: userId,
      format,
      canva_design_id: session.canva_design_id,
      error: errText,
    });
    await service
      .from("canva_design_sessions")
      .update({ status: "ready", export_error: errText, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    return { error: true, status: 502, body: { error: `canva_export_failed_${res.status}`, detail: detail.slice(0, 500) } };
  }
  const exportBody = await res.json();
  const jobId = exportBody?.job?.id as string | undefined;
  if (!jobId) {
    await service.from("canva_design_exports").insert({
      session_id: sessionId,
      staff_id: userId,
      format,
      canva_design_id: session.canva_design_id,
      error: "canva_export_no_job",
    });
    await service
      .from("canva_design_sessions")
      .update({ status: "ready", export_error: "canva_export_no_job", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    return { error: true, status: 502, body: { error: "canva_export_no_job" } };
  }

  let access = tokenRow.access_token;
  const job = await pollCanvaJob<CanvaExportJob>(
    access,
    `/exports/${jobId}`,
    (j) => j?.status === "success" || j?.status === "failed",
    async () => {
      const refreshed = await refreshToken(service, userId, credentials, tokenRow.refresh_token);
      if (refreshed) {
        access = refreshed.access_token;
        return refreshed.access_token;
      }
      return null;
    },
  );

  if (!job || job.status !== "success") {
    const errMsg = job?.error?.message ?? job?.error?.code ?? "export_timeout";
    await service.from("canva_design_exports").insert({
      session_id: sessionId,
      staff_id: userId,
      format,
      canva_design_id: session.canva_design_id,
      export_job_id: jobId,
      error: errMsg,
    });
    await service
      .from("canva_design_sessions")
      .update({
        status: "ready",
        export_job_id: jobId,
        export_error: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    return { error: true, status: 502, body: { error: "canva_export_failed", detail: errMsg, export_job_id: jobId } };
  }

  const downloadUrl = pickDownloadUrl(job);
  const urlExpiresAt = new Date(Date.now() + EXPORT_URL_TTL_MS).toISOString();
  await service.from("canva_design_exports").insert({
    session_id: sessionId,
    staff_id: userId,
    format,
    canva_design_id: session.canva_design_id,
    export_job_id: jobId,
    download_url: downloadUrl,
    url_expires_at: urlExpiresAt,
  });

  const { data: updated, error: updErr } = await service
    .from("canva_design_sessions")
    .update({
      status: "exported",
      export_job_id: jobId,
      export_download_url: downloadUrl,
      export_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select("*")
    .single();
  if (updErr) return { error: true, status: 500, body: { error: updErr.message } };
  return {
    body: {
      format,
      export_job_id: jobId,
      export_download_url: downloadUrl,
      url_expires_at: urlExpiresAt,
      session: updated,
    },
  };
}

/** 取本人 token；已過期（60s buffer）就先 refresh。 */
async function loadAndRefreshToken(
  service: ReturnType<typeof createClient>,
  userId: string,
  credentials: string,
): Promise<{ access_token: string; refresh_token: string | null } | { error: string }> {
  const { data, error } = await service
    .from("canva_connections")
    .select("access_token,refresh_token,expires_at")
    .eq("staff_id", userId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data?.access_token) return { error: "canva_not_connected" };
  const row = data as { access_token: string; refresh_token: string | null; expires_at: string | null };
  const expiredSoon =
    row.expires_at != null && new Date(row.expires_at).getTime() - 60_000 < Date.now();
  if (expiredSoon && row.refresh_token) {
    const refreshed = await refreshToken(service, userId, credentials, row.refresh_token);
    if (refreshed) return { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token };
  }
  return { access_token: row.access_token, refresh_token: row.refresh_token };
}

async function refreshToken(
  service: ReturnType<typeof createClient>,
  userId: string,
  credentials: string,
  refreshTokenValue: string | null,
): Promise<{ access_token: string; refresh_token: string | null; expires_in?: number; scope?: string } | null> {
  if (!refreshTokenValue) return null;
  const token = await tokenRequest(credentials, "refresh_token", {
    refresh_token: refreshTokenValue,
  });
  if (!token.access_token) return null;
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
  const tokenPatch: Record<string, unknown> = {
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? refreshTokenValue,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  // Refresh responses may omit scope. Writing null would wipe the scopes we already stored.
  if (typeof token.scope === "string" && token.scope.trim()) tokenPatch.scope = token.scope;
  await service
    .from("canva_connections")
    .update(tokenPatch)
    .eq("staff_id", userId);
  return { access_token: token.access_token, refresh_token: token.refresh_token ?? refreshTokenValue };
}
