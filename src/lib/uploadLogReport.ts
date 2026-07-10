import { supabase } from '@/lib/supabase';
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
}

function toHkDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date(iso));
}

function displayUser(name: string | null, email: string | null): string {
  const n = name?.trim();
  if (n) return n;
  const e = email?.trim();
  if (e) return e;
  return '未知用戶';
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

  const [pendingCounts, logsRes] = await Promise.all([
    fetchPendingCounts(),
    supabase
      .from('upload_log')
      .select('product_id, stage, action, user_name, user_email, logged_at')
      .gte('logged_at', startIso)
      .order('logged_at', { ascending: false }),
  ]);

  if (logsRes.error) {
    throw new Error(logsRes.error.message);
  }

  const logs = (logsRes.data ?? []) as RawLogRow[];

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
