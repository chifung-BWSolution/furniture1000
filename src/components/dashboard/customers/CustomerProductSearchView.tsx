import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Search, ShoppingCart, Plus, Trash2, Loader2, SlidersHorizontal, RotateCcw,
} from 'lucide-react';
import { fetchPortalBrowseProducts } from '@/lib/solutionsApi';
import {
  fetchProductCategoryPairs,
  type ProductCategoryPair,
} from '@/lib/productCategoryOptions';
import type { SearchProduct } from '@/types/solutions';
import { toast } from 'sonner';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';

const CART_KEY = 'fds-portal-inquiry-cart';
/** Match "約 1.5 米" with ±15% on the corresponding mm dimension. */
const DIM_TOLERANCE = 0.15;

type CartItem = { id: string; title: string; salePrice: number; imageUrl?: string; qty: number };

type Filters = {
  level1: string;
  level2: string;
  materials: string[];
  priceMin: string;
  priceMax: string;
  dimLM: string;
  dimWM: string;
  dimHM: string;
};

const EMPTY_FILTERS: Filters = {
  level1: '',
  level2: '',
  materials: [],
  priceMin: '',
  priceMax: '',
  dimLM: '',
  dimWM: '',
  dimHM: '',
};

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Target meters → product mm matches within tolerance. */
function dimMatches(mm: number | null | undefined, targetMeters: number | null): boolean {
  if (targetMeters == null) return true;
  if (mm == null || !Number.isFinite(mm) || mm <= 0) return false;
  const targetMm = targetMeters * 1000;
  const lo = targetMm * (1 - DIM_TOLERANCE);
  const hi = targetMm * (1 + DIM_TOLERANCE);
  return mm >= lo && mm <= hi;
}

function fmtDimMm(mm: number | null | undefined): string | null {
  if (mm == null || !Number.isFinite(mm) || mm <= 0) return null;
  if (mm >= 1000) return `${(mm / 1000).toFixed(mm % 100 === 0 ? 1 : 2)}m`;
  return `${Math.round(mm)}mm`;
}

function fmtDims(p: SearchProduct): string {
  const parts = [p.dimensionLMm, p.dimensionWMm, p.dimensionHMm]
    .map(fmtDimMm)
    .filter(Boolean);
  return parts.length ? parts.join(' × ') : '';
}

export function CustomerProductSearchView() {
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [categoryPairs, setCategoryPairs] = useState<ProductCategoryPair[]>([]);
  const [all, setAll] = useState<SearchProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>(() => loadCart());
  const [showCart, setShowCart] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchPortalBrowseProducts(600), fetchProductCategoryPairs()])
      .then(([products, pairs]) => {
        setAll(products);
        setCategoryPairs(pairs);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const level1Options = useMemo(() => {
    const fromRegistry = [...new Set(categoryPairs.map((p) => p.level1))];
    if (fromRegistry.length > 0) return fromRegistry;
    return [...new Set(all.map((p) => p.level1Category).filter(Boolean))] as string[];
  }, [categoryPairs, all]);

  const level2Options = useMemo(() => {
    if (!filters.level1) return [] as string[];
    const fromRegistry = [
      ...new Set(
        categoryPairs
          .filter((p) => p.level1 === filters.level1 && p.level2)
          .map((p) => p.level2),
      ),
    ];
    if (fromRegistry.length > 0) return fromRegistry;
    return [
      ...new Set(
        all
          .filter((p) => p.level1Category === filters.level1 && p.level2Category)
          .map((p) => p.level2Category as string),
      ),
    ];
  }, [categoryPairs, filters.level1, all]);

  const materialOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of all) {
      const m = (p.material || '').trim();
      if (m && m !== '—') set.add(m);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [all]);

  const persistCart = (next: CartItem[]) => {
    setCart(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
  };

  const addToCart = (p: SearchProduct) => {
    const existing = cart.find((c) => c.id === p.id);
    if (existing) {
      persistCart(
        cart.map((c) => (c.id === p.id ? { ...c, qty: c.qty + 1 } : c)),
      );
    } else {
      persistCart([
        ...cart,
        {
          id: p.id,
          title: p.title,
          salePrice: p.salePrice,
          imageUrl: p.imageUrl,
          qty: 1,
        },
      ]);
    }
    toast.success('已加入查詢車', { description: p.title });
  };

  const results = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const priceMin = parseOptionalNumber(filters.priceMin);
    const priceMax = parseOptionalNumber(filters.priceMax);
    const dimL = parseOptionalNumber(filters.dimLM);
    const dimW = parseOptionalNumber(filters.dimWM);
    const dimH = parseOptionalNumber(filters.dimHM);

    return all.filter((p) => {
      if (q) {
        const hay = `${p.title} ${p.description} ${p.material} ${p.level1Category || ''} ${p.level2Category || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.level1 && p.level1Category !== filters.level1) return false;
      if (filters.level2 && p.level2Category !== filters.level2) return false;
      if (filters.materials.length > 0) {
        if (!filters.materials.includes(p.material)) return false;
      }
      if (priceMin != null && p.salePrice < priceMin) return false;
      if (priceMax != null && p.salePrice > priceMax) return false;
      if (!dimMatches(p.dimensionLMm, dimL)) return false;
      if (!dimMatches(p.dimensionWMm, dimW)) return false;
      if (!dimMatches(p.dimensionHMm, dimH)) return false;
      return true;
    });
  }, [keyword, filters, all]);

  const cartCount = cart.reduce((n, c) => n + c.qty, 0);
  const activeFilterCount =
    (filters.level1 ? 1 : 0) +
    (filters.level2 ? 1 : 0) +
    filters.materials.length +
    (filters.priceMin.trim() ? 1 : 0) +
    (filters.priceMax.trim() ? 1 : 0) +
    (filters.dimLM.trim() ? 1 : 0) +
    (filters.dimWM.trim() ? 1 : 0) +
    (filters.dimHM.trim() ? 1 : 0);

  const toggleMaterial = (m: string) => {
    setFilters((prev) => {
      const has = prev.materials.includes(m);
      return {
        ...prev,
        materials: has
          ? prev.materials.filter((x) => x !== m)
          : [...prev.materials, m],
      };
    });
  };

  return (
    <PortalPageShell
      title="產品搜尋"
      badge="查詢車"
      subtitle="類似產品目錄：以一級／二級分類瀏覽，並可按 MATERIALS、價錢、長闊高（米）篩選。僅顯示售價。"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-body text-sm font-medium hover:bg-muted"
          >
            <SlidersHorizontal className="h-4 w-4" />
            篩選{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setShowCart(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-body text-sm font-medium text-primary"
          >
            <ShoppingCart className="h-4 w-4" />
            查詢車 ({cartCount})
          </button>
        </div>
      }
      maxWidthClass="max-w-7xl"
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜尋產品名稱、描述、材質…"
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 font-body text-sm placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Level-1 category chips — like 產品目錄 */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, level1: '', level2: '' }))}
          className={cn(
            'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
            !filters.level1
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          全部
        </button>
        {level1Options.map((l1) => (
          <button
            key={l1}
            type="button"
            onClick={() =>
              setFilters((f) => ({
                ...f,
                level1: f.level1 === l1 ? '' : l1,
                level2: '',
              }))
            }
            className={cn(
              'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
              filters.level1 === l1
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {l1}
          </button>
        ))}
      </div>

      {filters.level1 && level2Options.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">二級分類</span>
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, level2: '' }))}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium',
              !filters.level2
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground',
            )}
          >
            全部
          </button>
          {level2Options.map((l2) => (
            <button
              key={l2}
              type="button"
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  level2: f.level2 === l2 ? '' : l2,
                }))
              }
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium',
                filters.level2 === l2
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {l2}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'grid gap-4',
          showFilters ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : '',
        )}
      >
        {showFilters ? (
          <aside className="h-fit space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm lg:sticky lg:top-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold">進階篩選</h2>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" /> 重設
              </button>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Materials
              </p>
              {materialOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暫無材質資料</p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {materialOptions.map((m) => {
                    const checked = filters.materials.includes(m);
                    return (
                      <label
                        key={m}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted/60"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMaterial(m)}
                          className="rounded border-border"
                        />
                        <span className="truncate">{m}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                價錢（HK$）
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">下限</span>
                  <input
                    inputMode="numeric"
                    value={filters.priceMin}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, priceMin: e.target.value }))
                    }
                    placeholder="0"
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono-data text-xs"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">上限</span>
                  <input
                    inputMode="numeric"
                    value={filters.priceMax}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, priceMax: e.target.value }))
                    }
                    placeholder="如 5000"
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono-data text-xs"
                  />
                </label>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                例：上限 5000 → 只顯示 HK$5,000 以下
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                尺寸（米）· 約 ±15%
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['dimLM', '長'],
                    ['dimWM', '闊'],
                    ['dimHM', '高'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      {label}
                    </span>
                    <input
                      inputMode="decimal"
                      value={filters[key]}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, [key]: e.target.value }))
                      }
                      placeholder="1.5"
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono-data text-xs"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                例：長 1.5 → 約 1.5 米（1275–1725 mm）的產品
              </p>
            </div>
          </aside>
        ) : null}

        <div className="min-w-0 space-y-3">
          <p className="font-mono-data text-xs text-muted-foreground">
            {isLoading ? '載入中…' : `顯示 ${results.length} / ${all.length} 件產品`}
          </p>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((p) => {
                  const dims = fmtDims(p);
                  return (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm"
                    >
                      <div className="aspect-[4/3] bg-muted">
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.title}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                            無圖片
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="mb-1 flex flex-wrap gap-1">
                          {p.level1Category ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {p.level1Category}
                              {p.level2Category ? ` / ${p.level2Category}` : ''}
                            </span>
                          ) : null}
                        </div>
                        <h3 className="line-clamp-2 font-display text-[15px] font-semibold text-foreground">
                          {p.title}
                        </h3>
                        {p.material && p.material !== '—' ? (
                          <p className="mt-1 truncate font-body text-xs text-muted-foreground">
                            {p.material}
                          </p>
                        ) : null}
                        {dims ? (
                          <p className="mt-0.5 font-mono-data text-xs text-muted-foreground">
                            {dims}
                          </p>
                        ) : null}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="font-mono-data text-base font-bold text-primary">
                            ${p.salePrice.toLocaleString()}
                          </p>
                          <button
                            type="button"
                            onClick={() => addToCart(p)}
                            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/15"
                          >
                            <Plus className="h-3 w-3" /> 加入
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Search className="mb-3 h-8 w-8 text-muted-foreground/40" />
                  <p className="font-display text-sm text-muted-foreground">
                    找不到符合條件的產品
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    可放寬價錢上限，或調整長／闊／高（米）後再試
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCart && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-bold">查詢車</h3>
              <button
                type="button"
                onClick={() => setShowCart(false)}
                className="text-sm text-muted-foreground"
              >
                關閉
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {cart.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">查詢車是空的</p>
              ) : (
                cart.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
                  >
                    <div className="h-12 w-12 overflow-hidden rounded-lg bg-muted">
                      {c.imageUrl ? (
                        <img src={c.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="font-mono-data text-xs text-primary">
                        ${c.salePrice.toLocaleString()} × {c.qty}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => persistCart(cart.filter((x) => x.id !== c.id))}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {cart.length > 0 ? (
              <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                查詢車只保留本機選擇；未有 Supabase 查詢紀錄前不會顯示「已送出」狀態。
              </p>
            ) : null}
          </div>
        </div>
      )}
    </PortalPageShell>
  );
}
