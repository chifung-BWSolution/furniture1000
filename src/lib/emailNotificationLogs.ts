import { invokeWithUserJwt } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/lib/supabase';

export type EmailLogStatus = 'success' | 'failed';

export type EmailNotificationLog = {
  id: string;
  sentAt: string;
  recipient: string;
  notificationType: string;
  relatedQuoteId: string | null;
  relatedProductId: string | null;
  status: EmailLogStatus;
  errorMessage: string | null;
  provider: string | null;
  resendOf: string | null;
  payload: Record<string, unknown>;
};

export const EMAIL_TYPE_LABELS: Record<string, string> = {
  upload_log_report: '上載紀錄',
  client_login: '客戶登入通知',
  daily_report: '每日動態報告',
  factory_upload: '廠家上載通知',
};

type LogRow = {
  id: string;
  sent_at: string;
  recipient: string;
  notification_type: string;
  related_quote_id: string | null;
  related_product_id: string | null;
  status: string;
  error_message: string | null;
  provider: string | null;
  resend_of: string | null;
  payload: Record<string, unknown> | null;
};

type PostgrestError = { code?: string; message: string } | null;

type LogTable = {
  select: (columns: string) => {
    order: (
      column: string,
      options: { ascending: boolean },
    ) => {
      limit: (count: number) => Promise<{ data: LogRow[] | null; error: PostgrestError }>;
    };
  };
};

function logsTable(): LogTable {
  return (supabase as unknown as { from: (table: string) => LogTable }).from(
    'email_notification_logs',
  );
}

export function isMissingEmailLogTable(error: PostgrestError): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message}`;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|does not exist|Could not find the table/i.test(text)
  );
}

function fromRow(row: LogRow): EmailNotificationLog {
  return {
    id: row.id,
    sentAt: row.sent_at,
    recipient: row.recipient,
    notificationType: row.notification_type,
    relatedQuoteId: row.related_quote_id,
    relatedProductId: row.related_product_id,
    status: row.status === 'failed' ? 'failed' : 'success',
    errorMessage: row.error_message,
    provider: row.provider,
    resendOf: row.resend_of,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
  };
}

export async function loadEmailNotificationLogs(): Promise<{
  rows: EmailNotificationLog[];
  missingTable: boolean;
  error: string | null;
}> {
  const { data, error } = await logsTable()
    .select(
      'id, sent_at, recipient, notification_type, related_quote_id, related_product_id, status, error_message, provider, resend_of, payload',
    )
    .order('sent_at', { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingEmailLogTable(error)) return { rows: [], missingTable: true, error: null };
    return { rows: [], missingTable: false, error: error.message };
  }
  return { rows: (data ?? []).map(fromRow), missingTable: false, error: null };
}

export async function resendEmailNotification(row: EmailNotificationLog): Promise<{ ok: boolean; error: string | null }> {
  if (row.notificationType !== 'upload_log_report') {
    return { ok: false, error: '這種類型還沒有重發入口' };
  }
  const payload = row.payload;
  const { error } = await invokeWithUserJwt('send-upload-log-report-email', {
    test: payload.test === true,
    to: row.recipient,
    forward_to: typeof payload.forward_to === 'string' ? payload.forward_to : undefined,
    include_all_dates: payload.include_all_dates === true,
    day_count: typeof payload.day_count === 'number' ? payload.day_count : undefined,
    resend_of: row.id,
  });
  if (error) return { ok: false, error };
  return { ok: true, error: null };
}
