import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";
const ADMIN_EMAILS = new Set([
  "cf@bwsolution.com",
  "chifung.login@gmail.com",
]);

type UserRole = "admin" | "uploader" | "pm" | "designer" | "client";
type LogType = "login" | "logout" | "failed" | "edit" | "publish";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e || null;
}

function deriveRole(
  email: string,
  displayName: string | null,
  source: "pms" | "client",
): UserRole {
  if (source === "client") return "client";
  if (ADMIN_EMAILS.has(email)) return "admin";
  const name = (displayName ?? "").toLowerCase();
  if (name.includes("設計") || name.includes("designer") || name.includes("design")) {
    return "designer";
  }
  if (name.includes("經理") || name.includes("pm") || name.includes("project")) {
    return "pm";
  }
  return "uploader";
}

type StaffRef = { id?: string | null; name?: string | null };
type PmsUserRow = {
  auth_user_id?: string | null;
  member_id?: string | null;
  email?: string | null;
  staff?: StaffRef | StaffRef[] | null;
};

function extractPmsUser(row: PmsUserRow) {
  const staff = Array.isArray(row.staff) ? row.staff[0] : row.staff;
  const staff_id = staff?.id?.trim() || row.member_id?.trim() || null;
  const display_name = staff?.name?.trim() || null;
  const email = normalizeEmail(row.email);
  const auth_user_id = row.auth_user_id?.trim() || null;
  return { staff_id, display_name, email, auth_user_id };
}

async function listPmsUsers(pmsAdmin: ReturnType<typeof createClient>) {
  const { data, error } = await pmsAdmin
    .from("users")
    .select("auth_user_id, member_id, email, staff!fk_users_member_id(id, name)")
    .not("email", "is", null)
    .order("email", { ascending: true });

  if (error) throw new Error(`PMS users lookup failed: ${error.message}`);

  const byEmail = new Map<string, ReturnType<typeof extractPmsUser>>();
  for (const row of data ?? []) {
    const parsed = extractPmsUser(row as PmsUserRow);
    if (!parsed.email) continue;
    byEmail.set(parsed.email, parsed);
  }
  return byEmail;
}

async function fetchAuthMeta(
  furnitureAdmin: ReturnType<typeof createClient>,
  authUserIds: string[],
): Promise<Map<string, { last_login_at: string | null; active: boolean }>> {
  const map = new Map<string, { last_login_at: string | null; active: boolean }>();
  const unique = [...new Set(authUserIds.filter(Boolean))];

  for (const authUserId of unique) {
    const { data, error } = await furnitureAdmin.auth.admin.getUserById(authUserId);
    if (error || !data.user) continue;
    map.set(authUserId, {
      last_login_at: data.user.last_sign_in_at ?? null,
      active: !data.user.banned_until,
    });
  }
  return map;
}

type ProfileRow = {
  id: string;
  email: string;
  auth_user_id: string | null;
  staff_id: string | null;
  display_name: string | null;
  role: UserRole;
  active: boolean;
  source: "pms" | "client";
  last_login_at: string | null;
};

async function syncProfiles(
  furnitureAdmin: ReturnType<typeof createClient>,
  pmsUsers: Map<string, ReturnType<typeof extractPmsUser>>,
  clientEmails: { email: string; display_name: string | null }[],
  authMeta: Map<string, { last_login_at: string | null; active: boolean }>,
): Promise<ProfileRow[]> {
  const { data: existing, error: existingErr } = await furnitureAdmin
    .from("platform_user_profiles")
    .select("*");
  if (existingErr) throw new Error(`profiles read failed: ${existingErr.message}`);

  const existingByEmail = new Map<string, ProfileRow>();
  for (const row of existing ?? []) {
    const email = normalizeEmail(row.email);
    if (email) existingByEmail.set(email, row as ProfileRow);
  }

  const now = new Date().toISOString();
  const upserts: Record<string, unknown>[] = [];

  for (const [email, pms] of pmsUsers) {
    const prev = existingByEmail.get(email);
    const auth = pms.auth_user_id ? authMeta.get(pms.auth_user_id) : undefined;
    const lastLogin = auth?.last_login_at ?? prev?.last_login_at ?? null;
    const active = auth ? auth.active : (prev?.active ?? true);
    upserts.push({
      email,
      auth_user_id: pms.auth_user_id,
      staff_id: pms.staff_id,
      display_name: pms.display_name ?? prev?.display_name ?? email.split("@")[0],
      role: prev?.role ?? deriveRole(email, pms.display_name, "pms"),
      active,
      source: "pms",
      last_login_at: lastLogin,
      updated_at: now,
    });
  }

  for (const client of clientEmails) {
    const email = normalizeEmail(client.email);
    if (!email || pmsUsers.has(email)) continue;
    const prev = existingByEmail.get(email);
    upserts.push({
      email,
      auth_user_id: prev?.auth_user_id ?? null,
      staff_id: null,
      display_name: client.display_name ?? prev?.display_name ?? email.split("@")[0],
      role: "client",
      active: prev?.active ?? true,
      source: "client",
      last_login_at: prev?.last_login_at ?? null,
      updated_at: now,
    });
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await furnitureAdmin
      .from("platform_user_profiles")
      .upsert(upserts, { onConflict: "email" });
    if (upsertErr) throw new Error(`profiles upsert failed: ${upsertErr.message}`);
  }

  const { data: merged, error: mergedErr } = await furnitureAdmin
    .from("platform_user_profiles")
    .select("*")
    .order("display_name", { ascending: true });
  if (mergedErr) throw new Error(`profiles reload failed: ${mergedErr.message}`);
  return (merged ?? []) as ProfileRow[];
}

type LoginLog = {
  id: string;
  user: string;
  email?: string;
  type: LogType;
  detail?: string;
  skus?: string[];
  ip: string;
  location: string;
  at: string;
  suspicious: boolean;
};

const STAGE_PAGE_LABELS: Record<string, string> = {
  copywriting: "產品文案",
  product_info: "產品信息",
  furniture_group_check: "傢俬組檢查",
  ready_to_publish: "準備上載",
  listed_products: "待處理產品",
  product_catalog: "產品目錄",
  ai_processor: "AI 處理",
  settings: "設定",
  general: "系統",
};

function mapUploadAction(action: string, stage: string): LogType {
  if (action === "upload") return "publish";
  if (stage === "ready_to_publish" && action === "add_to_ready") return "publish";
  return "edit";
}

function resolveSku(
  productSku: string | null | undefined,
  productId: string | null | undefined,
  skuByProductId: Map<string, string>,
): string {
  return String(productSku ?? "").trim()
    || (productId ? skuByProductId.get(productId) ?? "" : "")
    || "";
}

function buildEditDetail(
  stage: string,
  pageLabel: string | null | undefined,
  productSku: string | null | undefined,
  productId: string | null | undefined,
  skuByProductId: Map<string, string>,
): string | undefined {
  const page = String(pageLabel ?? "").trim() || STAGE_PAGE_LABELS[stage] || stage || "系統";
  const sku = resolveSku(productSku, productId, skuByProductId);
  if (sku) return `${page} · SKU ${sku}`;
  return page;
}

type PendingUploadLog = {
  id: string;
  user: string;
  email?: string;
  logType: LogType;
  stage: string;
  pageLabel: string | null | undefined;
  productId: string | null | undefined;
  sku: string;
  at: string;
};

/** Group bulk publish actions (same user within 3 minutes) into one row. */
const PUBLISH_GROUP_MS = 180_000;

function publishGroupKey(user: string, email: string | undefined, at: string): string {
  const bucket = Math.floor(new Date(at).getTime() / PUBLISH_GROUP_MS);
  return `${user}|${email ?? ""}|${bucket}`;
}

async function fetchLoginLogs(
  furnitureAdmin: ReturnType<typeof createClient>,
  profiles: ProfileRow[],
): Promise<{ logs: LoginLog[]; trend: { day: string; 成功: number; 失敗: number }[] }> {
  const nameByEmail = new Map<string, string>();
  const nameByAuthId = new Map<string, string>();
  for (const p of profiles) {
    const label = p.display_name?.trim() || p.email;
    nameByEmail.set(p.email, label);
    if (p.auth_user_id) nameByAuthId.set(p.auth_user_id, label);
  }

  const formatUser = (name: string | null | undefined, email: string | null | undefined): string => {
    const n = String(name ?? "").trim();
    const e = normalizeEmail(email) ?? "";
    if (n && e && n !== e && !n.includes(e)) {
      if (n === "Branding Works" && e === "chifung.login@gmail.com") {
        return `${n} (${e})`;
      }
    }
    return n || (e ? nameByEmail.get(e) ?? e : "") || "未知用戶";
  };

  const logs: LoginLog[] = [];
  const loginLogDedupeKeys = new Set<string>();
  const displayedLoginKeys = new Set<string>();

  const loginAtMs = (iso: string): number => new Date(iso).getTime();
  const loginDedupeKey = (userId: string, iso: string): string => {
    const bucket = Math.floor(loginAtMs(iso) / 120_000);
    return `${userId}|${bucket}`;
  };
  const shouldIncludeLogin = (userKey: string, iso: string): boolean => {
    const bucket = Math.floor(loginAtMs(iso) / 120_000);
    const key = `${userKey}|${bucket}`;
    if (displayedLoginKeys.has(key)) return false;
    displayedLoginKeys.add(key);
    return true;
  };

  const { data: loginRows } = await furnitureAdmin
    .from("login_log")
    .select("id, user_id, user_email, user_name, event, login_method, logged_at")
    .order("logged_at", { ascending: false })
    .limit(150);

  for (const row of loginRows ?? []) {
    const email = normalizeEmail(row.user_email);
    const userId = String(row.user_id ?? "");
    const userKey = userId || email || String(row.user_name ?? "");
    const loggedAt = String(row.logged_at);
    if (userKey && !shouldIncludeLogin(userKey, loggedAt)) continue;
    if (userId) loginLogDedupeKeys.add(loginDedupeKey(userId, loggedAt));
    const method = String(row.login_method ?? "password");
    logs.push({
      id: `ll-${row.id}`,
      user: formatUser(String(row.user_name ?? ""), email),
      email: email ?? undefined,
      type: row.event === "logout" ? "logout" : "login",
      ip: "—",
      location: method === "sso" ? "SSO" : "密碼登入",
      at: loggedAt,
      suspicious: false,
    });
  }

  const { data: ssoRows } = await furnitureAdmin
    .from("pms_sso_codes")
    .select("id, user_id, email, used_at")
    .not("used_at", "is", null)
    .order("used_at", { ascending: false })
    .limit(150);

  for (const row of ssoRows ?? []) {
    const userId = String(row.user_id ?? "");
    const usedAt = String(row.used_at);
    const email = normalizeEmail(row.email) ?? "";
    const userKey = userId || email;
    if (userKey && !shouldIncludeLogin(userKey, usedAt)) continue;
    if (userId && loginLogDedupeKeys.has(loginDedupeKey(userId, usedAt))) continue;
    const user = formatUser(
      nameByAuthId.get(userId) ?? nameByEmail.get(email) ?? email,
      email,
    );
    logs.push({
      id: `sso-${row.id}`,
      user,
      email: email || undefined,
      type: "login",
      ip: "—",
      location: "SSO",
      at: usedAt,
      suspicious: false,
    });
  }

  const { data: uploadRows } = await furnitureAdmin
    .from("upload_log")
    .select("id, user_name, user_email, user_id, stage, action, logged_at, product_id, page_label, product_sku")
    .order("logged_at", { ascending: false })
    .limit(200);

  const productIds = [
    ...new Set(
      (uploadRows ?? [])
        .map((r) => String(r.product_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const skuByProductId = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: productRows } = await furnitureAdmin
      .from("products")
      .select("id, sku, product_sku")
      .in("id", productIds);
    for (const p of productRows ?? []) {
      const sku = String(p.sku ?? p.product_sku ?? "").trim();
      if (sku) skuByProductId.set(String(p.id), sku);
    }
  }

  const pendingUpload: PendingUploadLog[] = [];

  for (const row of uploadRows ?? []) {
    const email = normalizeEmail(row.user_email);
    const user = formatUser(
      String(row.user_name ?? "").trim() ||
        (email ? nameByEmail.get(email) : null) ||
        (row.user_id ? nameByAuthId.get(String(row.user_id)) : null),
      email,
    );
    if (user === "歷史紀錄") continue;
    const logType = mapUploadAction(String(row.action), String(row.stage));
    const sku = resolveSku(
      row.product_sku as string | null | undefined,
      row.product_id as string | null | undefined,
      skuByProductId,
    );
    pendingUpload.push({
      id: String(row.id),
      user,
      email: email ?? undefined,
      logType,
      stage: String(row.stage),
      pageLabel: row.page_label as string | null | undefined,
      productId: row.product_id as string | null | undefined,
      sku,
      at: String(row.logged_at),
    });
  }

  const publishGroups = new Map<string, PendingUploadLog[]>();
  for (const item of pendingUpload) {
    if (item.logType === "publish") {
      const key = publishGroupKey(item.user, item.email, item.at);
      const group = publishGroups.get(key) ?? [];
      group.push(item);
      publishGroups.set(key, group);
      continue;
    }

    const detail = buildEditDetail(
      item.stage,
      item.pageLabel,
      item.sku,
      item.productId,
      skuByProductId,
    );
    logs.push({
      id: `ul-${item.id}`,
      user: item.user,
      email: item.email,
      type: item.logType,
      detail,
      skus: item.sku ? [item.sku] : undefined,
      ip: "—",
      location: "系統",
      at: item.at,
      suspicious: false,
    });
  }

  for (const [, group] of publishGroups) {
    group.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const lead = group[0];
    const skus = [...new Set(group.map((g) => g.sku).filter(Boolean))];
    logs.push({
      id: `ul-${lead.id}${group.length > 1 ? `+${group.length}` : ""}`,
      user: lead.user,
      email: lead.email,
      type: "publish",
      skus: skus.length > 0 ? skus : undefined,
      ip: "—",
      location: "系統",
      at: lead.at,
      suspicious: false,
    });
  }

  logs.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const trendMap = new Map<string, { 成功: number; 失敗: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    trendMap.set(key, { 成功: 0, 失敗: 0 });
  }

  for (const log of logs) {
    const d = new Date(log.at);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    if (!trendMap.has(key)) continue;
    const bucket = trendMap.get(key)!;
    if (log.type === "login") bucket.成功 += 1;
    if (log.type === "failed") bucket.失敗 += 1;
  }

  const trend = [...trendMap.entries()].map(([day, v]) => ({ day, ...v }));

  return { logs: logs.slice(0, 250), trend };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const furnitureUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const furnitureAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const furnitureServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const pmsServiceKey =
    Deno.env.get("FACTORY_SERVICE_ROLE_KEY") ??
    Deno.env.get("PMS_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("MASTER_SERVICE_ROLE_KEY") ??
    "";

  if (!furnitureUrl || !furnitureAnonKey || !furnitureServiceKey) {
    return jsonResponse({ error: "Furniture Supabase not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const furnitureClient = createClient(furnitureUrl, furnitureAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await furnitureClient.auth.getUser();
  if (userError || !userData.user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = body.action?.trim() || "fetch";

  const furnitureAdmin = createClient(furnitureUrl, furnitureServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (action === "fetch") {
      let pmsUsers = new Map<string, ReturnType<typeof extractPmsUser>>();
      if (pmsServiceKey) {
        const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        pmsUsers = await listPmsUsers(pmsAdmin);
      }

      const { data: companies } = await furnitureAdmin
        .from("client_companies")
        .select("contact_email, contact_person, name");

      const { data: invitations } = await furnitureAdmin
        .from("project_invitations")
        .select("email")
        .not("email", "is", null);

      const clientEmails: { email: string; display_name: string | null }[] = [];
      const seenClient = new Set<string>();
      for (const c of companies ?? []) {
        const email = normalizeEmail(c.contact_email);
        if (!email || seenClient.has(email)) continue;
        seenClient.add(email);
        clientEmails.push({
          email,
          display_name: c.contact_person?.trim() || c.name?.trim() || null,
        });
      }
      for (const inv of invitations ?? []) {
        const email = normalizeEmail(inv.email);
        if (!email || seenClient.has(email)) continue;
        seenClient.add(email);
        clientEmails.push({ email, display_name: null });
      }

      const authIds = [...pmsUsers.values()]
        .map((u) => u.auth_user_id)
        .filter((id): id is string => !!id);
      const authMeta = await fetchAuthMeta(furnitureAdmin, authIds);
      const profiles = await syncProfiles(furnitureAdmin, pmsUsers, clientEmails, authMeta);
      const { logs, trend } = await fetchLoginLogs(furnitureAdmin, profiles);

      return jsonResponse({
        users: profiles.map((p) => ({
          id: p.id,
          name: p.display_name?.trim() || p.email.split("@")[0],
          email: p.email,
          role: p.role,
          active: p.active,
          lastLogin: p.last_login_at ?? new Date(0).toISOString(),
          source: p.source,
        })),
        logs,
        securityTrend: trend,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[fetch-platform-admin]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Request failed" },
      500,
    );
  }
});
