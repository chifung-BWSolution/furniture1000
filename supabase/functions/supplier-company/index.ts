import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { pmsProjectUrl, pmsServiceRoleKey, pmsKeyMissingError } from "../_shared/pmsProject.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Supplier portal: company profile + compliance files, read from PMS.
 *
 * The browser never sends a factory id. It is resolved from supplier_logins by
 * the FDS RPC using the caller's JWT, then PMS is read with the service role.
 * Supplier files are only returned when a PMS supplier can be linked to the
 * factory by an exact display name; otherwise `linked: false` with no files.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anon || !authHeader) return json({ error: "unauthorized" }, 401);

  const furniture = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData } = await furniture.auth.getUser();
  if (!userData.user?.id) return json({ error: "unauthorized" }, 401);

  const { data: factoryId, error: factoryError } = await furniture.rpc("fds_supplier_factory_folder");
  if (factoryError) return json({ error: factoryError.message }, 403);
  if (!factoryId) return json({ error: "permission_denied" }, 403);

  const pmsUrl = pmsProjectUrl();
  const pmsKey = pmsServiceRoleKey();
  if (!pmsKey) return json({ error: pmsKeyMissingError() }, 500);
  const pms = createClient(pmsUrl, pmsKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: factory, error: rowError } = await pms
    .from("factories")
    .select(
      "id, display_name, factory_name, factory_eng_name, factory_code, contact_person, phone, email, website, location, join_date, key_product_categories, status, project_number, remarks",
    )
    .eq("id", factoryId)
    .maybeSingle();
  if (rowError) return json({ error: rowError.message }, 500);
  if (!factory) return json({ company: null, compliance: { linked: false, files: [] } });

  let linkedSupplier: { id: string; display_name: string | null } | null = null;
  // Explicit binding wins; only fall back to an exact display-name match.
  const { data: boundSupplierId } = await furniture.rpc("fds_supplier_pms_supplier");
  if (boundSupplierId) {
    const { data: supplier } = await pms
      .from("suppliers")
      .select("id, display_name")
      .eq("id", boundSupplierId)
      .maybeSingle();
    if (supplier?.id) linkedSupplier = supplier;
  }
  const displayName = String(factory.display_name ?? "").trim();
  if (!linkedSupplier && displayName) {
    const { data: supplier } = await pms
      .from("suppliers")
      .select("id, display_name")
      .eq("display_name", displayName)
      .maybeSingle();
    if (supplier?.id) linkedSupplier = supplier;
  }

  let files: Array<Record<string, unknown>> = [];
  if (linkedSupplier?.id) {
    const { data, error } = await pms
      .from("supplier_files")
      .select("id, type_name, file_name, institution, code_number, expiry_date, created_date")
      .eq("supplier_id", linkedSupplier.id)
      .order("created_date", { ascending: false })
      .limit(100);
    if (error) return json({ error: error.message }, 500);
    files = data ?? [];
  }

  // No PMS supplier master for this factory: read whatever the factory master
  // itself has (factory_files), instead of pretending nothing exists.
  let factoryFiles: Array<Record<string, unknown>> = [];
  if (!linkedSupplier?.id) {
    const { data, error } = await pms
      .from("factory_files")
      .select("id, file_name, file, created_date")
      .eq("factory_id", factoryId)
      .order("created_date", { ascending: false })
      .limit(100);
    if (error) return json({ error: error.message }, 500);
    factoryFiles = data ?? [];
  }

  return json({
    company: factory,
    compliance: {
      linked: Boolean(linkedSupplier),
      supplier: linkedSupplier,
      files,
      factory_files: factoryFiles,
      factory_status: factory.status ?? null,
      factory_join_date: factory.join_date ?? null,
    },
  });
});
