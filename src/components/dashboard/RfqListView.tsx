import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompactEmptyState } from '@/components/ui/empty-state';
import {
  RFQ_NEW_PATH,
  buildRfqDetailPath,
} from '@/lib/appSectionRoutes';
import {
  formatRfqDateTime,
  listRfqs,
  rfqStatusClass,
  rfqStatusLabel,
  type RfqListRow,
  type RfqStatus,
} from '@/lib/rfq';

const STATUS_FILTERS: Array<{ value: RfqStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'open', label: '進行中' },
  { value: 'review', label: '評審中' },
  { value: 'awarded', label: '已定標' },
  { value: 'not_awarded', label: '不定標' },
  { value: 'cancelled', label: '已取消' },
];

export function RfqListView() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RfqListRow[]>([]);
  const [status, setStatus] = useState<RfqStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: RfqStatus | 'all' = status) => {
    setLoading(true);
    setError(null);
    const result = await listRfqs(next === 'all' ? null : next);
    setRows(result.rows);
    setError(result.error);
    setLoading(false);
  }, [status]);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="fds-page-title">
                <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
                RFQ 採購
              </h1>
              <p className="fds-page-description">
                向廠家詢價、封標、按行定標。定標價只留在這裡，不會寫入目錄價或客戶報價。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2"
                onClick={() => void load(status)}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                重新整理
              </Button>
              <Button
                type="button"
                className="h-9 gap-2"
                onClick={() => navigate(RFQ_NEW_PATH)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                建立 RFQ
              </Button>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                status === filter.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}

        {loading && rows.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">讀取 RFQ…</p>
        ) : rows.length === 0 ? (
          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
            <CompactEmptyState
              title="還沒有 RFQ"
              description="建立第一張詢價單，加入項目與受邀廠家後發布。"
            />
          </section>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">編號</th>
                    <th className="px-4 py-3 font-medium">標題</th>
                    <th className="px-4 py-3 font-medium">幣別</th>
                    <th className="px-4 py-3 font-medium">狀態</th>
                    <th className="px-4 py-3 font-medium">截止</th>
                    <th className="px-4 py-3 text-right font-medium">行數</th>
                    <th className="px-4 py-3 text-right font-medium">廠家</th>
                    <th className="px-4 py-3 text-right font-medium">已回價</th>
                    <th className="px-4 py-3 text-right font-medium">已決定</th>
                    <th className="px-4 py-3 font-medium">建立</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      role="link"
                      className="cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                      onClick={() => navigate(buildRfqDetailPath(row.id))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(buildRfqDetailPath(row.id));
                        }
                      }}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                        {row.rfq_no}
                        {row.revision > 1 ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                            R{row.revision}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-medium">{row.title}</td>
                      <td className="px-4 py-3">{row.currency}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${rfqStatusClass(row.status)}`}>
                          {rfqStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatRfqDateTime(row.close_at)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.item_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.invitation_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.submitted_factory_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.resolved_item_count}/{row.item_count}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {formatRfqDateTime(row.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="px-1 text-xs text-muted-foreground">
          欄位只顯示詢價進度；未揭標前，任何角色都看不回價單價。
          {rows.length > 0
            ? ` 共 ${rows.length} 張。`
            : ''}
        </p>
      </div>
    </div>
  );
}
