import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pmsKeyMissingError, pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FACTORY_ID_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles allowed to read the manufacturer directory. */
const DIRECTORY_ROLES = ["admin", "uploader", "designer"];

/** Columns the manufacturer directory renders. */
const FACTORY_COLUMNS =
  "id, display_name, factory_code, created_at, contact_person, phone, location, project_number, working_folder, join_date";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** PMS stores created_date / evaluator. The directory UI still reads created_at / staff_name. */
function toStaffCommentShape(row: Record<string, unknown>) {
  const evaluator = typeof row.evaluator === "string" ? row.evaluator.trim() : "";
  return {
    id: row.id ?? null,
    factory_id: row.factory_id ?? null,
    factory: row.factory ?? null,
    comment: typeof row.comment === "string" ? row.comment : "",
    created_at: row.created_date ?? row.created_at ?? null,
    staff_name: evaluator || "匿名用戶",
  };
}

/**
 * Furniture client that carries the caller's JWT.
 *
 * `bwf_has_role` reads `auth.uid()` / `auth.jwt()` inside PostgREST, so the
 * caller must be the end user — the PMS service role cannot stand in here.
 */
function createFurnitureClient(req: Request) {
  const furnitureUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const furnitureAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !furnitureUrl || !furnitureAnonKey) return null;
  return createClient(furnitureUrl, furnitureAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Role gate only — one round trip. */
async function hasDirectoryRole(
  client: ReturnType<typeof createFurnitureClient>,
): Promise<boolean> {
  if (!client) return false;
  const { data, error } = await client.rpc("bwf_has_role", { p_roles: DIRECTORY_ROLES });
  return !error && data === true;
}

/** Role gate for read-only calls that do not need the caller's e-mail. */
async function requireDirectoryRole(req: Request): Promise<Response | null> {
  const client = createFurnitureClient(req);
  if (!client) return jsonResponse({ error: "Unauthorized" }, 401);
  if (!(await hasDirectoryRole(client))) return jsonResponse({ error: "Forbidden" }, 403);
  return null;
}

async function requireDirectoryUser(req: Request): Promise<{ email: string } | Response> {
  const client = createFurnitureClient(req);
  if (!client) return jsonResponse({ error: "Unauthorized" }, 401);
  // Both calls only need the caller's JWT, so they no longer run one after the
  // other — that halves the round trips before the PMS queries start.
  const [roleResult, userResult] = await Promise.all([
    client.rpc("bwf_has_role", { p_roles: DIRECTORY_ROLES }),
    client.auth.getUser(),
  ]);
  if (userResult.error || !userResult.data.user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (roleResult.error || roleResult.data !== true) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }
  return { email: (userResult.data.user.email ?? "").trim().slice(0, 120) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const MASTER_SERVICE_KEY = pmsServiceRoleKey();
    if (!MASTER_SERVICE_KEY) {
      throw new Error(pmsKeyMissingError());
    }

    const masterSupabase = createClient(pmsProjectUrl(), MASTER_SERVICE_KEY);

    let body: { factory_id?: string; action?: string; feedback?: { factory_id: string; factory_name: string; comment: string; staff_name: string } } = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine - fetch all
    }

    // Homepage only needs the active-factory total. Skip projects, comments, and products.
    if (body.action === "count_factories") {
      const { count, error } = await masterSupabase
        .from("factories")
        .select("id", { count: "exact", head: true })
        .ilike("status", "active");
      if (error) throw new Error(`Failed to count factories: ${error.message}`);
      return new Response(JSON.stringify({ active_factories: count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Directory list: factory rows only.
    //
    // The directory table renders the factory rows alone, so skip the
    // bwf_projects and staff_supplier_comments queries — they were the bulk
    // of the payload (365KB, of which 320KB was comments + linked projects)
    // and of the response time. Full payload stays available for the detail
    // page, which still calls this function without an action.
    if (body.action === "list") {
      let listQuery = masterSupabase
        .from("factories")
        .select(FACTORY_COLUMNS)
        .ilike("status", "active")
        .order("display_name", { ascending: true });

      if (body.factory_id) {
        listQuery = listQuery.eq("id", body.factory_id);
      }

      // The role gate and the PMS read do not depend on each other, so they
      // travel together instead of stacking two round trips.
      const [denied, listResult] = await Promise.all([
        requireDirectoryRole(req),
        listQuery,
      ]);
      if (denied) return denied;

      if (listResult.error) {
        throw new Error(`Failed to fetch factories: ${listResult.error.message}`);
      }

      console.log(`[fetch-manufacturer-directory] list: ${listResult.data?.length || 0} factories`);
      return jsonResponse({ factories: listResult.data || [] });
    }

    // Handle save feedback action. PMS factory_id is factories.id (uuid).
    if (body.action === "save_feedback" && body.feedback) {
      const caller = await requireDirectoryUser(req);
      if (caller instanceof Response) return caller;

      const { factory_id: fId, factory_name, comment, staff_name } = body.feedback;
      if (!FACTORY_ID_UUID.test(fId ?? "")) {
        return new Response(
          JSON.stringify({ error: "factory_id 必須是 factories.id（uuid），不能使用廠商編號" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          },
        );
      }
      const factoryName = (factory_name ?? "").trim().slice(0, 200);
      const commentText = (comment ?? "").trim().slice(0, 2000);
      const displayName = (staff_name ?? "").trim().slice(0, 40);
      if (!factoryName || !commentText) {
        return jsonResponse({ error: "請填寫廠家名稱和意見" }, 400);
      }
      const evaluator = [displayName, caller.email].filter(Boolean).join(" · ").slice(0, 160) || "用戶";
      const { data: insertedComment, error: insertError } = await masterSupabase
        .from("staff_supplier_comments")
        .insert({
          factory_id: fId,
          factory: factoryName,
          comment: commentText,
          evaluator,
        })
        .select("id, factory_id, factory, comment, evaluator, created_date")
        .single();

      if (insertError) {
        throw new Error(`Failed to save feedback: ${insertError.message}`);
      }

      return new Response(
        JSON.stringify({ success: true, comment: toStaffCommentShape(insertedComment) }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const factoryId = body.factory_id;

    // Fetch factories (required - throw on failure)
    // Master DB stores title-case status values (e.g. "Active"); ilike matches user-facing "active".
    let factoriesQuery = masterSupabase
      .from("factories")
      .select(FACTORY_COLUMNS)
      .ilike("status", "active")
      .order("display_name", { ascending: true });

    if (factoryId) {
      factoriesQuery = factoriesQuery.eq("id", factoryId);
    }

    // The role gate and the PMS read do not depend on each other, so they
    // travel together instead of stacking two round trips.
    const [caller, factoriesResult] = await Promise.all([
      requireDirectoryUser(req),
      factoriesQuery,
    ]);
    if (caller instanceof Response) return caller;

    const factories = factoriesResult.data;
    const factoriesError = factoriesResult.error;

    if (factoriesError) {
      throw new Error(`Failed to fetch factories: ${factoriesError.message}`);
    }

    console.log(`[fetch-manufacturer-directory] Fetched ${factories?.length || 0} factories`);

    // --- Build factory lookup by ID (UUID) ---
    const factoryById = new Map<string, any>();
    if (factories) {
      for (const f of factories) {
        factoryById.set(f.id, f);
      }
    }

    // --- Fetch projects from bwf_projects using factories_id as the confirmed bridge column ---
    let projects: any[] = [];
    try {
      const { data, error } = await masterSupabase
        .from("bwf_projects")
        .select("id, project_name, project_content, signed_date, estimated_profit, factories_id")
        .order("signed_date", { ascending: false });
      if (error) {
        console.error("[fetch-manufacturer-directory] Failed to fetch projects:", error.message);
      } else {
        projects = data || [];
        console.log(`[fetch-manufacturer-directory] Fetched ${projects.length} projects from bwf_projects`);
      }
    } catch (e) {
      console.error("[fetch-manufacturer-directory] Exception fetching projects:", (e as Error).message);
    }

    // --- DIRECT MAPPING: bwf_projects.factories_id → factories.id ---
    let matchedCount = 0;
    let unmatchedCount = 0;

    const factoryLinkedProjectsMap = new Map<string, any[]>();

    for (const p of projects) {
      const factoriesIdValue = p.factories_id;
      if (factoriesIdValue && factoryById.has(factoriesIdValue)) {
        matchedCount++;
        if (!factoryLinkedProjectsMap.has(factoriesIdValue)) {
          factoryLinkedProjectsMap.set(factoriesIdValue, []);
        }
        factoryLinkedProjectsMap.get(factoriesIdValue)!.push(p);
      } else {
        unmatchedCount++;
      }
    }

    console.log(`[fetch-manufacturer-directory] MAPPING RESULT: matched=${matchedCount}, unmatched=${unmatchedCount}, total=${projects.length}, bridge_column="factories_id"`);

    // Format linked projects per factory with required fields
    const factoryLinkedProjectsResponse: Record<string, any[]> = {};
    if (factories) {
      for (const f of factories) {
        const linkedProjects = factoryLinkedProjectsMap.get(f.id) || [];
        factoryLinkedProjectsResponse[f.id] = linkedProjects.map(p => ({
          id: p.id,
          project_name: p.project_name || '—',
          project_content: p.project_content || '—',
          signed_date: p.signed_date || null,
          estimated_profit: p.estimated_profit !== null && p.estimated_profit !== undefined
            ? Number(p.estimated_profit) || 0
            : 0,
        }));
      }
    }

    // --- Fetch comments (for User Feedback / 用家意見) ---
    let comments: any[] = [];
    try {
      const { data, error } = await masterSupabase
        .from("staff_supplier_comments")
        .select("id, factory_id, factory, comment, evaluator, created_date")
        .order("created_date", { ascending: false });
      if (error) {
        console.error("[fetch-manufacturer-directory] Failed to fetch comments:", error.message);
      } else {
        comments = data || [];
        console.log(`[fetch-manufacturer-directory] Fetched ${comments.length} comments`);
      }
    } catch (e) {
      console.error("[fetch-manufacturer-directory] Exception fetching comments:", (e as Error).message);
    }

    // Products stay empty until FDS has its own source. PMS Production has no bwf_product_master.
    const products: any[] = [];

    const enrichedComments = comments.map((c) => toStaffCommentShape(c));

    // Build aggregate stats per factory
    const factoryStats: Record<string, { order_count: number; comment_count: number }> = {};
    if (factories) {
      for (const f of factories) {
        const linkedProjects = factoryLinkedProjectsResponse[f.id] || [];
        const commentCount = enrichedComments.filter(c => c.factory_id === f.id).length;
        factoryStats[f.id] = {
          order_count: linkedProjects.length,
          comment_count: commentCount,
        };
      }
    }

    // Log summary per factory (top 10 by order count)
    if (factories) {
      const sorted = [...factories].sort((a, b) => (factoryStats[b.id]?.order_count || 0) - (factoryStats[a.id]?.order_count || 0));
      for (const f of sorted.slice(0, 10)) {
        const stats = factoryStats[f.id];
        console.log(`[fetch-manufacturer-directory] Factory "${f.display_name}" (code=${f.factory_code}): orders=${stats?.order_count || 0}, comments=${stats?.comment_count || 0}`);
      }
    }

    return new Response(
      JSON.stringify({
        factories: factories || [],
        comments: enrichedComments,
        products,
        factory_linked_projects: factoryLinkedProjectsResponse,
        factory_stats: factoryStats,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[fetch-manufacturer-directory] Edge function error:", (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
