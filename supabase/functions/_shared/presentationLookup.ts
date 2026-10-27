import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const CUSTOMER_COLUMNS = "id,display_name,company_name,customer_name,phone_display,email,address";
const PROJECT_COLUMNS = "id,project_name,project_code,customer_id,real_customer_display_name";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function customerOption(row: Record<string, unknown>) {
  return {
    id: text(row.id),
    name: text(row.display_name) || text(row.company_name) || text(row.customer_name) || "未命名客戶",
    contactPerson: text(row.customer_name) || null,
    contactEmail: text(row.email) || null,
    contactPhone: text(row.phone_display) || null,
    address: text(row.address) || null,
    projects: [],
  };
}

/** Live PMS lookup for presentation briefs. No customer/project copies in FDS. */
export async function fetchPresentationLookup(db: SupabaseClient, body: {
  action?: string;
  search?: string;
  customer_id?: string;
  limit?: number;
}) {
  const search = text(body.search).replace(/[,()]/g, " ").slice(0, 80);
  const pattern = `%${search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  const limit = Math.min(Math.max(Math.floor(Number(body.limit) || 40), 1), 50);
  if (body.action === "presentation_clients") {
    let query = db.from("customers").select(CUSTOMER_COLUMNS)
      .order("display_name", { ascending: true, nullsFirst: false }).order("id").limit(limit);
    if (search) query = query.or(
      ["display_name", "company_name", "customer_name"].map(column => `${column}.ilike.${pattern}`).join(","),
    );
    const { data, error } = await query;
    if (error) throw new Error(`PMS 客戶搜尋失敗：${error.message}`);
    return { clients: (data ?? []).map(customerOption) };
  }
  if (body.action !== "presentation_projects") throw new Error("Invalid presentation lookup action");
  let query = db.from("bwf_projects").select(PROJECT_COLUMNS)
    .order("project_code", { ascending: false, nullsFirst: false }).order("id").limit(limit);
  const customerId = text(body.customer_id).slice(0, 200);
  if (customerId) query = query.eq("customer_id", customerId);
  if (search) query = query.or(
    ["project_name", "project_code", "real_customer_display_name"].map(column => `${column}.ilike.${pattern}`).join(","),
  );
  const { data, error } = await query;
  if (error) throw new Error(`PMS 專案搜尋失敗：${error.message}`);
  const projects = data ?? [];
  const customerIds = [...new Set(projects.map(row => text(row.customer_id)).filter(Boolean))];
  const customers = customerIds.length
    ? await db.from("customers").select(CUSTOMER_COLUMNS).in("id", customerIds)
    : { data: [], error: null };
  if (customers.error) throw new Error(`PMS 專案客戶載入失敗：${customers.error.message}`);
  const byId = new Map((customers.data ?? []).map(row => [text(row.id), customerOption(row)]));
  return {
    projects: projects.map(row => ({
      id: text(row.id),
      name: text(row.project_name) || text(row.project_code) || "未命名專案",
      code: text(row.project_code) || null,
      customerName: text(row.real_customer_display_name) || null,
      client: byId.get(text(row.customer_id)) ?? null,
      projectType: null,
      note: null,
    })),
  };
}
