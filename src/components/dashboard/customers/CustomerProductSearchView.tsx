import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Search, ShoppingCart, Plus, Trash2, Loader2, Send } from 'lucide-react';
import { PRODUCT_CATEGORIES } from '@/constants/solutions-mock';
import { fetchClientSearchProducts, fetchSearchProducts } from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import type { SearchProduct } from '@/types/solutions';
import { toast } from 'sonner';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';

const CART_KEY = 'fds-portal-inquiry-cart';

type CartItem = { id: string; title: string; salePrice: number; imageUrl?: string; qty: number };

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function CustomerProductSearchView() {
  const { loading: ctxLoading, projects } = useClientZoneContext();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [all, setAll] = useState<SearchProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>(() => loadCart());
  const [showCart, setShowCart] = useState(false);

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  useEffect(() => {
    if (ctxLoading) return;
    setIsLoading(true);
    const load = projectIds.length > 0
      ? fetchClientSearchProducts(projectIds)
      : fetchSearchProducts(80);
    load.then(setAll).finally(() => setIsLoading(false));
  }, [ctxLoading, projectIds.join(',')]);

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

  const categories = useMemo(() => {
    const fromData = [...new Set(all.map((p) => p.category).filter(Boolean))];
    const merged = ['全部', ...PRODUCT_CATEGORIES.filter((c) => c !== '全部')];
    for (const c of fromData) {
      if (!merged.includes(c)) merged.push(c);
    }
    return merged.slice(0, 12);
  }, [all]);

  const results = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return all.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
      if (category !== '全部' && p.category !== category) return false;
      return true;
    });
  }, [keyword, category, all]);

  const loading = ctxLoading || isLoading;
  const cartCount = cart.reduce((n, c) => n + c.qty, 0);

  return (
    <PortalPageShell
      title="產品搜尋"
      badge="查詢車"
      subtitle="像購物網站一樣瀏覽產品目錄，加入查詢車後可轉化為新報價項目（僅售價，隱藏成本）。"
      actions={
        <button
          type="button"
          onClick={() => setShowCart(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-body text-sm font-medium text-primary"
        >
          <ShoppingCart className="h-4 w-4" />
          查詢車 ({cartCount})
        </button>
      }
      maxWidthClass="max-w-6xl"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋產品名稱或描述..."
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 font-body text-sm placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                category === c
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((p) => (
              <div
                key={p.id}
                className="overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm"
              >
                <div className="aspect-[4/3] bg-muted">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">無圖片</div>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-2 font-display text-[13.5px] font-semibold text-foreground">
                    {p.title}
                  </h3>
                  {p.description ? (
                    <p className="mt-1 line-clamp-2 font-body text-[11.5px] leading-relaxed text-muted-foreground">
                      {p.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="font-mono-data text-base font-bold text-primary">
                      ${p.salePrice.toLocaleString()}
                    </p>
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15"
                    >
                      <Plus className="h-3 w-3" /> 加入
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Search className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-display text-sm text-muted-foreground">找不到符合條件的產品</p>
            </div>
          )}
        </>
      )}

      {showCart && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-bold">查詢車</h3>
              <button type="button" onClick={() => setShowCart(false)} className="text-sm text-muted-foreground">
                關閉
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {cart.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">查詢車是空的</p>
              ) : (
                cart.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
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
              <button
                type="button"
                onClick={() => {
                  toast.success('已送出查詢車', {
                    description: `${cartCount} 件產品將轉交 PM 跟進報價（前端示意）`,
                  });
                  persistCart([]);
                  setShowCart(false);
                }}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
              >
                <Send className="h-4 w-4" /> 送出查詢給 PM
              </button>
            ) : null}
          </div>
        </div>
      )}
    </PortalPageShell>
  );
}
