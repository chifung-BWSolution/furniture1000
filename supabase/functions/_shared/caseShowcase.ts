import type { SupabaseClient, User } from "jsr:@supabase/supabase-js@2";

// Read the existing PMS contracts; never copy customer/order data into FDS.
const BRAND_TAG = "63175251-2c31-46e6-b107-cbe0140983d8";
/** Same NOS collection the quote form uses for 客戶產業. */
const INDUSTRY_COLLECTION_ID = "4f5de598-2dcb-45a6-a106-9d933e9a8007";
const PROJECT_LIST_COLUMNS =
  "signed_date, p2_code, estimated_income, estimated_profit, n_bwf_service_types_id, cost_center_id, customer_id, status, real_customer_display_name, main_designer_id";
export class CaseAccessError extends Error {}

async function rows(query: any): Promise<any[]> {
  const { data, error } = await query;
  if (error) {
    if (
      error.message?.includes("completion_photos") &&
      /does not exist|schema cache/i.test(error.message)
    ) {
      throw new Error(
        "目前 PMS 環境尚未提供完工相片欄位，請同步 PMS 的完工相片版本後重試。",
      );
    }
    throw new Error(error.message);
  }
  return data ?? [];
}

// PostgREST caps responses at 1000 rows. Stable ordering and explicit paging
// are required for orders, assignments, tags and project summaries alike.
async function all(makeQuery: () => any): Promise<any[]> {
  const result: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rows(
      makeQuery()
        .order("id")
        .range(offset, offset + 499),
    );
    result.push(...page);
    if (page.length < 500) return result;
  }
}

async function byIds(
  db: SupabaseClient,
  table: string,
  columns: string,
  ids: string[],
) {
  const unique = [...new Set(ids.filter(Boolean))];
  const result: any[] = [];
  for (let i = 0; i < unique.length; i += 150) {
    result.push(
      ...(await all(() =>
        db
          .from(table)
          .select(columns)
          .in("id", unique.slice(i, i + 150)),
      )),
    );
  }
  return result;
}

function asMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function famousBrandName(customer: any): string {
  return (
    customer?.brand_name_cn ||
    customer?.brand_name_en ||
    customer?.company_name ||
    customer?.display_name ||
    "未命名品牌"
  );
}

async function rowsByColumn(
  db: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  ids: string[],
) {
  const unique = [...new Set(ids.filter(Boolean))];
  const result: any[] = [];
  for (let i = 0; i < unique.length; i += 150) {
    result.push(
      ...(await all(() =>
        db
          .from(table)
          .select(columns)
          .in(column, unique.slice(i, i + 150)),
      )),
    );
  }
  return result;
}

/** Industry labels and famous-brand names for the given customers. */
async function customerFacets(db: SupabaseClient, customerIds: string[]) {
  const industriesByCustomer = new Map<string, string[]>();
  const famousByCustomer = new Map<string, string>();
  const unique = [...new Set(customerIds.filter(Boolean))];
  if (!unique.length) return { industriesByCustomer, famousByCustomer };
  const industryRows = await all(() =>
    db
      .from("nos_customer_tags")
      .select("id, display")
      .eq("collection_id", INDUSTRY_COLLECTION_ID),
  );
  const industryById = new Map(
    industryRows
      .map((row) => [row.id, String(row.display || "").trim()] as const)
      .filter((entry) => entry[0] && entry[1]),
  );
  const tags = await rowsByColumn(
    db,
    "customer_tags",
    "id, customer_uuid, tag_uuid",
    "customer_uuid",
    unique,
  );
  for (const tag of tags) {
    const label = industryById.get(tag.tag_uuid);
    if (!label || !tag.customer_uuid) continue;
    const list = industriesByCustomer.get(tag.customer_uuid) || [];
    if (!list.includes(label)) list.push(label);
    industriesByCustomer.set(tag.customer_uuid, list);
  }
  const brandCustomerIds = tags
    .filter((tag) => tag.tag_uuid === BRAND_TAG)
    .map((tag) => tag.customer_uuid);
  const brandCustomers = await byIds(
    db,
    "customers",
    "id, brand_name_cn, brand_name_en, company_name, display_name",
    brandCustomerIds,
  );
  for (const customer of brandCustomers) {
    famousByCustomer.set(customer.id, famousBrandName(customer));
  }
  return { industriesByCustomer, famousByCustomer };
}

async function serviceAndBu(db: SupabaseClient, projects: any[]) {
  const services = await byIds(
    db,
    "nos_service_type_2",
    "id, display",
    projects.map((project) => project.n_bwf_service_types_id),
  );
  const centres = await byIds(
    db,
    "cost_centres",
    "id, bu_code",
    projects.map((project) => project.cost_center_id),
  );
  return {
    serviceById: new Map(services.map((row) => [row.id, row.display || null])),
    buById: new Map(centres.map((row) => [row.id, row.bu_code || null])),
  };
}

function projectListFields(
  project: any,
  names: Map<string, string>,
  serviceById: Map<string, string | null>,
  buById: Map<string, string | null>,
  industriesByCustomer: Map<string, string[]>,
  famousByCustomer: Map<string, string>,
) {
  const customerId = project?.customer_id || null;
  return {
    signed_date: project?.signed_date || null,
    service_type: serviceById.get(project?.n_bwf_service_types_id) || null,
    bu_code: buById.get(project?.cost_center_id) || null,
    customer_name: project?.real_customer_display_name || null,
    p2_code: project?.p2_code || null,
    estimated_income: asMoney(project?.estimated_income),
    estimated_profit: asMoney(project?.estimated_profit),
    designer_name: names.get(project?.main_designer_id) || null,
    project_status: project?.status || null,
    industries: customerId ? industriesByCustomer.get(customerId) || [] : [],
    famous_brand: customerId ? famousByCustomer.get(customerId) || null : null,
  };
}

async function furnitureByProject(db: SupabaseClient, projectIds: string[]) {
  const orders = await rowsByColumn(
    db,
    "bwf_orders",
    "id, bwf_project_id, product_id",
    "bwf_project_id",
    projectIds,
  );
  const products = await byIds(
    db,
    "bwf_products",
    "id, product_types_id",
    orders.map((order) => order.product_id),
  );
  const types = await byIds(
    db,
    "product_types",
    "id, display",
    products.map((product) => product.product_types_id),
  );
  const typeById = new Map(types.map((type) => [type.id, type.display]));
  const productType = new Map(
    products.map((product) => [
      product.id,
      typeById.get(product.product_types_id) || null,
    ]),
  );
  const grouped = new Map<string, string[]>();
  for (const order of orders) {
    const label = productType.get(order.product_id);
    if (!label || !order.bwf_project_id) continue;
    const list = grouped.get(order.bwf_project_id) || [];
    if (!list.includes(label)) list.push(label);
    grouped.set(order.bwf_project_id, list);
  }
  return grouped;
}

async function actor(db: SupabaseClient, user: User, module: string) {
  let matches = await rows(
    db.from("users").select("member_id").eq("auth_user_id", user.id),
  );
  // Same verified-email fallback used by fetch-pms-staff-name, only if the
  // identity was confirmed by Auth, and never from request-supplied identity.
  if (!matches.length && user.email && user.email_confirmed_at) {
    matches = await rows(
      db
        .from("users")
        .select("member_id")
        .ilike("email", user.email.replace(/[\\%_]/g, "\\$&")),
    );
  }
  if (matches.length !== 1 || !matches[0].member_id)
    throw new CaseAccessError("未能連結 PMS 職員身份，請使用 PMS 登入。");
  const staff = await rows(
    db
      .from("staff")
      .select("id, role, n_team_type_id")
      .eq("id", matches[0].member_id)
      .eq("status", "Active"),
  );
  if (staff.length !== 1) throw new CaseAccessError("PMS 職員帳號未啟用。");
  const { data, error } = await db.rpc("check_permission", {
    p_user_id: staff[0].id,
    p_module: module,
    p_action: "view",
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new CaseAccessError("沒有此 PMS 頁面的查看權限。");
  return staff[0];
}

async function visibleProjectIds(
  db: SupabaseClient,
  staff: any,
): Promise<string[] | null> {
  const role = (staff.role || "user").trim().toLowerCase();
  const senior = role.includes("senior") && role.includes("user");
  if (role !== "user" && !senior) return null;
  const assigned = await all(() =>
    db
      .from("project_bv")
      .select("id, bwf_project_id")
      .eq("handler_id", staff.id)
      .not("bwf_project_id", "is", null),
  );
  const ids = new Set<string>(assigned.map((r) => r.bwf_project_id));
  if (senior && staff.n_team_type_id) {
    const team = await all(() =>
      db
        .from("bwf_projects")
        .select("id")
        .eq("n_team_type_id", staff.n_team_type_id),
    );
    team.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

export async function fetchCaseShowcase(
  db: SupabaseClient,
  user: User,
  action: string,
) {
  if (!["cases-orders", "cases-photos", "cases-brands"].includes(action))
    throw new CaseAccessError("不支援的查詢。");
  const staff = await actor(
    db,
    user,
    action === "cases-brands"
      ? "brands"
      : action === "cases-photos"
        ? "completion-photos"
        : "bwf/projects",
  );
  const projectPermission = action === "cases-orders" ? true : await (async () => {
    const { data, error } = await db.rpc("check_permission", {
      p_user_id: staff.id, p_module: "bwf/projects", p_action: "view",
    });
    if (error) throw new Error(error.message);
    return data === true;
  })();
  if (action === "cases-brands") {
    const tags = await all(() =>
      db
        .from("customer_tags")
        .select("id, customer_uuid")
        .eq("tag_uuid", BRAND_TAG),
    );
    const customers = await byIds(
      db,
      "customers",
      "id, status, brand_name_cn, brand_name_en, branding_icon, display_name, company_name, view_system",
      tags.map((t) => t.customer_uuid),
    );
    const active = customers.filter((c) => c.status === "Active");
    const summaries: any[] = [];
    for (let i = 0; i < active.length; i += 150) {
      summaries.push(
        ...(await all(() =>
          db
            .from("bwa_projects")
            .select(
              "id, customer_id, project_code, project_name, signed_date, n_service_type_id",
            )
            .in(
              "customer_id",
              active.slice(i, i + 150).map((c) => c.id),
            ),
        )),
      );
    }
    const serviceTypes = await all(() =>
      db.from("service_types").select("id, display"),
    );
    const projectTypes = await all(() =>
      db.from("project_types").select("id, display"),
    );
    // PMS uses the junction contract for project types, not the legacy field.
    const junctions = await all(() =>
      db
        .from("bwa_project_project_types")
        .select("id, project_id, project_type_id"),
    );
    const items = active.map(({ status: _status, ...c }) => {
      const projects = summaries
        .filter((p) => p.customer_id === c.id)
        .sort((a, b) =>
          (b.signed_date || "").localeCompare(a.signed_date || ""),
        );
      const ids = new Set(projects.map((p) => p.id));
      return {
        ...c,
        project_count: projects.length,
        recent_projects: projects.slice(0, 3),
        service_type_ids: [
          ...new Set(
            projects.map((p) => p.n_service_type_id).filter(Boolean),
          ),
        ],
        project_type_ids: [
          ...new Set(
            junctions
              .filter((j) => ids.has(j.project_id))
              .map((j) => j.project_type_id),
          ),
        ],
      };
    });
    const { industriesByCustomer } = await customerFacets(
      db,
      items.map((item) => item.id),
    );
    const visibleProjects = projectPermission ? await visibleProjectIds(db, staff) : [];
    const allBwfProjects = await rowsByColumn(
      db,
      "bwf_projects",
      "id, customer_id, signed_date, estimated_income",
      "customer_id",
      items.map((item) => item.id),
    );
    const visibleSet = visibleProjects === null ? null : new Set(visibleProjects);
    const bwfProjects = allBwfProjects.filter((project) => visibleSet === null || visibleSet.has(project.id));
    const furniture = await furnitureByProject(
      db,
      bwfProjects.map((project) => project.id),
    );
    return {
      items: items.map((item) => ({
        ...item,
        industries: industriesByCustomer.get(item.id) || [],
        filter_projects: bwfProjects
          .filter((project) => project.customer_id === item.id)
          .map((project) => ({
            signed_date: project.signed_date || null,
            estimated_income: asMoney(project.estimated_income),
            furniture_types: furniture.get(project.id) || [],
          })),
      })),
      service_types: serviceTypes,
      project_types: projectTypes,
    };
  }
  const visible = await visibleProjectIds(db, staff);
  if (visible?.length === 0) return { items: [] };
  const projectCols =
    action === "cases-photos"
      ? `id, project_code, project_name, main_pm_id, n_financial_year_id, completion_photos, handover_date, modified_date, site_address, ${PROJECT_LIST_COLUMNS}`
      : `id, project_code, project_name, main_pm_id, completion_photos, ${PROJECT_LIST_COLUMNS}`;
  const projects =
    visible === null
      ? await all(() => db.from("bwf_projects").select(projectCols))
      : await byIds(db, "bwf_projects", projectCols, visible);
  const people = await byIds(
    db,
    "staff",
    "id, name",
    projects.flatMap((p) => [p.main_pm_id, p.main_designer_id]),
  );
  const names = new Map(people.map((p) => [p.id, p.name]));
  const { serviceById, buById } = await serviceAndBu(db, projects);
  const { industriesByCustomer, famousByCustomer } = await customerFacets(
    db,
    projects.map((project) => project.customer_id),
  );
  if (action === "cases-photos") {
    const withPhotos = projects.filter(
      (p) =>
        p.completion_photos?.trim() &&
        !["[]", "null"].includes(p.completion_photos.trim()),
    );
    const years = await byIds(
      db,
      "financial_years",
      "id, display",
      withPhotos.map((p) => p.n_financial_year_id),
    );
    const yearNames = new Map(years.map((y) => [y.id, y.display]));
    const furniture = await furnitureByProject(
      db,
      withPhotos.map((project) => project.id),
    );
    return {
      items: withPhotos
        .map((p) => ({
          ...p,
          pm_name: names.get(p.main_pm_id) || null,
          designer_name: names.get(p.main_designer_id) || null,
          financial_year: yearNames.get(p.n_financial_year_id) || null,
          ...projectListFields(
            p,
            names,
            serviceById,
            buById,
            industriesByCustomer,
            famousByCustomer,
          ),
          furniture_types: furniture.get(p.id) || [],
          ...(!projectPermission ? { estimated_income: null, estimated_profit: null } : {}),
        }))
        .sort((a, b) =>
          (b.modified_date || "").localeCompare(a.modified_date || ""),
        ),
    };
  }
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const orderColumns =
    "id, bwf_project_id, product_id, factory_id, quantity, o_order_status, production_start_date, production_finish_date_est, production_finish_date, site_arrival_date_est, site_arrival_date, complete_installation_date_est, complete_installation_date, o_delivery_target, installation_team_id, installer_needed, remarks, created_date";
  const orders: any[] = [];
  const ids = [...projectMap.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    orders.push(
      ...(await all(() =>
        db
          .from("bwf_orders")
          .select(orderColumns)
          .in("bwf_project_id", ids.slice(i, i + 150)),
      )),
    );
  }
  const products = await byIds(
    db,
    "bwf_products",
    "id, display, product_types_id",
    orders.map((o) => o.product_id),
  );
  const factories = await byIds(
    db,
    "factories",
    "id, factory_name, display_name",
    orders.map((o) => o.factory_id),
  );
  const productsById = new Map(products.map((p) => [p.id, p]));
  const productTypes = await byIds(
    db,
    "product_types",
    "id, display",
    products.map((p) => p.product_types_id),
  );
  const productTypeById = new Map(productTypes.map((t) => [t.id, t.display]));
  const teams = await byIds(
    db,
    "suppliers",
    "id, display_name, chinese_name, name",
    orders.map((o) => o.installation_team_id),
  );
  const teamById = new Map(
    teams.map((t) => [t.id, t.display_name || t.chinese_name || t.name]),
  );
  const productNames = new Map(products.map((p) => [p.id, p.display]));
  const factoryNames = new Map(
    factories.map((f) => [f.id, f.factory_name || f.display_name]),
  );
  return {
    items: orders
      .map((o) => {
        const p = projectMap.get(o.bwf_project_id);
        return {
          id: o.id,
          project_id: o.bwf_project_id,
          project_code: p?.project_code,
          project_name: p?.project_name,
          pm_name: names.get(p?.main_pm_id) || null,
          completion_photos: p?.completion_photos ?? null,
          ...projectListFields(
            p,
            names,
            serviceById,
            buById,
            industriesByCustomer,
            famousByCustomer,
          ),
          product_name: productNames.get(o.product_id) || null,
          product_type:
            productTypeById.get(productsById.get(o.product_id)?.product_types_id) || null,
          factory_name: factoryNames.get(o.factory_id) || null,
          quantity: o.quantity,
          status: o.o_order_status,
          production_start_date: o.production_start_date,
          production_finish_date_est: o.production_finish_date_est,
          production_finish_date: o.production_finish_date,
          est_delivery_date: o.site_arrival_date_est,
          actual_delivery_date: o.site_arrival_date,
          est_installation_date: o.complete_installation_date_est,
          actual_installation_date: o.complete_installation_date,
          delivery_target: o.o_delivery_target,
          installation_team_name: teamById.get(o.installation_team_id) || null,
          installer_needed:
            o.installer_needed === true || o.installer_needed === "true"
              ? true
              : o.installer_needed === false || o.installer_needed === "false"
                ? false
                : null,
          remarks: o.remarks,
          created_date: o.created_date,
        };
      })
      .sort((a, b) =>
        (b.created_date || "").localeCompare(a.created_date || ""),
      ),
  };
}
