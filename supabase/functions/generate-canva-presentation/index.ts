import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  attachImageAssets,
  AUTOFILL_SCOPES,
  buildAutofillPayload,
  missingAutofillScopes,
  productImageFieldNeeds,
  type ProductRow,
} from "./autofill.ts";
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
 * - create_native → { session_id } autofill brand template (T-902) or blank presentation (T-901)
 * - template_dataset → 列出品牌模板 dataset 欄位（除錯）
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

function missingExportScopes(scope: string | null | undefined): string[] {
  return missingAutofillScopes(scope).filter((s) => s === "design:content:read");
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

async function uploadAssetFromUrl(
  accessToken: string,
  imageUrl: string,
  name: string,
  on401?: () => Promise<string | null>,
): Promise<string | null> {
  let token = accessToken;
  let res = await canvaAuthedFetch(token, "/url-asset-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: imageUrl, name: name.slice(0, 255) }),
  });
  if (res.status === 401 && on401) {
    const next = await on401();
    if (next) {
      token = next;
      res = await canvaAuthedFetch(token, "/url-asset-uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: imageUrl, name: name.slice(0, 255) }),
      });
    }
  }
  if (!res.ok) return null;
  const created = await res.json();
  const jobId = created?.job?.id as string | undefined;
  if (!jobId) return null;
  const job = await pollCanvaJob<{ status?: string; asset?: { id?: string } }>(
    token,
    `/url-asset-uploads/${jobId}`,
    (j) => j?.status === "success" || j?.status === "failed",
    on401,
  );
  if (job?.status !== "success" || !job.asset?.id) return null;
  return job.asset.id;
}

async function loadProductsForSession(
  service: ReturnType<typeof createClient>,
  productIds: string[],
): Promise<ProductRow[]> {
  if (productIds.length === 0) return [];
  const { data, error } = await service
    .from("products")
    .select(
      "id,title,model,sku,image_url,image_url_2,image_url_3,sale_price,middle_price,material,color,size_l,size_w,size_h,level1_category,level2_category,factory",
    )
    .in("id", productIds.slice(0, 50));
  if (error || !data) return [];
  const byId = new Map((data as ProductRow[]).map((p) => [p.id, p]));
  return productIds.map((id) => byId.get(id)).filter(Boolean) as ProductRow[];
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

function briefTitle(brief: Record<string, unknown>): string {
  const raw = String(brief.title ?? brief.project ?? brief.client ?? "客戶簡報").trim();
  return raw.length > 255 ? raw.slice(0, 255) : raw || "客戶簡報";
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

  // ── probe：T-901 PoC 能力與 scope ─────────────────────────────────
  if (action === "probe") {
    const { data: conn } = await service
      .from("canva_connections")
      .select("scope,account_name,expires_at")
      .eq("staff_id", userId)
      .maybeSingle();
    const scopeStr = (conn as { scope?: string } | null)?.scope ?? null;
    const missAutofill = missingAutofillScopes(scopeStr);
    const brandTemplateId = Deno.env.get("CANVA_BRAND_TEMPLATE_ID") ?? "";
    const connected = Boolean(conn);
    const autofillReady = connected && missAutofill.length === 0 && Boolean(brandTemplateId);
    return json({
      ok: autofillReady,
      connected,
      account_name: (conn as { account_name?: string } | null)?.account_name ?? null,
      scopes: scopeStr,
      missing_scopes: missAutofill,
      brand_template_configured: Boolean(brandTemplateId),
      brand_template_id: brandTemplateId || undefined,
      autofill_scopes_required: AUTOFILL_SCOPES,
      message:
        !connected
          ? "canva_not_connected"
          : !brandTemplateId
            ? "請在 Edge secrets 設定 CANVA_BRAND_TEMPLATE_ID（見 docs/prd/FDS-2.1-Canva品牌模板Autofill.md）"
            : missAutofill.length > 0
              ? "請解除連接後重新授權（Autofill 需 brandtemplate 與 asset scopes）"
              : "autofill_ready",
    });
  }

  if (action === "template_dataset") {
    const templateId = Deno.env.get("CANVA_BRAND_TEMPLATE_ID") ?? "";
    if (!templateId) return json({ error: "brand_template_not_configured" }, 400);
    const tokenRow = await loadAndRefreshToken(service, userId, credentials);
    if ("error" in tokenRow) return json({ error: tokenRow.error }, 401);
    const refresh = () =>
      refreshToken(service, userId, credentials, tokenRow.refresh_token).then((r) =>
        r?.access_token ?? null,
      );
    let res = await canvaAuthedFetch(tokenRow.access_token, `/brand-templates/${templateId}/dataset`);
    if (res.status === 401 && tokenRow.refresh_token) {
      const t = await refresh();
      if (t) res = await canvaAuthedFetch(t, `/brand-templates/${templateId}/dataset`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ error: `dataset_failed_${res.status}`, detail: detail.slice(0, 500) }, 502);
    }
    const body = await res.json();
    const dataset = body?.dataset ?? {};
    return json({
      brand_template_id: templateId,
      fields: Object.keys(dataset),
      dataset,
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
        status: "draft",
        brief,
        product_ids: productIds,
        updated_at: now,
      };
      if (versionNote != null) patch.version_note = versionNote;
      const { error: updErr } = await service.from("canva_design_sessions").update(patch).eq("id", sessionId);
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
      const { data: siblings } = await service
        .from("canva_design_sessions")
        .select("content_version")
        .eq("root_id", rootId);
      const maxV = (siblings ?? []).reduce(
        (m, r) => Math.max(m, Number((r as { content_version?: number }).content_version ?? 1)),
        1,
      );
      contentVersion = maxV + 1;
    }

    const { data: inserted, error: insErr } = await service
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
    if (insErr) return json({ error: insErr.message }, 500);
    const newId = inserted.id as string;
    if (!parentId) {
      await service.from("canva_design_sessions").update({ root_id: newId }).eq("id", newId);
    }
    return json({ session_id: newId, content_version: contentVersion, root_id: rootId ?? newId });
  }

  // ── create_native：T-902 autofill 或 T-901 空白 presentation ───
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
      const ageMs = Date.now() - new Date(String(session.updated_at)).getTime();
      if (ageMs < 120_000) return json({ error: "create_in_progress" }, 409);
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
    const miss = missingAutofillScopes(scopeStr);
    if (miss.includes("design:content:write")) {
      return json({ error: "missing_scope", missing_scopes: miss }, 403);
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

    await service
      .from("canva_design_sessions")
      .update({ status: "creating", error: null, updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    const brief = (session.brief ?? {}) as Record<string, unknown>;
    const title = briefTitle(brief);
    const brandTemplateId = Deno.env.get("CANVA_BRAND_TEMPLATE_ID") ?? "";
    const useAutofill = Boolean(brandTemplateId) && miss.length === 0;

    if (useAutofill) {
      let dsRes = await canvaAuthedFetch(
        tokenRow.access_token,
        `/brand-templates/${brandTemplateId}/dataset`,
      );
      if (dsRes.status === 401 && tokenRow.refresh_token) {
        const t = await on401();
        if (t) dsRes = await canvaAuthedFetch(t, `/brand-templates/${brandTemplateId}/dataset`);
      }
      if (!dsRes.ok) {
        const detail = await dsRes.text().catch(() => "");
        await service
          .from("canva_design_sessions")
          .update({
            status: "failed",
            error: `dataset_${dsRes.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
        return json({ error: "brand_template_dataset_failed", detail: detail.slice(0, 500) }, 502);
      }
      const dsBody = await dsRes.json();
      const datasetKeys = new Set(Object.keys(dsBody?.dataset ?? {}));
      const products = await loadProductsForSession(service, (session.product_ids ?? []) as string[]);
      const { data: autofillData, report } = buildAutofillPayload(brief, products, datasetKeys);
      const imageNeeds = productImageFieldNeeds(products, datasetKeys);
      const uploads: { field: string; asset_id: string }[] = [];
      for (const need of imageNeeds) {
        const assetId = await uploadAssetFromUrl(
          tokenRow.access_token,
          need.url,
          `fds-prod-${need.index}.jpg`,
          on401,
        );
        if (assetId) uploads.push({ field: need.field, asset_id: assetId });
      }
      attachImageAssets(autofillData, uploads);
      (report as Record<string, unknown>).images_uploaded = uploads.length;

      let afRes = await canvaAuthedFetch(tokenRow.access_token, "/autofills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "create_from_brand_template",
          brand_template_id: brandTemplateId,
          title,
          data: autofillData,
        }),
      });
      if (afRes.status === 401 && tokenRow.refresh_token) {
        const t = await on401();
        if (t) {
          afRes = await canvaAuthedFetch(t, "/autofills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "create_from_brand_template",
              brand_template_id: brandTemplateId,
              title,
              data: autofillData,
            }),
          });
        }
      }
      if (!afRes.ok) {
        const detail = await afRes.text().catch(() => "");
        await service
          .from("canva_design_sessions")
          .update({
            status: "failed",
            error: `autofill_${afRes.status}`,
            populate_report: report,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
        return json({ error: "canva_autofill_failed", detail: detail.slice(0, 500) }, 502);
      }
      const afCreated = await afRes.json();
      const afJobId = afCreated?.job?.id as string | undefined;
      if (!afJobId) {
        await service
          .from("canva_design_sessions")
          .update({
            status: "failed",
            error: "canva_autofill_no_job",
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
        return json({ error: "canva_autofill_no_job" }, 502);
      }

      const afJob = await pollCanvaJob<{
        status?: string;
        error?: { message?: string };
        result?: {
          design?: {
            id?: string;
            urls?: { edit_url?: string; view_url?: string };
            url?: string;
          };
        };
      }>(
        tokenRow.access_token,
        `/autofills/${afJobId}`,
        (j) => j?.status === "success" || j?.status === "failed",
        on401,
      );
      if (!afJob || afJob.status !== "success") {
        const errMsg = afJob?.error?.message ?? "autofill_timeout";
        await service
          .from("canva_design_sessions")
          .update({
            status: "failed",
            error: errMsg,
            autofill_job_id: afJobId,
            brand_template_id: brandTemplateId,
            generation_mode: "autofill",
            populate_report: report,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
        return json({ error: "canva_autofill_failed", detail: errMsg, job_id: afJobId }, 502);
      }
      const design = afJob.result?.design;
      const designId = design?.id;
      const editUrl = design?.urls?.edit_url ?? design?.url ?? null;
      const viewUrl = design?.urls?.view_url ?? null;
      if (!designId) {
        await service
          .from("canva_design_sessions")
          .update({ status: "failed", error: "autofill_no_design", autofill_job_id: afJobId })
          .eq("id", sessionId);
        return json({ error: "autofill_no_design" }, 502);
      }
      const { data: updated, error: updErr } = await service
        .from("canva_design_sessions")
        .update({
          status: "ready",
          generation_mode: "autofill",
          brand_template_id: brandTemplateId,
          autofill_job_id: afJobId,
          populate_report: report,
          canva_design_id: designId,
          edit_url: editUrl,
          view_url: viewUrl,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .select("*")
        .single();
      if (updErr) return json({ error: updErr.message }, 500);
      return json(updated);
    }

    const payload = {
      type: "type_and_asset",
      design_type: { type: "preset", name: "presentation" },
      title,
    };

    let res = await canvaAuthedFetch(tokenRow.access_token, "/designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401 && tokenRow.refresh_token) {
      const t = await on401();
      if (t) {
        res = await canvaAuthedFetch(t, "/designs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await service
        .from("canva_design_sessions")
        .update({
          status: "failed",
          error: `canva_create_${res.status}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      return json({ error: `canva_create_failed_${res.status}`, detail: detail.slice(0, 500) }, 502);
    }
    const created = await res.json();
    const design = created?.design as {
      id?: string;
      urls?: { edit_url?: string; view_url?: string };
    } | undefined;
    if (!design?.id) {
      await service
        .from("canva_design_sessions")
        .update({ status: "failed", error: "canva_create_no_design", updated_at: new Date().toISOString() })
        .eq("id", sessionId);
      return json({ error: "canva_create_no_design" }, 502);
    }

    const { data: updated, error: updErr } = await service
      .from("canva_design_sessions")
      .update({
        status: "ready",
        generation_mode: "blank",
        brand_template_id: null,
        canva_design_id: design.id,
        edit_url: design.urls?.edit_url ?? null,
        view_url: design.urls?.view_url ?? null,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .select("*")
      .single();
    if (updErr) return json({ error: updErr.message }, 500);
    return json(updated);
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
