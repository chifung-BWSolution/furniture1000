import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MASTER_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const masterServiceKey = Deno.env.get("FACTORY_SERVICE_ROLE_KEY") || "";
    if (!masterServiceKey) {
      throw new Error(
        "FACTORY_SERVICE_ROLE_KEY is not configured. Please set this secret in Edge Function Secrets."
      );
    }

    const masterSupabase = createClient(MASTER_PROJECT_URL, masterServiceKey);

    const body = await req.json().catch(() => ({}));
    const {
      search = "",
      factory_name = "",
      page = 1,
      page_size = 20,
    } = body as {
      search?: string;
      factory_name?: string;
      page?: number;
      page_size?: number;
    };

    const from = (page - 1) * page_size;
    const to = from + page_size - 1;

    // Try with delivery_terms join first, fall back to without it
    let products: Record<string, unknown>[] = [];
    let totalCount = 0;

    // First attempt: with delivery_terms join
    let query = masterSupabase
      .from("bwf_product_master")
      .select("id, title, image_url, sale_price, cost_price, factory_name, category, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, delivery_term_name, delivery_terms(name)", {
        count: "exact",
      })
      .not("title", "is", null)
      .neq("title", "");

    if (search.trim()) {
      query = query.ilike("title", `%${search.trim()}%`);
    }

    if (factory_name.trim()) {
      query = query.eq("factory_name", factory_name.trim());
    }

    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data, error, count } = await query;

    if (error) {
      // If the join failed (e.g. delivery_terms table doesn't exist), retry without it
      console.warn("Query with delivery_terms join failed, retrying without:", error.message);

      let fallbackQuery = masterSupabase
        .from("bwf_product_master")
        .select("id, title, image_url, sale_price, cost_price, factory_name, category, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, delivery_term_name", {
          count: "exact",
        })
        .not("title", "is", null)
        .neq("title", "");

      if (search.trim()) {
        fallbackQuery = fallbackQuery.ilike("title", `%${search.trim()}%`);
      }

      if (factory_name.trim()) {
        fallbackQuery = fallbackQuery.eq("factory_name", factory_name.trim());
      }

      fallbackQuery = fallbackQuery.order("created_at", { ascending: false }).range(from, to);

      const { data: fbData, error: fbError, count: fbCount } = await fallbackQuery;

      if (fbError) {
        // Last resort: query without delivery_term_name column too
        console.warn("Fallback also failed, trying minimal columns:", fbError.message);

        let minimalQuery = masterSupabase
          .from("bwf_product_master")
          .select("id, title, image_url, sale_price, cost_price, factory_name, category, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks", {
            count: "exact",
          })
          .not("title", "is", null)
          .neq("title", "");

        if (search.trim()) {
          minimalQuery = minimalQuery.ilike("title", `%${search.trim()}%`);
        }

        if (factory_name.trim()) {
          minimalQuery = minimalQuery.eq("factory_name", factory_name.trim());
        }

        minimalQuery = minimalQuery.order("created_at", { ascending: false }).range(from, to);

        const { data: minData, error: minError, count: minCount } = await minimalQuery;

        if (minError) {
          throw new Error(`Failed to fetch products: ${minError.message}`);
        }

        products = (minData || []).map((item: Record<string, unknown>) => ({
          ...item,
          delivery_term_name: null,
        }));
        totalCount = minCount || 0;
      } else {
        products = (fbData || []).map((item: Record<string, unknown>) => ({
          ...item,
          delivery_term_name: (item as any).delivery_term_name || null,
        }));
        totalCount = fbCount || 0;
      }
    } else {
      // Flatten delivery_terms join into delivery_term_name
      products = (data || []).map((item: Record<string, unknown>) => {
        const { delivery_terms, ...rest } = item as Record<string, unknown> & { delivery_terms?: { name: string } | null };
        return {
          ...rest,
          delivery_term_name: delivery_terms?.name || (rest as any).delivery_term_name || null,
        };
      });
      totalCount = count || 0;
    }

    return new Response(
      JSON.stringify({
        products,
        total: totalCount,
        page,
        page_size,
        total_pages: Math.ceil(totalCount / page_size),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Edge function error:", (error as Error).message);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
