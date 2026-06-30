import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/product';
import { mapReadyToPublishRow } from '@/lib/readyToPublishRow';
import { dedupeFactoryNames, normalizeFactoryDisplayName } from '@/lib/factoryNames';

export type ReadyToPublishPageSize = 20 | 25 | 50 | 100;

export interface ReadyToPublishServerList {
  totalCount: number;
  isLoading: boolean;
  currentPage: number;
  pageSize: ReadyToPublishPageSize;
  setCurrentPage: (page: number) => void;
  setPageSize: (size: ReadyToPublishPageSize) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  level1Filter: string;
  setLevel1Filter: (v: string) => void;
  level2Filter: string;
  setLevel2Filter: (v: string) => void;
  factoryFilter: string;
  setFactoryFilter: (v: string) => void;
  factoryOptions: string[];
  skuSortDir: 'asc' | 'desc';
  setSkuSortDir: (d: 'asc' | 'desc') => void;
  reload: () => void;
}

export function useReadyToPublishList(): { products: Product[]; serverList: ReadyToPublishServerList } {
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageSize, setPageSize] = useState<ReadyToPublishPageSize>(25);
  const [currentPage, setCurrentPage] = useState(0);
  const [level1Filter, setLevel1Filter] = useState('');
  const [level2Filter, setLevel2Filter] = useState('');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [skuSortDir, setSkuSortDirState] = useState<'asc' | 'desc'>('asc');
  const [sortBy, setSortBy] = useState<'ready_at' | 'sku'>('ready_at');
  const [factoryOptions, setFactoryOptions] = useState<string[]>([]);

  const setSkuSortDir = useCallback((dir: 'asc' | 'desc') => {
    setSortBy('sku');
    setSkuSortDirState(dir);
  }, []);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = useRef(0);
  const dataAbortRef = useRef<AbortController | null>(null);
  const countAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(0);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  useEffect(() => { setCurrentPage(0); }, [level1Filter, level2Filter, factoryFilter, pageSize, skuSortDir, sortBy]);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_publish_rts_factories', { p_stage: 'ready-to-publish' }).then(({ data, error }) => {
      if (cancelled || error) return;
      setFactoryOptions(dedupeFactoryNames((data as string[] | null) ?? []));
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const fetchPage = useCallback(async () => {
    const requestId = ++fetchSeq.current;
    dataAbortRef.current?.abort();
    countAbortRef.current?.abort();
    const dataController = new AbortController();
    const countController = new AbortController();
    dataAbortRef.current = dataController;
    countAbortRef.current = countController;

    setIsLoading(true);
    try {
      const offset = currentPage * pageSize;
      const { data, error } = await supabase
        .rpc('get_ready_to_publish_rows', {
          p_search: debouncedSearch.trim() || null,
          p_level1: level1Filter || null,
          p_level2: level2Filter || null,
          p_factory: normalizeFactoryDisplayName(factoryFilter) || null,
          p_sort: sortBy,
          p_sort_asc: sortBy === 'sku' ? skuSortDir === 'asc' : false,
          p_limit: pageSize,
          p_offset: offset,
        })
        .abortSignal(dataController.signal);

      if (dataController.signal.aborted || requestId !== fetchSeq.current) return;
      if (error) {
        console.warn('[useReadyToPublishList] rows error:', error.message);
        setProducts([]);
        setTotalCount(0);
        setIsLoading(false);
        return;
      }

      const mapped = (data || []).map((row: Record<string, unknown>) => mapReadyToPublishRow(row));
      setProducts(mapped);
      const fallbackCount = offset + mapped.length;
      setTotalCount(fallbackCount);
      setIsLoading(false);

      (async () => {
        try {
          const { data: count, error: countErr } = await supabase
            .rpc('get_ready_to_publish_count', {
              p_search: debouncedSearch.trim() || null,
              p_level1: level1Filter || null,
              p_level2: level2Filter || null,
              p_factory: normalizeFactoryDisplayName(factoryFilter) || null,
            })
            .abortSignal(countController.signal);
          if (!countController.signal.aborted && requestId === fetchSeq.current) {
            setTotalCount(countErr ? fallbackCount : Number(count) || 0);
          }
        } catch {
          if (!countController.signal.aborted && requestId === fetchSeq.current) {
            setTotalCount(fallbackCount);
          }
        }
      })();

      const rtsIds = mapped.map((p) => p.id);
      if (rtsIds.length > 0) {
        supabase
          .from('ready_to_shopify')
          .select('id,image_url')
          .in('id', rtsIds)
          .then(({ data: imgRows }) => {
            if (requestId !== fetchSeq.current || !imgRows?.length) return;
            const imgMap = Object.fromEntries(
              imgRows.map((r: { id: string; image_url: string | null }) => [r.id, r.image_url || '']),
            );
            setProducts((prev) =>
              prev.map((p) => {
                const url = imgMap[p.id];
                return url && !p.imageUrl ? { ...p, imageUrl: url } : p;
              }),
            );
          });
      }
    } catch {
      if (requestId === fetchSeq.current) {
        setProducts([]);
        setIsLoading(false);
      }
    }
  }, [currentPage, pageSize, debouncedSearch, level1Filter, level2Filter, factoryFilter, skuSortDir, sortBy, reloadKey]);

  useEffect(() => { fetchPage(); }, [fetchPage]);
  useEffect(() => () => {
    dataAbortRef.current?.abort();
    countAbortRef.current?.abort();
  }, []);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const serverList = useMemo<ReadyToPublishServerList>(() => ({
    totalCount,
    isLoading,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
    searchQuery,
    setSearchQuery,
    level1Filter,
    setLevel1Filter,
    level2Filter,
    setLevel2Filter,
    factoryFilter,
    setFactoryFilter,
    factoryOptions,
    skuSortDir,
    setSkuSortDir,
    reload,
  }), [
    totalCount, isLoading, currentPage, pageSize, searchQuery,
    level1Filter, level2Filter, factoryFilter, factoryOptions, skuSortDir, reload,
  ]);

  return { products, serverList };
}
