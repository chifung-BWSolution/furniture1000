import { supabase } from '@/lib/supabase';

/**
 * AI 用量統計資料層。
 * - Token 逐次記錄在 `ai_usage_logs`（edge functions 寫入；migration 20261024113000）。
 * - FDS 2.1 文件解析（parse_pdf）的 token 記在 `processing_jobs.tokens`；
 *   Tripo 點數記在 `processing_jobs.result->credits_consumed`。
 * 兩張表 RLS 都只給 admin / uploader 讀取。
 */

export interface AiUsageLogRow {
  id: string;
  created_at: string;
  source: string;
  feature: string | null;
  model: string | null;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface UsageJobRow {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  tokens: number | null;
  cost_actual: number | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

export function startOfMonthISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function fetchAiUsageLogs(limit = 500): Promise<AiUsageLogRow[]> {
  const { data, error } = await supabase
    .from('ai_usage_logs')
    .select('id,created_at,source,feature,model,prompt_tokens,output_tokens,total_tokens')
    .gte('created_at', startOfMonthISO())
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AiUsageLogRow[];
}

export async function fetchUsageJobs(limit = 1000): Promise<UsageJobRow[]> {
  const { data, error } = await supabase
    .from('processing_jobs')
    .select('id,job_type,status,created_at,finished_at,tokens,cost_actual,payload,result')
    .in('job_type', ['generate_tripo', 'parse_pdf'])
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as UsageJobRow[];
}
