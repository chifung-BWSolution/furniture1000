import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  applyProductCategoryBatchFromPms,
  isSyncOriginPms,
  pushProductCategoryBatchToPms,
  type CategoryRowPayload,
} from "../_shared/pmsProductCategorySync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-origin, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeRows(raw: unknown): CategoryRowPayload[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = item as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      const level1 = String(r.level1 ?? "").trim();
      const level2 = String(r.level2 ?? "").trim();
      const sort_order = Number(r.sort_order ?? r.sortOrder ?? 0);
      const previousLevel1 =
        typeof r.previousLevel1 === "string" ? r.previousLevel1 : undefined;
      const previousLevel2 =
        typeof r.previousLevel2 === "string" ? r.previousLevel2 : undefined;
      if (!id || !level1 || !level2) return null;
      return {
        id,
        level1,
        level2,
        sort_order: Number.isFinite(sort_order) ? sort_order : 0,
        previousLevel1,
        previousLevel2,
      };
    })
    .filter((x): x is CategoryRowPayload => x !== null);
}

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id).trim()).filter(Boolean);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const furnitureUrl = Deno.env.get("SUPABASE_URL") || "";
    const furnitureServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const pmsServiceKey =
      Deno.env.get("FACTORY_SERVICE_ROLE_KEY") ||
      Deno.env.get("MASTER_SERVICE_ROLE_KEY") ||
      Deno.env.get("PMS_SUPABASE_SERVICE_ROLE_KEY") ||
      "";

    if (!furnitureUrl || !furnitureServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    if (!pmsServiceKey) {
      throw new Error("Missing FACTORY_SERVICE_ROLE_KEY for PMS access");
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "push").trim().toLowerCase();

    const creates = normalizeRows(body.creates);
    const updates = normalizeRows(body.updates);
    const deletes = normalizeIds(body.deletes);

    const furnitureAdmin = createClient(furnitureUrl, furnitureServiceKey);
    const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey);

    if (action === "apply") {
      if (!isSyncOriginPms(req, body)) {
        return jsonResponse(
          { error: "apply requires x-sync-origin: pms (header or body syncOrigin)" },
          400,
        );
      }

      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const syncSecret = req.headers.get("x-sync-secret")?.trim() ?? "";
      const expectedSecret = Deno.env.get("BWF_PMS_CATEGORY_SYNC_SECRET")?.trim() ?? "";
      const authorized =
        token === furnitureServiceKey ||
        (expectedSecret.length > 0 && syncSecret === expectedSecret);
      if (!authorized) {
        return jsonResponse({ error: "Unauthorized apply" }, 401);
      }

      const { errors } = await applyProductCategoryBatchFromPms(furnitureAdmin, {
        creates,
        updates,
        deletes,
      });
      if (errors.length > 0) {
        return jsonResponse({ ok: false, errors }, 207);
      }
      return jsonResponse({ ok: true });
    }

    if (action !== "push") {
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }

    if (isSyncOriginPms(req, body)) {
      return jsonResponse({ ok: true, skipped: true, reason: "x-sync-origin: pms" });
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const userClient = createClient(furnitureUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { errors } = await pushProductCategoryBatchToPms(pmsAdmin, {
      creates,
      updates,
      deletes,
    });

    if (errors.length > 0) {
      return jsonResponse({ ok: false, errors }, 207);
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("sync-product-category-pms:", (error as Error).message);
    return jsonResponse({ error: (error as Error).message }, 500);
  }
});
