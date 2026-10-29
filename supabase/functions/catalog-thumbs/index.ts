import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  CATALOG_THUMB_BATCH,
  catalogThumbPublicUrl,
  listCatalogThumbPages,
  pickMissingPages,
  renderCatalogThumbs,
} from "../_shared/catalogThumbs.ts";

/**
 * FDS-07 圖冊頁縮圖。
 *
 * 夜間解析（`process-jobs` 的 parse_pdf）會在抽字那一批順便畫好同一批頁的縮圖；
 * 這支 function 是補畫與查詢用：
 * - `{ documentId, action: "status" }` → 已有哪些頁、還缺幾頁（前端開選擇器時問一次）
 * - `{ documentId, pages? , limit? }` → 補畫缺的頁（前端在背景叫，或管理員手動）
 * - `{}`（pg_cron 帶 x-worker-secret）→ 找下一份還有缺頁的圖冊，畫一批
 *
 * 只有「圖冊」文件會有縮圖；報價單含成本，不經這條路。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STAFF_ROLES = ["admin", "uploader", "pm", "designer"];

type DocumentRow = {
  id: string;
  doc_type: string;
  page_count: number | null;
  storage_path: string | null;
  parent_document_id?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorise(
  req: Request,
  url: string,
  anonKey: string,
  serviceKey: string,
): Promise<{ admin: SupabaseClient; via: "worker" | "user"; supabaseUrl: string } | null> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const secret = req.headers.get("x-worker-secret");
  if (secret) {
    const { data } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    if (data === true) return { admin, via: "worker", supabaseUrl: url };
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return null;
  // 夜間解析（process-jobs）用 service role 直接叫這一支。
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer === serviceKey) return { admin, via: "worker", supabaseUrl: url };
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user?.id) return null;
  const { data: allowed } = await userClient.rpc("bwf_has_role", { p_roles: STAFF_ROLES });
  if (allowed !== true) return null;
  return { admin, via: "user", supabaseUrl: url };
}

async function loadCatalog(admin: SupabaseClient, documentId: string): Promise<DocumentRow | null> {
  const { data, error } = await admin
    .from("supplier_documents")
    .select("id, doc_type, page_count, storage_path, parent_document_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.doc_type !== "catalog") return null;
  return data as DocumentRow;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  const auth = await authorise(req, url, anonKey, serviceKey);
  if (!auth) return json({ error: "permission_denied" }, 403);
  const { admin } = auth;

  let body: { documentId?: string; pages?: number[]; limit?: number; action?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Math.min(
    CATALOG_THUMB_BATCH,
    Math.max(1, Number.isFinite(Number(body.limit)) ? Number(body.limit) : CATALOG_THUMB_BATCH),
  );

  try {
    // ── 指定文件：查狀態或補畫 ────────────────────────────────────────
    if (body.documentId) {
      const doc = await loadCatalog(admin, body.documentId);
      if (!doc) return json({ error: "catalog_not_found" }, 404);
      const pageCount = Number(doc.page_count ?? 0);
      const ready = await listCatalogThumbPages(admin, doc.id);

      if (body.action === "status") {
        return json({
          documentId: doc.id,
          pageCount,
          ready,
          missing: Math.max(0, pageCount - ready.length),
          thumbUrlPattern: catalogThumbPublicUrl(url, doc.id, 1),
        });
      }

      const requested = Array.isArray(body.pages)
        ? body.pages.map((pageNo) => Number(pageNo)).filter((pageNo) => Number.isInteger(pageNo) && pageNo > 0)
        : [];
      const pageNos = requested.length > 0
        ? requested.slice(0, limit)
        : pickMissingPages(pageCount, ready, limit);
      if (pageNos.length === 0) {
        return json({ documentId: doc.id, pageCount, ready, rendered: [], remaining: 0 });
      }
      if (!doc.storage_path) return json({ error: "catalog_unreadable" }, 400);

      const rendered = await renderCatalogThumbs(admin, {
        documentId: doc.id,
        pageNos,
        supabaseUrl: url,
        serviceKey,
      });
      const after = await listCatalogThumbPages(admin, doc.id);
      return json({
        documentId: doc.id,
        pageCount,
        ready: after,
        rendered: rendered.map((row) => row.pageNo),
        bytes: rendered.reduce((sum, row) => sum + row.bytes, 0),
        remaining: Math.max(0, pageCount - after.length),
      });
    }

    // ── 沒指定文件（cron）：找下一份還有缺頁的圖冊 ──────────────────
    const { data: docs, error } = await admin
      .from("supplier_documents")
      .select("id, doc_type, page_count, storage_path, created_at")
      .eq("doc_type", "catalog")
      .is("parent_document_id", null)
      .gt("page_count", 0)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) return json({ error: error.message }, 400);

    for (const doc of docs ?? []) {
      const pageCount = Number(doc.page_count ?? 0);
      const ready = await listCatalogThumbPages(admin, doc.id);
      const pageNos = pickMissingPages(pageCount, ready, limit);
      if (pageNos.length === 0) continue;
      if (!doc.storage_path) continue;
      const rendered = await renderCatalogThumbs(admin, {
        documentId: doc.id,
        pageNos,
        supabaseUrl: url,
        serviceKey,
      });
      const after = await listCatalogThumbPages(admin, doc.id);
      return json({
        documentId: doc.id,
        pageCount,
        ready: after,
        rendered: rendered.map((row) => row.pageNo),
        remaining: Math.max(0, pageCount - after.length),
      });
    }

    return json({ skipped: true, reason: "all_catalogs_have_thumbnails" });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
