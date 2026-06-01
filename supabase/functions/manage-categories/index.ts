import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action: string };

    switch (action) {
      case "list": {
        const { data, error } = await supabase
          .from("bwf_product_categories")
          .select("*")
          .order("level", { ascending: true })
          .order("sort_order", { ascending: true });

        if (error) throw new Error(`Failed to list categories: ${error.message}`);

        return new Response(
          JSON.stringify({ categories: data || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "create": {
        const { name, parent_id, level, sort_order } = body as {
          name: string;
          parent_id?: string | null;
          level: number;
          sort_order?: number;
        };

        if (!name || !level) {
          throw new Error("name and level are required");
        }

        // Get max sort_order for the level/parent
        let maxSortQuery = supabase
          .from("bwf_product_categories")
          .select("sort_order")
          .eq("level", level);

        if (parent_id) {
          maxSortQuery = maxSortQuery.eq("parent_id", parent_id);
        } else {
          maxSortQuery = maxSortQuery.is("parent_id", null);
        }

        const { data: existingItems } = await maxSortQuery.order("sort_order", { ascending: false }).limit(1);
        const nextSortOrder = sort_order ?? ((existingItems?.[0]?.sort_order ?? 0) + 1);

        const { data, error } = await supabase
          .from("bwf_product_categories")
          .insert({
            name,
            parent_id: parent_id || null,
            level,
            sort_order: nextSortOrder,
          })
          .select()
          .single();

        if (error) throw new Error(`Failed to create category: ${error.message}`);

        return new Response(
          JSON.stringify({ category: data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "update": {
        const { id, name, sort_order: newSortOrder } = body as {
          id: string;
          name?: string;
          sort_order?: number;
        };

        if (!id) throw new Error("id is required");

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (newSortOrder !== undefined) updateData.sort_order = newSortOrder;

        const { data, error } = await supabase
          .from("bwf_product_categories")
          .update(updateData)
          .eq("id", id)
          .select()
          .single();

        if (error) throw new Error(`Failed to update category: ${error.message}`);

        return new Response(
          JSON.stringify({ category: data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "delete": {
        const { id } = body as { id: string };
        if (!id) throw new Error("id is required");

        // Delete will cascade to children due to ON DELETE CASCADE
        const { error } = await supabase
          .from("bwf_product_categories")
          .delete()
          .eq("id", id);

        if (error) throw new Error(`Failed to delete category: ${error.message}`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "reorder": {
        const { items } = body as { items: { id: string; sort_order: number }[] };
        if (!items || !Array.isArray(items)) throw new Error("items array is required");

        for (const item of items) {
          const { error } = await supabase
            .from("bwf_product_categories")
            .update({ sort_order: item.sort_order })
            .eq("id", item.id);

          if (error) throw new Error(`Failed to reorder category ${item.id}: ${error.message}`);
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "assign_product": {
        const { product_id, category_name } = body as {
          product_id: string;
          category_name: string;
        };

        if (!product_id) throw new Error("product_id is required");

        const { error } = await supabase
          .from("products")
          .update({ category: category_name || null })
          .eq("id", product_id);

        if (error) throw new Error(`Failed to assign category: ${error.message}`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "bulk_assign": {
        const { product_ids, category_name } = body as {
          product_ids: string[];
          category_name: string;
        };

        if (!product_ids || !Array.isArray(product_ids)) throw new Error("product_ids array is required");

        const { error } = await supabase
          .from("products")
          .update({ category: category_name || null })
          .in("id", product_ids);

        if (error) throw new Error(`Failed to bulk assign categories: ${error.message}`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "product_counts": {
        // Get product count per category name
        const { data: allProducts, error: countError } = await supabase
          .from("products")
          .select("category");

        if (countError) throw new Error(`Failed to count products: ${countError.message}`);

        const counts: Record<string, number> = {};
        let uncategorized = 0;
        let categorized = 0;

        for (const p of allProducts || []) {
          if (!p.category || p.category.trim() === "") {
            uncategorized++;
          } else {
            categorized++;
            counts[p.category] = (counts[p.category] || 0) + 1;
          }
        }

        return new Response(
          JSON.stringify({ counts, uncategorized, categorized }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      case "list_products_by_category": {
        const { category_name, page = 1, page_size = 50 } = body as {
          category_name?: string;
          page?: number;
          page_size?: number;
        };

        const from = (page - 1) * page_size;
        const to = from + page_size - 1;

        let query = supabase
          .from("products")
          .select("id, title, image_url, category, status, price, factories_display_name, description, description_html, tags, collection, shopify_product_id, source, synced_at, created_at, color, factory_id, cost_price, production_date, shipping_days, shipping_fee, total_lead_time, bwf_master_id, remarks, images, dimension_l_mm, dimension_w_mm, dimension_h_mm, sale_price", { count: "exact" });

        if (category_name === "__uncategorized__") {
          // Match products where category is null OR empty string
          query = query.or("category.is.null,category.eq.");
        } else if (category_name) {
          query = query.eq("category", category_name);
        }

        query = query.order("title", { ascending: true }).range(from, to);

        const { data, error, count } = await query;

        if (error) throw new Error(`Failed to list products: ${error.message}`);

        return new Response(
          JSON.stringify({
            products: data || [],
            total: count || 0,
            page,
            page_size,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error("Edge function error:", (error as Error).message);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
