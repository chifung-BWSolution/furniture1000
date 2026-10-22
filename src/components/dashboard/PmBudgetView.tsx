import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, FileText } from 'lucide-react';
import { PM_PRO_PDF_PATH, PM_QUICK_PATH, pmInquiryPath } from '@/content/bwaPm';
import {
  inquiryErrorMessage,
  inquiryStatusLabel,
  listFurnitureInquiries,
  type BwaInquirySummary,
} from '@/lib/bwaFurnitureInquiry';
import { formatListDate } from '@/lib/listTableUtils';

export function PmBudgetView() {
  const [rows, setRows] = useState<BwaInquirySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void listFurnitureInquiries().then((result) => {
      if (cancelled) return;
      setRows(result.rows);
      setError(result.error ? inquiryErrorMessage(result.error) : '');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="fds-page-title">
                <CircleDollarSign className="h-5 w-5 text-primary" />
                向 BWF 詢價
              </h1>
              <p className="fds-page-description">
                把工程報價裡的傢俬項目送給 BWF 傢俬部。這裡只看 BWF 正式回覆的賣價，不含成本、廠家或毛利。
              </p>
            </div>
            <Link
              to={PM_QUICK_PATH}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
            >
              新詢價
            </Link>
          </div>
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">載入詢價…</p>}
        {error && <p className="px-2 text-sm text-destructive">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <section className="rounded-2xl border border-border/80 bg-card px-6 py-12 text-center text-sm text-muted-foreground shadow-sm">
            還沒有詢價
          </section>
        )}

        <div className="grid gap-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold">{row.bwa_project_name || '未命名工程'}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.bwa_project_ref || '無工程編號'}
                    {row.bwa_project_id ? ' · 已連 BWA 工程' : ''}
                    {!row.bwa_project_id && row.bwa_pitching_id ? ' · 已連 BWA 提案' : ''}
                    {' · '}
                    {row.item_count} 項傢俬
                    {' · '}
                    已回覆賣價 {row.returned_count} 項
                  </p>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold">
                  {inquiryStatusLabel(row.status)}
                </span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                建立 {formatListDate(row.created_at)}
                {row.sent_at ? ` · 送出 ${formatListDate(row.sent_at)}` : ''}
                {row.replied_at ? ` · 回覆 ${formatListDate(row.replied_at)}` : ''}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={pmInquiryPath(PM_QUICK_PATH, row.id)}
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
                >
                  查看項目
                </Link>
                <Link
                  to={pmInquiryPath(PM_PRO_PDF_PATH, row.id)}
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-semibold"
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  說明
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
