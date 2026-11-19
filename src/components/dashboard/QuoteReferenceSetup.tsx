import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Info, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { Label } from '@/components/ui/label';
import { LoadingImage } from '@/components/ui/loading-image';
import { MultiSelect } from '@/components/ui/multi-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  type QuoteReferenceCandidate,
  type QuoteReferenceMatch,
  type QuoteReferenceTagTone,
} from '@/lib/quoteReferenceMatch';
import { fetchProductCategoryPairs, uniqueLevel2InOrder, type ProductCategoryPair } from '@/lib/productCategoryOptions';
import { formatListDate, formatListMoney } from '@/lib/listTableUtils';
import { cn } from '@/lib/utils';
import type { BwfQuoteItemInput } from '@/lib/bwfQuoteItems';
import { loadQuoteLineItemsForPicker } from '@/lib/quoteCopy';
import { quoteItemLineSubtotal } from '@/lib/quoteItemTotals';

interface QuoteReferenceSetupProps {
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
  onChangePitching: () => void;
  onCopyQuote: (quoteUuid: string) => Promise<void>;
}

const NONE = '__none__';

function tagClass(tone: QuoteReferenceTagTone): string {
  if (tone === 'teal') return 'bg-teal-500/10 text-teal-800 dark:text-teal-300';
  if (tone === 'amber') return 'bg-amber-500/10 text-amber-800 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}

function matchScoreClass(score: number): string {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  if (score >= 60) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
  if (score >= 40) return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
  return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200';
}

const RESULT_ROW_HEIGHT = 56;
const ITEM_ROW_HEIGHT = 72;
const FACET_LIMIT = 40;
const JUNK_FACETS = new Set(['可選', '待定', '待確認', '待定色', 'tbc', '如圖', '按圖', '見圖', '圖片', '圖片色', 'as shown', 'n/a', '-', '/', '色卡', '另議']);

interface CategoryFilter {
  id: string;
  level1: string;
  level2: string;
  colors: string[];
  materials: string[];
}

function blankCategoryFilter(id: string): CategoryFilter {
  return { id, level1: '', level2: '', colors: [], materials: [] };
}

function categoryFilterSummary(row: CategoryFilter): string {
  return [row.level1, row.level2].filter(Boolean).join('／') || '未選類別';
}

function facetKey(value: string): string {
  return value.trim().toLocaleLowerCase('zh-Hant');
}

function topFacetValues(counts: Map<string, number> | undefined): string[] {
  if (!counts) return [];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
    .slice(0, FACET_LIMIT)
    .map(([name]) => name);
}

type WorkspacePanel = 'filters' | 'results' | 'details';
type MatchSort = 'score' | 'date' | 'amount';

function money(value: number | null) {
  return value === null ? '—' : `$${formatListMoney(value)}`;
}

function useRowsPerPage(rowHeight: number, maxRows: number, headerHeight = 0) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState(1);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      if (element.clientHeight > 0) {
        setPageSize(Math.max(1, Math.min(maxRows, Math.floor((element.clientHeight - headerHeight) / rowHeight))));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, headerHeight, maxRows, rowHeight]);
  return { ref: setElement, pageSize };
}

function PageControls({ page, pageCount, label, onChange }: {
  page: number;
  pageCount: number;
  label: string;
  onChange: (page: number) => void;
}) {
  return (
    <nav aria-label={label} className="flex h-10 shrink-0 items-center justify-end gap-2 border-t px-2 text-xs text-muted-foreground">
      {pageCount > 1 && (
        <>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`${label}上一頁`} disabled={page === 0} onClick={() => onChange(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular-nums" aria-live="polite">{page + 1} / {pageCount}</span>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`${label}下一頁`} disabled={page + 1 >= pageCount} onClick={() => onChange(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </nav>
  );
}

function FilterSelect({ field, label, value, onChange, options, placeholder = '不限', disabled = false }: {
  field: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = `quote-ref-${field}`;
  const selection = options.find((option) => option.id === value)?.label ?? placeholder;
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? '' : next)} disabled={disabled}>
        <SelectTrigger id={id} title={selection} className="h-9 px-2 text-xs [&>span]:truncate"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{placeholder}</SelectItem>
          {options.map((option) => <SelectItem key={option.id} value={option.id} disabled={option.disabled}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function selectOptions(values: readonly string[]) {
  return values.map((value) => ({ id: value, label: value }));
}

function multiSelectOptions(values: string[]) {
  return values.map((value) => ({ value, label: value }));
}

function QuoteDetails({ match, copying, categoryById, onClose, onCopy }: {
  match: QuoteReferenceMatch;
  copying: boolean;
  categoryById: Map<string, string>;
  onClose: () => void;
  onCopy: () => void;
}) {
  const { candidate, score, tags } = match;
  const [items, setItems] = useState<BwfQuoteItemInput[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<{ images: string[]; title: string } | null>(null);
  const { ref, pageSize } = useRowsPerPage(ITEM_ROW_HEIGHT, 12, 28);

  useEffect(() => {
    let active = true;
    void loadQuoteLineItemsForPicker(candidate.id)
      .then((rows) => {
        if (active) setItems(rows.filter((row) => !row.isSectionTitle && !row.isCustomTerm && !row.isDivisionTitle));
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => { active = false; };
  }, [candidate.id, attempt]);

  const itemCount = items?.length ?? candidate.itemCount;
  const pageCount = Math.max(1, Math.ceil(itemCount / pageSize));
  const page = Math.min(Math.floor(offset / pageSize), pageCount - 1);
  const start = page * pageSize;

  return (
    <>
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-bold" title={`${candidate.quoteId} ${candidate.version ?? ''}`}>
              {candidate.quoteId} {candidate.version}
            </h2>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {formatListDate(candidate.createdAt)}{candidate.workPeriod && ` · ${candidate.workPeriod}`}
            </p>
          </div>
          <div className={cn('rounded-lg px-2 py-1 text-center', matchScoreClass(score))}>
            <div className="text-[11px] font-medium">匹配度</div>
            <div className="text-lg font-bold leading-tight tabular-nums">{score}%</div>
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="關閉報價詳情" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {candidate.projectName && <p className="mt-1 truncate text-sm font-semibold" title={candidate.projectName}>{candidate.projectName}</p>}
        <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {[
            ['傢俬類別', candidate.scopes.join('、')],
            ['客戶產業', candidate.industries.join('、')],
            ['客戶類型', candidate.customerType],
          ].map(([label, value]) => value ? (
            <div key={label} className="flex min-w-0 gap-2">
              <dt className="shrink-0">{label}</dt>
              <dd className="truncate text-foreground" title={value}>{value}</dd>
            </div>
          ) : null)}
        </dl>
      </div>

      <div className="shrink-0 border-b px-4 py-2.5">
        <h3 className="mb-1.5 text-sm font-semibold">匹配條件</h3>
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span key={tag.key} className={cn('rounded-full px-2 py-0.5 text-xs', tagClass(tag.tone))}>{tag.label}</span>
          ))}
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col px-3 pt-2.5" aria-label="報價項目">
        <h3 className="mb-2 px-1 text-sm font-semibold">報價項目 <span className="font-normal text-muted-foreground">（{itemCount} 項）</span></h3>
        <div ref={ref} className="min-h-0 flex-1">
          {loadFailed ? (
            <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
              <p role="alert" className="text-destructive">暫時無法載入項目</p>
              <Button type="button" size="sm" variant="outline" onClick={() => { setLoadFailed(false); setAttempt((current) => current + 1); }}>重試</Button>
            </div>
          ) : items === null ? (
            <p className="px-1 text-sm text-muted-foreground" role="status">載入報價項目…</p>
          ) : items.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">沒有可預覽的報價項目。</p>
          ) : (
            <Table className="table-fixed text-xs">
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="h-7 w-12 px-1"><span className="sr-only">圖片</span></TableHead>
                  <TableHead className="h-7">傢俬項目／規格</TableHead>
                  <TableHead className="h-7 w-[12%] px-1 text-right">數量</TableHead>
                  <TableHead className="h-7 w-[22%] text-right">小計</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(start, start + pageSize).map((item, index) => {
                  const dimensions = [item.dimensionLMm, item.dimensionWMm, item.dimensionHMm].filter(Boolean).join(' × ');
                  const spec = [dimensions && `${dimensions} mm`, item.material, item.color].filter(Boolean).join(' · ');
                  const tagLine = [
                    item.productCategoryId ? categoryById.get(item.productCategoryId) : '',
                    ...(item.colorTags ?? []),
                    ...(item.materialTags ?? []),
                  ].filter(Boolean).join(' · ');
                  const photos = [item.image, item.referenceImage, item.remarksImage].filter((url): url is string => Boolean(url?.trim()));
                  const itemName = item.name || '未命名項目';
                  return (
                    <TableRow key={item.id ?? start + index} style={{ height: ITEM_ROW_HEIGHT }}>
                      <TableCell className="px-1 py-0">
                        {photos.length > 0 ? (
                          <button type="button" className="block" aria-label={`放大${itemName}圖片`} onClick={() => setPreview({ images: photos, title: itemName })}>
                            <LoadingImage src={photos[0]} alt="" className="h-9 w-9 rounded" />
                          </button>
                        ) : (
                          <span className="block h-9 w-9 rounded bg-muted" />
                        )}
                      </TableCell>
                      <TableCell className="py-0">
                        <div className="truncate font-medium" title={item.name}>{itemName}</div>
                        {spec && <div className="truncate text-muted-foreground" title={spec}>{spec}</div>}
                        {tagLine && <div className="truncate text-primary" title={tagLine}>{tagLine}</div>}
                      </TableCell>
                      <TableCell className="truncate px-1 py-0 text-right tabular-nums" title={`${item.quantity ?? '—'} ${item.unit ?? ''}`}>{item.quantity ?? '—'}</TableCell>
                      <TableCell className="truncate py-0 text-right tabular-nums" title={item.isOptional ? '選配項目' : money(quoteItemLineSubtotal(item))}>
                        {item.isOptional ? '選配' : money(quoteItemLineSubtotal(item))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        {items && items.length > 0 && <PageControls label="報價項目" page={page} pageCount={pageCount} onChange={(next) => setOffset(next * pageSize)} />}
      </section>
      <ImageLightbox open={preview !== null} onClose={() => setPreview(null)} images={preview?.images ?? []} title={preview?.title} thumbWidth={96} />

      <footer className="shrink-0 space-y-2 border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">報價總額（HKD）</span>
          <span className="font-semibold tabular-nums">{money(candidate.totalAmount)}</span>
        </div>
        <Button type="button" className="w-full gap-2" disabled={copying} onClick={onCopy}>
          {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          {copying ? '複製中…' : '複製此報價'}
        </Button>
      </footer>
    </>
  );
}

export function QuoteReferenceSetup({
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
  onChangePitching,
  onCopyQuote,
}: QuoteReferenceSetupProps) {
  const categoryFilterSeq = useRef(1);
  const [categoryFilters, setCategoryFilters] = useState<CategoryFilter[]>(() => [blankCategoryFilter('1')]);
  const [activeCategoryId, setActiveCategoryId] = useState('1');
  const [pairs, setPairs] = useState<ProductCategoryPair[]>([]);
  const [amountBandId, setAmountBandId] = useState('');
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(industries);
  const [industryHard, setIndustryHard] = useState(false);
  const [customerType, setCustomerType] = useState(initialCustomerType.trim());
  const [grade, setGrade] = useState('');
  const [workPeriod, setWorkPeriod] = useState('');
  const [candidates, setCandidates] = useState<QuoteReferenceCandidate[]>([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<QuoteReferenceMatch[] | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [panel, setPanel] = useState<WorkspacePanel>('filters');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sort, setSort] = useState<MatchSort>('score');
  const [offset, setOffset] = useState(0);
  const { ref: resultsRef, pageSize } = useRowsPerPage(RESULT_ROW_HEIGHT, 12);
  const seededIndustries = useRef(industries.length > 0);
  const seededCustomerType = useRef(Boolean(initialCustomerType.trim()));

  useEffect(() => {
    let cancelled = false;
    void fetchProductCategoryPairs().then((rows) => {
      if (!cancelled) setPairs(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, []);

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

  const allIndustries = [...new Set([...industryOptions, ...selectedIndustries])];
  const categoryById = useMemo(() => {
    const names = new Map<string, string>();
    for (const pair of pairs) {
      if (pair.id && pair.level2) names.set(pair.id, pair.level2);
    }
    return names;
  }, [pairs]);

  const facetCounts = useMemo(() => {
    const colors = new Map<string, Map<string, number>>();
    const materials = new Map<string, Map<string, number>>();
    const bump = (groups: Map<string, Map<string, number>>, category: string, value: string) => {
      const name = value.trim();
      if (!name || JUNK_FACETS.has(facetKey(name))) return;
      const key = facetKey(category);
      if (!key) return;
      const counts = groups.get(key) ?? new Map<string, number>();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      groups.set(key, counts);
    };
    for (const row of candidates) {
      for (const trait of row.itemTraits ?? []) {
        for (const color of trait.colors) bump(colors, trait.category, color);
        for (const material of trait.materials) bump(materials, trait.category, material);
      }
    }
    return { colors, materials };
  }, [candidates]);

  const sortedResults = useMemo(() => {
    if (!results || sort === 'score') return results ?? [];
    return [...results].sort((a, b) => sort === 'date'
      ? (b.candidate.createdAt ?? '').localeCompare(a.candidate.createdAt ?? '')
      : (b.candidate.totalAmount ?? -Infinity) - (a.candidate.totalAmount ?? -Infinity));
  }, [results, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedResults.length / pageSize));
  const page = Math.min(Math.floor(offset / pageSize), pageCount - 1);
  const activeMatch = sortedResults.find((row) => row.candidate.id === activeId);

  const budgetText = (() => {
    if (estimatedIncome == null || estimatedIncome === '') return null;
    const formatted = formatListMoney(estimatedIncome);
    return formatted === 'N/A' ? null : formatted;
  })();

  const canMatch = categoryFilters.some((row) => row.level1.trim()) && !loadingIndex && !loadError;
  const activeCategoryIndex = Math.max(0, categoryFilters.findIndex(({ id }) => id === activeCategoryId));
  const activeCategory = categoryFilters[activeCategoryIndex];
  const adjacentCategoryIndex = activeCategoryIndex + 1 < categoryFilters.length ? activeCategoryIndex + 1 : activeCategoryIndex - 1;
  const adjacentCategory = categoryFilters[adjacentCategoryIndex];
  const level2Options = uniqueLevel2InOrder(pairs, activeCategory.level1).map((level2) => {
    const disabled = isClassificationUsed(activeCategory.id, activeCategory.level1, level2);
    return { id: level2, label: disabled ? `${level2}（其他組已選）` : level2, disabled };
  });
  const activeFacetKey = facetKey(activeCategory.level2);
  const colorOptions = topFacetValues(facetCounts.colors.get(activeFacetKey));
  const materialOptions = topFacetValues(facetCounts.materials.get(activeFacetKey));

  function updateCategoryFilter(id: string, patch: Partial<CategoryFilter>) {
    setCategoryFilters((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function isClassificationUsed(groupId: string, level1: string, level2: string) {
    return Boolean(level2) && categoryFilters.some((row) =>
      row.id !== groupId && row.level1 === level1 && row.level2 === level2,
    );
  }

  function changeLevel1(row: CategoryFilter, level1: string) {
    const level2s = uniqueLevel2InOrder(pairs, level1);
    const canKeepLevel2 = level2s.includes(row.level2) && !isClassificationUsed(row.id, level1, row.level2);
    const level2 = canKeepLevel2 ? row.level2 : '';
    updateCategoryFilter(row.id, {
      level1,
      level2,
      colors: level2 ? row.colors : [],
      materials: level2 ? row.materials : [],
    });
  }

  function changeLevel2(row: CategoryFilter, level2: string) {
    if (isClassificationUsed(row.id, row.level1, level2)) return;
    updateCategoryFilter(row.id, {
      level2,
      colors: level2 ? row.colors : [],
      materials: level2 ? row.materials : [],
    });
  }

  function addCategoryFilter() {
    categoryFilterSeq.current += 1;
    const id = String(categoryFilterSeq.current);
    setCategoryFilters((current) => [...current, blankCategoryFilter(id)]);
    setActiveCategoryId(id);
  }

  function removeActiveCategoryFilter() {
    if (!adjacentCategory) return;
    setCategoryFilters((current) => current.filter(({ id }) => id !== activeCategory.id));
    setActiveCategoryId(adjacentCategory.id);
  }

  function runMatch() {
    if (!canMatch) return;
    const matches = matchQuoteReferences(candidates, {
      furnitureGroups: categoryFilters.map((row) => ({
        scope: row.level1,
        classification: row.level2,
        colors: row.colors,
        materials: row.materials,
      })),
      amountBandId,
      sizeBandId: null,
      industries: selectedIndustries,
      industryHard,
      customerType: customerType || null,
      grade: grade || null,
      workPeriod: workPeriod || null,
      excludeQuoteId,
    });
    setResults(matches);
    setOffset(0);
    setSort('score');
    setActiveId(matches[0]?.candidate.id ?? null);
    setPanel('results');
  }

  function clearFilters() {
    seededIndustries.current = true;
    seededCustomerType.current = true;
    categoryFilterSeq.current = 1;
    setCategoryFilters([blankCategoryFilter('1')]);
    setActiveCategoryId('1');
    setAmountBandId('');
    setSelectedIndustries([]);
    setIndustryHard(false);
    setCustomerType('');
    setGrade('');
    setWorkPeriod('');
    setResults(null);
    setActiveId(null);
    setOffset(0);
    setSort('score');
    setPanel('filters');
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-muted/30 px-3 py-2 text-foreground sm:gap-3 sm:px-4">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="sr-only">報價參考分析</h1>
          <p className="truncate text-sm font-medium" title={pitchingLabel ?? undefined}>
            {pitchingLabel ? `複製到 ${pitchingLabel}` : '複製到已綁定的 Pitching 或項目'}
          </p>
          {budgetText && <p className="text-xs text-muted-foreground">預計收入 ${budgetText}</p>}
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={copyingId !== null} onClick={onChangePitching}>重選 Pitching</Button>
      </header>

      <nav className="flex shrink-0 gap-1 rounded-lg border bg-card p-1 xl:hidden" aria-label="報價參考區域">
        {([
          ['filters', '篩選'],
          ['results', '相符報價'],
          ['details', '報價詳情'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            className="h-8 flex-1"
            size="sm"
            variant={panel === key ? 'secondary' : 'ghost'}
            aria-pressed={panel === key}
            disabled={key === 'details' && !activeMatch}
            onClick={() => setPanel(key)}
          >
            {label}
          </Button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[clamp(21rem,26vw,32rem)_minmax(0,0.95fr)_minmax(0,1.45fr)] 2xl:gap-4">
        <section className={cn('min-h-0 min-w-0 flex-col rounded-xl border bg-card xl:flex', panel === 'filters' ? 'flex' : 'hidden')} aria-labelledby="quote-ref-filters">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 2xl:px-4">
            <h2 id="quote-ref-filters" className="text-base font-semibold">篩選條件</h2>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-primary" onClick={clearFilters}>清除全部</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 2xl:px-4">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,max(9rem,40%)),1fr))] gap-3">
              <div className="col-span-full min-w-0 space-y-4 border-b pb-3">
                <div className="space-y-2">
                  <Label htmlFor="quote-ref-group">搜尋組別</Label>
                  <div className="flex items-center gap-2">
                    <Select value={activeCategory.id} onValueChange={setActiveCategoryId}>
                      <SelectTrigger id="quote-ref-group" className="h-10 min-w-0 flex-1 gap-2 text-left [&>span]:truncate [&>svg]:shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryFilters.map((row, index) => (
                          <SelectItem key={row.id} value={row.id}>第 {index + 1} 組 · {categoryFilterSummary(row)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" className="h-10 shrink-0 gap-1.5 bg-primary/10 px-2.5 text-primary hover:bg-primary/15 hover:text-primary" onClick={addCategoryFilter}>
                      <Plus aria-hidden="true" />
                      新增組別
                    </Button>
                  </div>
                </div>
                <div className="flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md bg-primary/10 px-2">
                  <h3 id="quote-ref-active-group" className="shrink-0 whitespace-nowrap text-xs font-semibold text-primary sm:text-sm">
                    目前編輯 · 第 {activeCategoryIndex + 1} 組
                  </h3>
                  <div className="flex min-w-0 items-center justify-end gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0">共 {categoryFilters.length} 組條件</span>
                    {adjacentCategory && (
                      <>
                        <span className="min-w-0 truncate border-l pl-2" title={categoryFilterSummary(adjacentCategory)}>
                          第 {adjacentCategoryIndex + 1} 組：{categoryFilterSummary(adjacentCategory)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 gap-1 px-1 text-primary hover:text-primary [&_svg]:size-3.5"
                          aria-label={`編輯第 ${adjacentCategoryIndex + 1} 組`}
                          onClick={() => setActiveCategoryId(adjacentCategory.id)}
                        >
                          <Pencil aria-hidden="true" />
                          編輯
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div key={activeCategory.id} className="min-w-0 space-y-3" role="group" aria-labelledby="quote-ref-active-group">
                  <div className="grid grid-cols-2 gap-3">
                    <FilterSelect
                      field={`category-${activeCategory.id}`}
                      label="傢俬類別"
                      value={activeCategory.level1}
                      onChange={(level1) => changeLevel1(activeCategory, level1)}
                      options={selectOptions(categoryOptions)}
                      placeholder={categoriesLoading ? '載入類別…' : '請選擇'}
                      disabled={categoriesLoading}
                    />
                    <FilterSelect
                      field={`class-${activeCategory.id}`}
                      label="分類"
                      value={activeCategory.level2}
                      onChange={(level2) => changeLevel2(activeCategory, level2)}
                      options={level2Options}
                      placeholder={!activeCategory.level1 ? '先選類別' : level2Options.length === 0 ? '沒有細分類' : '不限'}
                      disabled={!activeCategory.level1 || level2Options.length === 0}
                    />
                  </div>
                  {activeCategory.level2 && (
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-3">
                      <div className="min-w-0 space-y-1">
                        <Label>顏色</Label>
                        {colorOptions.length > 0 ? (
                          <MultiSelect compact label={`${activeCategory.level2}顏色`} options={multiSelectOptions(colorOptions)} value={activeCategory.colors} onValueChange={(colors) => updateCategoryFilter(activeCategory.id, { colors })} placeholder="不限" />
                        ) : (
                          <p className="flex h-9 items-center text-xs text-muted-foreground">不限</p>
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <Label>材質</Label>
                        {materialOptions.length > 0 ? (
                          <MultiSelect compact label={`${activeCategory.level2}材質`} options={multiSelectOptions(materialOptions)} value={activeCategory.materials} onValueChange={(materials) => updateCategoryFilter(activeCategory.id, { materials })} placeholder="不限" />
                        ) : (
                          <p className="flex h-9 items-center text-xs text-muted-foreground">不限</p>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex min-h-9 items-center justify-between gap-2 border-t pt-2">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Info className="size-3.5 shrink-0" aria-hidden="true" />
                      各組條件獨立設定
                    </span>
                    {adjacentCategory && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={removeActiveCategoryFilter}>
                        移除此組
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <FilterSelect field="amount" label="金額區間" value={amountBandId} onChange={setAmountBandId} options={QUOTE_AMOUNT_BANDS} />
              <FilterSelect field="grade" label="傢俬級別" value={grade} onChange={setGrade} options={selectOptions(QUOTE_REFERENCE_GRADES)} />
              <FilterSelect field="period" label="工期" value={workPeriod} onChange={setWorkPeriod} options={selectOptions(workPeriodOptions)} />
              <FilterSelect field="customer-type" label="客戶類型" value={customerType} onChange={setCustomerType} options={selectOptions(customerTypeOptions)} />
              <div className="col-span-full space-y-1 border-t pt-2">
                <Label>客戶產業</Label>
                <MultiSelect compact label="客戶產業" options={multiSelectOptions(allIndustries)} value={selectedIndustries} onValueChange={setSelectedIndustries} placeholder="不限" />
                <label className="flex min-h-7 items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={industryHard} onCheckedChange={(checked) => setIndustryHard(checked === true)} />
                  只看相同產業
                </label>
              </div>
            </div>
          </div>
          <div className="shrink-0 space-y-1.5 border-t p-3 2xl:px-4">
            {loadError && <p role="alert" className="text-xs text-destructive">{loadError}</p>}
            <Button type="button" className="w-full gap-2" disabled={!canMatch || copyingId !== null} onClick={runMatch}>
              {loadingIndex ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loadingIndex ? '載入過往報價…' : '搜尋相符報價'}
            </Button>
          </div>
        </section>

        <section className={cn('min-h-0 min-w-0 flex-col rounded-xl border bg-card xl:flex', panel === 'results' ? 'flex' : 'hidden')} aria-labelledby="quote-ref-results">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 p-3">
            <h2 id="quote-ref-results" className="text-base font-semibold">
              相符報價 {results && <span className="ml-1 tabular-nums text-muted-foreground" aria-live="polite">{results.length}</span>}
            </h2>
            <Select value={sort} disabled={sortedResults.length === 0} onValueChange={(next: MatchSort) => { setSort(next); setOffset(0); }}>
              <SelectTrigger className="h-8 w-auto gap-2 text-xs" aria-label="報價排序"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">匹配度由高至低</SelectItem>
                <SelectItem value="date">日期由新至舊</SelectItem>
                <SelectItem value="amount">金額由高至低</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid shrink-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_4rem] gap-2 border-y bg-muted px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1.4fr)_minmax(0,.9fr)_4rem]">
            <span>報價編號</span>
            <span className="hidden sm:block">項目資料</span>
            <span className="text-right">金額 (HKD)</span>
            <span className="text-center">匹配度</span>
          </div>
          <div ref={resultsRef} className="min-h-0 flex-1">
            {sortedResults.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{results ? '沒有相符的報價，請調整篩選條件後再搜尋。' : '選擇傢俬類別後搜尋。'}</p>
            ) : (
              <ul aria-label="相符報價列表">
                {sortedResults.slice(page * pageSize, (page + 1) * pageSize).map(({ candidate, score, completeGroups, totalGroups }) => {
                  const quoteCode = `${candidate.quoteId} ${candidate.version ?? ''}`.trim();
                  const project = candidate.projectName || candidate.scopes.join('、') || '未記錄項目資料';
                  const furnitureSummary = `傢俬 ${completeGroups}/${totalGroups} 組完全相符`;
                  return (
                    <li key={candidate.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        style={{ height: RESULT_ROW_HEIGHT }}
                        className={cn(
                          'grid w-full grid-cols-[minmax(0,2fr)_minmax(0,1fr)_4rem] gap-2 rounded-none border-b px-3 text-left font-normal focus-visible:ring-inset sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1.4fr)_minmax(0,.9fr)_4rem]',
                          activeId === candidate.id && 'bg-primary/10 text-foreground hover:bg-primary/15',
                        )}
                        aria-label={`查看 ${quoteCode} 報價詳情，匹配度 ${score}%，${furnitureSummary}`}
                        aria-pressed={activeId === candidate.id}
                        onClick={() => { setActiveId(candidate.id); setPanel('details'); }}
                      >
                        <span className="block min-w-0">
                          <span className="block truncate text-xs font-semibold tabular-nums sm:text-sm" title={candidate.quoteId}>{candidate.quoteId}</span>
                          <span className="block truncate text-xs text-muted-foreground" title={project}>
                            {candidate.version}<span className="sm:hidden">{candidate.version ? ' · ' : ''}{project}</span>
                          </span>
                        </span>
                        <span className="hidden min-w-0 sm:block">
                          <span className="block truncate text-xs font-medium" title={project}>{project}</span>
                          <span className="block truncate text-xs tabular-nums text-muted-foreground">{formatListDate(candidate.createdAt)} · {candidate.itemCount} 項</span>
                        </span>
                        <span className="truncate text-right text-xs font-medium tabular-nums" title={money(candidate.totalAmount)}>{money(candidate.totalAmount)}</span>
                        <span className="grid justify-items-center gap-0.5 tabular-nums" title={furnitureSummary}>
                          <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-semibold', matchScoreClass(score))}>{score}%</span>
                          <span className="text-[11px] leading-tight text-muted-foreground">{completeGroups}/{totalGroups} 組相符</span>
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <PageControls label="相符報價" page={page} pageCount={pageCount} onChange={(next) => setOffset(next * pageSize)} />
        </section>

        <aside className={cn('min-h-0 min-w-0 flex-col rounded-xl border bg-card xl:flex', panel === 'details' ? 'flex' : 'hidden')} aria-label="報價詳情">
          {activeMatch ? (
            <QuoteDetails
              key={activeMatch.candidate.id}
              match={activeMatch}
              copying={copyingId !== null}
              categoryById={categoryById}
              onClose={() => { setActiveId(null); setPanel('results'); }}
              onCopy={() => void copyQuote(activeMatch.candidate.id)}
            />
          ) : (
            <div className="p-4">
              <h2 className="text-base font-semibold">報價詳情</h2>
              <p className="mt-2 text-sm text-muted-foreground">選擇一張相符報價，查看項目及匹配條件。</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
