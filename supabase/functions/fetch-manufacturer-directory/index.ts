import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MASTER_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";
const MASTER_SERVICE_KEY = Deno.env.get("FACTORY_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const MATERIAL_TYPE_RE = /material|物料/i;

type SupplierKind = "furniture" | "material" | "both";

type DirectorySignals = {
  quote_names?: string[];
  catalogs?: Array<{ factory_code?: string | null; factory_name?: string | null; year?: number | null }>;
  documents?: Array<{
    factory_id?: string | null;
    factory_name?: string | null;
    doc_type?: string | null;
    year?: number | null;
  }>;
};

function normName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function codeTokens(value: string | null | undefined): string[] {
  return (value || "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 3);
}

function shanghaiYear(): number {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(new Date());
  return Number(year);
}

function kindFromDisplays(displays: string[]): SupplierKind | null {
  let material = false;
  let furniture = false;
  for (const display of displays) {
    if (!display) continue;
    if (MATERIAL_TYPE_RE.test(display)) material = true;
    else furniture = true;
  }
  if (material && furniture) return "both";
  if (material) return "material";
  if (furniture) return "furniture";
  return null;
}

function bumpYear(map: Map<string, number>, factoryId: string | null, year: number | null | undefined) {
  if (!factoryId || year == null || !Number.isFinite(year)) return;
  const prev = map.get(factoryId);
  if (prev == null || year > prev) map.set(factoryId, year);
}

async function loadDirectorySignals(
  masterSupabase: ReturnType<typeof createClient>,
  factories: Array<{ id: string; display_name?: string | null; factory_code?: string | null; key_product_categories?: string | null }>,
) {
  const kindById = new Map<string, SupplierKind | null>();
  const usedIds = new Set<string>();
  const catalogYear = new Map<string, number>();
  const quotePdfYear = new Map<string, number>();

  const byId = new Map(factories.map((factory) => [factory.id, factory]));
  const byName = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const factory of factories) {
    const name = normName(factory.display_name);
    if (name && !byName.has(name)) byName.set(name, factory.id);
    const code = (factory.factory_code || "").trim().toUpperCase();
    if (code && code !== "-" && !byCode.has(code)) byCode.set(code, factory.id);
  }

  const resolveFactoryId = (name: string | null | undefined, codeOrId: string | null | undefined): string | null => {
    const raw = (codeOrId || "").trim();
    if (raw && byId.has(raw)) return raw;
    const code = raw.toUpperCase();
    if (code && byCode.has(code)) return byCode.get(code) || null;
    const normalized = normName(name);
    if (normalized && byName.has(normalized)) return byName.get(normalized) || null;
    const tokens = new Set([
      ...codeTokens(name),
      ...(code.length >= 3 ? [code] : []),
    ]);
    let match: string | null = null;
    for (const token of tokens) {
      const id = byCode.get(token);
      if (!id) continue;
      if (match && match !== id) return null;
      match = id;
    }
    return match;
  };

  try {
    const { data: types, error } = await masterSupabase
      .from("product_types")
      .select("id, bubble_id, display");
    if (error) {
      console.error("[fetch-manufacturer-directory] Failed to fetch product types:", error.message);
    } else {
      const displayByKey = new Map<string, string>();
      for (const row of types || []) {
        if (row.bubble_id) displayByKey.set(String(row.bubble_id), row.display || "");
        if (row.id) displayByKey.set(String(row.id), row.display || "");
      }
      for (const factory of factories) {
        const ids = String(factory.key_product_categories || "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        const displays = ids
          .map((id) => displayByKey.get(id))
          .filter((display): display is string => Boolean(display));
        kindById.set(factory.id, kindFromDisplays(displays));
      }
    }
  } catch (error) {
    console.error("[fetch-manufacturer-directory] Exception fetching product types:", (error as Error).message);
  }

  const furnitureUrl = Deno.env.get("SUPABASE_URL") || "";
  const furnitureKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("BWF_SUPABASE_SERVICE_ROLE_KEY") ||
    "";
  if (!furnitureUrl || !furnitureKey) {
    console.error("[fetch-manufacturer-directory] Furniture service role is not configured; directory signals skipped");
    return { kindById, usedIds, catalogYear, quotePdfYear };
  }

  try {
    const furniture = createClient(furnitureUrl, furnitureKey);
    const { data, error } = await furniture.rpc("manufacturer_directory_signals", {
      p_year: shanghaiYear(),
    });
    if (error) {
      console.error("[fetch-manufacturer-directory] Signals RPC failed:", error.message);
      return { kindById, usedIds, catalogYear, quotePdfYear };
    }
    const signals = (data || {}) as DirectorySignals;
    for (const name of signals.quote_names || []) {
      const id = resolveFactoryId(name, null);
      if (id) usedIds.add(id);
    }
    for (const row of signals.catalogs || []) {
      bumpYear(catalogYear, resolveFactoryId(row.factory_name, row.factory_code), row.year);
    }
    for (const row of signals.documents || []) {
      const id = resolveFactoryId(row.factory_name, row.factory_id);
      if (row.doc_type === "quote" || row.doc_type === "price_list") bumpYear(quotePdfYear, id, row.year);
      else if (row.doc_type === "catalog") bumpYear(catalogYear, id, row.year);
    }
  } catch (error) {
    console.error("[fetch-manufacturer-directory] Exception loading directory signals:", (error as Error).message);
  }

  return { kindById, usedIds, catalogYear, quotePdfYear };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    if (!MASTER_SERVICE_KEY) {
      throw new Error(
        "FACTORY_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not configured. Please set this secret in the Supabase project Edge Function settings."
      );
    }

    const masterSupabase = createClient(MASTER_PROJECT_URL, MASTER_SERVICE_KEY);

    let body: { factory_id?: string; action?: string; feedback?: { factory_id: string; factory_name: string; comment: string; staff_name: string } } = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine - fetch all
    }

    // Handle save feedback action
    if (body.action === "save_feedback" && body.feedback) {
      const { factory_id: fId, factory_name, comment, staff_name } = body.feedback;
      const { data: insertedComment, error: insertError } = await masterSupabase
        .from("staff_supplier_comments")
        .insert({
          factory_id: fId,
          factory: factory_name,
          comment,
          staff_name: staff_name || "匿名用戶",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to save feedback: ${insertError.message}`);
      }

      return new Response(
        JSON.stringify({ success: true, comment: insertedComment }),
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
        "id, display_name, factory_code, created_at, contact_person, phone, location, project_number, working_folder, join_date, key_product_categories"
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
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[fetch-manufacturer-directory] Failed to fetch comments:", error.message);
      } else {
        comments = data || [];
        console.log(`[fetch-manufacturer-directory] Fetched ${comments.length} comments`);
      }
    } catch (e) {
      console.error("[fetch-manufacturer-directory] Exception fetching comments:", (e as Error).message);
    }

    // --- Fetch products from bwf_product_master ---
    let products: any[] = [];
    try {
      const { data, error } = await masterSupabase
        .from("bwf_product_master")
        .select("id, title, factory_id, factory_name, images, category")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[fetch-manufacturer-directory] Failed to fetch products:", error.message);
      } else {
        products = data || [];
        console.log(`[fetch-manufacturer-directory] Fetched ${products.length} products`);
      }
    } catch (e) {
      console.error("[fetch-manufacturer-directory] Exception fetching products:", (e as Error).message);
    }

    // Enrich comments - resolve factory_id using direct ID match
    const enrichedComments = comments.map(c => {
      if (c.factory_id && factoryById.has(c.factory_id)) {
        return { ...c, factory_id: c.factory_id };
      }
      return c;
    });

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

    const signals = await loadDirectorySignals(masterSupabase, factories || []);
    const enrichedFactories = (factories || []).map((factory) => {
      const { key_product_categories: _categories, ...rest } = factory;
      return {
        ...rest,
        supplier_kind: signals.kindById.get(factory.id) ?? null,
        used_this_year: signals.usedIds.has(factory.id),
        catalog_year: signals.catalogYear.get(factory.id) ?? null,
        quote_pdf_year: signals.quotePdfYear.get(factory.id) ?? null,
      };
    });

    return new Response(
      JSON.stringify({
        factories: enrichedFactories,
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
