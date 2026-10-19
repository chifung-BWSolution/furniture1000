import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, ExternalLink, FileText, ImagePlus, Loader2, Package, RotateCcw, Ruler, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MultiColorSelector } from '@/components/dashboard/MultiColorSelector';
import { ProductImageGalleryLightbox } from '@/components/dashboard/ProductImageGallery';
import { autoMatchColor, getChineseColorLabel, getColorHex, multiColorToChineseDisplay } from '@/constants/color-map';
import { MATERIAL_TAG_RULES } from '@/constants/material-tags';
import { SourcePageDialog } from '@/components/dashboard/SourcePageDialog';
import type { SourcePageRequest } from '@/lib/sourcePage';
import { fetchEmbeddingStatus, searchByImage, startImageIndex, type EmbeddingStatus } from '@/lib/imageSearch';
import {
  EMPTY_SEARCH_FILTERS,
  VALIDITY_LABELS,
  fetchProductDetail,
  fetchSearchFacets,
  moneyLabel,
  searchProducts,
  sizeLabel,
  type PriceValidity,
  type ProductDetail,
  type SearchFacets,
  type SearchFilters,
  type SearchProduct,
  type SearchResult,
  type SearchScope,
  type SearchSort,
} from '@/lib/productSearch';

const PAGE_SIZE = 24;
const ALL = '__all';

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: 'all', label: '全部產品' },
  { id: 'catalog', label: '產品目錄' },
  { id: 'shopify', label: '已上架' },
  { id: 'quoted', label: '有供應商報價' },
];

const SORTS: { id: SearchSort; label: string }[] = [
  { id: 'relevance', label: '相關度' },
  { id: 'newest', label: '最新' },
  { id: 'price_asc', label: '價錢 低→高' },
  { id: 'price_desc', label: '價錢 高→低' },
  { id: 'size', label: '尺寸（長）' },
];

const VALIDITY_CLASS: Record<PriceValidity, string> = {
  valid: 'border-emerald-500/40 text-emerald-700',
  expired: 'border-destructive/40 text-destructive',
  future: 'border-sky-500/40 text-sky-700',
  unmarked: 'border-border text-muted-foreground',
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function activeFilterCount(f: SearchFilters): number {
  return [
    f.factory, f.level1, f.level2, f.priceMin, f.priceMax,
    f.lMin, f.lMax, f.wMin, f.wMax, f.hMin, f.hMax,
  ].filter(Boolean).length
    + f.colors.length
    + f.materialTags.length
    + (f.inStock ? 1 : 0)
    + (f.scope !== 'all' ? 1 : 0);
}

export function FurnitureSearchView() {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sourcePage, setSourcePage] = useState<(SourcePageRequest & { title?: string | null }) | null>(null);
  const [imageHits, setImageHits] = useState<SearchProduct[] | null>(null);
  const [imageIndexed, setImageIndexed] = useState<number | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<EmbeddingStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const closeDetail = useCallback(() => setDetailId(null), []);
  const debounced = useDebounced(filters, 300);
  const patch = useCallback((next: Partial<SearchFilters>) => {
    setFilters((cur) => ({ ...cur, ...next }));
    setPage(0);
  }, []);

  useEffect(() => {
    fetchSearchFacets().then(setFacets).catch((err) => {
      toast.error('讀取篩選選項失敗', { description: errorText(err) });
    });
    fetchEmbeddingStatus().then(setIndexStatus).catch(() => setIndexStatus(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const started = performance.now();
    searchProducts(debounced, page, PAGE_SIZE)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setElapsedMs(Math.round(performance.now() - started));
      })
      .catch((err) => {
        if (!cancelled) toast.error('搜索失敗', { description: errorText(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, page]);

  const level1Options = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of facets?.categories ?? []) map.set(c.level1, (map.get(c.level1) ?? 0) + c.count);
    return [...map.entries()].map(([name, count]) => ({ name, count }));
  }, [facets]);

  const level2Options = useMemo(
    () => (facets?.categories ?? []).filter((c) => c.level1 === filters.level1 && c.level2),
    [facets, filters.level1],
  );

  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterCount = activeFilterCount(filters);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="搜尋名稱、型號、SKU、廠家、顏色、材質（例：梳化 墨綠、M-123）"
            className="pl-8"
          />
        </div>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setImageLoading(true);
            searchByImage(file, filters)
              .then((res) => {
                setImageHits(res.items);
                setImageIndexed(res.indexed);
              })
              .catch((err) => toast.error('以圖搜款失敗', { description: errorText(err) }))
              .finally(() => setImageLoading(false));
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={imageLoading}
          onClick={() => imageInputRef.current?.click()}
        >
          {imageLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
          以圖搜款
        </Button>
        {imageHits && (
          <Button size="sm" variant="ghost" onClick={() => { setImageHits(null); setImageIndexed(null); }}>
            返回文字搜尋
          </Button>
        )}
        {indexStatus?.can_index && (
          <Button
            size="sm"
            variant="outline"
            disabled={indexing}
            onClick={() => {
              setIndexing(true);
              startImageIndex()
                .then((res) => {
                  toast.success(res.remaining ? `已索引 ${res.indexed} 件，還有未索引的產品` : `已索引 ${res.indexed} 件`);
                  return fetchEmbeddingStatus().then(setIndexStatus);
                })
                .catch((err) => toast.error('索引失敗', { description: errorText(err) }))
                .finally(() => setIndexing(false));
            }}
          >
            {indexing ? '索引中…' : `索引圖片${indexStatus.indexed ? ` (${indexStatus.indexed})` : ''}`}
          </Button>
        )}
        <Select value={filters.sort} onValueChange={(v) => patch({ sort: v as SearchSort })}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SCOPES.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={filters.scope === s.id ? 'default' : 'outline'}
            className="h-8"
            onClick={() => patch({ scope: s.id })}
          >
            {s.label}
          </Button>
        ))}

        <Select
          value={filters.factory || ALL}
          onValueChange={(v) => patch({ factory: v === ALL ? '' : v })}
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="廠家" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部廠家</SelectItem>
            {(facets?.factories ?? []).map((f) => (
              <SelectItem key={f.name} value={f.name}>
                {f.name} ({f.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.level1 || ALL}
          onValueChange={(v) => patch({ level1: v === ALL ? '' : v, level2: '' })}
        >
          <SelectTrigger className="h-8 w-36">
            <SelectValue placeholder="產品類型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部類型</SelectItem>
            {level1Options.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.name} ({c.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {level2Options.length > 0 && (
          <Select
            value={filters.level2 || ALL}
            onValueChange={(v) => patch({ level2: v === ALL ? '' : v })}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder="子類別" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部子類別</SelectItem>
              {level2Options.map((c) => (
                <SelectItem key={c.level2!} value={c.level2!}>
                  {c.level2} ({c.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="w-48">
          <MultiColorSelector
            value={filters.colors.join(',')}
            onChange={(v) => patch({ colors: v ? v.split(',').filter(Boolean) : [] })}
            placeholder="顏色（可多選）"
            className="[&>button]:min-h-8 [&>button]:py-1"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8">
              材質{filters.materialTags.length > 0 && ` (${filters.materialTags.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="flex flex-wrap gap-1.5">
              {MATERIAL_TAG_RULES.map((rule) => {
                const on = filters.materialTags.includes(rule.tag);
                return (
                  <button
                    key={rule.tag}
                    type="button"
                    onClick={() =>
                      patch({
                        materialTags: on
                          ? filters.materialTags.filter((t) => t !== rule.tag)
                          : [...filters.materialTags, rule.tag],
                      })
                    }
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                    )}
                  >
                    {rule.tag}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8">
              <Ruler className="mr-1 h-3.5 w-3.5" /> 尺寸／價錢
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3" align="start">
            {([
              ['長 L (mm)', 'lMin', 'lMax'],
              ['闊 W (mm)', 'wMin', 'wMax'],
              ['高 H (mm)', 'hMin', 'hMax'],
              ['折扣價', 'priceMin', 'priceMax'],
            ] as const).map(([label, minKey, maxKey]) => (
              <div key={label} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    inputMode="decimal"
                    value={filters[minKey]}
                    onChange={(e) => patch({ [minKey]: e.target.value })}
                    placeholder="最小"
                    className="h-8"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    inputMode="decimal"
                    value={filters[maxKey]}
                    onChange={(e) => patch({ [maxKey]: e.target.value })}
                    placeholder="最大"
                    className="h-8"
                  />
                </div>
              </div>
            ))}
          </PopoverContent>
        </Popover>

        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={filters.inStock} onCheckedChange={(v) => patch({ inStock: v === true })} />
          只看現貨
        </label>

        {filterCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setFilters({ ...EMPTY_SEARCH_FILTERS, query: filters.query, sort: filters.sort });
              setPage(0);
            }}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> 清除篩選
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {imageHits
            ? imageIndexed === 0
              ? '圖片索引還是空的，請先由管理員索引產品圖'
              : `相似款 ${imageHits.length} 件（相似度不是同一款）`
            : loading
              ? '搜尋中…'
              : `共 ${total.toLocaleString()} 件產品`}
          {!imageHits && !loading && elapsedMs != null && ` · ${(elapsedMs / 1000).toFixed(2)} 秒`}
        </span>
        <span>折扣價為售價 × 0.8，其後為原價</span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {imageLoading ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 對照產品圖…
          </div>
        ) : imageHits ? (
          imageHits.length === 0 ? (
            <div className="py-24 text-center text-sm text-muted-foreground">沒有相近的產品</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
              {imageHits.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onOpen={() => setDetailId(p.id)}
                  onOpenSource={setSourcePage}
                />
              ))}
            </div>
          )
        ) : loading && !result ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
          </div>
        ) : (result?.items.length ?? 0) === 0 ? (
          <div className="py-24 text-center text-sm text-muted-foreground">沒有符合條件的產品</div>
        ) : (
          <div
            className={cn(
              'grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4',
              loading && 'opacity-60',
            )}
          >
            {result!.items.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onOpen={() => setDetailId(p.id)}
                onOpenSource={setSourcePage}
              />
            ))}
          </div>
        )}
      </div>

      {!imageHits && pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button size="icon" variant="outline" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular-nums">
            {page + 1} / {pageCount}
          </span>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {detailId && (
        <ProductDetailDialog productId={detailId} onClose={closeDetail} onOpenSource={setSourcePage} />
      )}
      {sourcePage && <SourcePageDialog request={sourcePage} onClose={() => setSourcePage(null)} />}
    </div>
  );
}

function splitTitle(title: string): { primary: string; secondary: string | null } {
  const match = title.match(/^(.*[\u3400-\u9fff])\s+([A-Za-z0-9][\w .,&/'’\-]*[A-Za-z])\s*$/);
  if (!match) return { primary: title, secondary: null };
  const secondary = match[2].trim();
  if (secondary.length < 3) return { primary: title, secondary: null };
  return { primary: match[1].trim(), secondary };
}

function materialLine(material: string | undefined): string | null {
  if (!material) return null;
  const line = material
    .split(/\n|；|;/)
    .map((part) => part.trim())
    .find(Boolean);
  return line || null;
}

function colorSwatches(color: string | undefined): { key: string; hex: string; label: string }[] {
  if (!color) return [];
  const seen = new Set<string>();
  const swatches: { key: string; hex: string; label: string }[] = [];
  for (const part of color.split(/[,，/|、]/)) {
    const raw = part.trim();
    if (!raw) continue;
    const en = autoMatchColor(raw);
    if (!en) continue;
    const key = en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    swatches.push({ key, hex: getColorHex(en), label: getChineseColorLabel(en) });
    if (swatches.length >= 6) break;
  }
  return swatches;
}

function galleryUrls(product: SearchProduct): string[] {
  const listed = (product.image_urls ?? []).filter((url) => /^https?:\/\//i.test(url));
  if (listed.length > 0) return listed;
  return product.image_url && /^https?:\/\//i.test(product.image_url) ? [product.image_url] : [];
}

function PriceLockup({
  discount,
  original,
  size = 'card',
}: {
  discount?: number;
  original?: number;
  size?: 'card' | 'detail';
}) {
  const discountText = moneyLabel(discount, 'HK$');
  const originalText = moneyLabel(original, 'HK$');
  if (!discountText && !originalText) {
    return <span className="text-sm font-normal text-muted-foreground">未定價</span>;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span
        className={cn(
          'font-semibold tabular-nums tracking-tight text-foreground',
          size === 'detail' ? 'text-2xl' : 'text-base',
        )}
      >
        {discountText ?? originalText}
      </span>
      {discountText && originalText ? (
        <span className="text-xs tabular-nums text-muted-foreground line-through decoration-current/70">
          {originalText}
        </span>
      ) : null}
    </div>
  );
}

function ProductCard({
  product: p,
  onOpen,
  onOpenSource,
}: {
  product: SearchProduct;
  onOpen: () => void;
  onOpenSource: (request: SourcePageRequest & { title?: string | null }) => void;
}) {
  const size = sizeLabel(p);
  const { primary, secondary } = splitTitle(p.title);
  const feature = materialLine(p.material);
  const swatches = colorSwatches(p.color);
  const photos = galleryUrls(p);
  const thumbs = photos.slice(1, 5);
  const extraThumbs = Math.max(0, photos.length - 1 - thumbs.length);
  const quoteState = p.quote && p.quote.validity !== 'valid' ? p.quote.validity : null;
  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-shadow hover:shadow-md">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left">
        <div className="relative h-28 w-full shrink-0 overflow-hidden bg-muted">
          {photos[0] ? (
            <LoadingImage
              src={productThumbUrl(photos[0], 640)}
              alt={primary}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-8 w-8 text-muted-foreground/40" />
            </div>
          )}
          <div className="absolute left-3 top-3 flex flex-wrap gap-1">
            {p.in_stock && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">現貨</span>
            )}
            {p.exact && (
              <span className="rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-foreground">型號命中</span>
            )}
            {p.relation === 'similar' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                相似款{typeof p.similarity === 'number' ? ` ${Math.round(p.similarity * 100)}%` : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1 p-2.5">
          <div>
            <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{primary}</div>
            {secondary && <div className="line-clamp-1 text-xs text-muted-foreground">{secondary}</div>}
          </div>
          {(p.model || p.factory_name) && (
            <div className="truncate text-xs text-muted-foreground">
              {p.model && <span className="font-mono">{p.model}</span>}
              {p.model && p.factory_name && <span> | </span>}
              {p.factory_name && <span>{p.factory_name}</span>}
            </div>
          )}
          {feature && <div className="line-clamp-1 text-xs text-muted-foreground">{feature}</div>}
          {thumbs.length > 0 && (
            <div className="flex gap-1.5">
              {thumbs.map((url, index) => {
                const more = index === thumbs.length - 1 ? extraThumbs : 0;
                return (
                  <div key={url} className="relative h-9 w-9 overflow-hidden rounded-md bg-muted">
                    <LoadingImage
                      src={productThumbUrl(url, 96)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    {more > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-medium text-white">
                        +{more}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {swatches.length > 0 && (
            <div className="flex items-center gap-1.5">
              {swatches.map((swatch) => (
                <span
                  key={swatch.key}
                  title={swatch.label}
                  className="h-4 w-4 rounded-full ring-1 ring-inset ring-black/15"
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
            </div>
          )}
          {(size || p.in_stock) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {size && (
                <span className="inline-flex items-center gap-1">
                  <Ruler className="h-3.5 w-3.5" />
                  {size} mm
                </span>
              )}
              {p.in_stock && (
                <span className="inline-flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" />
                  現貨
                </span>
              )}
            </div>
          )}
          <div className="mt-auto flex items-end justify-between gap-2 pt-1">
            <PriceLockup discount={p.middle_price} original={p.sale_price} />
            {quoteState && (
              <Badge variant="outline" className={cn('shrink-0 px-1.5 py-0 text-[10px] font-normal', VALIDITY_CLASS[quoteState])}>
                {VALIDITY_LABELS[quoteState]}
              </Badge>
            )}
          </div>
        </div>
      </button>
      {p.source && (
        <button
          type="button"
          className="flex items-center gap-1 truncate border-t border-border px-3 py-1.5 text-left text-[11px] text-primary hover:bg-muted/40"
          onClick={() => onOpenSource({
            documentId: p.source!.document_id,
            pageNo: p.source!.page_no,
            productId: p.id,
            title: p.source!.title,
          })}
        >
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {p.source.title ?? '供應商文件'}
            {p.source.page_no != null && ` · 第 ${p.source.page_no} 頁`}
          </span>
          {(p.quote?.count ?? 0) > 1 && <span className="shrink-0 text-muted-foreground">· {p.quote!.count} 個報價</span>}
        </button>
      )}
    </div>
  );
}

function ProductDetailDialog({
  productId,
  onClose,
  onOpenSource,
}: {
  productId: string;
  onClose: () => void;
  onOpenSource: (request: SourcePageRequest & { title?: string | null }) => void;
}) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const closeZoom = useCallback(() => setZoomed(false), []);

  useEffect(() => {
    let cancelled = false;
    fetchProductDetail(productId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        toast.error('讀取產品失敗', { description: errorText(err) });
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [productId, onClose]);

  const specs: [string, string | null | undefined][] = detail
    ? [
        ['型號', detail.model],
        ['SKU', detail.sku],
        ['廠家', detail.factory_name],
        ['類別', [detail.level1_category, detail.level2_category].filter(Boolean).join(' / ') || detail.category],
        ['尺寸 (mm)', sizeLabel(detail)],
        ['材質', detail.material],
        ['顏色', detail.color ? multiColorToChineseDisplay(detail.color) : null],
        ['交期', detail.lead_time],
        ['現貨', detail.in_stock ? '是' : null],
      ].filter(([, v]) => v) as [string, string | null | undefined][]
    : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] max-w-4xl overflow-y-auto"
        onInteractOutside={(event) => zoomed && event.preventDefault()}
        onEscapeKeyDown={(event) => zoomed && event.preventDefault()}
      >
        {!detail ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{detail.title}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <div className="h-64 overflow-hidden rounded-lg bg-white">
                  {detail.images.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setZoomed(true)}
                      className="h-full w-full cursor-zoom-in"
                      title="點擊放大圖片"
                      aria-label="放大圖片"
                    >
                      <LoadingImage src={detail.images[activeImage]} alt={detail.title} className="h-full w-full object-contain" />
                    </button>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Package className="h-10 w-10 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                {detail.images.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.images.map((src, i) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setActiveImage(i)}
                        className={cn(
                          'h-14 w-14 overflow-hidden rounded border-2',
                          i === activeImage ? 'border-primary' : 'border-transparent',
                        )}
                      >
                        <LoadingImage src={productThumbUrl(src)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3 text-sm">
                <PriceLockup discount={detail.middle_price} original={detail.sale_price} size="detail" />
                <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
                  {specs.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {detail.specifications && (
                  <p className="whitespace-pre-line text-xs text-muted-foreground">{detail.specifications}</p>
                )}
                {detail.description && (
                  <p className="line-clamp-6 whitespace-pre-line text-xs text-muted-foreground">{detail.description}</p>
                )}
              </div>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">供應商報價</h3>
              {detail.prices.length === 0 ? (
                <p className="text-xs text-muted-foreground">未有經審核的供應商報價。</p>
              ) : (
                <div className="overflow-x-auto rounded border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">規格</th>
                        <th className="px-2 py-1.5 text-left font-medium">廠家</th>
                        <th className="px-2 py-1.5 text-left font-medium">單位／MOQ</th>
                        <th className="px-2 py-1.5 text-left font-medium">有效期</th>
                        <th className="px-2 py-1.5 text-left font-medium">來源</th>
                        <th className="px-2 py-1.5 text-left font-medium">匯入日期</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.prices.map((row) => (
                        <tr key={row.id} className="border-t border-border/60">
                          <td className="px-2 py-1.5">{row.variant_label ?? '標準'}</td>
                          <td className="px-2 py-1.5">{row.factory_name ?? '—'}</td>
                          <td className="px-2 py-1.5">
                            {[row.unit, row.moq != null ? `MOQ ${row.moq}` : null].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px] font-normal', VALIDITY_CLASS[row.validity])}>
                              {VALIDITY_LABELS[row.validity]}
                            </Badge>
                            {(row.valid_from || row.valid_to) && (
                              <div className="mt-0.5 text-muted-foreground">
                                {row.valid_from ?? '…'} – {row.valid_to ?? '…'}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <SourceLink
                              title={row.document_title}
                              page={row.page_no}
                              documentId={row.document_id}
                              productId={detail.id}
                              onOpen={onOpenSource}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">{row.created_at.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {detail.sources.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-sm font-medium">原始文件</h3>
                <ul className="space-y-1 text-xs">
                  {detail.sources.map((s) => (
                    <li key={`${s.document_id}-${s.page_no}`} className="flex items-center gap-2">
                      <span className="text-muted-foreground">{s.doc_type === 'catalog' ? '目錄' : '報價單'}</span>
                      <SourceLink
                        title={s.title}
                        page={s.page_no}
                        documentId={s.document_id}
                        productId={detail.id}
                        onOpen={onOpenSource}
                      />
                      {s.factory_name && <span className="text-muted-foreground">· {s.factory_name}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </DialogContent>
      {zoomed && detail && detail.images.length > 0
        ? createPortal(
            <div className="pointer-events-auto">
              <ProductImageGalleryLightbox
                urls={detail.images}
                title={detail.title}
                startIndex={activeImage}
                onClose={closeZoom}
              />
            </div>,
            document.body,
          )
        : null}
    </Dialog>
  );
}

function SourceLink({
  title,
  page,
  documentId,
  productId,
  onOpen,
}: {
  title?: string | null;
  page?: number | null;
  documentId?: string;
  productId: string;
  onOpen: (request: SourcePageRequest & { title?: string | null }) => void;
}) {
  const label = `${title ?? '供應商文件'}${page != null ? ` · 第 ${page} 頁` : ''}`;
  if (!documentId) return <span className="text-muted-foreground">{label}</span>;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
      onClick={() => onOpen({ documentId, pageNo: page, productId, title })}
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}
