import { supabase } from '@/lib/supabase';

export const COMMAND_LOG_PAGE_SIZE = 15;

export type CommandLogStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type CommandLogRow = {
  id: string;
  developerName: string;
  developerEmail: string;
  instructionText: string;
  taskReference: string | null;
  model: string | null;
  status: CommandLogStatus;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  creditsUsed: number | null;
  costUsd: number | null;
  resultSummary: string | null;
  failureReason: string | null;
  businessDate: string;
};

export type CommandLogFilters = {
  from: string;
  to: string;
  developerEmail: string;
  status: string;
  model: string;
  search: string;
};

export const emptyCommandLogFilters: CommandLogFilters = {
  from: '',
  to: '',
  developerEmail: '',
  status: '',
  model: '',
  search: '',
};

export type CommandLogListResult = { rows: CommandLogRow[]; total: number };

export type CommandLogAnalytics = {
  summary: {
    todayCommandCount: number;
    todayCompletedCount: number;
    todayRunningCount: number;
    todayFailedCount: number;
    todayCredits: number;
    todayCostUsd: number;
    todayDurationSeconds: number;
    monthCommandCount: number;
    monthCostUsd: number;
    monthDurationSeconds: number;
  };
  daily: Array<{
    businessDate: string;
    developerName: string;
    developerEmail: string;
    totalCommands: number;
    completedCount: number;
    failedCount: number;
    totalCredits: number;
    totalCostUsd: number;
    totalDurationSeconds: number;
  }>;
  developers: Array<{
    developerName: string;
    developerEmail: string;
    totalCommands: number;
    completedCount: number;
    failedCount: number;
    totalDurationSeconds: number;
    totalCredits: number;
    totalCostUsd: number;
    activeDays: number;
  }>;
  options: {
    developers: Array<{ email: string; name: string }>;
    models: string[];
  };
};

export type CostSummary = {
  completedCount: number;
  durationSeconds: number;
  pricedSeconds: number;
  unpricedSeconds: number;
  labourCostHkd: number;
  toolCostUsd: number;
  toolCostCount: number;
  status: 'priced' | 'partial' | 'none';
};

export type DevelopmentMonthlyRow = CostSummary & {
  monthStart: string;
  rateMin: number | null;
  rateMax: number | null;
  rateCount: number;
};

export type DevelopmentCostOverview = {
  currentRevision: number;
  currentRate: { revision: number; effectiveFrom: string; rate: number } | null;
  monthSummary: CostSummary;
  appSummary: CostSummary;
  monthlyRows: DevelopmentMonthlyRow[];
  rateVersions: Array<{
    revision: number;
    effectiveFrom: string;
    rate: number;
    reason: string;
    createdAt: string;
    createdByName: string;
    createdByEmail: string;
    status: 'current' | 'scheduled' | 'historical';
  }>;
};

export function developmentOpsError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  if (message.includes('permission_denied')) return '沒有權限。請使用系統管理員帳號。';
  if (message.includes('revision_conflict')) return '費率剛被更新，請重新載入後再儲存。';
  if (message.includes('reason_invalid')) return '請填寫 3 至 300 字的調整原因。';
  if (message.includes('rate_invalid')) return '時薪必須大於 0。';
  return '暫時無法完成操作，請稍後再試。';
}

function dateOrNull(value: string) {
  return value.trim() || null;
}

export async function getCommandLogs(
  filters: CommandLogFilters,
  page: number,
  pageSize = COMMAND_LOG_PAGE_SIZE,
): Promise<CommandLogListResult> {
  const { data, error } = await supabase.rpc('bwf_dev_command_logs_list', {
    p_from: dateOrNull(filters.from),
    p_to: dateOrNull(filters.to),
    p_developer_email: filters.developerEmail || null,
    p_status: filters.status || null,
    p_model: filters.model || null,
    p_search: filters.search || null,
    p_limit: pageSize,
    p_offset: Math.max(0, page - 1) * pageSize,
  });
  if (error) throw error;
  const payload = (data ?? {}) as CommandLogListResult;
  return { rows: payload.rows ?? [], total: payload.total ?? 0 };
}

export async function getCommandLogAnalytics(filters: CommandLogFilters): Promise<CommandLogAnalytics> {
  const { data, error } = await supabase.rpc('bwf_dev_command_logs_analytics', {
    p_from: dateOrNull(filters.from),
    p_to: dateOrNull(filters.to),
    p_developer_email: filters.developerEmail || null,
  });
  if (error) throw error;
  return data as CommandLogAnalytics;
}

export async function deleteCommandLog(id: string) {
  const { error } = await supabase.rpc('bwf_dev_command_log_delete', { p_id: id });
  if (error) throw error;
}

export async function getDevelopmentCostOverview(): Promise<DevelopmentCostOverview> {
  const { data, error } = await supabase.rpc('bwf_development_cost_overview');
  if (error) throw error;
  return data as DevelopmentCostOverview;
}

export async function saveDevelopmentRate(input: {
  hourlyRateHkd: number;
  effectiveFrom: string;
  changeReason: string;
  expectedRevision: number;
}) {
  const { data, error } = await supabase.rpc('bwf_development_cost_save_rate', {
    p_hourly_rate: input.hourlyRateHkd,
    p_effective_from: input.effectiveFrom,
    p_reason: input.changeReason,
    p_expected_revision: input.expectedRevision,
  });
  if (error) throw error;
  return data as { revision: number };
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours} 小時 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${secs} 秒`;
  return `${secs} 秒`;
}

const numberFormat = new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 4 });
const money = new Intl.NumberFormat('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return numberFormat.format(Number(value));
}

export function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `US$ ${numberFormat.format(Number(value))}`;
}

export function formatHkd(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `HK$ ${money.format(Number(value))}`;
}
