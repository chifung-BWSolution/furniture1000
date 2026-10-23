import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Combine, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/ui/empty-state';
import { productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import {
  findSimilarProductGroups,
  type SimilarProductCriterion,
  type SimilarProductGroup,
} from '@/lib/similarProducts';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  PublishedProductMergeModal,
  type MergeHostProduct,
} from './PublishedProductMergeModal';

type MirrorRow = MergeHostProduct['raw'] & {
  configurable?: string | null;
};

interface SimilarItem {
  id: string;
  shopify_product_id: string;
  title: string;
  factory: string;
  sku: string;
  price: number | null;
  size: string;
  imageUrl: string;
  raw: MirrorRow;
}

const LIST_SELECT = [
  'id',
  'shopify_product_id',
  'title',
  'vendor',
  'image_url',
  'variants',
  'price',
  'sku',
  'status',
  '"my_fields.normal_size"',
  'configurable',
].join(',');

const FETCH_PAGE = 500;
const GROUPS_PER_PAGE = 8;

function primarySku(row: MirrorRow): string {
  const direct = (row.sku || '').trim();
  if (direct) return direct;
  const skus = (row.variants ?? [])
    .map((v) => (v.sku || '').trim())
    .filter(Boolean);
  if (skus.length === 0) return '';
  return skus
    .slice()
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))[0];
}

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString()}`;
}

function criterionLabel(criterion: SimilarProductGroup['criterion']): string {
  if (criterion === 'name') return '同名同廠';
  if (criterion === 'sku') return '同一產品碼';
  return '同名同廠且同一產品碼';
}

function rowToItem(row: MirrorRow): SimilarItem | null {
  const id = String(row.id || '').trim();
  const shopifyId = String(row.shopify_product_id || '').trim();
  if (!id || !shopifyId) return null;
  if (typeof row.configurable === 'string' && row.configurable.trim()) return null;
  const price = row.price != null && Number.isFinite(Number(row.price)) ? Number(row.price) : null;
  return {
    id,
    shopify_product_id: shopifyId,
    title: (row.title || '').trim() || '(未命名)',
    factory: (row.vendor || '').trim() || '—',
    sku: primarySku(row) || '—',
    price,
    size: (row['my_fields.normal_size'] || '').trim(),
    imageUrl: (row.image_url || '').trim(),
    raw: row,
  };
}

export function SimilarProductsView() {
  const [items, setItems] = useState<SimilarItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scanLoaded, setScanLoaded] = useState(0);
  const [scanTotal, setScanTotal] = useState<number | null>(null);
  const [scanPhase, setScanPhase] = useState<'counting' | 'fetching' | 'matching'>('counting');
  const [criteria, setCriteria] = useState<SimilarProductCriterion[]>(['name', 'sku']);
  const [search, setSearch] = useState('');
  const [factory, setFactory] = useState('全部');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionGroupId, setSelectionGroupId] = useState<string | null>(null);
  const [mergeProducts, setMergeProducts] = useState<MergeHostProduct[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const loadGenRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setIsLoading(true);
    setScanPhase('counting');
    setScanLoaded(0);
    setScanTotal(null);
    try {
      const { count, error: countError } = await supabase
        .from('shopify_products')
        .select('id', { count: 'exact', head: true })
        .is('configurable', null);
      if (countError) throw countError;
      if (loadGenRef.current !== gen) return;
      const total = count ?? 0;
      setScanTotal(total);
      setScanPhase('fetching');

      const rows: MirrorRow[] = [];
      let from = 0;
      while (from < total || (total === 0 && from === 0)) {
        const { data, error } = await supabase
          .from('shopify_products')
          .select(LIST_SELECT)
          .is('configurable', null)
          .order('id', { ascending: true })
          .range(from, from + FETCH_PAGE - 1);
        if (error) throw error;
        if (loadGenRef.current !== gen) return;
        const pageRows = (data ?? []) as unknown as MirrorRow[];
        rows.push(...pageRows);
        setScanLoaded(Math.min(rows.length, total || rows.length));
        if (pageRows.length < FETCH_PAGE) break;
        from += FETCH_PAGE;
        if (total === 0) break;
      }
      if (loadGenRef.current !== gen) return;
      setScanLoaded(total || rows.length);
      setScanPhase('matching');
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (loadGenRef.current !== gen) return;
      setItems(rows.map(rowToItem).filter((row): row is SimilarItem => Boolean(row)));
    } catch (e) {
      if (loadGenRef.current !== gen) return;
      toast.error('讀取已上載產品失敗', {
        description: e instanceof Error ? e.message : String(e),
      });
      setItems([]);
    } finally {
      if (loadGenRef.current === gen) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () => findSimilarProductGroups(items, criteria),
    [items, criteria],
  );

  const factories = useMemo(() => {
    const set = new Set<string>();
    for (const group of groups) {
      for (const product of group.products) {
        if (product.factory && product.factory !== '—') set.add(product.factory);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [groups]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((group) => {
      if (factory !== '全部' && !group.products.some((p) => p.factory === factory)) return false;
      if (!q) return true;
      if (group.label.toLowerCase().includes(q)) return true;
      return group.products.some((p) =>
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.factory.toLowerCase().includes(q),
      );
    });
  }, [groups, search, factory]);

  const pageCount = Math.max(1, Math.ceil(visibleGroups.length / GROUPS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pagedGroups = visibleGroups.slice(
    (safePage - 1) * GROUPS_PER_PAGE,
    safePage * GROUPS_PER_PAGE,
  );
  const similarCount = visibleGroups.reduce((n, g) => n + g.products.length, 0);
  const scanPercent = scanPhase === 'matching'
    ? 100
    : scanTotal && scanTotal > 0
      ? Math.min(100, Math.round((scanLoaded / scanTotal) * 100))
      : 0;
  const scanLabel = scanPhase === 'counting'
    ? '正在計算產品數量…'
    : scanPhase === 'matching'
      ? `已讀取 ${scanLoaded.toLocaleString()} 件，正在比對相似產品…`
      : `正在掃描 ${scanLoaded.toLocaleString()} / ${(scanTotal ?? 0).toLocaleString()}`;

  const toggleCriterion = (key: SimilarProductCriterion, on: boolean) => {
    setCriteria((prev) => {
      const next = on ? [...new Set([...prev, key])] : prev.filter((c) => c !== key);
      return next;
    });
    setPage(1);
    setSelectedIds([]);
    setSelectionGroupId(null);
  };

  const toggleSelected = (groupId: string, productId: string, on: boolean) => {
    if (selectionGroupId && selectionGroupId !== groupId) {
      setSelectionGroupId(groupId);
      setSelectedIds(on ? [productId] : []);
      return;
    }
    setSelectionGroupId(groupId);
    setSelectedIds((prev) => {
      if (!on) return prev.filter((id) => id !== productId);
      if (prev.includes(productId)) return prev;
      return [...prev, productId];
    });
  };

  const openMerge = useCallback(async (ordered: SimilarItem[]) => {
    if (ordered.length < 2) {
      toast.message('請至少選擇 2 件產品合併（最先勾選的為主產品）');
      return;
    }
    const ids = ordered.map((p) => p.id);
    const { data, error } = await supabase
      .from('shopify_products')
      .select('id, images')
      .in('id', ids);
    if (error) {
      toast.error('讀取產品圖片失敗', { description: error.message });
      return;
    }
    const imagesById = new Map(
      (data ?? []).map((row) => [
        String((row as { id: string }).id),
        (row as { images?: MirrorRow['images'] }).images ?? null,
      ]),
    );
    setMergeProducts(ordered.map((p) => ({
      shopify_product_id: p.shopify_product_id,
      title: p.title,
      raw: { ...p.raw, images: imagesById.get(p.id) ?? p.raw.images ?? null },
    })));
    setMergeOpen(true);
  }, []);

  const mergeGroup = (group: SimilarProductGroup<SimilarItem>) => {
    const inGroup = selectionGroupId === group.id;
    const picked = inGroup
      ? selectedIds
          .map((id) => group.products.find((p) => p.id === id))
          .filter((p): p is SimilarItem => Boolean(p))
      : [];
    const ordered = picked.length >= 2 ? picked : group.products;
    void openMerge(ordered);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border px-4 md:px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="fds-page-title">整合相似</h1>
            <p className="fds-page-description">
              已上載產品裡，名稱與廠家相同、或 SKU 屬於同一產品碼的，會編成一組。合併後保留一件主產品，其餘變成它的規格。已合併的子產品不會再出現。
            </p>
          </div>
          <div className="font-mono-data text-[11px] text-muted-foreground">
            {isLoading
              ? scanLabel
              : `已掃描 ${items.length} 件 · ${visibleGroups.length} 組 · ${similarCount} 件待合併`}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
            <Checkbox
              checked={criteria.includes('name')}
              onCheckedChange={(v) => toggleCriterion('name', v === true)}
            />
            <span className="font-body text-xs">同名同廠</span>
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
            <Checkbox
              checked={criteria.includes('sku')}
              onCheckedChange={(v) => toggleCriterion('sku', v === true)}
            />
            <span className="font-body text-xs">同一產品碼</span>
          </label>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="搜尋名稱、SKU、廠家"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select
            value={factory}
            onValueChange={(value) => {
              setFactory(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[9rem] text-xs" aria-label="廠家">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="全部">全部廠家</SelectItem>
              {factories.filter((name) => name !== '全部').map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {criteria.length === 2 ? (
          <p className="mt-2 font-body text-[11px] text-muted-foreground">
            兩項都選時，一組必須同時符合：名稱與廠家相同，而且 SKU 是同一產品碼的變體。
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 md:px-6 py-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-md space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-body text-sm text-muted-foreground">{scanLabel}</span>
                <span className="font-mono-data text-xs text-muted-foreground">{scanPercent}%</span>
              </div>
              <Progress value={scanPercent} aria-label="掃描進度" />
            </div>
          </div>
        ) : criteria.length === 0 ? (
          <EmptyState
            title="請至少選擇一項相似準則"
            description="揀選廠家、分類或名稱關鍵字，再開始比對相似產品。"
          />
        ) : visibleGroups.length === 0 ? (
          <EmptyState
            title="找不到可合併的相似產品"
            description="放寬上方準則，或先在「產品管理」加入更多產品再試一次。"
          />
        ) : (
          <div className="space-y-3">
            {pagedGroups.map((group) => {
              const selectedHere = selectionGroupId === group.id ? selectedIds : [];
              const hostId = selectedHere[0];
              return (
                <section key={group.id} className="rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-body text-sm font-semibold">{group.label}</h2>
                        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 font-mono-data text-[10px] text-violet-700 dark:text-violet-300">
                          {group.products.length} 件
                        </span>
                        <span className="font-body text-[11px] text-muted-foreground">
                          {criterionLabel(group.criterion)}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => mergeGroup(group)}
                    >
                      <Combine className="h-3.5 w-3.5" />
                      {selectedHere.length >= 2 ? `合併所選 ${selectedHere.length} 件` : '合併此組'}
                    </Button>
                  </div>
                  <ul>
                    {group.products.map((product) => {
                      const checked = selectedHere.includes(product.id);
                      const isHost = hostId === product.id && selectedHere.length >= 1;
                      return (
                        <li
                          key={product.id}
                          className={cn(
                            'flex items-center gap-3 border-t border-border/70 px-3 py-2 first:border-t-0',
                            checked && 'bg-violet-500/5',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleSelected(group.id, product.id, v === true)}
                            aria-label={`選擇 ${product.title}`}
                          />
                          {product.imageUrl.startsWith('http') ? (
                            <LoadingImage
                              src={productThumbUrl(product.imageUrl, 96)}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-12 w-12 shrink-0 rounded-md bg-muted object-cover"
                            />
                          ) : (
                            <div className="h-12 w-12 shrink-0 rounded-md bg-muted" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-body text-sm">{product.title}</p>
                              {isHost ? (
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-body text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  主產品
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate font-mono-data text-[11px] text-muted-foreground">
                              {product.sku} · {product.factory}
                              {product.size ? ` · ${product.size}` : ''} · {fmtMoney(product.price)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {!isLoading && visibleGroups.length > GROUPS_PER_PAGE ? (
        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-2.5">
          <span className="font-mono-data text-[11px] text-muted-foreground">
            {safePage} / {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              上一頁
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={safePage >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              下一頁
            </Button>
          </div>
        </div>
      ) : null}

      <PublishedProductMergeModal
        products={mergeProducts}
        open={mergeOpen}
        onOpenChange={(open) => {
          setMergeOpen(open);
          if (!open) setMergeProducts([]);
        }}
        onMerged={() => {
          setSelectedIds([]);
          setSelectionGroupId(null);
          void load();
        }}
      />
    </div>
  );
}
