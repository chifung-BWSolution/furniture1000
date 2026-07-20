import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Check, X, MessageSquare, FileText, Loader2, ChevronDown, ChevronUp,
  Shield, Clock, Search, RefreshCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { loadQuoteItems, type BwfQuoteItemInput } from '@/lib/bwfQuoteItems';
import { compareQuoteVersion, displayQuoteVersion } from '@/lib/quoteVersions';
import { quoteStatusBadgeClass } from '@/lib/listTableUtils';
import { quoteItemLineSubtotal } from '@/lib/quoteItemTotals';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';

/** Shared with 產品搜尋 / 付款+送貨 (local only). */
const PORTAL_CART_KEY = 'fds-portal-inquiry-cart';

type QuoteRecord = {
  id: string;
  quote_id: string;
  version: string;
  status: string;
  total_amount: number;
  created_at: string;
  modified_date?: string | null;
  project_data: {
    formData?: {
      clientName?: string;
      clientContactName?: string;
      projectManager?: string;
    };
    clientInfo?: { name?: string; contactName?: string };
    [key: string]: unknown;
  };
};

type Decision = 'pending' | 'approved' | 'rejected' | 'change_requested';

const LIST_SELECT =
  'id, quote_id, version, status, total_amount, created_at, modified_date, project_data';

function fmtMoney(n: number) {
  return `HK$ ${Math.round(n || 0).toLocaleString()}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function clientNameOf(q: QuoteRecord) {
  return (
    q.project_data?.formData?.clientName?.trim() ||
    q.project_data?.clientInfo?.name?.trim() ||
    q.project_data?.formData?.clientContactName?.trim() ||
    '—'
  );
}

function groupByQuoteId(rows: QuoteRecord[]): Map<string, QuoteRecord[]> {
  const map = new Map<string, QuoteRecord[]>();
  for (const row of rows) {
    const list = map.get(row.quote_id) || [];
    list.push(row);
    map.set(row.quote_id, list);
  }
  for (const [key, list] of map) {
    list.sort((a, b) => -compareQuoteVersion(a.version, b.version));
    map.set(key, list);
  }
  return map;
}

export function CustomerQuoteSchemesView() {
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState('');
  const [items, setItems] = useState<BwfQuoteItemInput[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [itemDecisions, setItemDecisions] = useState<
    Record<string, 'ok' | 'change' | 'reject'>
  >({});

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bwf_quote')
        .select(LIST_SELECT)
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) throw error;
      const rows = (data as QuoteRecord[]) || [];
      setQuotes(rows);
      if (rows[0] && !activeId) setActiveId(rows[0].id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '無法載入報價';
      toast.error('載入失敗', { description: message });
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    void fetchQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setItemsLoading(true);
    loadQuoteItems(activeId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const groups = useMemo(() => groupByQuoteId(quotes), [quotes]);

  const latestRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = [...groups.values()].map((versions) => versions[0]);
    return list.filter((row) => {
      if (!q) return true;
      return (
        row.quote_id.toLowerCase().includes(q) ||
        clientNameOf(row).toLowerCase().includes(q) ||
        displayQuoteVersion(row.version).toLowerCase().includes(q) ||
        (row.status || '').toLowerCase().includes(q)
      );
    });
  }, [groups, searchQuery]);

  const active = useMemo(
    () => quotes.find((q) => q.id === activeId) || null,
    [quotes, activeId],
  );
  const activeVersions = active ? groups.get(active.quote_id) || [active] : [];
  const decision = active ? decisions[active.id] || 'pending' : 'pending';

  const billableItems = useMemo(
    () =>
      items.filter(
        (it) => !it.isSectionTitle && !it.isOptional && !it.isCustomTerm,
      ),
    [items],
  );
  const itemsSubtotal = useMemo(
    () => billableItems.reduce((sum, it) => sum + quoteItemLineSubtotal(it), 0),
    [billableItems],
  );

  const pushAcceptedItemsToCheckoutCart = () => {
    const accepted = billableItems.filter((it) => {
      const key = it.id || '';
      const d = key ? itemDecisions[key] || 'ok' : 'ok';
      return d === 'ok';
    });
    if (accepted.length === 0) return 0;
    type CartItem = {
      id: string;
      title: string;
      salePrice: number;
      imageUrl?: string;
      qty: number;
    };
    let existing: CartItem[] = [];
    try {
      const raw = localStorage.getItem(PORTAL_CART_KEY);
      if (raw) existing = JSON.parse(raw) as CartItem[];
    } catch {
      existing = [];
    }
    const map = new Map(existing.map((c) => [c.id, { ...c }]));
    for (const it of accepted) {
      const id = it.id || `quote-item-${it.name || 'item'}`;
      const qty = Math.max(1, Number(it.quantity) || 1);
      const hit = map.get(id);
      if (hit) {
        hit.qty += qty;
      } else {
        map.set(id, {
          id,
          title: it.name || '產品',
          salePrice: Number(it.unitPrice) || 0,
          imageUrl: it.image || undefined,
          qty,
        });
      }
    }
    const next = [...map.values()];
    localStorage.setItem(PORTAL_CART_KEY, JSON.stringify(next));
    return accepted.length;
  };

  const setDecision = (next: Decision) => {
    if (!active) return;
    setDecisions((prev) => ({ ...prev, [active.id]: next }));
    if (next === 'approved') {
      const n = pushAcceptedItemsToCheckoutCart();
      toast.success('已確認整張報價', {
        description:
          n > 0
            ? `已將 ${n} 項產品加入「付款+送貨」購物車（僅本機，未寫入資料庫）`
            : '前端示意狀態（未寫入資料庫）',
      });
      return;
    }
    const label =
      next === 'rejected'
        ? '已拒絕報價'
        : next === 'change_requested'
          ? '已送出更改要求'
          : '';
    if (label) {
      toast.success(label, { description: '前端示意狀態（未寫入資料庫）' });
    }
  };

  const toggleExpand = (quoteId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(quoteId)) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
  };

  return (
    <PortalPageShell
      title="報價方案"
      badge="Client Portal"
      subtitle="參考報價一覽：讀取真實報價與產品明細（僅售價，隱藏成本）。可逐件提出更改或確認整張報價。"
      actions={
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 font-body text-[11px] text-muted-foreground">
          <Shield className="h-3 w-3" /> 僅顯示售價
        </span>
      }
      maxWidthClass="max-w-6xl"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋報價單號／客戶名稱／版本…"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button
          type="button"
          onClick={() => void fetchQuotes()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          重新整理
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* List — inspired by 報價一覽 */}
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <h2 className="font-display text-sm font-bold">報價一覽</h2>
            <p className="font-mono-data text-[11px] text-muted-foreground">
              {loading ? '載入中…' : `共 ${latestRows.length} 張報價 · ${quotes.length} 個版本`}
            </p>
          </div>
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : latestRows.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
              尚無可展示報價
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-muted/60 text-[11px] text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium">日期</th>
                    <th className="px-3 py-2 font-medium">報價／客戶</th>
                    <th className="px-3 py-2 font-medium">狀態</th>
                    <th className="px-3 py-2 font-medium text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {latestRows.map((latest) => {
                    const versions = groups.get(latest.quote_id) || [latest];
                    const expanded = expandedIds.has(latest.quote_id);
                    const rowsToShow = expanded ? versions : [latest];
                    return rowsToShow.map((row, idx) => {
                      const isLatest = idx === 0;
                      const selected = row.id === activeId;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => setActiveId(row.id)}
                          className={cn(
                            'cursor-pointer border-b border-border/70 transition-colors',
                            selected ? 'bg-primary/10' : 'hover:bg-accent/40',
                            !isLatest && 'bg-muted/15',
                          )}
                        >
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono-data text-[11px] text-muted-foreground">
                            {fmtDate(row.modified_date || row.created_at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-start gap-1.5">
                              {isLatest && versions.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpand(latest.quote_id);
                                  }}
                                  className="mt-0.5 rounded p-0.5 hover:bg-muted"
                                  aria-label="展開版本"
                                >
                                  {expanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="w-4" />
                              )}
                              <div className="min-w-0">
                                <p className="truncate font-mono-data text-xs font-semibold">
                                  {row.quote_id}{' '}
                                  <span className="text-primary">
                                    {displayQuoteVersion(row.version)}
                                  </span>
                                  {isLatest && versions.length > 1 ? (
                                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                      · {versions.length} 版
                                    </span>
                                  ) : null}
                                </p>
                                <p className="truncate font-body text-[11px] text-muted-foreground">
                                  {clientNameOf(row)}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={cn(
                                'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                quoteStatusBadgeClass(row.status),
                              )}
                            >
                              {row.status || '—'}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono-data text-xs font-semibold text-foreground">
                            {fmtMoney(row.total_amount)}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Detail — real products */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {!active ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-sm text-muted-foreground">
              請從左側選擇一張報價
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-bold">
                    {active.quote_id} · {displayQuoteVersion(active.version)}
                  </h2>
                  <p className="mt-1 font-body text-sm text-muted-foreground">
                    {clientNameOf(active)} · {fmtMoney(active.total_amount)}
                  </p>
                </div>
                <select
                  value={activeId}
                  onChange={(e) => setActiveId(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-xs"
                >
                  {activeVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {displayQuoteVersion(v.version)} · {v.status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-border/80 bg-muted/20 px-3 py-2.5 text-xs text-foreground/85">
                真實產品明細來自 bwf_quote_item（唯讀）。成本價已隱藏。目前狀態：
                <span className="ml-1 font-medium">
                  {decision === 'pending' ? '待客戶決定' : decision}
                </span>
              </div>

              <div className="max-h-[320px] overflow-y-auto rounded-xl border border-border">
                {itemsLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                    此版本暫無產品明細
                  </p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {items.map((it, idx) => {
                      if (it.isSectionTitle) {
                        return (
                          <li
                            key={it.id || `sec-${idx}`}
                            className="bg-muted/40 px-3 py-2 font-display text-xs font-bold"
                          >
                            {it.name || '分區'}
                          </li>
                        );
                      }
                      const key = it.id || `item-${idx}`;
                      const line = quoteItemLineSubtotal(it);
                      const d = itemDecisions[key] || 'ok';
                      return (
                        <li key={key} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="h-12 w-12 overflow-hidden rounded-md bg-muted">
                            {it.image ? (
                              <img src={it.image} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{it.name || '—'}</p>
                            <p className="font-mono-data text-[11px] text-muted-foreground">
                              ${Number(it.unitPrice || 0).toLocaleString()} × {it.quantity || 1}
                              {it.unit ? ` ${it.unit}` : ''}
                              {it.isOptional ? ' · 可選' : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono-data text-xs font-semibold">
                              {it.isOptional ? '—' : fmtMoney(line)}
                            </p>
                            {!it.isCustomTerm && !it.isOptional ? (
                              <select
                                value={d}
                                onChange={(e) =>
                                  setItemDecisions((prev) => ({
                                    ...prev,
                                    [key]: e.target.value as 'ok' | 'change' | 'reject',
                                  }))
                                }
                                className="mt-1 rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                              >
                                <option value="ok">接受</option>
                                <option value="change">要求改</option>
                                <option value="reject">不要</option>
                              </select>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {fmtDate(active.modified_date || active.created_at)}
                </span>
                <span className="font-mono-data text-sm font-bold">
                  小計 {fmtMoney(itemsSubtotal || active.total_amount)}
                </span>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  更改要求／留言
                </span>
                <textarea
                  value={notes[active.id] || ''}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [active.id]: e.target.value }))
                  }
                  rows={2}
                  placeholder="例如：會議室椅改為藍色、數量改 12…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDecision('approved')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <Check className="h-3.5 w-3.5" /> 確認整張報價
                </button>
                <button
                  type="button"
                  onClick={() => setDecision('change_requested')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> 要求修改
                </button>
                <button
                  type="button"
                  onClick={() => setDecision('rejected')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" /> 拒絕
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </PortalPageShell>
  );
}
