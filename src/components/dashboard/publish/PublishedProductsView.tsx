import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCheck, Search, ArrowDownToLine, ArrowUpToLine, RotateCcw, Eye, ChevronDown,
  CloudDownload, Loader2,
} from 'lucide-react';
import {
  MOCK_PUBLISHED, PUBLISH_STATE_META, type PublishState, type PublishedProduct,
} from '@/constants/analytics-mock';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const STATE_FILTERS: { key: PublishState | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已發佈' },
  { key: 'unpublished', label: '未發佈' },
  { key: 'delisted', label: '已下架' },
];

function fmtDate(d: string) {
  const x = new Date(d);
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
}

export function PublishedProductsView() {
  const [items, setItems] = useState<PublishedProduct[]>(MOCK_PUBLISHED);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<PublishState | 'all'>('all');
  const [factoryFilter, setFactoryFilter] = useState('全部');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncFromShopify = async () => {
    setIsSyncing(true);
    const toastId = toast.loading('正在從 Shopify 導入產品...', { description: '連接 Shopify 商店並下載所有產品資料。' });
    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-sync-from-shopify', {
        body: {},
      });
      if (error) {
        toast.error('導入失敗', { id: toastId, description: error.message, duration: 8000 });
        return;
      }
      if (data?.error) {
        toast.error('導入失敗', { id: toastId, description: data.error, duration: 8000 });
        return;
      }
      const s = data?.summary;
      const parts: string[] = [];
      if (s?.created > 0) parts.push(`新增 ${s.created} 件`);
      if (s?.updated > 0) parts.push(`更新 ${s.updated} 件`);
      if (s?.skipped > 0) parts.push(`略過 ${s.skipped} 件`);
      toast.success(`✅ 從 Shopify 導入完成`, {
        id: toastId,
        description: parts.length ? parts.join('、') : `共處理 ${s?.total_shopify ?? 0} 件產品`,
        duration: 6000,
      });
    } catch (err) {
      toast.error('導入失敗', { id: toastId, description: err instanceof Error ? err.message : '未知錯誤', duration: 8000 });
    } finally {
      setIsSyncing(false);
    }
  };

  const factories = useMemo(() => ['全部', ...Array.from(new Set(MOCK_PUBLISHED.map((p) => p.factory)))], []);

  const filtered = useMemo(() => items.filter((p) => {
    if (search && !p.title.includes(search)) return false;
    if (stateFilter !== 'all' && p.state !== stateFilter) return false;
    if (factoryFilter !== '全部' && p.factory !== factoryFilter) return false;
    return true;
  }), [items, search, stateFilter, factoryFilter]);

  const setState = (id: string, state: PublishState, msg: string) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, state } : p)));
    toast.success(msg);
  };
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkDelist = () => {
    const ids = Array.from(selected);
    if (!ids.length) { toast.message('請先勾選產品'); return; }
    setItems((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, state: 'delisted' } : p));
    setSelected(new Set());
    toast.success(`已下架 ${ids.length} 件產品`);
  };

  const counts = {
    published: items.filter((p) => p.state === 'published').length,
    unpublished: items.filter((p) => p.state === 'unpublished').length,
    delisted: items.filter((p) => p.state === 'delisted').length,
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <CheckCheck className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">已上載產品</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">
            已發佈 {counts.published} · 未發佈 {counts.unpublished} · 已下架 {counts.delisted}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 從 Shopify 導入按鈕 */}
          <button
            onClick={handleSyncFromShopify}
            disabled={isSyncing}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}
            {isSyncing ? '導入中...' : '從 Shopify 導入'}
          </button>
          {selected.size > 0 && (
            <button onClick={bulkDelist} className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/20">
              <ArrowDownToLine className="h-3.5 w-3.5" /> 批量下架（{selected.size}）
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋產品..." className="h-8 w-44 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="relative">
            <select value={factoryFilter} onChange={(e) => setFactoryFilter(e.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20">
              {factories.map((f) => <option key={f} value={f}>{f === '全部' ? '廠家：全部' : f}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* state filter pills */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-6 py-2">
        {STATE_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setStateFilter(f.key)} className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors', stateFilter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
            {f.label}
          </button>
        ))}
      </div>

      {/* table */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2.5"><input type="checkbox" className="rounded border-border" checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())} /></th>
                <th className="px-3 py-2.5 text-left font-medium">產品</th>
                <th className="px-3 py-2.5 text-left font-medium">廠家</th>
                <th className="px-3 py-2.5 text-left font-medium">狀態</th>
                <th className="px-3 py-2.5 text-left font-medium">上架時間</th>
                <th className="px-3 py-2.5 text-right font-medium">瀏覽</th>
                <th className="px-3 py-2.5 text-left font-medium">最後修改</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5"><input type="checkbox" className="rounded border-border" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-10 w-10 rounded-md object-cover bg-muted" />
                      <span className="font-body text-[13px] font-medium text-foreground">{p.title}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{p.factory}</td>
                  <td className="px-3 py-2.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', PUBLISH_STATE_META[p.state].className)}>{PUBLISH_STATE_META[p.state].label}</span></td>
                  <td className="px-3 py-2.5 font-mono-data text-[11.5px] text-muted-foreground">{fmtDate(p.publishedAt)}</td>
                  <td className="px-3 py-2.5 text-right font-mono-data text-foreground"><span className="inline-flex items-center gap-1"><Eye className="h-3 w-3 text-muted-foreground" />{p.views.toLocaleString()}</span></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{p.lastEditor}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {p.state === 'published' ? (
                        <button onClick={() => setState(p.id, 'delisted', '已下架')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10"><ArrowDownToLine className="h-3 w-3" /> 下架</button>
                      ) : (
                        <button onClick={() => setState(p.id, 'published', '已重新上架')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-emerald-600 hover:bg-emerald-500/10"><ArrowUpToLine className="h-3 w-3" /> 上架</button>
                      )}
                      <button onClick={() => toast.success('已還原至上一版本')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"><RotateCcw className="h-3 w-3" /> 還原</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">找不到符合條件的產品</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
