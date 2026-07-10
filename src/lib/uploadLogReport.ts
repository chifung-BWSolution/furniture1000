import { supabase } from '@/lib/supabase';
import { resolvePmsStaffByIds } from '@/lib/pmsStaff';
import { getPublishDateHk } from '@/lib/publishTimestamps';
import type { UploadLogStage } from '@/lib/uploadLog';

export const UPLOAD_LOG_STAGES: UploadLogStage[] = [
  'copywriting',
  'product_info',
  'furniture_group_check',
  'ready_to_publish',
];

export const STAGE_LABELS: Record<UploadLogStage, string> = {
  copywriting: '產品文案',
  product_info: '產品信息',
  furniture_group_check: '傢俬組檢查',
  ready_to_publish: '準備上載',
};

export const HISTORICAL_USER_LABEL = '歷史紀錄';

/** Actions that count as “modified / completed” per stage. */
const STAGE_ACTIONS: Record<UploadLogStage, Set<string>> = {
  copywriting: new Set(['submit']),
  product_info: new Set(['save', 'complete']),
  furniture_group_check: new Set(['save', 'add_to_ready']),
  ready_to_publish: new Set(['upload']),
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
  logged_at: string;
  editor_staff_id?: string | null;
}

function toHkDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date(iso));
}

function displayUser(name: string | null, email: string | null): string {
  const n = name?.trim();
  if (n && n !== HISTORICAL_USER_LABEL) return n;
  const e = email?.trim();
  if (e) return e;
  return '未知用戶';
}

function needsStaffResolve(log: RawLogRow): boolean {
  const name = log.user_name?.trim();
  return !name || name === HISTORICAL_USER_LABEL || name === '未知用戶';
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
    dates.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(d));
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

    const user = displayUser(log.user_name, log.user_email);
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
        const completedCount = users.reduce((sum, u) => sum + u.count, 0);
        stages[stage] = { completedCount, users };
      }
    }
    return { hkDate, stages };
  });
}

/** Paginate PostgREST reads (default cap is 1000 rows). */
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
      console.warn(`[uploadLogReport] ${label} fetch failed:`, error.message);
      break;
    }
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
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
  const hkDate = toHkDate(loggedAt);
  const key = dedupeKey(hkDate, stage, productId);
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

async function fetchProductStaffMap(productIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const unique = Array.from(new Set(productIds.filter(Boolean)));
  if (unique.length === 0) return map;

  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { data, error } = await supabase
      .from('products')
      .select('id, editor_staff_id')
      .in('id', chunk);
    if (error) {
      console.warn('[uploadLogReport] product staff map failed:', error.message);
      break;
    }
    for (const row of data ?? []) {
      if (row.id) map.set(row.id, row.editor_staff_id ?? null);
    }
  }
  return map;
}

async function enrichLogsWithStaff(
  logs: RawLogRow[],
  productStaffMap: Map<string, string | null>,
): Promise<RawLogRow[]> {
  const staffIds: string[] = [];
  for (const log of logs) {
    if (!needsStaffResolve(log)) continue;
    const sid = log.editor_staff_id ?? (log.product_id ? productStaffMap.get(log.product_id) : null);
    if (sid) staffIds.push(sid);
  }

  const staffMap = await resolvePmsStaffByIds(staffIds);

  return logs.map((log) => {
    if (!needsStaffResolve(log)) return log;
    const sid = log.editor_staff_id ?? (log.product_id ? productStaffMap.get(log.product_id) : null);
    if (!sid) return log;
    const staff = staffMap.get(sid);
    if (!staff) return log;
    const name = staff.display_name ?? staff.name ?? staff.email ?? log.user_name;
    return {
      ...log,
      user_name: name,
      user_email: staff.email ?? log.user_email,
    };
  });
}

/** Supplement upload_log with workflow timestamps written before logging existed. */
async function fetchHistoricalLogRows(
  startIso: string,
  covered: Set<string>,
  productStaffMap: Map<string, string | null>,
): Promise<RawLogRow[]> {
  const historical: RawLogRow[] = [];

  const [copyProducts, infoRts, checkedRts, readyRts, syncedProducts] = await Promise.all([
    fetchAllPages<{ id: string; copy_done_at: string; editor_staff_id: string | null }>(
      'products.copy_done_at',
      async (from, to) =>
        supabase
          .from('products')
          .select('id, copy_done_at, editor_staff_id')
          .eq('copy_done', true)
          .not('copy_done_at', 'is', null)
          .gte('copy_done_at', startIso)
          .order('copy_done_at', { ascending: false })
          .range(from, to),
    ),
    fetchAllPages<{ product_id: string; info_completed_at: string }>('rts.info_completed_at', async (from, to) =>
      supabase
        .from('ready_to_shopify')
        .select('product_id, info_completed_at')
        .eq('info_done', true)
        .not('info_completed_at', 'is', null)
        .gte('info_completed_at', startIso)
        .order('info_completed_at', { ascending: false })
        .range(from, to),
    ),
    fetchAllPages<{ product_id: string; checked_edited_at: string }>('rts.checked_edited_at', async (from, to) =>
      supabase
        .from('ready_to_shopify')
        .select('product_id, checked_edited_at')
        .not('checked_edited_at', 'is', null)
        .gte('checked_edited_at', startIso)
        .order('checked_edited_at', { ascending: false })
        .range(from, to),
    ),
    fetchAllPages<{ product_id: string; ready_to_publish_at: string }>('rts.ready_to_publish_at', async (from, to) =>
      supabase
        .from('ready_to_shopify')
        .select('product_id, ready_to_publish_at')
        .not('ready_to_publish_at', 'is', null)
        .gte('ready_to_publish_at', startIso)
        .order('ready_to_publish_at', { ascending: false })
        .range(from, to),
    ),
    fetchAllPages<{ id: string; synced_at: string; editor_staff_id: string | null }>(
      'products.synced_at',
      async (from, to) =>
        supabase
          .from('products')
          .select('id, synced_at, editor_staff_id')
          .not('synced_at', 'is', null)
          .not('shopify_product_id', 'is', null)
          .gte('synced_at', startIso)
          .order('synced_at', { ascending: false })
          .range(from, to),
    ),
  ]);

  for (const row of copyProducts) {
    if (row.editor_staff_id) productStaffMap.set(row.id, row.editor_staff_id);
    pushHistorical(
      historical,
      covered,
      row.id,
      'copywriting',
      'submit',
      row.copy_done_at,
      row.editor_staff_id,
    );
  }
  for (const row of infoRts) {
    pushHistorical(
      historical,
      covered,
      row.product_id,
      'product_info',
      'complete',
      row.info_completed_at,
      productStaffMap.get(row.product_id) ?? null,
    );
  }
  for (const row of checkedRts) {
    pushHistorical(
      historical,
      covered,
      row.product_id,
      'furniture_group_check',
      'save',
      row.checked_edited_at,
      productStaffMap.get(row.product_id) ?? null,
    );
  }
  for (const row of readyRts) {
    pushHistorical(
      historical,
      covered,
      row.product_id,
      'furniture_group_check',
      'add_to_ready',
      row.ready_to_publish_at,
      productStaffMap.get(row.product_id) ?? null,
    );
  }
  for (const row of syncedProducts) {
    if (row.editor_staff_id) productStaffMap.set(row.id, row.editor_staff_id);
    pushHistorical(
      historical,
      covered,
      row.id,
      'ready_to_publish',
      'upload',
      row.synced_at,
      row.editor_staff_id,
    );
  }

  return historical;
}

async function fetchPendingCounts(): Promise<Record<UploadLogStage, number>> {
  const [copyRes, infoRes, fgRes, readyRes] = await Promise.all([
    supabase.rpc('get_publish_rts_count', { p_stage: 'copywriting' }),
    supabase.rpc('get_publish_rts_count', { p_stage: 'product-info' }),
    supabase.rpc('get_fg_check_count', {
      p_search: null,
      p_level1: null,
      p_level2: null,
      p_factory: null,
    }),
    supabase.rpc('get_ready_to_publish_count', {
      p_search: null,
      p_level1: null,
      p_level2: null,
      p_factory: null,
    }),
  ]);

  return {
    copywriting: Number(copyRes.data) || 0,
    product_info: Number(infoRes.data) || 0,
    furniture_group_check: Number(fgRes.data) || 0,
    ready_to_publish: Number(readyRes.data) || 0,
  };
}

export async function fetchUploadLogReport(dayCount = 30): Promise<UploadLogReport> {
  const todayHk = getPublishDateHk();
  const start = new Date();
  start.setDate(start.getDate() - dayCount);
  const startIso = start.toISOString();

  const uploadLogs = await fetchAllPages<RawLogRow>('upload_log', async (from, to) =>
    supabase
      .from('upload_log')
      .select('product_id, stage, action, user_name, user_email, logged_at')
      .gte('logged_at', startIso)
      .order('logged_at', { ascending: false })
      .range(from, to),
  );

  const covered = new Set<string>();
  const productStaffMap = new Map<string, string | null>();

  for (const log of uploadLogs) {
    if (!log.product_id || !STAGE_ACTIONS[log.stage]?.has(log.action)) continue;
    covered.add(dedupeKey(toHkDate(log.logged_at), log.stage, log.product_id));
  }

  const unresolvedProductIds = uploadLogs
    .filter((log) => needsStaffResolve(log) && log.product_id)
    .map((log) => log.product_id as string);

  const staffMapFromDb = await fetchProductStaffMap(unresolvedProductIds);
  staffMapFromDb.forEach((sid, pid) => productStaffMap.set(pid, sid));

  const historical = await fetchHistoricalLogRows(startIso, covered, productStaffMap);
  const merged = [...uploadLogs, ...historical];
  const logs = await enrichLogsWithStaff(merged, productStaffMap);

  const pendingCounts = await fetchPendingCounts();

  return {
    generatedAt: new Date().toISOString(),
    todayHk,
    pendingCounts,
    dailyRows: buildDailyRows(logs, dayCount),
  };
}

export function formatHkDateLabel(hkDate: string, todayHk?: string): string {
  const [y, m, d] = hkDate.split('-');
  const base = `${y}/${m}/${d}`;
  if (todayHk && hkDate === todayHk) return `${base}（今天）`;
  return base;
}

export function formatHkDateTime(date = new Date()): string {
  const hk = date.toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
  return hk.replace('T', ' ').slice(0, 19);
}
