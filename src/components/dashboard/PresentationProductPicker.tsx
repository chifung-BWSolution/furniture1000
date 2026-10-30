import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Check, ChevronLeft, ChevronRight, Loader2, MapPin, Package, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingImage } from '@/components/ui/loading-image';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { productThumbUrl } from '@/lib/imageThumb';
import {
  EMPTY_SEARCH_FILTERS,
  fetchSearchFacets,
  searchProducts,
  type SearchFacets,
  type SearchProduct,
  type SearchResult,
} from '@/lib/productSearch';
import { cn } from '@/lib/utils';

const ROWS_PER_PAGE = 3;
const CARD_MIN_WIDTH = 168;
const GRID_GAP = 12;
const TITLE_SPLIT = /^(.*[\u3400-\u9fff])\s+([A-Za-z0-9][\w .,&/'’\-]*[A-Za-z])\s*$/;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Same split as the product list: Chinese title, then a trailing English name. */
function splitTitle(title: string): { primary: string; secondary: string | null } {
  const match = title.match(TITLE_SPLIT);
  if (!match) return { primary: title, secondary: null };
  const secondary = match[2].trim();
  if (secondary.length < 3) return { primary: title, secondary: null };
  return { primary: match[1].trim(), secondary };
}

function coverUrl(product: SearchProduct): string | null {
  const listed = (product.image_urls ?? []).find((url) => /^https?:\/\//i.test(url));
  if (listed) return listed;
  return product.image_url && /^https?:\/\//i.test(product.image_url) ? product.image_url : null;
}

function productCode(product: SearchProduct): string | null {
  const code = product.model?.trim() || product.sku?.trim();
  return code || null;
}

function productCategory(product: SearchProduct): string | null {
  return product.level2_category?.trim()
    || product.level1_category?.trim()
    || product.category?.trim()
    || null;
}

function matchesFilters(product: SearchProduct, query: string, level1: string, level2: string): boolean {
  if (level1 && product.level1_category !== level1) return false;
  if (level2 && product.level2_category !== level2) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    product.title,
    product.model,
    product.sku,
    product.category,
    product.level1_category,
    product.level2_category,
    product.factory_name,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

function Thumb({
  url,
  alt,
  className,
}: {
  url: string | null;
  alt: string;
  className?: string;
}) {
  if (!url) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
        <Package className="h-5 w-5 opacity-50" aria-hidden />
      </div>
    );
  }
  return (
    <LoadingImage
      src={productThumbUrl(url, 480)}
      alt={alt}
      className={cn('bg-muted object-cover', className)}
      loading="lazy"
      decoding="async"
    />
  );
}

export function PresentationProductPicker({
  selected,
  maxItems,
  onChange,
  zones,
  productZone,
  onZoneChange,
  zoneDisabled = false,
  fixedPagination = false,
}: {
  selected: SearchProduct[];
  maxItems: number;
  onChange: (next: SearchProduct[] | ((current: SearchProduct[]) => SearchProduct[])) => void;
  zones: { id: string; name: string }[];
  productZone: Record<string, string>;
  onZoneChange: (productId: string, zoneId: string) => void;
  zoneDisabled?: boolean;
  fixedPagination?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [level1, setLevel1] = useState('');
  const [level2, setLevel2] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [page, setPage] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const pageSize = columns * ROWS_PER_PAGE;

  useEffect(() => {
    const element = pickerRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width <= 0) return;
      setColumns(Math.max(1, Math.floor((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(true);
  const debouncedQuery = useDebounced(query, 300);

  const filterKey = `${debouncedQuery}\0${level1}\0${level2}\0${onlySelected ? '1' : '0'}\0${pageSize}`;
  const [pageFor, setPageFor] = useState(filterKey);
  if (pageFor !== filterKey) {
    setPageFor(filterKey);
    setPage(0);
  }
  const activePage = pageFor === filterKey ? page : 0;

  useEffect(() => {
    let cancelled = false;
    fetchSearchFacets()
      .then((next) => {
        if (!cancelled) setFacets(next);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error('讀取分類失敗', {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (onlySelected) {
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    searchProducts(
      { ...EMPTY_SEARCH_FILTERS, query: debouncedQuery, level1, level2, scope: 'all', sort: 'relevance' },
      activePage,
      pageSize,
    )
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({ total: 0, can_view_cost: false, can_open_source: false, items: [] });
          toast.error('搜索失敗', {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, level1, level2, activePage, onlySelected, pageSize]);

  const level1Options = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of facets?.categories ?? []) {
      if (!row.level1) continue;
      map.set(row.level1, (map.get(row.level1) ?? 0) + row.count);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count }));
  }, [facets]);

  const level2Options = useMemo(
    () => (facets?.categories ?? []).filter((row) => row.level1 === level1 && row.level2),
    [facets, level1],
  );

  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);
  const atLimit = selected.length >= maxItems;

  const filteredSelected = useMemo(
    () => selected.filter((item) => matchesFilters(item, debouncedQuery, level1, level2)),
    [selected, debouncedQuery, level1, level2],
  );

  const total = onlySelected ? filteredSelected.length : (result?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageFor === filterKey && page > pageCount - 1) {
    setPage(pageCount - 1);
  }
  const safePage = Math.min(activePage, pageCount - 1);
  const pageItems = onlySelected
    ? filteredSelected.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : (result?.items ?? []);

  const toggle = (product: SearchProduct) => {
    const already = selectedIds.has(product.id);
    if (!already && selected.length >= maxItems) {
      toast.message(`最多 ${maxItems} 件`, { description: '簡報不宜過長' });
      return;
    }
    onChange((current) => {
      if (current.some((item) => item.id === product.id)) {
        return current.filter((item) => item.id !== product.id);
      }
      if (current.length >= maxItems) return current;
      return [...current, product];
    });
  };

  const chooseLevel1 = (name: string) => {
    setLevel1(name);
    setLevel2('');
  };

  return (
    <div className={cn("grid h-full min-h-0 items-stretch gap-2 lg:grid-cols-[18rem_minmax(0,1fr)]", fixedPagination && "grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-1")}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-border dark:bg-card">
        <div className="flex shrink-0 items-center justify-between gap-2 p-3 pb-0">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#efedff] text-[#5b4dff] dark:bg-indigo-950/60 dark:text-indigo-200">
              <Box className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">已選擇產品</p>
              <p className="sr-only" aria-live="polite">
                已選 {selected.length} / {maxItems}{atLimit ? '，已達上限' : ''}
              </p>
              {atLimit ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">已達上限 {maxItems} 件</p> : null}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-9 shrink-0 rounded-xl bg-white px-0 dark:bg-background"
            disabled={selected.length === 0}
            aria-label={`清除全部（${selected.length}）`}
            onClick={() => onChange((current) => (current.length === 0 ? current : []))}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        {selected.length === 0 ? (
          <p className="m-3 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-sm text-muted-foreground dark:border-border">尚未選擇。點產品卡片即可加入。</p>
        ) : (
          <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pt-0">
            {selected.map((product) => {
              const { primary, secondary } = splitTitle(product.title);
              const label = primary || product.title;
              const zoneId = productZone[product.id] || '';
              return (
                <li
                  key={product.id}
                  className="flex min-w-0 items-start gap-3 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-none dark:border-border dark:bg-background"
                >
                  <Thumb
                    url={coverUrl(product)}
                    alt=""
                    className="h-12 w-12 shrink-0 overflow-hidden rounded-full"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-5 text-foreground">{label}</p>
                        {secondary ? (
                          <p className="truncate text-xs leading-5 text-muted-foreground">{secondary}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={`移除 ${label}`}
                        onClick={() => toggle(product)}
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    <Select
                      value={zoneId || undefined}
                      disabled={zoneDisabled || zones.length === 0}
                      onValueChange={(value) => onZoneChange(product.id, value)}
                    >
                      <SelectTrigger
                        aria-label={`${label} 所屬分區`}
                        className="relative mt-2 h-8 w-fit max-w-full rounded-full border-slate-200 bg-white pl-8 pr-2 text-xs shadow-none dark:border-border dark:bg-card"
                      >
                        <MapPin className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" aria-hidden />
                        <SelectValue placeholder="選擇分區" />
                      </SelectTrigger>
                      <SelectContent>
                        {zones.map((zone) => (
                          <SelectItem key={zone.id} value={zone.id}>{zone.name || '未命名分區'}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div ref={pickerRef} className={cn("min-h-0 min-w-0 rounded-2xl border border-border/80 bg-card p-3 shadow-sm", fixedPagination ? "flex flex-col overflow-hidden" : "overflow-y-auto")}>
      <div className={cn("space-y-3", fixedPagination && "min-h-0 flex-1 overflow-y-auto")}>
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#efedff] text-[#5b4dff] dark:bg-indigo-950/60 dark:text-indigo-200">
            <Package className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">選擇產品</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">選擇家具，並指定所屬分區。</p>
          </div>
        </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋名稱、型號或分類"
            aria-label="搜尋產品"
            className="h-11 rounded-lg bg-background pl-9"
          />
          {searching && !onlySelected ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>
        <div className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3">
          <Switch
            id="presentation-only-selected"
            checked={onlySelected}
            onCheckedChange={setOnlySelected}
          />
          <Label htmlFor="presentation-only-selected" className="cursor-pointer text-sm font-normal">
            只看已選
          </Label>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="產品類型">
          <FilterChip active={level1 === ''} onClick={() => chooseLevel1('')}>
            全部
          </FilterChip>
          {level1Options.map((option) => (
            <FilterChip
              key={option.name}
              active={level1 === option.name}
              onClick={() => chooseLevel1(option.name)}
            >
              {option.name}
              <span className={cn('ml-1 tabular-nums', level1 === option.name ? 'text-white/80' : 'text-muted-foreground')}>
                {option.count}
              </span>
            </FilterChip>
          ))}
        </div>
        {level1 && level2Options.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="子類別">
            <FilterChip active={level2 === ''} onClick={() => setLevel2('')}>
              全部子類別
            </FilterChip>
            {level2Options.map((option) => (
              <FilterChip
                key={option.level2!}
                active={level2 === option.level2}
                onClick={() => setLevel2(option.level2!)}
              >
                {option.level2}
              </FilterChip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {searching && !onlySelected
            ? '搜尋中…'
            : `共 ${total.toLocaleString()} 件`}
        </span>
        <span>點擊卡片選擇，再次點擊取消</span>
      </div>

      {searching && !onlySelected && !result ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border px-4 py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          載入產品…
        </div>
      ) : pageItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          {onlySelected ? '已選產品裡沒有符合目前篩選的項目' : '沒有符合條件的產品'}
        </div>
      ) : (
        <ul
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          className={cn(
            'grid gap-3',
            searching && !onlySelected && 'opacity-60',
          )}
        >
          {pageItems.map((product) => (
            <li key={product.id} className="min-w-0">
              <PickerCard
                product={product}
                selected={selectedIds.has(product.id)}
                blocked={atLimit && !selectedIds.has(product.id)}
                onToggle={() => toggle(product)}
              />
            </li>
          ))}
        </ul>
      )}

      </div>
      {pageCount > 1 ? (
        <div className={cn("flex items-center justify-center gap-2", fixedPagination ? "shrink-0 border-t border-border pt-2 mt-2" : "mt-3")}>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-11 bg-background"
            aria-label="上一頁"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[5.5rem] text-center text-sm tabular-nums text-foreground">
            {safePage + 1} / {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-11 bg-background"
            aria-label="下一頁"
            disabled={safePage + 1 >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function PickerCard({
  product,
  selected,
  blocked,
  onToggle,
}: {
  product: SearchProduct;
  selected: boolean;
  blocked: boolean;
  onToggle: () => void;
}) {
  const { primary, secondary } = splitTitle(product.title);
  const code = productCode(product);
  const category = productCategory(product);
  const action = selected ? '取消選擇' : '選擇';
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-disabled={blocked}
      aria-label={`${action} ${product.title}`}
      onClick={onToggle}
      className={cn(
        'relative flex h-full min-h-11 w-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected
          ? 'border-indigo-500 ring-2 ring-indigo-500/35'
          : 'border-border hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-400',
        blocked && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full shadow-sm',
          selected
            ? 'bg-indigo-600 text-white'
            : 'border border-border bg-background/90 text-transparent',
        )}
        aria-hidden
      >
        <Check className="h-4 w-4" />
      </span>
      <Thumb
        url={coverUrl(product)}
        alt=""
        className="aspect-[4/3] w-full"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {primary || product.title}
        </span>
        {secondary ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">{secondary}</span>
        ) : null}
        {(code || category) ? (
          <span className="mt-auto truncate text-xs text-muted-foreground">
            {code ? <span className="font-mono text-foreground/80">{code}</span> : null}
            {code && category ? ' · ' : null}
            {category}
          </span>
        ) : null}
      </span>
    </button>
  );
}
