import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, Pencil } from 'lucide-react';
import { PM_QUICK_PATH, pmInquiryPath } from '@/content/bwaPm';
import {
  formatHkMoney,
  getPmQuoteItems,
  listPmQuickQuotes,
  listPmQuotesForWork,
  pmQuoteErrorMessage,
  type PmQuoteItem,
  type PmQuoteSummary,
} from '@/lib/pmQuickQuote';
import { searchBwaWorks, type BwaWorkOption } from '@/lib/bwaWorks';
import { formatListDate, formatListMoney } from '@/lib/listTableUtils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';

function workKindLabel(kind: BwaWorkOption['kind']): string {
  return kind === 'project' ? '工程' : '提案';
}

function optionKey(option: BwaWorkOption): string {
  return `${option.kind}:${option.project_id || option.pitching_id || option.code}`;
}

function itemKey(quoteId: string, itemId: string): string {
  return `${quoteId}:${itemId}`;
}

interface QuoteWithItems {
  quote: PmQuoteSummary;
  items: PmQuoteItem[];
}

function PmBudgetWorkSearch() {
  const [workQuery, setWorkQuery] = useState('');
  const [workOptions, setWorkOptions] = useState<BwaWorkOption[]>([]);
  const [workError, setWorkError] = useState('');
  const [workOpen, setWorkOpen] = useState(false);
  const [workLoading, setWorkLoading] = useState(false);
  const [selectedWork, setSelectedWork] = useState<BwaWorkOption | null>(null);

  const [quotes, setQuotes] = useState<QuoteWithItems[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!workOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setWorkLoading(true);
      void searchBwaWorks(workQuery).then((result) => {
        if (cancelled) return;
        setWorkOptions(result.items);
        setWorkError(result.error);
        setWorkLoading(false);
      });
    }, workQuery.trim() ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workQuery, workOpen]);

  const loadQuotes = useCallback(async (work: BwaWorkOption) => {
    setLoading(true);
    setErrorMessage('');
    const listResult = await listPmQuotesForWork({
      pitchingId: work.pitching_id,
      projectId: work.project_id,
    });
    if (listResult.error) {
      setErrorMessage(pmQuoteErrorMessage(listResult.error));
      setQuotes([]);
      setLoading(false);
      return;
    }
    const itemsResult = await getPmQuoteItems(listResult.rows.map((row) => row.id));
    if (itemsResult.error) {
      setErrorMessage(pmQuoteErrorMessage(itemsResult.error));
      setQuotes([]);
      setLoading(false);
      return;
    }
    const withItems = listResult.rows.map((quote) => ({
      quote,
      items: itemsResult.itemsByQuote[quote.id] || [],
    }));
    setQuotes(withItems);
    const nextSelected: Record<string, boolean> = {};
    for (const entry of withItems) {
      for (const item of entry.items) {
        nextSelected[itemKey(entry.quote.id, item.id)] = true;
      }
    }
    setSelected(nextSelected);
    setLoading(false);
  }, []);

  const pickWork = (option: BwaWorkOption) => {
    setSelectedWork(option);
    setWorkQuery('');
    setWorkOpen(false);
    void loadQuotes(option);
  };

  const clearWork = () => {
    setSelectedWork(null);
    setQuotes([]);
    setSelected({});
    setErrorMessage('');
  };

  const isSelected = (quoteId: string, itemId: string) =>
    selected[itemKey(quoteId, itemId)] !== false;

  const setSelectedAll = (entry: QuoteWithItems, value: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      for (const item of entry.items) {
        next[itemKey(entry.quote.id, item.id)] = value;
      }
      return next;
    });
  };

  const quoteSubtotal = (entry: QuoteWithItems) =>
    entry.items.reduce(
      (sum, item) => (isSelected(entry.quote.id, item.id) ? sum + item.quantity * item.unitPrice : sum),
      0,
    );

  const { totalBudget, selectedCount, totalCount } = useMemo(() => {
    let total = 0;
    let chosen = 0;
    let count = 0;
    for (const entry of quotes) {
      for (const item of entry.items) {
        count += 1;
        if (isSelected(entry.quote.id, item.id)) {
          chosen += 1;
          total += item.quantity * item.unitPrice;
        }
      }
    }
    return { totalBudget: total, selectedCount: chosen, totalCount: count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, selected]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="fds-page-title">
                <CircleDollarSign className="h-5 w-5 text-primary" />
                報價預算
              </h1>
              <p className="fds-page-description">
                BWA PM 揀一筆工程或提案，列出該 pitching／項目下 BWF 建立的快速報價單，逐項勾選傢俬，
                即時試算需要多少預算。只顯示 BWF 報價的賣價，不含成本、廠家或毛利。
              </p>
            </div>
            <Link
              to={PM_QUICK_PATH}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-semibold"
            >
              去快速報價
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="relative">
            <label className="text-sm" htmlFor="budget-work-search">
              揀選 BWA 工程或提案
              <input
                id="budget-work-search"
                value={selectedWork ? `${workKindLabel(selectedWork.kind)} · ${selectedWork.code || '無編號'}${selectedWork.name ? ` · ${selectedWork.name}` : ''}` : workQuery}
                role="combobox"
                aria-expanded={workOpen}
                aria-controls="budget-work-list"
                autoComplete="off"
                placeholder="編號、名稱或客戶"
                onFocus={() => setWorkOpen(true)}
                onBlur={() => window.setTimeout(() => setWorkOpen(false), 150)}
                onChange={(event) => {
                  setSelectedWork(null);
                  setWorkQuery(event.target.value);
                  setWorkOpen(true);
                }}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3"
              />
            </label>
            {workOpen && (
              <ul
                id="budget-work-list"
                role="listbox"
                className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-md"
              >
                {workLoading && <li className="px-3 py-2 text-sm text-muted-foreground">搜尋中…</li>}
                {!workLoading && workError && (
                  <li className="px-3 py-2 text-sm text-muted-foreground">{workError}</li>
                )}
                {!workLoading && !workError && workOptions.length === 0 && (
                  <li className="px-3 py-2 text-sm text-muted-foreground">沒有符合的工程或提案。</li>
                )}
                {!workLoading && !workError && workOptions.map((option) => (
                  <li key={optionKey(option)}>
                    <button
                      type="button"
                      role="option"
                      className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pickWork(option);
                      }}
                    >
                      <span className="text-sm font-semibold">
                        {workKindLabel(option.kind)} · {option.code || '無編號'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {option.name || '無名稱'}
                        {option.customer_name && option.customer_name !== option.name ? ` · ${option.customer_name}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {selectedWork && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">
                {workKindLabel(selectedWork.kind)} · {selectedWork.code || '無編號'}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {selectedWork.name || '無名稱'}
                {selectedWork.customer_name && selectedWork.customer_name !== selectedWork.name
                  ? ` · ${selectedWork.customer_name}`
                  : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                已選 {selectedCount} / {totalCount} 項傢俬
              </p>
              <p className="text-lg font-bold text-primary">{formatHkMoney(totalBudget)}</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadQuotes(selectedWork)}>
              重新載入
            </Button>
          </section>
        )}

        {loading && <p className="px-2 text-sm text-muted-foreground">載入報價單…</p>}
        {errorMessage && <p className="px-2 text-sm text-destructive">{errorMessage}</p>}
        {selectedWork && !loading && quotes.length === 0 && (
          <EmptyState
            title="這個 pitching／項目下還沒有快速報價單"
            description="BWF PM 在「快速報價」揀選同一筆工程或提案建立報價單後，這裡會列出來試算預算。"
          />
        )}

        <div className="grid gap-3">
          {quotes.map((entry) => {
            const allSelected = entry.items.length > 0 && entry.items.every((item) => isSelected(entry.quote.id, item.id));
            return (
              <article key={entry.quote.id} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold">
                      {entry.quote.bwaProjectName || '未命名工程'}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {entry.quote.quoteId}
                      {entry.quote.bwaProjectRef ? ` · ${entry.quote.bwaProjectRef}` : ''}
                      {' · '}
                      {entry.quote.submitter || '未知提交者'}
                      {entry.quote.createdAt ? ` · ${formatListDate(entry.quote.createdAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold text-primary">{formatHkMoney(quoteSubtotal(entry))}</p>
                    <Link
                      to={pmInquiryPath(PM_QUICK_PATH, entry.quote.id)}
                      className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-semibold"
                    >
                      <Pencil className="mr-1.5 h-4 w-4" />
                      編輯
                    </Link>
                  </div>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="w-10 py-2">
                          <Checkbox
                            aria-label="全選這張報價單的傢俬"
                            checked={allSelected}
                            onCheckedChange={(checked) => setSelectedAll(entry, checked === true)}
                          />
                        </th>
                        <th className="py-2 font-medium">傢俬</th>
                        <th className="py-2 font-medium">規格</th>
                        <th className="py-2 text-right font-medium">數量</th>
                        <th className="py-2 font-medium">單位</th>
                        <th className="py-2 text-right font-medium">賣價</th>
                        <th className="py-2 text-right font-medium">小計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.items.map((item) => {
                        const checked = isSelected(entry.quote.id, item.id);
                        return (
                          <tr key={item.id} className="border-b border-border/60 last:border-0">
                            <td className="py-2">
                              <Checkbox
                                aria-label={`揀選 ${item.name || '項目'}`}
                                checked={checked}
                                onCheckedChange={(value) => setSelected((current) => ({
                                  ...current,
                                  [itemKey(entry.quote.id, item.id)]: value === true,
                                }))}
                              />
                            </td>
                            <td className="py-2 font-medium">{item.name || '—'}</td>
                            <td className="py-2 text-muted-foreground">{item.spec || '—'}</td>
                            <td className="py-2 text-right">{formatListMoney(item.quantity)}</td>
                            <td className="py-2">{item.unit || '—'}</td>
                            <td className="py-2 text-right">{formatHkMoney(item.unitPrice)}</td>
                            <td className="py-2 text-right font-semibold">
                              {checked ? formatHkMoney(item.quantity * item.unitPrice) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {entry.items.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-3 text-center text-sm text-muted-foreground">
                            這張報價單沒有傢俬項目。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 報價預算（已報價列表） ────────────────────────────────────────────────
// 預設列出所有 PM 快速報價單；「按工程試算」仍保留原本的 BWA 工程預算工具。
export function PmBudgetView() {
  const [mode, setMode] = useState<'list' | 'search'>('list');
  if (mode === 'search') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="px-4 pt-4 sm:px-6">
          <Button type="button" variant="outline" size="sm" onClick={() => setMode('list')}>
            返回預算列表
          </Button>
        </div>
        <PmBudgetWorkSearch />
      </div>
    );
  }
  return <PmBudgetList onSearch={() => setMode('search')} />;
}

function PmBudgetList({ onSearch }: { onSearch: () => void }) {
  const [rows, setRows] = useState<PmQuoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void listPmQuickQuotes()
      .then((result) => {
        if (cancelled) return;
        if (result.error) setError(pmQuoteErrorMessage(result.error));
        else setRows(result.rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = rows.reduce((sum, row) => sum + row.totalAmount, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">報價預算</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            已報價的快速報價單（{rows.length} 張，合計 {formatHkMoney(total)}）。打開可看明細與預算試算。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onSearch}>
            按工程試算
          </Button>
          <Button asChild>
            <Link to={PM_QUICK_PATH}>新增預算</Link>
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="還沒有快速報價單"
          description="按「新增預算」建立第一張 PM 快速報價單。"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">單號</th>
                <th className="px-3 py-2 font-medium">工程／提案</th>
                <th className="px-3 py-2 font-medium">負責人</th>
                <th className="px-3 py-2 font-medium">日期</th>
                <th className="px-3 py-2 text-right font-medium">金額</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 font-mono-data text-xs">{row.quoteId || row.id}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.bwaProjectName || row.bwaProjectRef || '—'}</div>
                    {row.bwaProjectRef && row.bwaProjectName ? (
                      <div className="text-xs text-muted-foreground">{row.bwaProjectRef}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.submitter || '—'}</td>
                  <td className="px-3 py-2">{formatListDate(row.createdAt)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatHkMoney(row.totalAmount)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`${PM_QUICK_PATH}?quote=${row.id}`}>打開</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
