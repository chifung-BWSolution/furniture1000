import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, ChevronLeft, ChevronRight, Package, Loader2, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchFactories } from '@/lib/factorySupabase';
import { matchMultipleColors } from '@/constants/color-map';

function normalizeProductColor(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  return matchMultipleColors(raw) || raw.trim();
}

interface MasterProduct {
  id: string;
  title: string;
  image_url: string | null;
  sale_price: number | null;
  cost_price: number | null;
  factory_name: string | null;
  category: string | null;
  material: string | null;
  dimension_l_mm: number | null;
  dimension_w_mm: number | null;
  dimension_h_mm: number | null;
  color: string | null;
  remarks: string | null;
  delivery_term_name: string | null;
}

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
  }[]) => void;
  /** Names of products already in the list, used to pre-select checkboxes */
  existingProductNames?: string[];
}

export function ProductSelectorModal({ open, onClose, onSelect, existingProductNames = [] }: ProductSelectorModalProps) {
  const [search, setSearch] = useState('');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [factories, setFactories] = useState<string[]>([]);
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Map<string, MasterProduct>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 20;

  // Fetch factories for filter dropdown
  useEffect(() => {
    if (open) {
      fetchFactories().then((list) => {
        if (list.length > 0) {
          setFactories(list);
        } else {
          // Fallback: get distinct factory names from local products table
          supabase
            .from('products')
            .select('factory_name')
            .not('factory_name', 'is', null)
            .neq('factory_name', '')
            .then(({ data }) => {
              const unique = [...new Set((data || []).map((r: any) => r.factory_name).filter(Boolean))];
              setFactories(unique as string[]);
            });
        }
      });
    }
  }, [open]);

  // Fetch products - try edge function (master DB) first, fall back to local products table
  const fetchProducts = useCallback(async (searchVal: string, factoryVal: string, pageVal: number) => {
    setIsLoading(true);
    try {
      console.log('[ProductSelector] Fetching products...', { search: searchVal, factory: factoryVal, page: pageVal });
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-fetch-product-catalog',
        {
          body: {
            search: searchVal.trim(),
            factory_name: factoryVal,
            page: pageVal,
            page_size: PAGE_SIZE,
          },
        }
      );

      console.log('[ProductSelector] Response:', { data, error });

      // If edge function succeeds and returns products
      if (!error && data && !data.error && Array.isArray(data.products)) {
        setProducts(data.products);
        setTotalPages(data.total_pages || 1);
        setTotal(data.total || 0);
        return;
      }

      // Edge function failed — fall back to local products table
      console.warn('[ProductSelector] Edge function failed, falling back to local products table', error || data?.error);
      await fetchFromLocalProducts(searchVal, factoryVal, pageVal);
    } catch (err) {
      console.error('[ProductSelector] Network error, falling back to local:', err);
      await fetchFromLocalProducts(searchVal, factoryVal, pageVal);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fallback: fetch from local products table
  const fetchFromLocalProducts = useCallback(async (searchVal: string, factoryVal: string, pageVal: number) => {
    try {
      const from = (pageVal - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('products')
        .select('id, title, images, sale_price, cost_price, factory_name, category, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, delivery_term_name', {
          count: 'exact',
        })
        .not('title', 'is', null)
        .neq('title', '');

      if (searchVal.trim()) {
        query = query.ilike('title', `%${searchVal.trim()}%`);
      }

      if (factoryVal.trim()) {
        query = query.eq('factory_name', factoryVal.trim());
      }

      query = query.order('created_at', { ascending: false }).range(from, to);

      const { data: rows, error: localErr, count } = await query;

      if (localErr) {
        console.error('[ProductSelector] Local fallback error:', localErr);
        setProducts([]);
        setTotalPages(1);
        setTotal(0);
        return;
      }

      // Map local products to the same shape as master products
      const mapped: MasterProduct[] = (rows || []).map((row: any) => ({
        id: row.id,
        title: row.title || '',
        image_url: Array.isArray(row.images) && row.images.length > 0 ? row.images[0] : null,
        sale_price: row.sale_price,
        cost_price: row.cost_price,
        factory_name: row.factory_name || '',
        category: row.category || null,
        material: row.material || null,
        dimension_l_mm: row.dimension_l_mm,
        dimension_w_mm: row.dimension_w_mm,
        dimension_h_mm: row.dimension_h_mm,
        color: row.color || null,
        remarks: row.remarks || null,
        delivery_term_name: row.delivery_term_name || null,
      }));

      setProducts(mapped);
      setTotalPages(Math.ceil((count || 0) / PAGE_SIZE));
      setTotal(count || 0);
    } catch (err) {
      console.error('[ProductSelector] Local fallback network error:', err);
      setProducts([]);
      setTotalPages(1);
      setTotal(0);
    }
  }, []);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the count of existing products for immediate display
  const existingCount = existingProductNames.length;

  // Reset state when modal opens & do initial fetch
  useEffect(() => {
    if (open) {
      setSelectedProducts(new Map());
      setSearch('');
      setFactoryFilter('');
      setPage(1);
      fetchProducts('', '', 1);
    }
  }, [open, fetchProducts]);

  // Pre-select products that are already in the list when products load
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

  // Derive a display count: show existing count immediately while loading, then actual selection count
  const displaySelectedCount = isLoading && selectedProducts.size === 0 ? existingCount : selectedProducts.size;

  // Debounced search/filter effect
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchProducts(search, factoryFilter, 1);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, factoryFilter, open, fetchProducts]);

  // Page change (no debounce)
  useEffect(() => {
    if (!open || page === 1) return;
    fetchProducts(search, factoryFilter, page);
  }, [page]);

  const toggleProduct = (product: MasterProduct) => {
    setSelectedProducts((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) {
        next.delete(product.id);
      } else {
        next.set(product.id, product);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allCurrentPageSelected = products.every((p) => selectedProducts.has(p.id));
    setSelectedProducts((prev) => {
      const next = new Map(prev);
      if (allCurrentPageSelected) {
        // Deselect all on current page
        products.forEach((p) => next.delete(p.id));
      } else {
        // Select all on current page
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
    }));
    onSelect(mapped);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-[900px] flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">
              產品目錄
            </h2>
            <p className="mt-0.5 font-body text-xs text-muted-foreground">
              從資料庫搜尋產品並加入報價單
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋產品名稱..."
              className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 font-body text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <select
            value={factoryFilter}
            onChange={(e) => {
              setFactoryFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-border bg-background px-3 py-2.5 font-body text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option value="">所有廠家</option>
            {factories.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 font-mono-data text-xs text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            {total} 件產品
          </div>
        </div>

        {/* Product Table */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 font-body text-sm text-muted-foreground">
                載入中...
              </span>
            </div>
          ) : products.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-muted-foreground/60">
              <Package className="mb-2 h-10 w-10" />
              <span className="font-body text-sm">找不到符合條件的產品</span>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 pr-2 w-8">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                        isAllSelected
                          ? 'border-primary bg-primary'
                          : isSomeSelected
                          ? 'border-primary/60 bg-primary/30'
                          : 'border-border bg-background hover:border-primary/50'
                      }`}
                    >
                      {isAllSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      {isSomeSelected && !isAllSelected && (
                        <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                      )}
                    </button>
                  </th>
                  <th className="pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    圖片
                  </th>
                  <th className="pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    產品名稱
                  </th>
                  <th className="pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    廠家
                  </th>
                  <th className="pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    類別
                  </th>
                  <th className="pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    成本價
                  </th>
                  <th className="pb-2 pr-3 font-body text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                      className={`cursor-pointer border-b border-border/40 transition-colors last:border-b-0 ${
                        isSelected
                          ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                          : 'hover:bg-accent/50'
                      }`}
                    >
                      <td className="py-2.5 pr-2">
                        <div
                          className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary'
                              : 'border-border bg-background'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="h-10 w-10 aspect-square overflow-hidden rounded-md border border-border bg-muted/30">
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
                        <span className="font-body text-xs font-medium text-foreground line-clamp-2">
                          {product.title || '—'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-body text-xs text-muted-foreground">
                          {product.factory_name || '—'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-body text-xs text-muted-foreground">
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

        {/* Pagination & Action Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          {/* Pagination */}
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

          {/* Selection count & Add Button */}
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
