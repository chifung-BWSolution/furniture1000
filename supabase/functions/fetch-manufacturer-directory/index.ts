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

/** PMS stores created_date / evaluator. The directory UI still reads created_at / staff_name. */
function toStaffCommentShape(row: Record<string, unknown>) {
  const evaluator = typeof row.evaluator === "string" ? row.evaluator.trim() : "";
  return {
    ...row,
    created_at: row.created_date ?? null,
    staff_name: evaluator || "匿名用戶",
  };
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

    // Handle save feedback action. PMS factory_id is factories.id (uuid).
    if (body.action === "save_feedback" && body.feedback) {
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
      const evaluator = (staff_name ?? "").trim() || "匿名用戶";
      const { data: insertedComment, error: insertError } = await masterSupabase
        .from("staff_supplier_comments")
        .insert({
          factory_id: fId,
          factory: factory_name,
          comment,
          evaluator,
        })
        .select()
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
      .select(
        "id, display_name, factory_code, created_at, contact_person, phone, location, project_number, working_folder, join_date"
      )
      .ilike("status", "active")
      .order("display_name", { ascending: true });

    if (factoryId) {
      factoriesQuery = factoriesQuery.eq("id", factoryId);
    }

    const { data: factories, error: factoriesError } = await factoriesQuery;

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
        .select("*")
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
