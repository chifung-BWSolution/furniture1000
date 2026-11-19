import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchPmsPitchings } from '@/lib/pmsPitchings';
import { loadQuoteReferenceCandidates } from '@/lib/quoteReferenceIndex';
import {
  matchQuoteReferences,
  QUOTE_AMOUNT_BANDS,
  QUOTE_REFERENCE_GRADES,
  QUOTE_SIZE_BANDS,
  type QuoteReferenceCandidate,
  type QuoteReferenceMatch,
  type QuoteReferenceTagTone,
} from '@/lib/quoteReferenceMatch';
import { formatListDate, formatListMoney } from '@/lib/listTableUtils';
import { cn } from '@/lib/utils';

export type QuoteReferenceSetupMode = 'choose' | 'reference';

interface QuoteReferenceSetupProps {
  mode: QuoteReferenceSetupMode;
  pitchingId: string | null;
  pitchingLabel: string | null;
  initialCustomerType: string;
  estimatedIncome: number | string | null;
  industries: string[];
  industryOptions: string[];
  categoryOptions: string[];
  categoriesLoading: boolean;
  workPeriodOptions: string[];
  excludeQuoteId?: string | null;
  onBlankQuote: () => void;
  onOpenReference: () => void;
  onBackToChoice: () => void;
  onChangePitching: () => void;
  onCopyQuote: (quoteUuid: string) => Promise<void>;
}

const NONE = '__none__';

function tagClass(tone: QuoteReferenceTagTone): string {
  if (tone === 'teal') return 'bg-teal-50 text-teal-800';
  if (tone === 'amber') return 'bg-amber-50 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

function toggleValue(values: string[], value: string, on: boolean): string[] {
  if (on) return values.includes(value) ? values : [...values, value];
  return values.filter((item) => item !== value);
}

export function QuoteReferenceSetup({
  mode,
  pitchingId,
  pitchingLabel,
  initialCustomerType,
  estimatedIncome,
  industries,
  industryOptions,
  categoryOptions,
  categoriesLoading,
  workPeriodOptions,
  excludeQuoteId,
  onBlankQuote,
  onOpenReference,
  onBackToChoice,
  onChangePitching,
  onCopyQuote,
}: QuoteReferenceSetupProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [amountBandId, setAmountBandId] = useState('');
  const [sizeBandId, setSizeBandId] = useState('');
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(industries);
  const [industryHard, setIndustryHard] = useState(false);
  const [industryFilter, setIndustryFilter] = useState('');
  const [customerType, setCustomerType] = useState(initialCustomerType.trim());
  const [grade, setGrade] = useState('');
  const [workPeriod, setWorkPeriod] = useState('');
  const [candidates, setCandidates] = useState<QuoteReferenceCandidate[]>([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<QuoteReferenceMatch[] | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const seededIndustries = useRef(industries.length > 0);
  const seededCustomerType = useRef(Boolean(initialCustomerType.trim()));

  useEffect(() => {
    if (seededIndustries.current || industries.length === 0) return;
    seededIndustries.current = true;
    setSelectedIndustries(industries);
  }, [industries]);

  useEffect(() => {
    const next = initialCustomerType.trim();
    if (!next || seededCustomerType.current) return;
    seededCustomerType.current = true;
    setCustomerType(next);
  }, [initialCustomerType]);

  useEffect(() => {
    if (seededCustomerType.current || !pitchingId) return;
    let cancelled = false;
    void fetchPmsPitchings({ ids: [pitchingId] }).then((rows) => {
      if (cancelled || seededCustomerType.current) return;
      const match = rows.find((row) => row.id === pitchingId);
      const type = match?.customer_type?.trim() || '';
      if (!type) return;
      seededCustomerType.current = true;
      setCustomerType(type);
    });
    return () => {
      cancelled = true;
    };
  }, [pitchingId]);

  useEffect(() => {
    if (mode !== 'reference') return;
    let cancelled = false;
    setLoadingIndex(true);
    setLoadError(null);
    void loadQuoteReferenceCandidates()
      .then((rows) => {
        if (!cancelled) setCandidates(rows);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '無法載入過往報價');
      })
      .finally(() => {
        if (!cancelled) setLoadingIndex(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const customerTypeOptions = useMemo(() => {
    const values = new Set<string>();
    if (initialCustomerType.trim()) values.add(initialCustomerType.trim());
    if (customerType.trim()) values.add(customerType.trim());
    for (const row of candidates) {
      const type = row.customerType?.trim();
      if (type) values.add(type);
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [candidates, customerType, initialCustomerType]);

  const visibleIndustries = useMemo(() => {
    const query = industryFilter.trim().toLocaleLowerCase('zh-Hant');
    const options = [...industryOptions];
    for (const value of selectedIndustries) {
      if (!options.includes(value)) options.unshift(value);
    }
    const source = options.length > 0 ? options : selectedIndustries;
    if (!query) return source;
    return source.filter((option) => option.toLocaleLowerCase('zh-Hant').includes(query));
  }, [industryFilter, industryOptions, selectedIndustries]);

  const budgetText = (() => {
    if (estimatedIncome == null || estimatedIncome === '') return null;
    const formatted = formatListMoney(estimatedIncome);
    return formatted === 'N/A' ? null : formatted;
  })();

  const canMatch = selectedCategories.length > 0 && Boolean(amountBandId) && !loadingIndex && !loadError;

  function runMatch() {
    if (!canMatch) return;
    setResults(
      matchQuoteReferences(candidates, {
        categories: selectedCategories,
        amountBandId,
        sizeBandId: sizeBandId || null,
        industries: selectedIndustries,
        industryHard,
        customerType: customerType || null,
        grade: grade || null,
        workPeriod: workPeriod || null,
        excludeQuoteId,
      }),
    );
  }

  async function copyQuote(quoteUuid: string) {
    setCopyingId(quoteUuid);
    try {
      await onCopyQuote(quoteUuid);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '請再試一次';
      toast.error('無法複製報價', { description: message });
    } finally {
      setCopyingId(null);
    }
  }

  if (mode === 'choose') {
    return (
      <div className="h-full overflow-y-auto bg-background fds-page-padding">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">建立報價</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {pitchingLabel ? `已綁定 ${pitchingLabel}` : '已綁定 Pitching 或項目'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onBlankQuote}
              className="rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/40"
            >
              <div className="font-display text-base font-bold text-foreground">空白報價</div>
              <p className="mt-2 font-body text-sm text-muted-foreground">
                直接打開編輯器，從空白明細開始。
              </p>
            </button>
            <button
              type="button"
              onClick={onOpenReference}
              className="rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/40"
            >
              <div className="font-display text-base font-bold text-foreground">參考過往報價</div>
              <p className="mt-2 font-body text-sm text-muted-foreground">
                按類別、金額和尺寸配對過往報價，再把內容複製到這張新單。
              </p>
            </button>
          </div>
          <Button type="button" variant="ghost" className="self-start px-0" onClick={onChangePitching}>
            重選 Pitching
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background fds-page-padding">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">報價參考分析</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {pitchingLabel ? `複製到 ${pitchingLabel}` : '複製到已綁定的 Pitching 或項目'}
              {budgetText ? ` · 預計收入 ${budgetText}，只供參考` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onBackToChoice}>
              返回
            </Button>
            <Button type="button" variant="ghost" onClick={onChangePitching}>
              重選 Pitching
            </Button>
          </div>
        </div>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="grid gap-5">
            <div>
              <Label>傢俬類別</Label>
              <p className="mb-2 mt-1 font-body text-xs text-muted-foreground">至少選一項。沒有交集的報價不會列出。</p>
              {categoriesLoading ? (
                <p className="font-body text-sm text-muted-foreground">載入類別…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {categoryOptions.map((option) => {
                    const selected = selectedCategories.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedCategories((current) => toggleValue(current, option, !selected))}
                        className={cn(
                          'rounded-full border px-3 py-1 font-body text-xs',
                          selected
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-background text-muted-foreground',
                        )}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="quote-ref-amount">金額區間</Label>
                <Select value={amountBandId || NONE} onValueChange={(value) => setAmountBandId(value === NONE ? '' : value)}>
                  <SelectTrigger id="quote-ref-amount" className="mt-2">
                    <SelectValue placeholder="選擇金額區間" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>選擇金額區間</SelectItem>
                    {QUOTE_AMOUNT_BANDS.map((band) => (
                      <SelectItem key={band.id} value={band.id}>{band.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="quote-ref-size">項目尺寸</Label>
                <Select value={sizeBandId || NONE} onValueChange={(value) => setSizeBandId(value === NONE ? '' : value)}>
                  <SelectTrigger id="quote-ref-size" className="mt-2">
                    <SelectValue placeholder="未指定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>未指定</SelectItem>
                    {QUOTE_SIZE_BANDS.map((band) => (
                      <SelectItem key={band.id} value={band.id}>{band.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="quote-ref-grade">傢俬級別</Label>
                <Select value={grade || NONE} onValueChange={(value) => setGrade(value === NONE ? '' : value)}>
                  <SelectTrigger id="quote-ref-grade" className="mt-2">
                    <SelectValue placeholder="未指定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>未指定</SelectItem>
                    {QUOTE_REFERENCE_GRADES.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="quote-ref-period">工期</Label>
                <Select value={workPeriod || NONE} onValueChange={(value) => setWorkPeriod(value === NONE ? '' : value)}>
                  <SelectTrigger id="quote-ref-period" className="mt-2">
                    <SelectValue placeholder="未指定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>未指定</SelectItem>
                    {workPeriodOptions.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="quote-ref-customer-type">客戶類型</Label>
              <Select
                value={customerType || NONE}
                onValueChange={(value) => setCustomerType(value === NONE ? '' : value)}
              >
                <SelectTrigger id="quote-ref-customer-type" className="mt-2">
                  <SelectValue placeholder="未指定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>未指定</SelectItem>
                  {customerTypeOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="quote-ref-industry-filter">客戶產業</Label>
                <label className="flex items-center gap-2 font-body text-xs text-muted-foreground">
                  <Checkbox
                    checked={industryHard}
                    onCheckedChange={(checked) => setIndustryHard(checked === true)}
                    aria-label="只看相同產業"
                  />
                  只看相同產業
                </label>
              </div>
              <input
                id="quote-ref-industry-filter"
                value={industryFilter}
                onChange={(event) => setIndustryFilter(event.target.value)}
                placeholder="搜尋產業"
                className="mt-2 h-9 w-full rounded-md border border-input bg-transparent px-3 font-body text-sm"
              />
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {visibleIndustries.length === 0 ? (
                  <p className="px-1 py-2 font-body text-xs text-muted-foreground">沒有相符的產業</p>
                ) : (
                  visibleIndustries.map((option) => (
                    <label key={option} className="flex items-start gap-2 rounded px-1 py-1 font-body text-sm">
                      <Checkbox
                        checked={selectedIndustries.includes(option)}
                        onCheckedChange={(checked) =>
                          setSelectedIndustries((current) => toggleValue(current, option, checked === true))
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="button" onClick={runMatch} disabled={!canMatch}>
                配對過往報價
              </Button>
              {loadingIndex ? (
                <span className="inline-flex items-center gap-2 font-body text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  載入過往報價…
                </span>
              ) : null}
              {loadError ? <span className="font-body text-xs text-destructive">{loadError}</span> : null}
            </div>
          </div>
        </section>

        {results ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-base font-bold text-foreground">
              {results.length === 0 ? '沒有符合的過往報價' : `${results.length} 張相符報價`}
            </h2>
            {results.length === 0 ? (
              <p className="font-body text-sm text-muted-foreground">
                請調整傢俬類別、金額區間或產業後再配對。
              </p>
            ) : (
              results.map((row) => (
                <article key={row.candidate.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono-data text-sm font-semibold text-foreground">
                        {row.candidate.quoteId}
                        {row.candidate.version ? ` ${row.candidate.version}` : ''}
                      </div>
                      <p className="mt-1 font-body text-xs text-muted-foreground">
                        {formatListDate(row.candidate.createdAt)}
                        {' · '}
                        {formatListMoney(row.candidate.totalAmount)}
                        {' · '}
                        {row.candidate.itemCount} 項
                      </p>
                      <p className="mt-1 font-body text-xs text-foreground/80">
                        {row.candidate.scopes.join('、') || '未記錄類別'}
                        {row.candidate.industries.length > 0
                          ? ` · ${row.candidate.industries.join('、')}`
                          : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono-data text-lg font-semibold text-foreground">{row.score}</div>
                      <div className="font-body text-[11px] text-muted-foreground">配對排序</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {row.tags.map((item) => (
                      <span
                        key={item.key}
                        className={cn('rounded-full px-2 py-0.5 font-body text-[11px]', tagClass(item.tone))}
                      >
                        {item.label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      disabled={copyingId !== null}
                      onClick={() => void copyQuote(row.candidate.id)}
                    >
                      {copyingId === row.candidate.id ? '複製中…' : '複製這張報價'}
                    </Button>
                  </div>
                </article>
              ))
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
