import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { flattenRtsListRow } from '@/lib/rtsProductSync';
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

export type PublishRtsCountStage = 'copywriting' | 'product-info';

const DEFAULT_ORDER: PublishListOrder[] = [
  { column: 'copy_queued_at', ascending: false, nullsFirst: false },
  { column: 'imported_at', ascending: false },
];

const RTS_LIST_SELECT = `
  id, product_id, title, body_html, image_url, vendor, product_type, tags, price, sku, cost,
  copy_done, copy_done_at, copy_queued_at, info_done, in_shopify_queue, revert_reason, imported_at,
  material, "my_fields.materials",
  products!inner (
    id, title, description, description_html, image_url,
    factories_display_name, level1_category, level2_category,
    sale_price, price, cost_price, sku, model, factory_id, tags,
    dimension_l_mm, dimension_w_mm, dimension_h_mm, in_stock, customize, revert_reason,
    shopify_product_id
  )
`;

interface UsePublishRtsListOpts {
  applyBaseFilters: (q: any) => any;
  applyProductsCountFilters: (q: any) => any;
  countStage: PublishRtsCountStage;
  reloadKey?: number;
  orderBy?: PublishListOrder[];
}

/** Publish list sourced from ready_to_shopify (workflow flags) + embedded products (display/sync). */
export function usePublishRtsList({ applyBaseFilters, applyProductsCountFilters, countStage, reloadKey = 0, orderBy }: UsePublishRtsListOpts) {
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

  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  const level1Options = useMemo(() => Array.from(new Set(categoryPairs.map((p) => p.level1))), [categoryPairs]);
  const level2Options = useMemo(
    () => Array.from(new Set(categoryPairs.filter((p) => p.level1 === level1Filter && p.level2).map((p) => p.level2))),
    [categoryPairs, level1Filter],
  );

  const [availableFactories, setAvailableFactories] = useState<string[]>([]);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const factoryRef = useRef<HTMLDivElement>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = useRef(0);
  const dataAbortRef = useRef<AbortController | null>(null);
  const countAbortRef = useRef<AbortController | null>(null);

  const orderByKey = JSON.stringify(orderBy ?? DEFAULT_ORDER);
  const resolvedOrderBy = useMemo(() => orderBy ?? DEFAULT_ORDER, [orderByKey]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(searchQuery); setCurrentPage(1); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

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
          data.map((r: any) => ({ level1: String(r.level1 ?? '').trim(), level2: String(r.level2 ?? '').trim() })).filter((p) => p.level1),
        );
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      let q = supabase
        .from('products')
        .select('factories_display_name')
        .not('factories_display_name', 'is', null)
        .neq('factories_display_name', '');
      q = applyProductsCountFilters(q);
      const { data } = await q.abortSignal(controller.signal);
      if (cancelled || !data) return;
      const names = data.map((r: any) => r.factories_display_name).filter(Boolean) as string[];
      const unique = Array.from(new Set(names));
      unique.sort((a, b) => a.localeCompare(b, 'zh'));
      setAvailableFactories(unique);
    })();
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (factoryRef.current && !factoryRef.current.contains(e.target as Node)) setFactoryOpen(false);
    };
    if (factoryOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [factoryOpen]);

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
          const term = debouncedSearch.trim().replace(/[,()]/g, ' ');
          q = q.or(`title.ilike.%${term}%,sku.ilike.%${term}%,products.model.ilike.%${term}%,products.factory_id.ilike.%${term}%`);
        }
        if (level1Filter) q = q.eq('products.level1_category', level1Filter);
        if (level2Filter) q = q.eq('products.level2_category', level2Filter);
        if (selectedFactories.length > 0) {
          q = q.or(selectedFactories.map((f) => `vendor.eq.${f},products.factories_display_name.eq.${f}`).join(','));
        }
        return q;
      };

      const orders = resolvedOrderBy;

      const runQuery = async (spec: PublishListOrder[], signal: AbortSignal) => {
        let q = buildFilters(supabase.from('ready_to_shopify').select(RTS_LIST_SELECT));
        for (const o of spec) {
          q = q.order(o.column, { ascending: o.ascending ?? false, nullsFirst: o.nullsFirst });
        }
        return q.range(from, to).abortSignal(signal);
      };

      let data: any[] | null = null;
      const { data: d1, error: e1 } = await runQuery(orders, dataController.signal);
      if (dataController.signal.aborted || requestId !== fetchSeq.current) return;
      if (e1) {
        console.warn('[usePublishRtsList] primary order failed, falling back to imported_at:', e1.message);
        const { data: d2 } = await runQuery([{ column: 'imported_at', ascending: false }], dataController.signal);
        if (dataController.signal.aborted || requestId !== fetchSeq.current) return;
        data = d2;
      } else {
        data = d1;
      }
      const flattenedRows = (data || []).map(flattenRtsListRow);
      setRows(flattenedRows);
      const fallbackCount = from + flattenedRows.length;
      setTotalCount(fallbackCount);
      setIsLoading(false);

      (async () => {
        try {
          const { data: count, error } = await supabase
            .rpc('get_publish_rts_count', {
              p_stage: countStage,
              p_search: debouncedSearch.trim() || null,
              p_level1: level1Filter || null,
              p_level2: level2Filter || null,
              p_factories: selectedFactories.length > 0 ? selectedFactories : null,
            })
            .abortSignal(countController.signal);
          if (!countController.signal.aborted && requestId === fetchSeq.current) {
            if (error) {
              console.warn('[usePublishRtsList] count error:', error.message);
              setTotalCount(fallbackCount);
            } else {
              setTotalCount(Number(count) || 0);
            }
          }
        } catch (err) {
          if (!countController.signal.aborted && requestId === fetchSeq.current) {
            console.warn('[usePublishRtsList] count failed:', err instanceof Error ? err.message : err);
            setTotalCount(fallbackCount);
          }
        }
      })();
    } catch {
      if (!dataController.signal.aborted && requestId === fetchSeq.current) {
        setRows([]);
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debouncedSearch, level1Filter, level2Filter, selectedFactories, reloadKey, resolvedOrderBy, countStage]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => () => {
    dataAbortRef.current?.abort();
    countAbortRef.current?.abort();
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const Toolbar = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-8 py-2.5">
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

      <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(parseInt(v) as PageSize)}>
        <SelectTrigger className="h-8 w-[120px] text-xs font-body"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="20">每頁 20 項</SelectItem>
          <SelectItem value="50">每頁 50 項</SelectItem>
          <SelectItem value="100">每頁 100 項</SelectItem>
        </SelectContent>
      </Select>

      <div className="h-4 w-px bg-border" />

      <Select value={level1Filter || '__all__'} onValueChange={(v) => { setLevel1Filter(v === '__all__' ? '' : v); setLevel2Filter(''); }}>
        <SelectTrigger className="h-8 w-[150px] gap-1 text-xs font-body"><FolderTree className="h-3 w-3 text-muted-foreground" /><SelectValue placeholder="一級分類" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部一級分類</SelectItem>
          {level1Options.map((l1) => <SelectItem key={l1} value={l1}>{l1}</SelectItem>)}
        </SelectContent>
      </Select>

      {level1Filter && level2Options.length > 0 && (
        <Select value={level2Filter || '__all__'} onValueChange={(v) => setLevel2Filter(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-8 w-[150px] gap-1 text-xs font-body"><FolderTree className="h-3 w-3 text-muted-foreground" /><SelectValue placeholder="二級分類" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部二級分類</SelectItem>
            {level2Options.map((l2) => <SelectItem key={l2} value={l2}>{l2}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

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
