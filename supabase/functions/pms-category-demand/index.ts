import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { pmsKeyMissingError, pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";

/**
 * 常用傢俬「類別熱度」：讀 PMS 的真實落單量，寫成聚合放進 FDS。
 *
 * 為什麼只有類別層級：PMS 記的是項目用的通用產品類型（同事椅 1,890 件…，105 個
 * bwf_products / 30 個 product_types），Furniture 目錄是型號級貨品。兩邊沒有共同
 * ID／SKU（PMS bwf_products 只有 display，bubble_id／slug 全 NULL），名稱比對 0 命中。
 * 所以這裡只輸出 PMS 產品類型的落單聚合，由 FDS 的 fds_pms_category_map 對照到
 * products.level1_category。FDS 這邊不存 PMS 明細。
 *
 * 呼叫來源：pg_cron（x-worker-secret）、admin（使用者 JWT）、service role。
 * 寫入一律經 fds_pms_category_demand（service role only）。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

type PmsTypeRow = { id: string; display: string | null };
type PmsProductRow = { id: string; product_types_id: string | null };
type PmsOrderRow = { product_id: string | null; quantity: number | null };

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
  serviceKey: string,
): Promise<boolean> {
  const secret = req.headers.get("x-worker-secret");
  if (secret) {
    const { data } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    return data === true;
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim() ?? "";
  if (bearer && bearer === serviceKey) return true;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user?.id) return false;
  const { data } = await userClient.rpc("bwf_has_role", { p_roles: ["admin"] });
  return data === true;
}

/** PostgREST caps a response at 1000 rows; page explicitly. */
async function fetchAll<T>(
  makeQuery: () => any,
  key: string,
): Promise<T[]> {
  const result: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    result.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const pmsServiceKey = pmsServiceRoleKey();
  const furnitureUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const furnitureAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const furnitureServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!pmsServiceKey) return jsonResponse({ error: pmsKeyMissingError() }, 500);
  if (!furnitureUrl || !furnitureServiceKey) {
    return jsonResponse({ error: "Furniture Supabase not configured" }, 500);
  }

  const admin = createClient(furnitureUrl, furnitureServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!(await isAuthorized(req, admin, furnitureUrl, furnitureAnonKey, furnitureServiceKey))) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  try {
    const pms = createClient(pmsProjectUrl(), pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const types = await fetchAll<PmsTypeRow>(
      () => pms.from("product_types").select("id, display"),
      "product_types",
    );
    const products = await fetchAll<PmsProductRow>(
      () => pms.from("bwf_products").select("id, product_types_id"),
      "bwf_products",
    );
    const orders = await fetchAll<PmsOrderRow>(
      () => pms.from("bwf_orders").select("product_id, quantity"),
      "bwf_orders",
    );

    const typeNameById = new Map<string, string>();
    for (const row of types) {
      const name = (row.display ?? "").trim();
      if (row.id && name) typeNameById.set(row.id, name);
    }
    const typeIdByProduct = new Map<string, string>();
    for (const row of products) {
      const typeId = row.product_types_id ?? "";
      if (row.id && typeId) typeIdByProduct.set(row.id, typeId);
    }

    // Aggregate by type name: PMS has two types sharing the display "Sofa 梳化".
    const agg = new Map<string, { qty: number; lines: number; products: Set<string> }>();
    for (const order of orders) {
      const typeId = order.product_id ? typeIdByProduct.get(order.product_id) : undefined;
      if (!typeId) continue;
      const name = typeNameById.get(typeId);
      if (!name) continue;
      const row = agg.get(name) ?? { qty: 0, lines: 0, products: new Set<string>() };
      row.qty += Number(order.quantity ?? 0) || 0;
      row.lines += 1;
      if (order.product_id) row.products.add(order.product_id);
      agg.set(name, row);
    }

    const rows = [...agg.entries()].map(([pmsType, row]) => ({
      pms_type: pmsType,
      demand_qty: Math.round(row.qty),
      order_lines: row.lines,
      distinct_products: row.products.size,
      updated_at: new Date().toISOString(),
    }));

    const { error: writeError } = await admin
      .from("fds_pms_category_demand")
      .upsert(rows, { onConflict: "pms_type" });
    if (writeError) throw new Error(writeError.message);

    // Drop types PMS no longer has, so a renamed type does not linger.
    const keep = rows.map((row) => row.pms_type);
    let removedStale = 0;
    if (keep.length > 0) {
      const { data: stale, error: staleError } = await admin
        .from("fds_pms_category_demand")
        .select("pms_type")
        .not("pms_type", "in", `(${keep.map((name) => `"${name.replace(/"/g, '""')}"`).join(",")})`);
      if (staleError) throw new Error(staleError.message);
      if (stale && stale.length > 0) {
        const { error: deleteError } = await admin
          .from("fds_pms_category_demand")
          .delete()
          .in("pms_type", stale.map((row) => row.pms_type));
        if (deleteError) throw new Error(deleteError.message);
        removedStale = stale.length;
      }
    }

    // Report the FDS-side view so a run can be checked without extra queries.
    const { data: mapped, error: summaryError } = await admin.rpc("fds_pms_category_demand_summary");
    if (summaryError) throw new Error(summaryError.message);

    return jsonResponse({
      ok: true,
      pms_types: types.length,
      pms_products: products.length,
      pms_orders: orders.length,
      demand_rows: rows.length,
      total_qty: rows.reduce((sum, row) => sum + row.demand_qty, 0),
      removed_stale: removedStale,
      level1: mapped ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Category demand refresh failed";
    return jsonResponse({ error: message }, 500);
  }
});
