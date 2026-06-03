import { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Search, SlidersHorizontal, LayoutGrid, List, Share2, FolderPlus,
  FileText, Check, Package, Truck,
} from 'lucide-react';
import { PRODUCT_CATEGORIES } from '@/constants/solutions-mock';
import { fetchSearchProducts } from '@/lib/solutionsApi';
import { TIER_META, type ProductTier, type SearchProduct } from '@/types/solutions';

const COLORS = ['全部', '黑色', '白色', '灰色', '胡桃啡', '原木色', '米白'];
const STOCK_OPTS = ['全部', '現貨', '訂製'];

export function ProductSearchView() {
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [color, setColor] = useState('全部');
  const [stock, setStock] = useState('全部');
  const [tierFilter, setTierFilter] = useState<ProductTier | '全部'>('全部');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSearchProducts(60)
      .then(setProducts)
      .finally(() => setIsLoading(false));
  }, []);

  const results = useMemo(() => {
    return products.filter((p) => {
      if (keyword && !p.title.includes(keyword) && !p.description.includes(keyword)) return false;
      if (category !== '全部' && p.category !== category) return false;
      if (color !== '全部' && p.color !== color) return false;
      if (stock === '現貨' && !p.inStock) return false;
      if (stock === '訂製' && p.inStock) return false;
      if (tierFilter !== '全部' && p.tier !== tierFilter) return false;
      return true;
    });
  }, [products, keyword, category, color, stock, tierFilter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">產品搜尋</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">{results.length} 筆結果</span>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
              已選 {selected.size} 件
            </span>
          )}
          <button className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90">
            <Share2 className="h-3.5 w-3.5" /> 生成分享連結
          </button>
        </div>
      </div>

      {/* Advanced search bar */}
      <div className="shrink-0 space-y-3 border-b border-border bg-card px-6 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="關鍵字搜尋：產品名稱、描述、材質..."
            className="w-full rounded-xl border border-border bg-background pl-10 pr-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" /> 進階篩選
          </span>
          <FilterSelect value={category} onChange={setCategory} options={PRODUCT_CATEGORIES} label="分類" />
          <FilterSelect value={color} onChange={setColor} options={COLORS} label="顏色" />
          <FilterSelect value={stock} onChange={setStock} options={STOCK_OPTS} label="現貨/訂製" />
          {/* tier pills */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
            {(['全部', 'A', 'B', 'C'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  tierFilter === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t === '全部' ? '全部分級' : `${t} 類`}
              </button>
            ))}
          </div>
          {/* view toggle */}
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
            <button onClick={() => setView('grid')} className={cn('rounded-md p-1.5', view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}><LayoutGrid className="h-3.5 w-3.5" /></button>
            <button onClick={() => setView('list')} className={cn('rounded-md p-1.5', view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}><List className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="aspect-[4/3] animate-pulse bg-muted" />
                <div className="space-y-2 p-3">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-full animate-pulse rounded bg-muted/70" />
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((p) => {
              const isSel = selected.has(p.id);
              return (
                <div key={p.id} className={cn('group flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:shadow-md', isSel ? 'border-primary ring-2 ring-primary/20' : 'border-border')}>
                  <div className="relative aspect-[4/3] bg-muted">
                    <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-full w-full object-cover" />
                    <span className={cn('absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-bold', TIER_META[p.tier].className)}>{TIER_META[p.tier].label}</span>
                    <button onClick={() => toggle(p.id)} className={cn('absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border transition-colors', isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/80 text-muted-foreground hover:text-foreground')}>
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-1 flex-col p-3">
                    <h3 className="font-display text-[13.5px] font-semibold text-foreground">{p.title}</h3>
                    <p className="mt-1 line-clamp-2 font-body text-[11.5px] leading-relaxed text-muted-foreground">{p.description}</p>
                    <div className="mt-2 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Package className="h-3 w-3" />{p.inStock ? '現貨' : '訂製'}</span>
                      <span className="flex items-center gap-0.5"><Truck className="h-3 w-3" />{p.deliveryDays} 天</span>
                    </div>
                    <p className="mt-2 font-mono-data text-base font-bold text-primary">${p.salePrice.toLocaleString()}</p>
                    <div className="mt-2.5 flex gap-1.5">
                      <button className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20">
                        <FolderPlus className="h-3.5 w-3.5" /> 加入專案
                      </button>
                      <button className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                        <FileText className="h-3.5 w-3.5" /> 加入報價
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5"></th>
                  <th className="px-3 py-2.5 text-left font-medium">產品</th>
                  <th className="px-3 py-2.5 text-left font-medium">分級</th>
                  <th className="px-3 py-2.5 text-right font-medium">售價</th>
                  <th className="px-3 py-2.5 text-center font-medium">交期</th>
                  <th className="px-3 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {results.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="rounded border-border" /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-10 w-10 rounded-md object-cover bg-muted" />
                        <div>
                          <p className="font-body text-[13px] font-medium text-foreground">{p.title}</p>
                          <p className="line-clamp-1 text-[11px] text-muted-foreground">{p.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', TIER_META[p.tier].className)}>{TIER_META[p.tier].label}</span></td>
                    <td className="px-3 py-2.5 text-right font-mono-data text-primary">${p.salePrice.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-center text-muted-foreground">{p.deliveryDays} 天</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button className="rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20">加入專案</button>
                        <button className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent">加入報價</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: string }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 appearance-none rounded-lg border border-border bg-background pl-2.5 pr-7 text-[11.5px] text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        aria-label={label}
      >
        {options.map((o) => <option key={o} value={o}>{o === '全部' ? `${label}：全部` : o}</option>)}
      </select>
    </div>
  );
}
