import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Search, Eye } from 'lucide-react';
import { MOCK_SEARCH_PRODUCTS, PRODUCT_CATEGORIES } from '@/constants/solutions-mock';

export function CustomerProductSearchView() {
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');

  // 客戶唯讀：僅限受邀專案內產品或 A 類已發佈產品
  const visible = MOCK_SEARCH_PRODUCTS.filter((p) => p.tier === 'A' || p.tier === 'B');

  const results = useMemo(() => {
    return visible.filter((p) => {
      if (keyword && !p.title.includes(keyword) && !p.description.includes(keyword)) return false;
      if (category !== '全部' && p.category !== category) return false;
      return true;
    });
  }, [keyword, category, visible]);

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">產品參考</h1>
          <span className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            <Eye className="h-3 w-3" /> 唯讀模式
          </span>
        </div>
        <p className="mt-1 font-body text-sm text-muted-foreground">瀏覽方案內與已發佈的產品，僅供參考</p>

        {/* Simple search bar */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋產品名稱或描述..."
              className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 font-body text-sm placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRODUCT_CATEGORIES.slice(0, 6).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                  category === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Read-only result cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm">
              <div className="aspect-[4/3] bg-muted">
                <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-full w-full object-cover" />
              </div>
              <div className="p-3">
                <h3 className="font-display text-[13.5px] font-semibold text-foreground">{p.title}</h3>
                <p className="mt-1 line-clamp-2 font-body text-[11.5px] leading-relaxed text-muted-foreground">{p.description}</p>
                <p className="mt-2 font-mono-data text-base font-bold text-primary">${p.salePrice.toLocaleString()}</p>
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
      </div>
    </div>
  );
}
