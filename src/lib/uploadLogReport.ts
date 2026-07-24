import { supabase } from '@/lib/supabase';
import { resolvePmsStaffByAuthUserIds, resolvePmsStaffByIds } from '@/lib/pmsStaff';
import { getPublishDateHk } from '@/lib/publishTimestamps';
import type { PublishLogStage } from '@/lib/uploadLog';
import { formatUploadLogUserLabel } from '@/lib/uploadLogUserDisplay';

export const UPLOAD_LOG_STAGES: PublishLogStage[] = [
  'copywriting',
  'product_info',
  'furniture_group_check',
  'ready_to_publish',
];

export const STAGE_LABELS: Record<PublishLogStage, string> = {
  copywriting: '產品文案',
  product_info: '產品信息',
  furniture_group_check: '傢俬組檢查',
  ready_to_publish: '準備上載',
};

export const HISTORICAL_USER_LABEL = '歷史紀錄';
export const UNKNOWN_USER_LABEL = '（無用戶紀錄）';

/** Shown under the daily upload-log report table (UI, text, email). */
export const UPLOAD_LOG_REPORT_FOOTNOTE =
  '「產品目前停留」僅顯示今天（即時查詢）。「今日已處理」：產品文案每件產品以最後一次「提交到下一步」計 1 件（upload_log + copy_done_at，歸屬最後操作者與該提交日）；產品信息取 upload_log（完成）+ ready_to_shopify.info_completed_at。兩階段同日數量可能不同——文案已於前日提交、信息於當日才批次完成時，文案計在前日、信息計在當日。';

/** Actions that count as “modified / completed” per stage. */
const STAGE_ACTIONS: Record<PublishLogStage, Set<string>> = {
  copywriting: new Set(['submit']),
  // Only 「完成」 moves to 傢俬組檢查; per-product 「儲存」 is not counted as processed.
  product_info: new Set(['complete']),
  furniture_group_check: new Set(['save', 'add_to_ready']),
  ready_to_publish: new Set(['upload']),
};

/** Never attribute copywriting / product_info via products.editor_staff_id (editor ≠ actor). */
const STAGES_NO_EDITOR_STAFF_LOOKUP = new Set<PublishLogStage>([
  'copywriting',
  'product_info',
]);

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
  stages: Record<PublishLogStage, StageDailyStats>;
}

export interface ShopifyCategoryLevel2Count {
  level2: string;
  count: number;
}

/** One level-1 bucket with nested level-2 counts (from shopify_products.product_type). */
export interface ShopifyCategoryBreakdown {
  level1: string;
  count: number;
  children: ShopifyCategoryLevel2Count[];
}

export interface UploadLogReport {
  generatedAt: string;
  todayHk: string;
  pendingCounts: Record<PublishLogStage, number>;
  /** Matches 已上載產品 → 已發佈 (shopify_products active, non-configurable). */
  publishedShopifyCount: number;
  /** Current published Shopify products broken down by 一級 / 二級分類. */
  publishedShopifyBreakdown: ShopifyCategoryBreakdown[];
  dailyRows: DailyReportRow[];
}

interface RawLogRow {
  product_id: string | null;
  stage: PublishLogStage;
  action: string;
  user_name: string | null;
  user_email: string | null;
  user_id?: string | null;
  logged_at: string;
  editor_staff_id?: string | null;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function staffDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const n = name?.trim();
  if (n && !looksLikeEmail(n)) return n;
  return null;
}

function toHkDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date(iso));
}

function displayUser(name: string | null, email: string | null): string {
  const n = name?.trim();
  if (n === HISTORICAL_USER_LABEL) return HISTORICAL_USER_LABEL;
  if (n && n !== UNKNOWN_USER_LABEL && !looksLikeEmail(n)) {
    return formatUploadLogUserLabel(n, email);
  }
  const fromEmail = formatUploadLogUserLabel(null, email);
  if (fromEmail !== '（無用戶紀錄）') return fromEmail;
  return UNKNOWN_USER_LABEL;
}

function needsStaffResolve(log: RawLogRow): boolean {
  const name = log.user_name?.trim();
  if (!name) return true;
  if (name === HISTORICAL_USER_LABEL || name === UNKNOWN_USER_LABEL || name === '未知用戶') {
    return true;
  }
  if (looksLikeEmail(name)) return true;
  if (log.user_email && name === log.user_email.trim()) return true;
  return false;
}

function resolveLogStaffId(
  log: RawLogRow,
  productStaffMap: Map<string, string | null>,
): string | null {
  return log.editor_staff_id ?? (log.product_id ? productStaffMap.get(log.product_id) ?? null : null);
}

function resolveStaffId(
  editorStaffId?: string | null,
  creatorStaffId?: string | null,
): string | null {
  return editorStaffId?.trim() || creatorStaffId?.trim() || null;
}

function emptyStageStats(): Record<PublishLogStage, StageDailyStats> {
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

function dedupeKey(hkDate: string, stage: PublishLogStage, productId: string): string {
  return `${hkDate}|${stage}|${productId}`;
}

function isCopywritingSubmit(log: RawLogRow): boolean {
  return log.stage === 'copywriting' && log.action === 'submit' && Boolean(log.product_id);
}

/**
 * 產品文案：每件產品只計一次，歸屬於最後一次「提交到下一步」的日期與操作者
 * （含退回後由他人重提的情況；舊日期的 upload_log 不再計入）。
 */
function dedupeCopywritingByLastSubmit(logs: RawLogRow[]): RawLogRow[] {
  const other = logs.filter((log) => !isCopywritingSubmit(log));
  const latestByProduct = new Map<string, RawLogRow>();

  for (const log of logs) {
    if (!isCopywritingSubmit(log) || !log.product_id) continue;
    const existing = latestByProduct.get(log.product_id);
    if (!existing || new Date(log.logged_at).getTime() > new Date(existing.logged_at).getTime()) {
      latestByProduct.set(log.product_id, log);
    }
  }

  return [...other, ...latestByProduct.values()];
}

function buildDailyRows(logs: RawLogRow[], dayCount: number): DailyReportRow[] {
  const sortedDates = buildDateRange(dayCount);

  const byDateStage = new Map<string, Map<PublishLogStage, Map<string, Set<string>>>>();

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
  stage: PublishLogStage,
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
      .select('id, editor_staff_id, creator_staff_id')
      .in('id', chunk);
    if (error) {
      console.warn('[uploadLogReport] product staff map failed:', error.message);
      break;
    }
    for (const row of data ?? []) {
      if (row.id) {
        map.set(row.id, resolveStaffId(row.editor_staff_id, row.creator_staff_id));
      }
    }
  }
  return map;
}

async function enrichLogsWithStaff(
  logs: RawLogRow[],
  productStaffMap: Map<string, string | null>,
): Promise<RawLogRow[]> {
  const staffIds = new Set<string>();
  for (const log of logs) {
    const sid = resolveLogStaffId(log, productStaffMap);
    if (sid) staffIds.add(sid);
  }

  const staffMap = await resolvePmsStaffByIds([...staffIds]);

  const authUserIds = new Set<string>();
  for (const log of logs) {
    if (!needsStaffResolve(log) || !log.user_id) continue;
    authUserIds.add(log.user_id);
  }
  const authUserMap = await resolvePmsStaffByAuthUserIds([...authUserIds]);

  return logs.map((log) => {
    if (needsStaffResolve(log) && log.user_id) {
      const fromAuth = authUserMap.get(log.user_id);
      const name = staffDisplayName(
        fromAuth?.display_name ?? fromAuth?.name,
        fromAuth?.email,
      );
      if (name) {
        return {
          ...log,
          user_name: name,
          user_email: fromAuth?.email ?? log.user_email,
        };
      }
    }

    const useEditorStaff = !STAGES_NO_EDITOR_STAFF_LOOKUP.has(log.stage);
    const sid = useEditorStaff ? resolveLogStaffId(log, productStaffMap) : null;
    if (sid) {
      const staff = staffMap.get(sid);
      const name = staffDisplayName(
        staff?.display_name ?? staff?.name,
        staff?.email,
      );
      if (name) {
        return {
          ...log,
          user_name: name,
          user_email: staff?.email ?? log.user_email,
        };
      }
    }

    if (needsStaffResolve(log)) {
      return { ...log, user_name: UNKNOWN_USER_LABEL };
    }

    return log;
  });
}

/** Supplement upload_log with workflow timestamps written before logging existed. */
async function fetchHistoricalLogRows(
  startIso: string,
  covered: Set<string>,
  productStaffMap: Map<string, string | null>,
): Promise<RawLogRow[]> {
  const historical: RawLogRow[] = [];

  const [
    copyProducts,
    infoRts,
    checkedRts,
    readyRts,
    rtsFgReady,
    syncedProducts,
  ] = await Promise.all([
    fetchAllPages<{ id: string; copy_done_at: string }>(
      'products.copy_done_at',
      async (from, to) =>
        supabase
          .from('products')
          .select('id, copy_done_at')
          .eq('copy_done', true)
          .not('copy_done_at', 'is', null)
          .gte('copy_done_at', startIso)
          .order('copy_done_at', { ascending: false })
          .range(from, to),
    ),
    fetchAllPages<{ product_id: string; info_completed_at: string | null; imported_at: string | null }>(
      'rts.info_completed_at',
      async (from, to) =>
        supabase
          .from('ready_to_shopify')
          .select('product_id, info_completed_at, imported_at')
          .eq('info_done', true)
          .or(`info_completed_at.gte."${startIso}",imported_at.gte."${startIso}"`)
          .order('info_completed_at', { ascending: false, nullsFirst: false })
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
    fetchAllPages<{
      product_id: string;
      ready_to_publish_at: string | null;
      imported_at: string | null;
      furniture_group_checked: boolean | null;
    }>('rts.furniture_group_checked', async (from, to) =>
      supabase
        .from('ready_to_shopify')
        .select('product_id, ready_to_publish_at, imported_at, furniture_group_checked')
        .eq('furniture_group_checked', true)
        .or(`ready_to_publish_at.gte."${startIso}",imported_at.gte."${startIso}"`)
        .order('ready_to_publish_at', { ascending: false, nullsFirst: false })
        .range(from, to),
    ),
    fetchAllPages<{ id: string; synced_at: string; editor_staff_id: string | null; creator_staff_id: string | null }>(
      'products.synced_at',
      async (from, to) =>
        supabase
          .from('products')
          .select('id, synced_at, editor_staff_id, creator_staff_id')
          .not('synced_at', 'is', null)
          .not('shopify_product_id', 'is', null)
          .gte('synced_at', startIso)
          .order('synced_at', { ascending: false })
          .range(from, to),
    ),
  ]);

  const rememberStaff = (
    productId: string,
    editorStaffId?: string | null,
    creatorStaffId?: string | null,
  ) => {
    const sid = resolveStaffId(editorStaffId, creatorStaffId);
    if (sid) productStaffMap.set(productId, sid);
    return sid;
  };

  for (const row of copyProducts) {
    pushHistorical(
      historical,
      covered,
      row.id,
      'copywriting',
      'submit',
      row.copy_done_at,
      null,
    );
  }

  for (const row of infoRts) {
    const loggedAt = row.info_completed_at ?? row.imported_at;
    if (!loggedAt || loggedAt < startIso) continue;
    pushHistorical(
      historical,
      covered,
      row.product_id,
      'product_info',
      'complete',
      loggedAt,
      null,
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

  for (const row of rtsFgReady) {
    const loggedAt = row.ready_to_publish_at ?? row.imported_at;
    if (!loggedAt || loggedAt < startIso) continue;
    pushHistorical(
      historical,
      covered,
      row.product_id,
      'furniture_group_check',
      'add_to_ready',
      loggedAt,
      productStaffMap.get(row.product_id) ?? null,
    );
  }

  for (const row of syncedProducts) {
    const staffId = rememberStaff(row.id, row.editor_staff_id, row.creator_staff_id);
    pushHistorical(
      historical,
      covered,
      row.id,
      'furniture_group_check',
      'add_to_ready',
      row.synced_at,
      staffId,
    );
    pushHistorical(
      historical,
      covered,
      row.id,
      'ready_to_publish',
      'upload',
      row.synced_at,
      staffId,
    );
  }

  return historical;
}

const UNCATEGORIZED_LABEL = '未分類';

/** Parse shopify product_type "L1 / L2" (same convention as PublishedProductsView). */
function splitProductType(productType: string | null | undefined): { level1: string; level2: string } {
  const raw = (productType || '').trim();
  if (!raw) return { level1: UNCATEGORIZED_LABEL, level2: '' };
  const parts = raw.split(' / ').map((p) => p.trim());
  const level1 = parts[0] || UNCATEGORIZED_LABEL;
  const level2 = parts[1] || '';
  return { level1, level2 };
}

async function fetchCategorySortOrders(): Promise<{
  level1Order: Map<string, number>;
  level2Order: Map<string, number>;
}> {
  const level1Order = new Map<string, number>();
  const level2Order = new Map<string, number>();
  const { data, error } = await supabase
    .from('product_category')
    .select('level1, level2, sort_order')
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('[uploadLogReport] product_category sort order failed:', error.message);
    return { level1Order, level2Order };
  }
  for (const row of data ?? []) {
    const l1 = String(row.level1 ?? '').trim();
    const l2 = String(row.level2 ?? '').trim();
    const order = Number(row.sort_order) || 0;
    if (l1 && !level1Order.has(l1)) level1Order.set(l1, order);
    if (l1 && l2) {
      const key = `${l1}\0${l2}`;
      if (!level2Order.has(key)) level2Order.set(key, order);
    }
  }
  return { level1Order, level2Order };
}

/**
 * Same filters as PublishedProductsView「已發佈」count, plus L1/L2 breakdown
 * from product_type ("一級 / 二級").
 */
async function fetchPublishedShopifyStats(): Promise<{
  count: number;
  breakdown: ShopifyCategoryBreakdown[];
}> {
  const [rows, sortOrders] = await Promise.all([
    fetchAllPages<{ product_type: string | null }>('shopify_products.product_type', (from, to) =>
      supabase
        .from('shopify_products')
        .select('product_type')
        .eq('status', 'active')
        .is('configurable', null)
        .range(from, to),
    ),
    fetchCategorySortOrders(),
  ]);

  const l1Counts = new Map<string, number>();
  const l2Counts = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const { level1, level2 } = splitProductType(row.product_type);
    l1Counts.set(level1, (l1Counts.get(level1) || 0) + 1);
    if (level2) {
      if (!l2Counts.has(level1)) l2Counts.set(level1, new Map());
      const child = l2Counts.get(level1)!;
      child.set(level2, (child.get(level2) || 0) + 1);
    }
  }

  const sortL1 = (a: string, b: string) => {
    if (a === UNCATEGORIZED_LABEL) return 1;
    if (b === UNCATEGORIZED_LABEL) return -1;
    const oa = sortOrders.level1Order.get(a);
    const ob = sortOrders.level1Order.get(b);
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if (oa != null && ob == null) return -1;
    if (oa == null && ob != null) return 1;
    return a.localeCompare(b, 'zh-Hant');
  };

  const sortL2 = (level1: string, a: string, b: string) => {
    const oa = sortOrders.level2Order.get(`${level1}\0${a}`);
    const ob = sortOrders.level2Order.get(`${level1}\0${b}`);
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if (oa != null && ob == null) return -1;
    if (oa == null && ob != null) return 1;
    return a.localeCompare(b, 'zh-Hant');
  };

  const breakdown: ShopifyCategoryBreakdown[] = Array.from(l1Counts.entries())
    .sort(([a], [b]) => sortL1(a, b))
    .map(([level1, count]) => {
      const childrenMap = l2Counts.get(level1);
      const children: ShopifyCategoryLevel2Count[] = childrenMap
        ? Array.from(childrenMap.entries())
            .sort(([a], [b]) => sortL2(level1, a, b))
            .map(([level2, c]) => ({ level2, count: c }))
        : [];
      return { level1, count, children };
    });

  return { count: rows.length, breakdown };
}

async function fetchPendingCounts(): Promise<Record<PublishLogStage, number>> {
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
      .select('product_id, stage, action, user_name, user_email, user_id, logged_at')
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

  const uploadProductIds = uploadLogs
    .filter((log) => log.product_id)
    .map((log) => log.product_id as string);

  const historical = await fetchHistoricalLogRows(startIso, covered, productStaffMap);
  const merged = [...uploadLogs, ...historical];

  // Staff name lookup only (not used as product_info completion source).
  const allProductIds = merged
    .filter((log) => log.product_id)
    .map((log) => log.product_id as string);
  const staffMapFromDb = await fetchProductStaffMap([
    ...uploadProductIds,
    ...allProductIds,
  ]);
  staffMapFromDb.forEach((sid, pid) => productStaffMap.set(pid, sid));

  const enriched = await enrichLogsWithStaff(merged, productStaffMap);
  const logs = dedupeCopywritingByLastSubmit(enriched);

  const [pendingCounts, publishedShopify] = await Promise.all([
    fetchPendingCounts(),
    fetchPublishedShopifyStats(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    todayHk,
    pendingCounts,
    publishedShopifyCount: publishedShopify.count,
    publishedShopifyBreakdown: publishedShopify.breakdown,
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
