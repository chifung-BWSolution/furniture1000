import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthProvider';
import { usePmsStaffName } from '@/hooks/use-pms-staff-name';
import { Calculator, CircleDollarSign } from 'lucide-react';
import { PM_BUDGET_PATH } from '@/content/bwaPm';
import {
  formatHkMoney,
  getPmQuickQuote,
  pmQuoteErrorMessage,
  pmQuoteItemsTotal,
  savePmQuickQuote,
} from '@/lib/pmQuickQuote';
import { searchBwaWorks, type BwaWorkOption } from '@/lib/bwaWorks';
import { Button } from '@/components/ui/button';

interface DraftLine {
  key: string;
  name: string;
  spec: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

function blankLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    name: '',
    spec: '',
    quantity: '1',
    unit: '',
    unitPrice: '',
  };
}

function toMoneyInput(value: number): string {
  return Number.isFinite(value) && value !== 0 ? String(value) : '';
}

function lineSubtotal(line: DraftLine): number {
  return (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
}

function workKindLabel(kind: BwaWorkOption['kind']): string {
  return kind === 'project' ? '工程' : '提案';
}

function linkLabel(pitchingId: string | null, projectId: string | null): string {
  if (projectId) return '已連到 BWA 工程';
  if (pitchingId) return '已連到 BWA 提案';
  return '';
}

function optionKey(option: BwaWorkOption): string {
  return `${option.kind}:${option.project_id || option.pitching_id || option.code}`;
}

export function PmQuickView() {
  const { user } = useAuth();
  const staffName = usePmsStaffName(user?.id);
  const [params, setParams] = useSearchParams();
  const quoteUuid = (params.get('quote') || '').trim();
  const [projectRef, setProjectRef] = useState('');
  const [projectName, setProjectName] = useState('');
  const [pitchingId, setPitchingId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [savedQuoteId, setSavedQuoteId] = useState('');
  const [loading, setLoading] = useState(Boolean(quoteUuid));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [workQuery, setWorkQuery] = useState('');
  const [workOptions, setWorkOptions] = useState<BwaWorkOption[]>([]);
  const [workError, setWorkError] = useState('');
  const [workOpen, setWorkOpen] = useState(false);
  const [workLoading, setWorkLoading] = useState(false);

  useEffect(() => {
    if (!quoteUuid) {
      setProjectRef('');
      setProjectName('');
      setPitchingId(null);
      setProjectId(null);
      setLines([blankLine()]);
      setSavedQuoteId('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getPmQuickQuote(quoteUuid).then((result) => {
      if (cancelled) return;
      if (result.error || !result.quote) {
        setErrorMessage(
          result.error ? pmQuoteErrorMessage(result.error) : '找不到這張快速報價單。',
        );
        setLoading(false);
        return;
      }
      const quote = result.quote;
      setProjectRef(quote.bwaProjectRef);
      setProjectName(quote.bwaProjectName);
      setPitchingId(quote.bwaPitchingId);
      setProjectId(quote.bwaProjectId);
      setSavedQuoteId(quote.quoteId);
      setLines(
        quote.items.length > 0
          ? quote.items.map((item) => ({
            key: item.id,
            name: item.name,
            spec: item.spec,
            quantity: String(item.quantity || ''),
            unit: item.unit,
            unitPrice: toMoneyInput(item.unitPrice),
          }))
          : [blankLine()],
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [quoteUuid]);

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

  const total = useMemo(
    () => pmQuoteItemsTotal(
      lines.map((line) => ({
        id: line.key,
        sortOrder: 0,
        name: line.name,
        spec: line.spec,
        quantity: Number(line.quantity) || 0,
        unit: line.unit,
        unitPrice: Number(line.unitPrice) || 0,
      })),
    ),
    [lines],
  );

  const clearWorkLink = () => {
    setPitchingId(null);
    setProjectId(null);
  };

  const pickWork = (option: BwaWorkOption) => {
    setProjectRef(option.code);
    setProjectName(option.name);
    setPitchingId(option.pitching_id);
    setProjectId(option.project_id);
    setWorkQuery('');
    setWorkOpen(false);
  };

  const newQuote = () => {
    const next = new URLSearchParams(params);
    next.delete('quote');
    setParams(next, { replace: true });
    setMessage('');
    setErrorMessage('');
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    setErrorMessage('');
    const result = await savePmQuickQuote({
      id: quoteUuid || null,
      projectRef,
      projectName,
      pitchingId,
      projectId,
      submitter: (staffName || user?.email || '').trim(),
      items: lines.map((line) => ({
        name: line.name,
        spec: line.spec,
        quantity: Number(line.quantity) || 0,
        unit: line.unit,
        unitPrice: Number(line.unitPrice) || 0,
      })),
    });
    setSaving(false);
    if (result.error || !result.id) {
      const text = result.error
        ? (result.error.message === 'need_items'
          ? '至少要有一項有名稱的傢俬。'
          : result.error.message === 'need_submitter'
            ? '缺少提交者姓名，無法保存。'
            : pmQuoteErrorMessage(result.error))
        : '儲存沒有完成。';
      setErrorMessage(text);
      return;
    }
    if (result.id !== quoteUuid) {
      const next = new URLSearchParams(params);
      next.set('quote', result.id);
      setParams(next, { replace: true });
    }
    if (result.quoteId) setSavedQuoteId(result.quoteId);
    setMessage('已儲存。BWA PM 可以在報價預算揀選這張單的傢俬試算預算。');
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="fds-page-title">
                <Calculator className="h-5 w-5 text-primary" />
                快速報價
              </h1>
              <p className="fds-page-description">
                BWF PM 為 BWA 的工程或提案建傢俬報價單：揀一筆 BWA 工程／提案（或手填編號名稱），逐項填傢俬和賣價。
                BWA PM 之後在「報價預算」按同一個 pitching 揀選傢俬，即時試算需要多少預算。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={PM_BUDGET_PATH}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-semibold"
              >
                <CircleDollarSign className="mr-1.5 h-4 w-4" />
                報價預算
              </Link>
              {quoteUuid && (
                <Button type="button" variant="outline" onClick={newQuote}>
                  開新報價單
                </Button>
              )}
            </div>
          </div>
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">載入報價單…</p>}
        {errorMessage && <p className="px-2 text-sm text-destructive">{errorMessage}</p>}
        {!loading && (
          <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <div className="relative">
              <label className="text-sm" htmlFor="bwa-work-search">
                搜尋 BWA 工程或提案
                <input
                  id="bwa-work-search"
                  value={workQuery}
                  role="combobox"
                  aria-expanded={workOpen}
                  aria-controls="bwa-work-list"
                  autoComplete="off"
                  placeholder="編號、名稱或客戶"
                  onFocus={() => setWorkOpen(true)}
                  onBlur={() => window.setTimeout(() => setWorkOpen(false), 150)}
                  onChange={(event) => {
                    setWorkQuery(event.target.value);
                    setWorkOpen(true);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3"
                />
              </label>
              {workOpen && (
                <ul
                  id="bwa-work-list"
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-md"
                >
                  {workLoading && <li className="px-3 py-2 text-sm text-muted-foreground">搜尋中…</li>}
                  {!workLoading && workError && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">{workError}</li>
                  )}
                  {!workLoading && !workError && workOptions.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      沒有符合的工程或提案。可以直接手填下面的編號和名稱。
                    </li>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                工程編號
                <input
                  value={projectRef}
                  onChange={(event) => {
                    setProjectRef(event.target.value);
                    clearWorkLink();
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3"
                />
              </label>
              <label className="text-sm">
                工程名稱
                <input
                  value={projectName}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    clearWorkLink();
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3"
                />
              </label>
            </div>
            {linkLabel(pitchingId, projectId) && (
              <p className="text-xs text-muted-foreground">{linkLabel(pitchingId, projectId)}。手改編號或名稱會改回手填。</p>
            )}

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={line.key} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1.4fr_1.4fr_5rem_5rem_7rem_7rem_auto]">
                  <label className="text-xs text-muted-foreground">
                    項目 {index + 1}
                    <input
                      aria-label={`項目 ${index + 1} 名稱`}
                      value={line.name}
                      onChange={(event) => updateLine(line.key, { name: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    規格
                    <input
                      aria-label={`項目 ${index + 1} 規格`}
                      value={line.spec}
                      onChange={(event) => updateLine(line.key, { spec: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    數量
                    <input
                      aria-label={`項目 ${index + 1} 數量`}
                      value={line.quantity}
                      inputMode="decimal"
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    單位
                    <input
                      aria-label={`項目 ${index + 1} 單位`}
                      value={line.unit}
                      onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    賣價 (HK$)
                    <input
                      aria-label={`項目 ${index + 1} 賣價`}
                      value={line.unitPrice}
                      inputMode="decimal"
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <div className="text-xs text-muted-foreground">
                    小計
                    <p className="mt-1 flex h-10 items-center text-sm font-semibold text-foreground">
                      {formatHkMoney(lineSubtotal(line))}
                    </p>
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="self-end text-xs text-muted-foreground underline"
                      onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    >
                      移除
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, blankLine()])}>
                加一項
              </Button>
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? '儲存中…' : '儲存報價單'}
              </Button>
              <p className="ml-auto text-sm font-semibold">
                總額 <span className="text-primary">{formatHkMoney(total)}</span>
              </p>
            </div>
            {savedQuoteId && (
              <p className="text-xs text-muted-foreground">報價單號 {savedQuoteId}</p>
            )}
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
