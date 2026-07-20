import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Check, X, MessageSquare, FileText, Loader2, ChevronDown, Shield,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';
import { toast } from 'sonner';

type QuoteRow = {
  id: string;
  quoteId: string;
  version: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  clientName: string;
  itemCount: number;
};

type Decision = 'pending' | 'approved' | 'rejected' | 'change_requested';

function fmtMoney(n: number) {
  return `HK$ ${Math.round(n || 0).toLocaleString()}`;
}

export function CustomerQuoteSchemesView() {
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState('');
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('bwf_quote')
          .select('id, quote_id, version, status, total_amount, created_at, project_data')
          .order('created_at', { ascending: false })
          .limit(40);
        if (error) throw error;
        const rows: QuoteRow[] = (data || []).map((q) => {
          const pd = (q.project_data || {}) as Record<string, unknown>;
          const form = (pd.formData || {}) as Record<string, unknown>;
          const items = Array.isArray(pd.items) ? pd.items.length : 0;
          return {
            id: String(q.id),
            quoteId: String(q.quote_id || '—'),
            version: String(q.version || 'v1'),
            status: String(q.status || '—'),
            totalAmount: Number(q.total_amount || 0),
            createdAt: String(q.created_at || ''),
            clientName: String(form.clientName || form.clientContactName || '—'),
            itemCount: items,
          };
        });
        if (!cancelled) {
          setQuotes(rows);
          if (rows[0]) setActiveId(rows[0].id);
        }
      } catch {
        if (!cancelled) setQuotes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = useMemo(
    () => quotes.find((q) => q.id === activeId) || null,
    [quotes, activeId],
  );
  const decision = active ? decisions[active.id] || 'pending' : 'pending';

  const setDecision = (next: Decision) => {
    if (!active) return;
    setDecisions((prev) => ({ ...prev, [active.id]: next }));
    const label =
      next === 'approved'
        ? '已確認整張報價'
        : next === 'rejected'
          ? '已拒絕報價'
          : next === 'change_requested'
            ? '已送出更改要求'
            : '';
    if (label) toast.success(label, { description: '前端示意狀態（未寫入資料庫）' });
  };

  return (
    <PortalPageShell
      title="報價方案"
      badge="Client Portal"
      subtitle="HTML 報價展示與版本控制：可逐件批核、提出更改，或全張確認／拒絕。成本價已隱藏。"
      actions={
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 font-body text-[11px] text-muted-foreground">
          <Shield className="h-3 w-3" /> 僅顯示售價
        </span>
      }
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !active ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 font-body text-sm text-muted-foreground">暫無可展示報價</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-2">
            <p className="font-body text-xs font-medium text-muted-foreground">版本列表</p>
            {quotes.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setActiveId(q.id)}
                className={cn(
                  'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                  q.id === activeId
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-primary/30',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-data text-xs font-semibold">{q.version}</span>
                  <span className="truncate font-body text-[10px] text-muted-foreground">{q.status}</span>
                </div>
                <p className="mt-0.5 truncate font-body text-xs">{q.quoteId}</p>
              </button>
            ))}
          </aside>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">
                  {active.quoteId} · {active.version}
                </h2>
                <p className="mt-1 font-body text-sm text-muted-foreground">
                  {active.clientName} · 約 {active.itemCount || '—'} 項 · {fmtMoney(active.totalAmount)}
                </p>
              </div>
              <div className="relative">
                <select
                  className="h-9 appearance-none rounded-lg border border-border bg-background pl-3 pr-8 font-body text-xs"
                  value={activeId}
                  onChange={(e) => setActiveId(e.target.value)}
                >
                  {quotes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.quoteId} {q.version}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border/80 bg-muted/20 p-4">
              <p className="font-body text-sm leading-relaxed text-foreground/90">
                這是您的專屬報價微型網站預覽：可下載 PDF、對個別產品提出更改，或一次確認整張報價。
                PM 會即時收到通知並更新下一版本。
              </p>
              <p className="mt-2 font-mono-data text-xs text-muted-foreground">
                目前狀態：{decision === 'pending' ? '待客戶決定' : decision}
              </p>
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block font-body text-xs font-medium text-muted-foreground">
                更改要求／留言
              </span>
              <textarea
                value={notes[active.id] || ''}
                onChange={(e) =>
                  setNotes((prev) => ({ ...prev, [active.id]: e.target.value }))
                }
                rows={3}
                placeholder="例如：會議室椅改為藍色、數量改 12…"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDecision('approved')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 font-body text-xs font-medium text-white hover:bg-emerald-700"
              >
                <Check className="h-3.5 w-3.5" /> 確認整張報價
              </button>
              <button
                type="button"
                onClick={() => setDecision('change_requested')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-body text-xs font-medium text-primary hover:bg-primary/15"
              >
                <MessageSquare className="h-3.5 w-3.5" /> 要求修改
              </button>
              <button
                type="button"
                onClick={() => setDecision('rejected')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-body text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" /> 拒絕
              </button>
            </div>
          </section>
        </div>
      )}
    </PortalPageShell>
  );
}
