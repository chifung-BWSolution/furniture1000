import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

/**
 * Copies selected pages out of supplier catalogs for a quotation appendix.
 * Only catalog documents. Price lists stay private. The caller never receives
 * the storage path or the rest of the file.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "supplier-documents";
const MAX_PAGES = 24;
const ROLES = ["admin", "uploader", "pm", "designer"];

type PageRequest = { documentId: string; pageNo: number };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !authHeader) return json({ error: "Unauthorized" }, 401);

  // 夜間解析（process-jobs）與 catalog-thumbs 會用 service role 直接叫這一支抽頁；
  // 這種呼叫沒有使用者身分，只可以拿來抽「圖冊」頁（下面仍會檢查 doc_type）。
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const workerCall = bearer !== "" && bearer === serviceKey;
  if (!workerCall) {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user?.id) return json({ error: "Unauthorized" }, 401);
    const { data: allowed, error: roleErr } = await userClient.rpc("bwf_has_role", { p_roles: ROLES });
    if (roleErr) return json({ error: roleErr.message }, 400);
    if (allowed !== true) return json({ error: "permission_denied" }, 403);
  }

  let body: { pages?: PageRequest[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const pages = (body.pages ?? [])
    .map((page) => ({
      documentId: String(page.documentId ?? "").trim(),
      pageNo: Number(page.pageNo),
    }))
    .filter((page) => page.documentId && Number.isInteger(page.pageNo) && page.pageNo >= 1);
  if (pages.length === 0) return json({ error: "pages_required" }, 400);
  if (pages.length > MAX_PAGES) return json({ error: "too_many_pages" }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ids = [...new Set(pages.map((page) => page.documentId))];
  const { data: docs, error: docErr } = await admin
    .from("supplier_documents")
    .select("id, storage_path, doc_type")
    .in("id", ids);
  if (docErr) return json({ error: docErr.message }, 400);
  const byId = new Map((docs ?? []).map((doc) => [doc.id as string, doc]));
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc || doc.doc_type !== "catalog" || !doc.storage_path) {
      return json({ error: "catalog_not_found" }, 404);
    }
  }

  const loaded = new Map<string, PDFDocument>();
  for (const id of ids) {
    const path = byId.get(id)!.storage_path as string;
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) return json({ error: "catalog_unreadable" }, 400);
    loaded.set(id, await PDFDocument.load(await data.arrayBuffer(), { ignoreEncryption: true }));
  }

  const out = await PDFDocument.create();
  for (const page of pages) {
    const src = loaded.get(page.documentId)!;
    const index = page.pageNo - 1;
    if (index < 0 || index >= src.getPageCount()) return json({ error: "page_out_of_range" }, 400);
    const [copied] = await out.copyPages(src, [index]);
    out.addPage(copied);
  }

  const bytes = await out.save();
  return new Response(bytes, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
    },
  });
});
