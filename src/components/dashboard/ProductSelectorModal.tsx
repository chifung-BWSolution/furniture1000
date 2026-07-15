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

  const fetchProducts = useCallback(
    async (
      source: CatalogSourceType,
      searchVal: string,
      factoryVal: string,
      pageVal: number,
      level1Val: string,
      level2Val: string,
    ) => {
      setIsLoading(true);
      try {
        const result = await fetchProductCatalog({
          source,
          search: searchVal,
          factory_name: factoryVal,
          level1: level1Val,
          level2: level2Val,
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
      );
    },
    [catalogSource, search, factoryFilter, level1Filter, level2Filter, fetchProducts],
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
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-[1024px] flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="font-display text-lg font-bold text-foreground">產品目錄</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="font-body text-xs text-muted-foreground">
                從資料庫搜尋產品並加入報價單
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
            <table className="w-full table-fixed text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-8 pb-2 pr-2">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                        isAllSelected
                          ? 'border-primary bg-primary'
                          : isSomeSelected
                            ? 'border-primary/60 bg-primary/30'
                            : 'border-border bg-background hover:border-primary/50',
                      )}
                    >
                      {isAllSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      {isSomeSelected && !isAllSelected && (
                        <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                      )}
                    </button>
                  </th>
                  <th className="w-12 pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    圖片
                  </th>
                  <th className="w-[34%] pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    產品名稱
                  </th>
                  <th className="w-[14%] pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    廠家
                  </th>
                  <th className="w-[12%] pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    類別
                  </th>
                  <th className="w-[10%] pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    成本價
                  </th>
                  <th className="w-[10%] pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    售價
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const isSelected = selectedProducts.has(product.id);
                  return (
                    <tr
                      key={product.id}
                      onClick={() => toggleProduct(product)}
                      className={cn(
                        'cursor-pointer border-b border-border/40 transition-colors last:border-b-0',
                        isSelected
                          ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                          : 'hover:bg-accent/50',
                      )}
                    >
                      <td className="py-2.5 pr-2">
                        <div
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                            isSelected
                              ? 'border-primary bg-primary'
                              : 'border-border bg-background',
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="h-10 w-10 overflow-hidden rounded-md border border-border bg-muted/30">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Package className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="min-w-0">
                          <div className="truncate font-body text-xs font-medium text-foreground">
                            {product.title || '—'}
                          </div>
                          {product.sku ? (
                            <div className="truncate font-mono-data text-[10px] text-muted-foreground">
                              {product.sku}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="block truncate font-body text-xs text-muted-foreground">
                          {product.factory_name || '—'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="block truncate font-body text-xs text-muted-foreground">
                          {product.category || '—'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono-data text-xs font-medium text-foreground">
                          {product.cost_price
                            ? `$${Number(product.cost_price).toLocaleString()}`
                            : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-mono-data text-xs font-medium text-foreground">
                          {product.sale_price
                            ? `$${Number(product.sale_price).toLocaleString()}`
                            : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
