import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Search, Eye, Loader2 } from 'lucide-react';
import { PRODUCT_CATEGORIES } from '@/constants/solutions-mock';
import { fetchClientSearchProducts } from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import type { SearchProduct } from '@/types/solutions';

export function CustomerProductSearchView() {
  const { loading: ctxLoading, projects } = useClientZoneContext();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [all, setAll] = useState<SearchProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  useEffect(() => {
    if (ctxLoading) return;
    setIsLoading(true);
    fetchClientSearchProducts(projectIds)
      .then(setAll)
      .finally(() => setIsLoading(false));
  }, [ctxLoading, projectIds.join(',')]);

  const categories = useMemo(() => {
    const fromData = [...new Set(all.map((p) => p.category).filter(Boolean))];
    const merged = ['全部', ...PRODUCT_CATEGORIES.filter((c) => c !== '全部')];
    for (const c of fromData) {
      if (!merged.includes(c)) merged.push(c);
    }
    return merged.slice(0, 10);
  }, [all]);

  const results = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return all.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) return false;
      if (category !== '全部' && p.category !== category) return false;
      return true;
    });
  }, [keyword, category, all]);

  const loading = ctxLoading || isLoading;

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">產品參考</h1>
          <span className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            <Eye className="h-3 w-3" /> 唯讀模式
          </span>
        </div>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          瀏覽受邀專案內產品與 A 類已發佈產品，僅供參考（無法加入設計專案）
        </p>
        {projects.length > 0 && (
          <p className="mt-1 font-mono-data text-[11px] text-muted-foreground/80">
            資料來源：{projects.length} 個受邀專案
            {all.length > 0 ? ` · ${all.length} 件可參考產品` : ''}
          </p>
        )}

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
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                    <h3 className="line-clamp-2 font-display text-[13.5px] font-semibold text-foreground">{p.title}</h3>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 font-body text-[11.5px] leading-relaxed text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                    <p className="mt-2 font-mono-data text-base font-bold text-primary">
                      ${p.salePrice.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Search className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="font-display text-sm text-muted-foreground">找不到符合條件的產品</p>
                {projects.length === 0 && (
                  <p className="mt-1 text-[12px] text-muted-foreground/70">尚未收到專案邀請，暫無方案內產品可參考</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
