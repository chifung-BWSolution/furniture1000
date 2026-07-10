import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type UploadLogStage =
  | "copywriting"
  | "product_info"
  | "furniture_group_check"
  | "ready_to_publish";

export const UPLOAD_LOG_STAGES: UploadLogStage[] = [
  "copywriting",
  "product_info",
  "furniture_group_check",
  "ready_to_publish",
];

export const STAGE_LABELS: Record<UploadLogStage, string> = {
  copywriting: "產品文案",
  product_info: "產品信息",
  furniture_group_check: "傢俬組檢查",
  ready_to_publish: "準備上載",
};

const HISTORICAL_USER_LABEL = "歷史紀錄";
const UNKNOWN_USER_LABEL = "（無用戶紀錄）";

const STAGE_ACTIONS: Record<UploadLogStage, Set<string>> = {
  copywriting: new Set(["submit"]),
  product_info: new Set(["save", "complete"]),
  furniture_group_check: new Set(["save", "add_to_ready"]),
  ready_to_publish: new Set(["upload"]),
};

export interface UserActivity {
  userName: string;
  count: number;
}

export interface StageDailyStats {
  completedCount: number;
  users: UserActivity[];
}

export interface DailyReportRow {
  hkDate: string;
  stages: Record<UploadLogStage, StageDailyStats>;
}

export interface UploadLogReport {
  generatedAt: string;
  todayHk: string;
  pendingCounts: Record<UploadLogStage, number>;
  dailyRows: DailyReportRow[];
}

interface RawLogRow {
  product_id: string | null;
  stage: UploadLogStage;
  action: string;
  user_name: string | null;
  user_email: string | null;
  user_id?: string | null;
  logged_at: string;
  editor_staff_id?: string | null;
}

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function toHkDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date(iso));
}

function displayUser(name: string | null): string {
  const n = name?.trim();
  if (n && n !== HISTORICAL_USER_LABEL && n !== UNKNOWN_USER_LABEL && !looksLikeEmail(n)) {
    return n;
  }
  return UNKNOWN_USER_LABEL;
}

function needsStaffResolve(log: RawLogRow): boolean {
  const name = log.user_name?.trim();
  if (!name) return true;
  if (name === HISTORICAL_USER_LABEL || name === UNKNOWN_USER_LABEL || name === "未知用戶") {
    return true;
  }
  if (looksLikeEmail(name)) return true;
  if (log.user_email && name === log.user_email.trim()) return true;
  return false;
}

function resolveStaffId(
  editorStaffId?: string | null,
  creatorStaffId?: string | null,
): string | null {
  return editorStaffId?.trim() || creatorStaffId?.trim() || null;
}

function emptyStageStats(): Record<UploadLogStage, StageDailyStats> {
  return {
    copywriting: { completedCount: 0, users: [] },
    product_info: { completedCount: 0, users: [] },
    furniture_group_check: { completedCount: 0, users: [] },
    ready_to_publish: { completedCount: 0, users: [] },
  };
}

function buildDateRange(dayCount: number): string[] {
  const dates: string[] = [];
  const anchor = new Date();
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - i);
    dates.push(toHkDate(d.toISOString()));
  }
  return dates;
}

function dedupeKey(hkDate: string, stage: UploadLogStage, productId: string): string {
  return `${hkDate}|${stage}|${productId}`;
}

function buildDailyRows(logs: RawLogRow[], dayCount: number): DailyReportRow[] {
  const sortedDates = buildDateRange(dayCount);
  const byDateStage = new Map<string, Map<UploadLogStage, Map<string, Set<string>>>>();

  for (const log of logs) {
    if (!log.product_id) continue;
    const stage = log.stage;
    if (!STAGE_ACTIONS[stage]?.has(log.action)) continue;
    const hkDate = toHkDate(log.logged_at);
    if (!sortedDates.includes(hkDate)) continue;
    if (!byDateStage.has(hkDate)) byDateStage.set(hkDate, new Map());
    const stageMap = byDateStage.get(hkDate)!;
    if (!stageMap.has(stage)) stageMap.set(stage, new Map());
    const userMap = stageMap.get(stage)!;
    const user = displayUser(log.user_name);
    if (!userMap.has(user)) userMap.set(user, new Set());
    userMap.get(user)!.add(log.product_id);
  }

  return sortedDates.map((hkDate) => {
    const stages = emptyStageStats();
    const stageMap = byDateStage.get(hkDate);
    if (stageMap) {
      for (const stage of UPLOAD_LOG_STAGES) {
        const userMap = stageMap.get(stage);
        if (!userMap) continue;
        const users: UserActivity[] = [];
        for (const [userName, productIds] of userMap) {
          users.push({ userName, count: productIds.size });
        }
        users.sort((a, b) => b.count - a.count);
        stages[stage] = {
          completedCount: users.reduce((sum, u) => sum + u.count, 0),
          users,
        };
      }
    }
    return { hkDate, stages };
  });
}

async function fetchAllPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      console.warn(`[uploadLogReportServer] ${label}:`, error.message);
      break;
    }
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function resolvePmsStaffByIds(
  pmsSb: SupabaseClient,
  staffIds: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(staffIds.map((id) => id.trim()).filter(Boolean))).slice(0, 200);
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data: staffRows } = await pmsSb.from("staff").select("id, name").in("id", unique);
  for (const row of staffRows ?? []) {
    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (id && name && !looksLikeEmail(name)) map.set(id, name);
  }
  return map;
}

function pushHistorical(
  rows: RawLogRow[],
  covered: Set<string>,
  productId: string | null,
  stage: UploadLogStage,
  action: string,
  loggedAt: string | null,
  editorStaffId?: string | null,
): void {
  if (!productId || !loggedAt) return;
  const key = dedupeKey(toHkDate(loggedAt), stage, productId);
  if (covered.has(key)) return;
  covered.add(key);
  rows.push({
    product_id: productId,
    stage,
    action,
    user_name: HISTORICAL_USER_LABEL,
    user_email: null,
    logged_at: loggedAt,
    editor_staff_id: editorStaffId ?? null,
  });
}

export async function fetchUploadLogReportServer(dayCount = 30): Promise<UploadLogReport> {
  const furnitureUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const furnitureKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const pmsKey =
    Deno.env.get("FACTORY_SERVICE_ROLE_KEY") ??
    Deno.env.get("PMS_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("MASTER_SERVICE_ROLE_KEY") ??
    "";

  const furnitureSb = createClient(furnitureUrl, furnitureKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pmsSb = pmsKey
    ? createClient(PMS_PROJECT_URL, pmsKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;

  const todayHk = toHkDate(new Date().toISOString());
  const start = new Date();
  start.setDate(start.getDate() - dayCount);
  const startIso = start.toISOString();

  const uploadLogs = await fetchAllPages<RawLogRow>("upload_log", async (from, to) =>
    furnitureSb
      .from("upload_log")
      .select("product_id, stage, action, user_name, user_email, user_id, logged_at")
      .gte("logged_at", startIso)
      .order("logged_at", { ascending: false })
      .range(from, to)
  );

  const covered = new Set<string>();
  const productStaffMap = new Map<string, string | null>();

  for (const log of uploadLogs) {
    if (!log.product_id || !STAGE_ACTIONS[log.stage]?.has(log.action)) continue;
    covered.add(dedupeKey(toHkDate(log.logged_at), log.stage, log.product_id));
  }

  const historical: RawLogRow[] = [];
  const [copyProducts, infoRts, checkedRts, readyRts, rtsFgReady, syncedProducts] = await Promise.all([
    fetchAllPages<{ id: string; copy_done_at: string; editor_staff_id: string | null; creator_staff_id: string | null }>(
      "products.copy_done_at",
      async (from, to) =>
        furnitureSb.from("products").select("id, copy_done_at, editor_staff_id, creator_staff_id")
          .eq("copy_done", true).not("copy_done_at", "is", null).gte("copy_done_at", startIso)
          .order("copy_done_at", { ascending: false }).range(from, to),
    ),
    fetchAllPages<{ product_id: string; info_completed_at: string | null; imported_at: string | null }>(
      "rts.info_completed_at",
      async (from, to) =>
        furnitureSb.from("ready_to_shopify").select("product_id, info_completed_at, imported_at")
          .eq("info_done", true).or(`info_completed_at.gte."${startIso}",imported_at.gte."${startIso}"`)
          .order("info_completed_at", { ascending: false, nullsFirst: false }).range(from, to),
    ),
    fetchAllPages<{ product_id: string; checked_edited_at: string }>(
      "rts.checked_edited_at",
      async (from, to) =>
        furnitureSb.from("ready_to_shopify").select("product_id, checked_edited_at")
          .not("checked_edited_at", "is", null).gte("checked_edited_at", startIso)
          .order("checked_edited_at", { ascending: false }).range(from, to),
    ),
    fetchAllPages<{ product_id: string; ready_to_publish_at: string }>(
      "rts.ready_to_publish_at",
      async (from, to) =>
        furnitureSb.from("ready_to_shopify").select("product_id, ready_to_publish_at")
          .not("ready_to_publish_at", "is", null).gte("ready_to_publish_at", startIso)
          .order("ready_to_publish_at", { ascending: false }).range(from, to),
    ),
    fetchAllPages<{
      product_id: string;
      ready_to_publish_at: string | null;
      imported_at: string | null;
      furniture_group_checked: boolean | null;
    }>(
      "rts.furniture_group_checked",
      async (from, to) =>
        furnitureSb.from("ready_to_shopify")
          .select("product_id, ready_to_publish_at, imported_at, furniture_group_checked")
          .eq("furniture_group_checked", true)
          .or(`ready_to_publish_at.gte."${startIso}",imported_at.gte."${startIso}"`)
          .order("ready_to_publish_at", { ascending: false, nullsFirst: false }).range(from, to),
    ),
    fetchAllPages<{ id: string; synced_at: string; editor_staff_id: string | null; creator_staff_id: string | null }>(
      "products.synced_at",
      async (from, to) =>
        furnitureSb.from("products").select("id, synced_at, editor_staff_id, creator_staff_id")
          .not("synced_at", "is", null).not("shopify_product_id", "is", null).gte("synced_at", startIso)
          .order("synced_at", { ascending: false }).range(from, to),
    ),
  ]);

  const rememberStaff = (productId: string, editorStaffId?: string | null, creatorStaffId?: string | null) => {
    const sid = resolveStaffId(editorStaffId, creatorStaffId);
    if (sid) productStaffMap.set(productId, sid);
    return sid;
  };

  for (const row of copyProducts) {
    pushHistorical(historical, covered, row.id, "copywriting", "submit", row.copy_done_at,
      rememberStaff(row.id, row.editor_staff_id, row.creator_staff_id));
  }
  for (const row of infoRts) {
    const loggedAt = row.info_completed_at ?? row.imported_at;
    if (!loggedAt || loggedAt < startIso) continue;
    pushHistorical(historical, covered, row.product_id, "product_info", "complete", loggedAt,
      productStaffMap.get(row.product_id) ?? null);
  }
  for (const row of checkedRts) {
    pushHistorical(historical, covered, row.product_id, "furniture_group_check", "save", row.checked_edited_at,
      productStaffMap.get(row.product_id) ?? null);
  }
  for (const row of readyRts) {
    pushHistorical(historical, covered, row.product_id, "furniture_group_check", "add_to_ready", row.ready_to_publish_at,
      productStaffMap.get(row.product_id) ?? null);
  }
  for (const row of rtsFgReady) {
    const loggedAt = row.ready_to_publish_at ?? row.imported_at;
    if (!loggedAt || loggedAt < startIso) continue;
    pushHistorical(historical, covered, row.product_id, "furniture_group_check", "add_to_ready", loggedAt,
      productStaffMap.get(row.product_id) ?? null);
  }
  for (const row of syncedProducts) {
    const staffId = rememberStaff(row.id, row.editor_staff_id, row.creator_staff_id);
    pushHistorical(historical, covered, row.id, "furniture_group_check", "add_to_ready", row.synced_at, staffId);
    pushHistorical(historical, covered, row.id, "ready_to_publish", "upload", row.synced_at, staffId);
  }

  const merged = [...uploadLogs, ...historical];
  const uniqueIds = Array.from(new Set(merged.filter((l) => l.product_id).map((l) => l.product_id as string)));
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500);
    const { data } = await furnitureSb.from("products").select("id, editor_staff_id, creator_staff_id").in("id", chunk);
    for (const row of data ?? []) {
      if (row.id) productStaffMap.set(row.id, resolveStaffId(row.editor_staff_id, row.creator_staff_id));
    }
  }

  const staffIds = new Set<string>();
  for (const log of merged) {
    const sid = log.editor_staff_id ?? (log.product_id ? productStaffMap.get(log.product_id) : null);
    if (sid) staffIds.add(sid);
  }
  const staffMap = pmsSb ? await resolvePmsStaffByIds(pmsSb, [...staffIds]) : new Map();

  const logs = merged.map((log) => {
    const sid = log.editor_staff_id ?? (log.product_id ? productStaffMap.get(log.product_id) : null);
    if (sid) {
      const name = staffMap.get(sid);
      if (name) return { ...log, user_name: name };
    }
    if (needsStaffResolve(log)) return { ...log, user_name: UNKNOWN_USER_LABEL };
    return log;
  });

  const [copyRes, infoRes, fgRes, readyRes] = await Promise.all([
    furnitureSb.rpc("get_publish_rts_count", { p_stage: "copywriting" }),
    furnitureSb.rpc("get_publish_rts_count", { p_stage: "product-info" }),
    furnitureSb.rpc("get_fg_check_count", { p_search: null, p_level1: null, p_level2: null, p_factory: null }),
    furnitureSb.rpc("get_ready_to_publish_count", { p_search: null, p_level1: null, p_level2: null, p_factory: null }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    todayHk,
    pendingCounts: {
      copywriting: Number(copyRes.data) || 0,
      product_info: Number(infoRes.data) || 0,
      furniture_group_check: Number(fgRes.data) || 0,
      ready_to_publish: Number(readyRes.data) || 0,
    },
    dailyRows: buildDailyRows(logs, dayCount),
  };
}
