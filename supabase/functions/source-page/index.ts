import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Opens one supplier PDF page for a product the caller is allowed to see.
 * The search payload never includes the storage path. This function checks
 * fds_source_page_context with the user JWT, then returns a 5-minute signed URL.
 *
 * The signed URL points at the whole private PDF, so only admin / uploader may
 * get one (C-04 role table: 查看原始 PDF（私有）pm / designer ❌). The RPC
 * enforces the same rule; the check here is a second lock on the door.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "supplier-documents";
const TTL_SECONDS = 300;
/** Roles allowed to open a private supplier document. */
const SOURCE_ROLES = ["admin", "uploader"];

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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user?.id) return json({ error: "Unauthorized" }, 401);

  // Private supplier documents (quote PDF with cost) are admin / uploader only.
  const { data: allowed, error: roleErr } = await userClient.rpc("bwf_has_role", {
    p_roles: SOURCE_ROLES,
  });
  if (roleErr) return json({ error: roleErr.message }, 400);
  if (allowed !== true) return json({ error: "permission_denied" }, 403);

  let body: { document_id?: string; page_no?: number | null; product_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const documentId = String(body.document_id ?? "").trim();
  if (!documentId) return json({ error: "document_id required" }, 400);
  const pageNo = body.page_no == null ? null : Number(body.page_no);
  const productId = body.product_id ? String(body.product_id) : null;

  const { data, error } = await userClient.rpc("fds_source_page_context", {
    p_document_id: documentId,
    p_page_no: Number.isFinite(pageNo) ? pageNo : null,
    p_product_id: productId,
  });
  if (error) {
    const denied = /permission_denied|source_not_linked/.test(error.message);
    return json({ error: error.message }, denied ? 403 : 400);
  }

  const ctx = data as {
    storage_path?: string;
    title?: string | null;
    doc_type?: string;
    page_no?: number | null;
    bbox?: unknown;
  };
  if (!ctx?.storage_path) return json({ error: "document_not_found" }, 404);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(ctx.storage_path, TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return json({ error: signErr?.message ?? "sign_failed" }, 500);
  }

  return json({
    url: signed.signedUrl,
    title: ctx.title ?? null,
    doc_type: ctx.doc_type ?? null,
    page_no: ctx.page_no ?? null,
    bbox: ctx.bbox ?? null,
  });
});
