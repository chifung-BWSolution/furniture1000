import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, X, ChevronLeft, ChevronRight, Package, Loader2, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  fetchCatalogFactoryNames,
  fetchProductCatalog,
  type CatalogProductRow,
  type CatalogSourceType,
} from '@/lib/productCatalogQuery';
import { formatProductDimensionsMm } from '@/lib/productDimensions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function normalizeProductColor(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  return raw.trim();
}

type MasterProduct = CatalogProductRow;

interface ProductSelectorModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (products: {
    image: string;
    name: string;
    unitPrice: number;
    costPrice?: number | null;
    category?: string;
    material?: string;
    color?: string;
    remarks?: string;
    dimensionLMm?: number | null;
    dimensionWMm?: number | null;
    dimensionHMm?: number | null;
    deliveryTermName?: string;
    factoryName?: string;
  }[]) => void;
  existingProductNames?: string[];
  /** Level-1 categories from quote wizard — products in these categories appear first when no level1 filter is set. */
  priorityLevel1Categories?: string[];
  /** Urgent work period — only show in-stock (現貨) products with 3-7天送貨 tag. */
  stockOnly?: boolean;
}

const CATALOG_SOURCE_OPTIONS: Array<{
  value: CatalogSourceType;
  label: string;
}> = [
  { value: 'shopify', label: 'A類產品 - shopify上架' },
  { value: 'system', label: 'B類產品 - 系統產品目錄(包含shopify產品)' },
];

export function ProductSelectorModal({
  open,
  onClose,
  onSelect,
  existingProductNames = [],
  priorityLevel1Categories = [],
  stockOnly = false,
}: ProductSelectorModalProps) {
  const [catalogSource, setCatalogSource] = useState<CatalogSourceType>('system');
  const [search, setSearch] = useState('');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [level1Filter, setLevel1Filter] = useState('');
  const [level2Filter, setLevel2Filter] = useState('');
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  const [factories, setFactories] = useState<string[]>([]);
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Map<string, MasterProduct>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  /** 4-column grid — show a full page of cards. */
  const PAGE_SIZE = 20;

  const level1Options = useMemo(
    () => Array.from(new Set(categoryPairs.map((p) => p.level1))),
    [categoryPairs],
  );
  const level2Options = useMemo(
    () =>
      Array.from(
        new Set(
          categoryPairs
            .filter((p) => p.level1 === level1Filter && p.level2)
            .map((p) => p.level2),
        ),
      ),
    [categoryPairs, level1Filter],
  );

  useEffect(() => {
    if (!open) return;
    supabase
      .from('product_category')
      .select('level1, level2, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        setCategoryPairs(
          data
            .map((r: { level1: string | null; level2: string | null }) => ({
              level1: String(r.level1 ?? '').trim(),
              level2: String(r.level2 ?? '').trim(),
            }))
            .filter((p) => p.level1),
        );
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetchCatalogFactoryNames(catalogSource).then(setFactories);
  }, [open, catalogSource]);

  const priorityLevel1 = useMemo(
    () => priorityLevel1Categories.map((c) => c.trim()).filter(Boolean),
    [priorityLevel1Categories],
  );
  const priorityActive = priorityLevel1.length > 0 && !level1Filter;

  const fetchProducts = useCallback(
    async (
      source: CatalogSourceType,
      searchVal: string,
      factoryVal: string,
      pageVal: number,
      level1Val: string,
      level2Val: string,
      priorityLevel1Val: string[],
      stockOnlyVal: boolean,
    ) => {
      setIsLoading(true);
      try {
        const result = await fetchProductCatalog({
          source,
          search: searchVal,
          factory_name: factoryVal,
          level1: level1Val,
          level2: level2Val,
          priority_level1:
            !level1Val.trim() && priorityLevel1Val.length > 0
              ? priorityLevel1Val
              : undefined,
          stock_only: stockOnlyVal || undefined,
          page: pageVal,
          page_size: PAGE_SIZE,
        });
        setProducts(result.products);
        setTotalPages(result.total_pages || 1);
        setTotal(result.total || 0);
      } catch (err) {
        console.error('[ProductSelector] fetch failed:', err);
        setProducts([]);
        setTotalPages(1);
        setTotal(0);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFetch = useCallback(
    (pageVal: number) => {
      fetchProducts(
        catalogSource,
        search,
        factoryFilter,
        pageVal,
        level1Filter,
        level2Filter,
        priorityLevel1,
        stockOnly,
      );
    },
    [catalogSource, search, factoryFilter, level1Filter, level2Filter, priorityLevel1, stockOnly, fetchProducts],
  );

  const existingCount = existingProductNames.length;

  useEffect(() => {
    if (!open) return;
    setSelectedProducts(new Map());
    setSearch('');
    setFactoryFilter('');
    setLevel1Filter('');
    setLevel2Filter('');
    setPage(1);
    setCatalogSource('system');
  }, [open]);

  useEffect(() => {
    if (open && products.length > 0 && existingProductNames.length > 0) {
      setSelectedProducts((prev) => {
        const next = new Map(prev);
        products.forEach((p) => {
          if (p.title && existingProductNames.includes(p.title) && !next.has(p.id)) {
            next.set(p.id, p);
          }
        });
        return next;
      });
    }
  }, [open, products, existingProductNames]);

  const displaySelectedCount =
    isLoading && selectedProducts.size === 0 ? existingCount : selectedProducts.size;

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      runFetch(1);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, factoryFilter, level1Filter, level2Filter, catalogSource, open, runFetch]);

  useEffect(() => {
    if (!open || page === 1) return;
    runFetch(page);
  }, [page, open, runFetch]);

  const handleCatalogSourceChange = (next: CatalogSourceType) => {
    if (next === catalogSource) return;
    setCatalogSource(next);
    setFactoryFilter('');
    setPage(1);
  };

  const toggleProduct = (product: MasterProduct) => {
    setSelectedProducts((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allCurrentPageSelected = products.every((p) => selectedProducts.has(p.id));
    setSelectedProducts((prev) => {
      const next = new Map(prev);
      if (allCurrentPageSelected) {
        products.forEach((p) => next.delete(p.id));
      } else {
        products.forEach((p) => next.set(p.id, p));
      }
      return next;
    });
  };

  const isAllSelected = products.length > 0 && products.every((p) => selectedProducts.has(p.id));
  const isSomeSelected = products.some((p) => selectedProducts.has(p.id)) && !isAllSelected;

  const handleAdd = () => {
    const mapped = Array.from(selectedProducts.values()).map((p) => ({
      image: p.image_url || '',
      name: p.title || '',
      unitPrice: p.sale_price || p.cost_price || 0,
      costPrice: p.cost_price,
      category: p.category?.trim() || undefined,
      material: p.material || undefined,
      color: normalizeProductColor(p.color),
      remarks: p.remarks || undefined,
      dimensionLMm: p.dimension_l_mm,
      dimensionWMm: p.dimension_w_mm,
      dimensionHMm: p.dimension_h_mm,
      deliveryTermName: p.delivery_term_name || undefined,
      factoryName: p.factory_name?.trim() || undefined,
    }));
    onSelect(mapped);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 flex max-h-[92vh] w-full max-w-[1180px] flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="font-display text-lg font-bold text-foreground">產品目錄</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="font-body text-xs text-muted-foreground">
                從資料庫搜尋產品並加入報價單
                {stockOnly ? (
                  <span className="ml-1 text-primary">
                    · 僅顯示現貨（3-7天送貨）
                  </span>
                ) : null}
                {priorityActive ? (
                  <span className="ml-1 text-primary">
                    · 已依報價類別優先排序（{priorityLevel1.join('、')}）
                  </span>
                ) : null}
              </p>
              {CATALOG_SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleCatalogSourceChange(opt.value)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 font-body text-[11px] font-medium transition-all',
                    catalogSource === opt.value
                      ? 'border-primary bg-primary/10 text-primary shadow-sm'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-[1.6]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋產品名稱或 SKU…"
              className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 font-body text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <Select
            value={factoryFilter || '__all__'}
            onValueChange={(value) => {
              setFactoryFilter(value === '__all__' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-10 w-full min-w-[6.5rem] max-w-[7.5rem] shrink-0 font-body text-sm lg:w-[7.5rem]">
              <SelectValue placeholder="所有廠家" />
            </SelectTrigger>
            <SelectContent className="max-h-64 max-w-[min(20rem,90vw)]">
              <SelectItem value="__all__">所有廠家</SelectItem>
              {factories.map((f) => (
                <SelectItem key={f} value={f} className="whitespace-normal break-words">
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={level1Filter || '__all__'}
            onValueChange={(value) => {
              setLevel1Filter(value === '__all__' ? '' : value);
              setLevel2Filter('');
              setPage(1);
            }}
          >
            <SelectTrigger className="h-10 w-full min-w-[8.5rem] max-w-[11rem] shrink-0 font-body text-sm">
              <SelectValue placeholder="全部一級分類" />
            </SelectTrigger>
            <SelectContent className="max-h-64 max-w-[min(24rem,90vw)]">
              <SelectItem value="__all__">全部一級分類</SelectItem>
              {level1Options.map((l1) => (
                <SelectItem key={l1} value={l1} className="whitespace-normal break-words">
                  {l1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {level1Filter && level2Options.length > 0 ? (
            <Select
              value={level2Filter || '__all__'}
              onValueChange={(value) => {
                setLevel2Filter(value === '__all__' ? '' : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-[8.5rem] max-w-[11rem] shrink-0 font-body text-sm">
                <SelectValue placeholder="全部二級分類" />
              </SelectTrigger>
              <SelectContent className="max-h-64 max-w-[min(24rem,90vw)]">
                <SelectItem value="__all__">全部二級分類</SelectItem>
                {level2Options.map((l2) => (
                  <SelectItem key={l2} value={l2} className="whitespace-normal break-words">
                    {l2}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <div className="flex shrink-0 items-center gap-2 font-mono-data text-xs text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            {total} 件產品
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 font-body text-sm text-muted-foreground">載入中...</span>
            </div>
          ) : products.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-muted-foreground/60">
              <Package className="mb-2 h-10 w-10" />
              <span className="font-body text-sm">找不到符合條件的產品</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    isAllSelected
                      ? 'border-primary bg-primary'
                      : isSomeSelected
                        ? 'border-primary/60 bg-primary/30'
                        : 'border-border bg-background hover:border-primary/50',
                  )}
                  aria-label="全選本頁"
                >
                  {isAllSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                  {isSomeSelected && !isAllSelected && (
                    <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                  )}
                </button>
                <span className="font-body text-[11px] text-muted-foreground">
                  全選本頁
                </span>
              </div>

              {/* Same 4-col card grid as 傢私方案「選擇產品」 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {products.map((product) => {
                  const isSelected = selectedProducts.has(product.id);
                  const dims = formatProductDimensionsMm(
                    product.dimension_l_mm,
                    product.dimension_w_mm,
                    product.dimension_h_mm,
                  );
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => toggleProduct(product)}
                      className={cn(
                        'overflow-hidden rounded-xl border bg-background text-left transition-colors',
                        isSelected
                          ? 'border-primary/50 ring-2 ring-primary/30'
                          : 'border-border hover:border-primary/30',
                      )}
                    >
                      <div className="relative aspect-[4/3] bg-muted">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.title || ''}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Package className="h-8 w-8 text-muted-foreground/40" />
                          </div>
                        )}
                        <div
                          className={cn(
                            'absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded border shadow-sm',
                            isSelected
                              ? 'border-primary bg-primary'
                              : 'border-border bg-background/90',
                          )}
                        >
                          {isSelected && (
                            <Check className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5 p-2.5">
                        <p className="line-clamp-2 font-body text-[13px] font-medium leading-snug text-foreground">
                          {product.title || '—'}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="min-w-0 truncate font-body text-[11px] font-medium text-muted-foreground"
                            title={product.factory_name || undefined}
                          >
                            {product.factory_name || '—'}
                          </span>
                          <span
                            className="shrink-0 truncate font-mono-data text-[11px] text-muted-foreground"
                            title={product.sku || undefined}
                          >
                            {product.sku || '—'}
                          </span>
                        </div>
                        {product.category ? (
                          <p className="truncate font-body text-[11px] text-muted-foreground">
                            {product.category}
                          </p>
                        ) : null}
                        {dims ? (
                          <p className="font-mono-data text-[11px] text-muted-foreground">
                            {dims}
                          </p>
                        ) : null}
                        <div className="flex items-baseline justify-between gap-2 pt-0.5 font-mono-data text-[12px]">
                          <span className="min-w-0 truncate text-foreground">
                            <span className="font-body text-muted-foreground">成本</span>
                            {product.cost_price
                              ? `$${Number(product.cost_price).toLocaleString()}`
                              : '—'}
                          </span>
                          <span className="shrink-0 font-semibold text-primary">
                            <span className="font-body font-normal text-muted-foreground">
                              售價
                            </span>
                            {product.sale_price
                              ? `$${Number(product.sale_price).toLocaleString()}`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-end">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium',
                              isSelected
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border bg-muted/40 text-muted-foreground',
                            )}
                          >
                            {isSelected ? (
                              <>
                                <Check className="h-3 w-3" /> 已選
                              </>
                            ) : (
                              '選擇'
                            )}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一頁
            </button>
            <span className="font-mono-data text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一頁
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {displaySelectedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 font-mono-data text-xs font-medium text-primary">
                已選 {displaySelectedCount} 件
              </span>
            )}
            <button
              type="button"
              onClick={handleAdd}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              確認{displaySelectedCount > 0 ? ` (${displaySelectedCount})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
