import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { dedupeFactoryNames, expandFactoryFilterSelection } from '@/lib/factoryNames';
import { supabase } from '@/lib/supabase';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, X, FolderTree, Factory, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export type PageSize = 20 | 50 | 100;

export type PublishListOrder = {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
};

const DEFAULT_ORDER: PublishListOrder[] = [
  { column: 'copy_queued_at', ascending: false, nullsFirst: false },
  { column: 'created_at', ascending: false },
];

interface UsePublishListOpts {
  /** explicit column list for the data query */
  select: string;
  /** base flag filters applied to BOTH count and data queries (e.g. in_shopify_queue=true) */
  applyBaseFilters: (q: any) => any;
  /** re-fetch trigger key — bump to reload (e.g. after 完成) */
  reloadKey?: number;
  /** DB sort order — defaults to copy_queued_at DESC, created_at DESC */
  orderBy?: PublishListOrder[];
}

export function usePublishList({ select, applyBaseFilters, reloadKey = 0, orderBy }: UsePublishListOpts) {
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [level1Filter, setLevel1Filter] = useState('');
  const [level2Filter, setLevel2Filter] = useState('');
  const [selectedFactories, setSelectedFactories] = useState<string[]>([]);

  // category pairs (for level1/level2 dropdowns)
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  const level1Options = useMemo(() => Array.from(new Set(categoryPairs.map((p) => p.level1))), [categoryPairs]);
  const level2Options = useMemo(
    () => Array.from(new Set(categoryPairs.filter((p) => p.level1 === level1Filter && p.level2).map((p) => p.level2))),
    [categoryPairs, level1Filter]
  );

  // factory options (loaded from the queue's own products so the list stays short)
  const [availableFactories, setAvailableFactories] = useState<string[]>([]);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const factoryRef = useRef<HTMLDivElement>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = useRef(0);
  const dataAbortRef = useRef<AbortController | null>(null);
  const countAbortRef = useRef<AbortController | null>(null);

  // Inline `orderBy={[...]}` from callers gets a new reference every render — stabilize
  // so fetchRows doesn't re-run in a loop (spinner forever + brief product flash).
  const orderByKey = JSON.stringify(orderBy ?? DEFAULT_ORDER);
  const resolvedOrderBy = useMemo(
    () => orderBy ?? DEFAULT_ORDER,
    [orderByKey],
  );

  // debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(searchQuery); setCurrentPage(1); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  // load category pairs
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      const { data } = await supabase
        .from('product_category')
        .select('level1, level2, sort_order')
        .order('sort_order', { ascending: true })
        .abortSignal(controller.signal);
      if (!cancelled && data) {
        setCategoryPairs(
          data.map((r: any) => ({ level1: String(r.level1 ?? '').trim(), level2: String(r.level2 ?? '').trim() })).filter((p) => p.level1)
        );
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  // load distinct factory names within this queue
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      let q = supabase.from('products').select('factories_display_name').not('factories_display_name', 'is', null).neq('factories_display_name', '');
      q = applyBaseFilters(q);
      const { data } = await q.abortSignal(controller.signal);
      if (cancelled || !data) return;
      const unique = dedupeFactoryNames(data.map((r: any) => r.factories_display_name as string));
      setAvailableFactories(unique);
    })();
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // close factory dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (factoryRef.current && !factoryRef.current.contains(e.target as Node)) setFactoryOpen(false);
    };
    if (factoryOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [factoryOpen]);

  // reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [level1Filter, level2Filter, selectedFactories, pageSize]);

  const fetchRows = useCallback(async () => {
    const requestId = ++fetchSeq.current;
    dataAbortRef.current?.abort();
    countAbortRef.current?.abort();
    const dataController = new AbortController();
    const countController = new AbortController();
    dataAbortRef.current = dataController;
    countAbortRef.current = countController;

    setIsLoading(true);
    try {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      const buildFilters = (q: any) => {
        q = applyBaseFilters(q);
        if (debouncedSearch.trim()) {
          // Match by product name OR SKU. SKU lives in `sku` (e.g. "PHZ-8006D");
          // also match the bare `model` ("8006D") and factory_id prefix so partial
          // codes work. PostgREST .or() with comma-separated ilike conditions.
          const term = debouncedSearch.trim().replace(/[,()]/g, ' ');
          q = q.or(`title.ilike.%${term}%,sku.ilike.%${term}%,model.ilike.%${term}%,factory_id.ilike.%${term}%`);
        }
        if (level1Filter) q = q.eq('level1_category', level1Filter);
        if (level2Filter) q = q.eq('level2_category', level2Filter);
        if (selectedFactories.length > 0) q = q.in('factories_display_name', expandFactoryFilterSelection(selectedFactories));
        return q;
      };

      const orders = resolvedOrderBy;

      const runQuery = async (spec: PublishListOrder[], signal: AbortSignal) => {
        let q = buildFilters(supabase.from('products').select(select));
        for (const o of spec) {
          q = q.order(o.column, { ascending: o.ascending ?? false, nullsFirst: o.nullsFirst });
        }
        return q.range(from, to).abortSignal(signal);
      };

      // Data query — newest stage entry first (per-page orderBy), with fallbacks.
      let data: any[] | null = null;
      const { data: d1, error: e1 } = await runQuery(orders, dataController.signal);
      if (dataController.signal.aborted || requestId !== fetchSeq.current) return;
      if (e1) {
        console.warn('[usePublishList] primary order failed, falling back to created_at:', e1.message);
        const { data: d2 } = await runQuery([{ column: 'created_at', ascending: false }], dataController.signal);
        if (dataController.signal.aborted || requestId !== fetchSeq.current) return;
        data = d2;
      } else {
        data = d1;
      }
      setRows(data || []);
      setIsLoading(false);

      // Count query — fire-and-forget, but abort stale counts so tab switches and
      // reloads cannot pile up HEAD requests against PostgREST.
      buildFilters(supabase.from('products').select('id', { count: 'exact', head: true }))
        .abortSignal(countController.signal)
        .then(({ count }: { count: number | null }) => {
          if (!countController.signal.aborted && requestId === fetchSeq.current) {
            setTotalCount(count || 0);
          }
        })
        .catch(() => { /* ignore count errors */ });
    } catch {
      if (!dataController.signal.aborted && requestId === fetchSeq.current) {
        setRows([]);
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debouncedSearch, level1Filter, level2Filter, selectedFactories, reloadKey, resolvedOrderBy]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => () => {
    dataAbortRef.current?.abort();
    countAbortRef.current?.abort();
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const Toolbar = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-8 py-2.5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="搜尋產品名稱或編碼 (SKU)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 w-[220px] rounded-lg border border-border bg-background pl-8 pr-8 font-body text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
        )}
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Page size */}
      <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(parseInt(v) as PageSize)}>
        <SelectTrigger className="h-8 w-[120px] text-xs font-body"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="20">每頁 20 項</SelectItem>
          <SelectItem value="50">每頁 50 項</SelectItem>
          <SelectItem value="100">每頁 100 項</SelectItem>
        </SelectContent>
      </Select>

      <div className="h-4 w-px bg-border" />

      {/* Level 1 */}
      <Select value={level1Filter || '__all__'} onValueChange={(v) => { setLevel1Filter(v === '__all__' ? '' : v); setLevel2Filter(''); }}>
        <SelectTrigger className="h-8 w-[150px] gap-1 text-xs font-body"><FolderTree className="h-3 w-3 text-muted-foreground" /><SelectValue placeholder="一級分類" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部一級分類</SelectItem>
          {level1Options.map((l1) => <SelectItem key={l1} value={l1}>{l1}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Level 2 */}
      {level1Filter && level2Options.length > 0 && (
        <Select value={level2Filter || '__all__'} onValueChange={(v) => setLevel2Filter(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-8 w-[150px] gap-1 text-xs font-body"><FolderTree className="h-3 w-3 text-muted-foreground" /><SelectValue placeholder="二級分類" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部二級分類</SelectItem>
            {level2Options.map((l2) => <SelectItem key={l2} value={l2}>{l2}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {/* Factory multi-select */}
      <div className="relative" ref={factoryRef}>
        <button
          onClick={() => setFactoryOpen((o) => !o)}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-body transition-colors ${selectedFactories.length > 0 ? 'border-indigo-500/50 text-indigo-600' : 'border-border text-foreground hover:bg-accent'}`}
        >
          <Factory className="h-3 w-3" />
          {selectedFactories.length > 0 ? `廠家 (${selectedFactories.length})` : '篩選廠家'}
          <ChevronDown className="h-3 w-3" />
        </button>
        {selectedFactories.length > 0 && (
          <button onClick={(e) => { e.stopPropagation(); setSelectedFactories([]); }} className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[9px] text-white hover:bg-indigo-600"><X className="h-2.5 w-2.5" /></button>
        )}
        {factoryOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-[300px] w-[240px] overflow-auto rounded-lg border border-border bg-background p-2 shadow-lg">
            {availableFactories.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">無可用廠家</p>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between border-b border-border px-2 pb-2">
                  <span className="font-mono-data text-[10px] text-muted-foreground">{selectedFactories.length} / {availableFactories.length} 已選</span>
                  <button onClick={() => setSelectedFactories([])} className="text-[10px] text-indigo-500 hover:underline">清除全部</button>
                </div>
                {availableFactories.map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                    <input
                      type="checkbox"
                      checked={selectedFactories.includes(f)}
                      onChange={(e) => setSelectedFactories((prev) => e.target.checked ? [...prev, f] : prev.filter((x) => x !== f))}
                      className="h-3.5 w-3.5 rounded border-border accent-indigo-600"
                    />
                    <span className="truncate font-body text-xs">{f}</span>
                  </label>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Count */}
      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-primary">{totalCount} 件產品</span>
    </div>
  );

  const Pagination = totalCount > 0 ? (
    <div className="flex shrink-0 items-center justify-between border-t border-border bg-muted/30 px-8 py-2.5">
      <span className="font-mono-data text-[11px] text-muted-foreground">
        顯示 {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalCount)}，共 {totalCount} 項
      </span>
      <div className="flex items-center gap-1">
        <button disabled={currentPage === 1} onClick={() => setCurrentPage(1)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronsLeft className="h-3.5 w-3.5" /></button>
        <button disabled={currentPage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
        <span className="px-2 font-mono-data text-[11px] text-foreground">{currentPage} / {totalPages}</span>
        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"><ChevronsRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  ) : null;

  return { rows, setRows, totalCount, setTotalCount, isLoading, Toolbar, Pagination };
}
