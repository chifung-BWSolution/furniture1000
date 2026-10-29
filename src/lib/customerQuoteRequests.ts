import { supabase } from '@/lib/supabase';

/**
 * FDS-14：客戶提交的選品／數量／需求（PM 檢視用）。
 * 提交只會寫入自己的記錄，正式報價的單價、明細與總額要 PM 另行處理。
 */

export type CustomerQuoteRequestStatus = 'submitted' | 'acknowledged' | 'converted' | 'declined';

export interface CustomerQuoteRequestLine {
  itemId?: string;
  clientItemId?: string;
  name?: string;
  unit?: string;
  unitPrice?: number | null;
  quantity?: number;
  selected?: boolean;
  note?: string;
}

export interface CustomerQuoteRequest {
  id: string;
  quote_uuid: string;
  quote_id: string;
  request_type: string;
  note: string;
  lines: CustomerQuoteRequestLine[];
  total_cents: number;
  status: CustomerQuoteRequestStatus;
  submitted_at: string;
  pm_name: string | null;
  pm_notified_at: string | null;
  pm_notify_error: string | null;
  line_count: number;
}

export const CUSTOMER_REQUEST_STATUS_LABELS: Record<CustomerQuoteRequestStatus, string> = {
  submitted: '待處理',
  acknowledged: '已確認',
  converted: '已開正式報價',
  declined: '不採用',
};

export const CUSTOMER_REQUEST_STATUS_OPTIONS: CustomerQuoteRequestStatus[] = [
  'submitted',
  'acknowledged',
  'converted',
  'declined',
];

export function customerRequestErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (raw.includes('permission_denied') || raw.includes('42501')) return '沒有權限處理客戶提交。';
  if (raw.includes('invalid_status')) return '提交狀態不正確。';
  if (raw.includes('request_not_found')) return '找不到這筆客戶提交。';
  if (raw.includes('PGRST202') || raw.includes('Could not find the function')) {
    return '客戶提交功能尚未部署到這個環境。';
  }
  return raw || '沒有完成，請再試一次。';
}

/** 只顯示客戶勾選的項目；改名、數量或備註都照提交時的內容。 */
export function selectedRequestLines(lines: CustomerQuoteRequestLine[] | null | undefined): CustomerQuoteRequestLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter((line) => line && line.selected === true && Number(line.quantity) > 0);
}

export function requestLineLabel(line: CustomerQuoteRequestLine): string {
  const name = (line.name ?? '').trim() || '未命名項目';
  const quantity = Math.max(0, Number(line.quantity) || 0);
  const unit = (line.unit ?? '').trim();
  const note = (line.note ?? '').trim();
  return `${name} × ${quantity}${unit ? ` ${unit}` : ''}${note ? `（${note}）` : ''}`;
}

export function formatRequestMoney(cents: number): string {
  return `HK$ ${(Math.max(0, Number(cents) || 0) / 100).toLocaleString('en-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatRequestTime(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  return text.slice(0, 16).replace('T', ' ');
}

/** 通知狀態只回報事實，不假裝已寄出。 */
export function requestNotifyLabel(request: Pick<CustomerQuoteRequest, 'pm_notified_at' | 'pm_notify_error'>): string {
  if (request.pm_notified_at) return '已通知負責同事';
  if (request.pm_notify_error === 'pm_email_missing') return '未通知：找不到負責同事電郵';
  if (request.pm_notify_error === 'invalid_recipient') return '未通知：負責同事電郵無效';
  if (request.pm_notify_error) return `未通知：${request.pm_notify_error}`;
  return '待通知負責同事';
}

export async function listCustomerQuoteRequests(quoteUuid: string): Promise<CustomerQuoteRequest[]> {
  const { data, error } = await supabase.rpc('fds_quote_customer_requests', {
    p_quote_uuid: quoteUuid,
    p_limit: 50,
  });
  if (error) throw new Error(customerRequestErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data as CustomerQuoteRequest[];
}

export async function setCustomerQuoteRequestStatus(
  id: string,
  status: CustomerQuoteRequestStatus,
): Promise<void> {
  const { error } = await supabase.rpc('fds_quote_customer_request_set_status', {
    p_id: id,
    p_status: status,
  });
  if (error) throw new Error(customerRequestErrorMessage(error));
}
