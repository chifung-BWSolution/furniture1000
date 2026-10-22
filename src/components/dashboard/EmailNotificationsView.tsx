import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  EMAIL_TYPE_LABELS,
  loadEmailNotificationLogs,
  resendEmailNotification,
  type EmailNotificationLog,
} from '@/lib/emailNotificationLogs';

function typeLabel(type: string): string {
  return EMAIL_TYPE_LABELS[type] ?? type;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-HK');
}

export function EmailNotificationsView() {
  const [rows, setRows] = useState<EmailNotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void loadEmailNotificationLogs().then((result) => {
      setRows(result.rows);
      setMissingTable(result.missingTable);
      setError(result.error);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (typeFilter !== 'all' && row.notificationType !== typeFilter) return false;
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        return true;
      }),
    [rows, statusFilter, typeFilter],
  );

  const resend = async (row: EmailNotificationLog) => {
    setResendingId(row.id);
    const result = await resendEmailNotification(row);
    setResendingId(null);
    if (!result.ok) {
      toast.error(result.error || '重發失敗');
      return;
    }
    toast.success(`已重發至 ${row.recipient}`);
    load();
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="fds-page-title">
                <Mail className="h-5 w-5 text-primary" />
                電郵通知
              </h1>
              <p className="fds-page-description">
                系統發出的電郵會留在這裡：時間、收件人、類型、關聯單、成功或失敗。紀錄永久保留。目前會寫入的是上載紀錄電郵；客戶登入、每日動態和廠家上載會在那些寄信程式接上之後出現。
              </p>
            </div>
            <button
              type="button"
              onClick={load}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              重新載入
            </button>
          </div>
        </section>

        {missingTable && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            資料表 email_notification_logs 尚未部署。部署 migration 和 send-upload-log-report-email 之後，新寄出的信才會出現在這裡。
          </section>
        )}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}

        <section className="rounded-2xl border border-border/80 bg-card px-4 py-5 md:px-6 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-wrap gap-2">
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              aria-label="通知類型"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="all">全部類型</option>
              {Object.entries(EMAIL_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="發送狀態"
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="all">全部狀態</option>
              <option value="success">成功</option>
              <option value="failed">失敗</option>
            </select>
          </div>

          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              讀取發送紀錄…
            </p>
          )}
          {!loading && visible.length === 0 && (
            <EmptyState
              title={rows.length === 0 ? '還沒有發送紀錄' : '沒有符合的紀錄'}
              description={rows.length === 0
                ? '系統寄出電郵後，這裡會列出每一封的狀態。'
                : '請調整上方的狀態篩選，再試一次。'}
            />
          )}
          <ul className="space-y-3">
            {visible.map((row) => {
              const related = row.relatedQuoteId || row.relatedProductId;
              return (
                <li key={row.id} className="rounded-xl border border-border/80 px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{row.recipient}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatWhen(row.sentAt)} · {typeLabel(row.notificationType)}
                        {related ? ` · ${related}` : ''}
                        {row.provider ? ` · ${row.provider}` : ''}
                        {row.resendOf ? ' · 重發' : ''}
                      </p>
                      {row.errorMessage && (
                        <p className="mt-1 text-xs text-destructive">{row.errorMessage}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          row.status === 'success'
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                            : 'rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800'
                        }
                      >
                        {row.status === 'success' ? '成功' : '失敗'}
                      </span>
                      <button
                        type="button"
                        disabled={resendingId === row.id || row.notificationType !== 'upload_log_report'}
                        onClick={() => void resend(row)}
                        className="h-8 rounded-lg border border-border px-2 text-xs disabled:opacity-40"
                      >
                        {resendingId === row.id ? '重發中…' : '重發'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
