/**
 * FDS-13 報價範圍（前端先判斷，伺服器再用 `fds_quote_zone_scope` 重新檢查）。
 * 分區示範圖只給「報價一覽」的 BWF 正式報價：
 * 快速報價、客戶方案、回收桶、DP- 單號、設計專案殼都不適用。
 */

export const QUOTE_ZONE_EXCLUDED_STATUSES = ['快速報價', '客戶方案', '回收桶'] as const;

export type QuoteZoneScopeInput = {
  status?: string | null;
  quoteId?: string | null;
  designProjectId?: string | null;
};

export type QuoteZoneScopeReason = 'ok' | 'not_formal_quote' | 'design_project';

export const QUOTE_ZONE_SCOPE_MESSAGES: Record<QuoteZoneScopeReason, string> = {
  ok: '',
  not_formal_quote: '分區示範圖只適用於 BWF 正式報價；快速報價、客戶方案與回收桶的報價不提供。',
  design_project: '這張報價屬於設計專案（DP- 或已掛設計專案），請在設計專案頁處理，不在正式報價生成分區示範圖。',
};

export function quoteZoneScope(input: QuoteZoneScopeInput): { allowed: boolean; reason: QuoteZoneScopeReason } {
  const status = (input.status ?? '').trim();
  if (QUOTE_ZONE_EXCLUDED_STATUSES.includes(status as (typeof QUOTE_ZONE_EXCLUDED_STATUSES)[number])) {
    return { allowed: false, reason: 'not_formal_quote' };
  }
  const quoteId = (input.quoteId ?? '').trim();
  if (/^DP-/i.test(quoteId)) return { allowed: false, reason: 'design_project' };
  if ((input.designProjectId ?? '').trim()) return { allowed: false, reason: 'design_project' };
  return { allowed: true, reason: 'ok' };
}
