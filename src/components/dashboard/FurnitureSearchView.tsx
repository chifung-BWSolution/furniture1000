import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { confirm } from '@/components/ui/confirm-dialog';
import {
  ChevronDown, ChevronLeft, ChevronRight, Box, Check, ExternalLink, FileText, ImagePlus, Loader2, Package, PackageSearch, RotateCcw, Ruler, Search, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import { CompactEmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal, ModalButton, ModalContent, ModalRoot } from '@/components/ui/modal';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiColorSelector } from '@/components/dashboard/MultiColorSelector';
import { ProductImageGalleryLightbox } from '@/components/dashboard/ProductImageGallery';
import { autoMatchColor, getChineseColorLabel, getColorHex, multiColorToChineseDisplay } from '@/constants/color-map';
import { MATERIAL_TAG_RULES } from '@/constants/material-tags';
import { DESIGNER_TYPES_PATH, buildDesignerProductPath, designerProductIdFromPath } from '@/lib/appSectionRoutes';
import { SourcePageDialog } from '@/components/dashboard/SourcePageDialog';
import type { SourcePageRequest } from '@/lib/sourcePage';
import { fetchEmbeddingStatus, searchByImage, startImageIndex, type EmbeddingStatus } from '@/lib/imageSearch';
import { supabase } from '@/lib/supabase';
import { invokeEdgeFunctionDirect } from '@/lib/invokeEdgeFunction';
import { buildFurnitureGlb } from '@/lib/furnitureGlb';
import { buildFurnitureFbx } from '@/lib/furnitureFbx';
import { ProductWorkbench } from '@/components/dashboard/ProductWorkbench';
import { ProductModelPreviewModal } from '@/components/dashboard/ProductModelPreviewModal';
import { StructureConfirmForm, type StructureDraft } from '@/components/dashboard/StructureConfirmDialog';
import { ModelEvidencePanel } from '@/components/dashboard/ModelEvidencePanel';
import { PartSuggestionPanel } from '@/components/dashboard/PartSuggestionPanel';
import { FurnitureModelReviewDialog } from '@/components/dashboard/FurnitureModelReviewDialog';
import type { DimensionEstimate } from '@/lib/dimensionConflicts';
import { applyKeyDimensions, deriveKeyDimensions } from '@/lib/furnitureKeyDimensions';
import {
  OVERALL_KEYS,
  buildEvidence,
  enterManual,
  estimatedOverallAxes,
  findDimension,
  generationBlockers,
  labelledDimensionsFrom,
  pinnedKeyValues,
  refreshKeyDimensions,
  valueOf,
  setModelOverall,
  withStatuses,
  type EvidenceInput,
  type ModelEvidence,
} from '@/lib/modelEvidence';
import { applyPartChanges, diffParts, ensurePartIds, type PartChange } from '@/lib/partSuggestions';
import {
  QUALITY_LABEL,
  fetchFurnitureModelDetail,
  fetchFurnitureModelVersions,
  saveFurnitureModel,
  type FurnitureModelVersion,
} from '@/lib/furnitureModelVersions';
import { useSkpRequirements } from '@/components/dashboard/SkpRequirementsDialog';
import { FurnitureProductScopeDialog, type ProductCountDetection, type ProductScopeChoice } from '@/components/dashboard/FurnitureProductScopeDialog';
import { hasStructureEvidence, selectFurnitureGeometry, validateFurnitureStructure, type StructureEvidence } from '@/lib/furnitureStructure';
import {
  buildParametric,
  customPartsSize,
  fitCustomPartsWithConstraints,
  inferFurnitureKindFrom,
  initialModelStyle,
  inferShelfTiers,
  resolveStyle,
  sanitizeCustomParts,
  type CustomPartSpec,
  type FurnitureKind,
  type ModelStyle,
  type ParametricModel,
  type SizeAxis,
} from '@/lib/furnitureParametric';
import {
  deleteProductModel,
  downloadModel,
  fetchModelFlags,
  fetchProductModels,
  fetchSkpStatus,
  registerGeneratedFile,
  requestSkp,
  uploadProductModel,
  type ModelFlags,
  type ModelFormatFlags,
  type ProductModelFile,
  type SkpStatus,
} from '@/lib/productModels';
import {
  EMPTY_SEARCH_FILTERS,
  VALIDITY_LABELS,
  fetchProductDetail,
  fetchSearchFacets,
  fetchSupplierCompare,
  mergeDuplicateProduct,
  moneyLabel,
  resolveSupplierPriceConflict,
  searchProducts,
  sizeLabel,
  type PriceValidity,
  type ProductDetail,
  type SearchFacets,
  type SupplierCompare,
  type SearchFilters,
  type SearchProduct,
  type SearchResult,
  type SearchScope,
  type SearchSort,
} from '@/lib/productSearch';

/** Card floor that yields 6 columns at a 1920 screen with the sidebar open. */
const CARD_MIN_PX = 240;
const GRID_GAP_PX = 16;
const ROWS_PER_PAGE = 4;
const PRODUCT_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4';
const ALL = '__all';

function columnsForWidth(width: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + GRID_GAP_PX) / (CARD_MIN_PX + GRID_GAP_PX)));
}

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: 'all', label: '全部產品' },
  { id: 'catalog', label: '圖冊' },
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

/** 常用傢俬的排序＝報價用量口徑，不是相關度。 */
const COMMON_SORTS: { id: SearchSort; label: string }[] = [
  { id: 'popular_demand', label: 'PMS 熱度' },
  { id: 'popular_quotes', label: '用得多' },
  { id: 'popular_quantity', label: '件數多' },
  { id: 'popular_amount', label: '金額高' },
];

const VALIDITY_CLASS: Record<PriceValidity, string> = {
  valid: 'border-emerald-500/40 text-emerald-700',
  expired: 'border-destructive/40 text-destructive',
  future: 'border-sky-500/40 text-sky-700',
  unmarked: 'border-border text-muted-foreground',
};

function modelSizeLabel(bytes: number | null): string {
  if (bytes == null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** One row per format and origin. Regenerating keeps older files; the menu shows the newest. */
function latestModelFiles(files: ProductModelFile[]): ProductModelFile[] {
  const seen = new Set<string>();
  return [...files]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .filter((file) => {
      const key = `${file.format}:${file.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function modelSourceLabel(source: ProductModelFile['source']): string {
  return source === 'uploaded' ? '上載' : 'AI 生成';
}

/** 最新的 SKP 檔（沒有則 null）。 */
function latestSkpFile(files: ProductModelFile[] | null): ProductModelFile | null {
  if (!files) return null;
  return (
    [...files]
      .filter((file) => file.format === 'skp')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0] ?? null
  );
}

/** 最新的 FBX 檔（沒有則 null）。GLB 不算，GLB 只是預覽中間檔。 */
function latestFbxFile(files: ProductModelFile[] | null): ProductModelFile | null {
  if (!files) return null;
  return (
    [...files]
      .filter((file) => file.format === 'fbx')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0] ?? null
  );
}

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

const NEW_PRODUCT_MS = 14 * 24 * 60 * 60 * 1000;
const DAY_WINDOWS = [7, 30, 90] as const;

export type DesignerBrowseMode = 'browse' | 'latest' | 'common';

function isNewProduct(createdAt: string | undefined): boolean {
  if (!createdAt) return false;
  const time = new Date(createdAt).getTime();
  return Number.isFinite(time) && Date.now() - time <= NEW_PRODUCT_MS;
}

export function FurnitureSearchView({
  mode = 'browse',
  documentId = null,
}: {
  mode?: DesignerBrowseMode;
  /** Limit the grid to products linked from one supplier PDF. */
  documentId?: string | null;
}) {
  const [filters, setFilters] = useState<SearchFilters>(() => ({
    ...EMPTY_SEARCH_FILTERS,
    sort:
      mode === 'latest' ? 'newest'
      : mode === 'common' ? 'popular_demand'
      : EMPTY_SEARCH_FILTERS.sort,
  }));
  const [sinceDays, setSinceDays] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const routeDetail = mode === 'browse' && !documentId;
  const [localDetailId, setLocalDetailId] = useState<string | null>(null);
  const detailId = routeDetail ? designerProductIdFromPath(location.pathname) : localDetailId;
  const [sourcePage, setSourcePage] = useState<(SourcePageRequest & { title?: string | null }) | null>(null);
  const [imageHits, setImageHits] = useState<SearchProduct[] | null>(null);
  const [imageIndexed, setImageIndexed] = useState<number | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  /** The uploaded picture stays put so a filter change can re-run the image search. */
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [indexStatus, setIndexStatus] = useState<EmbeddingStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(() =>
    typeof window === 'undefined' ? 6 : columnsForWidth(Math.max(0, window.innerWidth - 292)),
  );
  const pageSize = columns * ROWS_PER_PAGE;

  const closeDetail = useCallback(() => {
    if (routeDetail) navigate(DESIGNER_TYPES_PATH);
    else setLocalDetailId(null);
  }, [navigate, routeDetail]);
  const openDetail = useCallback((productId: string) => {
    if (routeDetail) navigate(buildDesignerProductPath(productId));
    else setLocalDetailId(productId);
  }, [navigate, routeDetail]);
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
    // Image mode owns the list; the text search would only waste a round trip.
    if (imageFile) return;
    let cancelled = false;
    setLoading(true);
    const started = performance.now();
    searchProducts(debounced, page, pageSize, {
      sinceDays: mode === 'latest' ? sinceDays : null,
      commonOnly: mode === 'common',
      documentId,
    })
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
  }, [debounced, page, pageSize, imageFile, mode, sinceDays, documentId]);

  // Any filter change re-runs the image search with the same picture.
  useEffect(() => {
    if (!imageFile) return;
    let cancelled = false;
    setImageLoading(true);
    searchByImage(imageFile, debounced)
      .then((res) => {
        if (cancelled) return;
        setImageHits(res.items);
        setImageIndexed(res.indexed);
      })
      .catch((err) => {
        if (cancelled) return;
        // Stop the spinner and leave an empty list; the toast carries the reason.
        setImageHits([]);
        toast.error('以圖搜款失敗', { description: errorText(err) });
      })
      .finally(() => {
        if (!cancelled) setImageLoading(false);
      });
    return () => {
      cancelled = true;
      // Leaving image mode must not leave the spinner running.
      setImageLoading(false);
    };
  }, [imageFile, debounced]);

  useEffect(() => {
    // Detail replaces this tree, so the grid node unmounts. Re-bind when the
    // list is on screen again; a detached node reports width 0 and must not
    // shrink the page to one column (ROWS_PER_PAGE products).
    if (detailId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const apply = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const next = columnsForWidth(width);
      setColumns((cur) => (cur === next ? cur : next));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [detailId]);

  const [modelFlags, setModelFlags] = useState<ModelFlags>({});
  const [modelFlagsKey, setModelFlagsKey] = useState(0);
  const visibleIds = useMemo(
    () => (imageHits ?? result?.items ?? []).map((p) => p.id).join(','),
    [imageHits, result],
  );
  useEffect(() => {
    if (!visibleIds) return;
    let cancelled = false;
    fetchModelFlags(visibleIds.split(','))
      .then((flags) => {
        if (!cancelled) setModelFlags(flags);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visibleIds, modelFlagsKey]);

  const seenColumns = useRef(columns);
  useEffect(() => {
    if (seenColumns.current === columns) return;
    seenColumns.current = columns;
    setPage(0);
  }, [columns]);

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
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const filterCount = activeFilterCount(filters);
  const allowImageSearch = mode === 'browse' && !documentId;

  if (detailId) {
    return (
      <>
        <ProductDetailPage
          productId={detailId}
          onClose={closeDetail}
          onOpenProduct={openDetail}
          onOpenSource={setSourcePage}
          onModelsChanged={() => setModelFlagsKey((n) => n + 1)}
        />
        {sourcePage && <SourcePageDialog request={sourcePage} onClose={() => setSourcePage(null)} />}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-5 md:px-6">
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
        {allowImageSearch && (
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            // The effect above runs the search; a later filter change reuses it.
            setImageFile(file);
          }}
        />
        )}
        {allowImageSearch && (
        <Button
          size="sm"
          variant="outline"
          disabled={imageLoading}
          onClick={() => imageInputRef.current?.click()}
        >
          {imageLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
          以圖搜款
        </Button>
        )}
        {allowImageSearch && imageFile && (
          <Button size="sm" variant="ghost" onClick={() => { setImageFile(null); setImageHits(null); setImageIndexed(null); }}>
            返回文字搜尋
          </Button>
        )}
        {allowImageSearch && indexStatus?.can_index && (
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
            {(mode === 'common' ? COMMON_SORTS : SORTS).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === 'latest' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">上架時間</span>
          <Button
            size="sm"
            variant={sinceDays == null ? 'default' : 'outline'}
            className="h-8"
            onClick={() => { setSinceDays(null); setPage(0); }}
          >
            全部
          </Button>
          {DAY_WINDOWS.map((days) => (
            <Button
              key={days}
              size="sm"
              variant={sinceDays === days ? 'default' : 'outline'}
              className="h-8"
              onClick={() => { setSinceDays(days); setPage(0); }}
            >
              最近 {days} 天
            </Button>
          ))}
          <span className="text-xs text-muted-foreground">14 天內上架會標「新」</span>
        </div>
      )}
      {mode === 'common' && (
        <p className="text-xs text-muted-foreground">
          先按 PMS 真實落單的類別熱度排，同類內再按傢俬報價單的實際用量排（只計最新版本，撇除回收桶）。全公司共用。
        </p>
      )}

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
          {imageFile
            ? imageLoading
              ? '以圖搜款中…'
              : imageIndexed === 0
                ? '圖片索引還是空的，請先由管理員索引產品圖'
                : `相似款 ${imageHits?.length ?? 0} 件（相似度不是同一款）`
            : loading
              ? '搜尋中…'
              : `共 ${total.toLocaleString()} 件產品`}
          {!imageFile && !loading && elapsedMs != null && ` · ${(elapsedMs / 1000).toFixed(2)} 秒`}
        </span>
        <span>折扣價為售價 × 0.8，其後為原價</span>
      </div>

      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {(imageLoading || (imageFile && !imageHits)) ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 對照產品圖…
          </div>
        ) : imageHits ? (
          imageHits.length === 0 ? (
            <div className="py-24 text-center text-sm text-muted-foreground">沒有相近的產品</div>
          ) : (
            <div className={PRODUCT_GRID_CLASS}>
              {imageHits.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  models={modelFlags[p.id]}
                  showNew={mode === 'latest'}
                  onOpen={() => openDetail(p.id)}
                  onOpenSource={setSourcePage}
                  canOpenSource={false}
                />
              ))}
            </div>
          )
        ) : loading && !result ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
          </div>
        ) : (result?.items.length ?? 0) === 0 ? (
          <CompactEmptyState
            icon={PackageSearch}
            title={
              mode === 'common' && filters.sort !== 'popular_demand' && !filters.query && filterCount === 0
                ? '未有報價用量記錄。'
                : '沒有符合條件的產品'
            }
            className="py-16"
          />
        ) : (
          <div
            className={cn(
              PRODUCT_GRID_CLASS,
              loading && 'opacity-60',
            )}
          >
            {result!.items.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                models={modelFlags[p.id]}
                showNew={mode === 'latest'}
                onOpen={() => openDetail(p.id)}
                onOpenSource={setSourcePage}
                canOpenSource={result?.can_open_source === true}
              />
            ))}
          </div>
        )}
      </div>

      {!imageFile && pageCount > 1 && (
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
  models,
  showNew,
  onOpen,
  onOpenSource,
  canOpenSource,
}: {
  product: SearchProduct;
  models?: ModelFormatFlags;
  showNew?: boolean;
  onOpen: () => void;
  onOpenSource: (request: SourcePageRequest & { title?: string | null }) => void;
  /** Private supplier PDF: only admin / uploader may open it. */
  canOpenSource: boolean;
}) {
  const size = sizeLabel(p);
  const { primary, secondary } = splitTitle(p.title);
  const feature = materialLine(p.material);
  const swatches = colorSwatches(p.color);
  const photos = galleryUrls(p);
  const thumbs = photos.slice(1, 5);
  const extraThumbs = Math.max(0, photos.length - 1 - thumbs.length);
  const quoteState = p.quote && p.quote.validity !== 'valid' ? p.quote.validity : null;
  const supplierPriceLabel = p.price_status === 'conflict'
    ? '價格衝突'
    : p.price_status === 'unmatched' && p.middle_price == null && !p.quote
      ? '未匹配價格'
      : null;
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-shadow hover:shadow-md">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left">
        <div className="relative h-36 w-full shrink-0 overflow-hidden bg-muted">
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
            {showNew && isNewProduct(p.created_at) && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">新</span>
            )}
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
          {(() => {
            // 舊版 RPC 只回 { su, '3d' }；新版多回格式層級旗標。
            // 若拿不到格式旗標，就退回舊的 model_type 標示，避免徽章整個消失。
            const hasFormatFlags =
              models?.skp !== undefined || models?.fbx !== undefined || models?.glb !== undefined;
            const badges: { key: string; label: string }[] = [];
            if (hasFormatFlags) {
              if (models?.skp) badges.push({ key: 'skp', label: 'SKP' });
              if (models?.fbx) badges.push({ key: 'fbx', label: 'FBX' });
              if (models?.glb) badges.push({ key: 'glb', label: 'GLB' });
            } else {
              if (models?.su) badges.push({ key: 'su', label: 'SU' });
              if (models?.['3d']) badges.push({ key: '3d', label: '3D' });
            }
            if (!badges.length) return null;
            return (
              <div className="absolute bottom-2 right-2 flex gap-1">
                {badges.map((badge) => (
                  <span
                    key={badge.key}
                    className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            );
          })()}
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
          {(p.usage_quote_count ?? 0) > 0 && (
            <div className="truncate text-xs text-muted-foreground">
              用於 {p.usage_quote_count} 張報價單 · 共 {p.usage_quantity ?? 0} 件
            </div>
          )}
          {(p.category_demand_qty ?? 0) > 0 && (
            <div className="truncate text-xs text-muted-foreground">
              {p.level1_category ?? '未分類'} · PMS 落單 {p.category_demand_qty?.toLocaleString()} 件
            </div>
          )}
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
            {supplierPriceLabel && (
              <Badge variant="outline" className="shrink-0 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-normal text-amber-800">
                {supplierPriceLabel}
              </Badge>
            )}
            {quoteState && (
              <Badge variant="outline" className={cn('shrink-0 px-1.5 py-0 text-[10px] font-normal', VALIDITY_CLASS[quoteState])}>
                {VALIDITY_LABELS[quoteState]}
              </Badge>
            )}
          </div>
        </div>
      </button>
      {p.source && (canOpenSource ? (
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
      ) : (
        // The document itself stays private: show where it came from, not a way in.
        <div className="flex items-center gap-1 truncate border-t border-border px-3 py-1.5 text-left text-[11px] text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {p.source.title ?? '供應商文件'}
            {p.source.page_no != null && ` · 第 ${p.source.page_no} 頁`}
          </span>
        </div>
      ))}
    </div>
  );
}

const TREND_LABEL = { up: '上升', down: '下降', flat: '持平' } as const;

function SupplierCompareSection({
  compare,
  keepId,
  canMerge,
  canOpenSource,
  onOpenSource,
  onMerged,
}: {
  compare: SupplierCompare | null;
  keepId: string;
  canMerge: boolean;
  canOpenSource: boolean;
  onOpenSource: (request: SourcePageRequest & { title?: string | null }) => void;
  onMerged: () => void;
}) {
  if (!compare) return null;
  const others = compare.suppliers.filter((row) => !row.is_current);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">同型號比較</h3>
      <p className="text-xs text-muted-foreground">最低價不會被標成最佳，也不會自動選用。匯率未記錄時不換算。</p>
      {!compare.model_key ? (
        <p className="text-xs text-muted-foreground">這件產品沒有型號，不能對其他供應商。</p>
      ) : others.length === 0 ? (
        <p className="text-xs text-muted-foreground">沒有其他供應商的同型號。</p>
      ) : null}
      {compare.truncated && (
        <p className="text-xs text-muted-foreground">同型號太多，只顯示前 20 個供應商。</p>
      )}
      {compare.suppliers.some((row) => row.offers.length > 0) && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">廠家</th>
                <th className="px-2 py-1.5 text-left font-medium">尺寸／材質</th>
                <th className="px-2 py-1.5 text-left font-medium">報價</th>
                <th className="px-2 py-1.5 text-left font-medium">中間價</th>
                <th className="px-2 py-1.5 text-left font-medium">狀態</th>
                <th className="px-2 py-1.5 text-left font-medium">來源</th>
              </tr>
            </thead>
            <tbody>
              {compare.suppliers.flatMap((row) => {
                const offers = row.offers.length > 0 ? row.offers : [null];
                return offers.map((offer, index) => (
                  <tr key={offer?.id ?? row.product_id} className="border-t border-border/60">
                    <td className="px-2 py-1.5 align-top">
                      {index === 0 ? (
                        <div>
                          <div>{row.factory_name ?? '—'}</div>
                          {row.is_current && <div className="text-muted-foreground">目前這件</div>}
                          {canMerge && row.same_supplier && !row.is_current && (
                            <button
                              type="button"
                              className="mt-1 text-primary hover:underline"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: '合併重複產品？',
                                  description: `把「${row.factory_name ?? row.model ?? '這件'}」的報價併入目前產品，被合併的產品會從列表隱藏。`,
                                  confirmLabel: '合併',
                                });
                                if (!ok) return;
                                mergeDuplicateProduct(keepId, row.product_id)
                                  .then(() => {
                                    toast.success('已合併重複產品');
                                    onMerged();
                                  })
                                  .catch((err) => toast.error('合併失敗', { description: errorText(err) }));
                              }}
                            >
                              合併重複
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{offer && !offer.current ? '歷史' : ''}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-top text-muted-foreground">
                      {index === 0 ? [sizeLabel(row), row.material].filter(Boolean).join(' · ') || '—' : offer?.variant_label ?? ''}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      {offer ? (
                        <div>
                          <div>
                            {compare.can_view_cost && offer.cost != null
                              ? moneyLabel(offer.cost, offer.currency)
                              : offer.currency ?? '已報價'}
                          </div>
                          {offer.currency && offer.currency !== 'HKD' && !offer.fx_recorded && (
                            <div className="text-muted-foreground">未記錄匯率</div>
                          )}
                          {offer.trend && <div className="text-muted-foreground">{TREND_LABEL[offer.trend]}</div>}
                        </div>
                      ) : '未有已審核報價'}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      {index === 0 && row.middle_price != null ? (
                        <div>
                          <div>{moneyLabel(row.middle_price, 'HK$')}</div>
                          {!compare.can_view_cost && <div className="text-muted-foreground">成本已遮蔽</div>}
                        </div>
                      ) : index === 0 ? (
                        '—'
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      {offer && (
                        <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px] font-normal', VALIDITY_CLASS[offer.validity])}>
                          {offer.current ? '當前' : '歷史'} · {VALIDITY_LABELS[offer.validity]}
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      {offer?.document_id && (
                        <SourceLink
                          title={offer.document_title}
                          page={offer.page_no}
                          documentId={offer.document_id}
                          productId={row.product_id}
                          onOpen={onOpenSource}
                          canOpen={canOpenSource}
                        />
                      )}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const SKP_POLL_MS = 5000;

function skpStatusText(skp: SkpStatus): string {
  switch (skp.status) {
    case 'ready':
      return 'SKP 已生成，可以下載';
    case 'queued':
      return skp.attempts > 0 ? `排隊重試中（第 ${skp.attempts} 次失敗：${skp.error ?? '未知錯誤'}）` : 'SKP 排隊中，等 Windows SKP Worker 處理';
    case 'running':
      return 'SKP 生成中…';
    case 'failed':
      return `SKP 生成失敗：${skp.error ?? '未知錯誤'}`;
    case 'cancelled':
      return 'SKP 任務已取消';
    default:
      return '';
  }
}

function measuredMm(value?: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

async function fileToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法讀取圖片');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('圖片壓縮失敗'))), 'image/jpeg', 0.82);
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

type ImageAnalysis = {
  requires_product_scope_confirmation?: boolean;
  detection?: ProductCountDetection;
  structure?: StructureEvidence;
  kind?: FurnitureKind;
  width_mm?: number | null;
  depth_mm?: number | null;
  height_mm?: number | null;
  style?: Partial<ModelStyle> | null;
  /** custom only: raw part list, checked by sanitizeCustomParts before use. */
  parts?: unknown;
  structure_notes?: string | null;
  image_count?: number;
  source_dimensions_scope?: 'single' | 'arrangement' | 'unknown';
  dimension_estimates?: DimensionEstimate[];
  /** Sizes printed on the photos, read by the AI with raw text and image position. */
  labelled_dimensions?: unknown;
};

type AnalysisRequest = {
  inferred_reference?: { image_base64: string; mime_type: string };
  product_scope?: ProductScopeChoice['scope'];
  product_count?: number;
  mode?: 'classify' | 'parts';
  title?: string | null;
  width_mm?: number | null;
  depth_mm?: number | null;
  height_mm?: number | null;
};

/**
 * Require at least two distinct readable references; send at most six views.
 * mode 'parts' asks only for the part list used when no template fits.
 * The prefixed slug is tried first. A legacy 200 that classifies kind but omits
 * structure is not accepted; the bare slug is tried before giving up.
 */
async function analyzeProductImages(urls: (string | File)[], request: AnalysisRequest = {}): Promise<ImageAnalysis | null> {
  const furnitureModelSlugs = ['supabase-functions-generate-furniture-model', 'generate-furniture-model'] as const;
  const images: { image_base64: string; mime_type: string }[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    try {
      const res = typeof url === 'string' ? await fetch(url) : null;
      if (res && !res.ok) continue;
      const blob = url instanceof File ? url : await res!.blob();
      const image = await fileToJpeg(new File([blob], 'product.jpg', { type: blob.type || 'image/jpeg' }));
      if (seen.has(image)) continue;
      seen.add(image);
      images.push({ image_base64: image, mime_type: 'image/jpeg' });
      if (images.length === 6) break;
    } catch {
      // A broken photo should not stop the others from being read.
    }
  }
  if (images.length < 2) throw Object.assign(new Error(`只有 ${images.length} 張可讀取的不同圖片，請補充至最少 2 張`), { code: 'reference_images_required' });
  const body = { images, ...request };
  type AnalysisResponse = ImageAnalysis & { supported?: boolean; reason?: string };
  let result: Awaited<ReturnType<typeof invokeEdgeFunctionDirect<AnalysisResponse>>> | null = null;
  let legacy: typeof result = null;
  for (const slug of furnitureModelSlugs) {
    const next = await invokeEdgeFunctionDirect<AnalysisResponse>(slug, body);
    if (next.status === 404) continue;
    if (next.error || !next.data) {
      result = next;
      break;
    }
    if ((next.data.requires_product_scope_confirmation && next.data.detection) || next.data.supported === false) {
      result = next;
      break;
    }
    if (hasStructureEvidence(next.data.structure)) {
      result = next;
      break;
    }
    legacy = next;
  }
  result = result ?? legacy;
  if (!result || result.error || !result.data) throw new Error(result?.error?.message ?? '無法辨認圖片');
  if (result.data.requires_product_scope_confirmation && result.data.detection) return result.data;
  if (result.data.supported === false || !result.data.kind) throw new Error(result.data.reason || '無法確認單件產品，請提供單品圖片');
  const structure = hasStructureEvidence(result.data.structure) ? result.data.structure : undefined;
  if (!structure) throw new Error('缺少結構辨認資料，請重新辨認圖片');
  return { ...result.data, structure };
}

type ModelDraft = StructureDraft;

const AXIS_INDEX: Record<SizeAxis, 0 | 1 | 2> = { width: 0, depth: 1, height: 2 };
/** Which size axes a profile outline spans, per extrusion axis (same as the engine's PLANE). */
const PART_PLANE: Record<'x' | 'y' | 'z', [number, number]> = { z: [0, 1], y: [0, 2], x: [1, 2] };

/** Dialog portals to document.body, so the workbench color tokens have to travel with it. */
const WORKBENCH_TONE = {
  ['--muted-foreground' as string]: '215 16% 47%',
  ['--foreground' as string]: '222 47% 11%',
  ['--muted' as string]: '210 40% 96%',
  ['--border' as string]: '214 32% 91%',
  ['--input' as string]: '214 32% 91%',
  ['--background' as string]: '0 0% 100%',
  ['--primary' as string]: '243 100% 68%',
  ['--primary-foreground' as string]: '0 0% 100%',
  ['--accent' as string]: '210 40% 96%',
  ['--accent-foreground' as string]: '222 47% 11%',
  ['--ring' as string]: '243 100% 68%',
};

/**
 * FDS-06：設計師要的是「可下載、可匯入效果圖軟件的檔」，主格式是 SKP 與 FBX。
 * GLB 只作中間／預覽格式，不當主按鈕名稱（見 docs/prd/FDS-V2.2.md §2、§9）。
 * 內部一律用格式語意命名，避免再出現「SU」「3D」這種含糊說法。
 */
type ModelTarget = 'skp' | 'fbx';

const MODEL_TARGET_LABEL: Record<ModelTarget, string> = {
  skp: 'SKP',
  fbx: 'FBX',
};

/** 產生按鈕與進度提示用的完整名稱，例如「生成 SKP」「下載 FBX」。 */
function modelTargetAction(target: ModelTarget, verb: '生成' | '下載' | '重新生成'): string {
  return `${verb} ${MODEL_TARGET_LABEL[target]}`;
}

type ProgressFlow = 'prepare' | 'generate';

/** Stepper inside the progress dialog: the real stages of each run, keyed by progress label. */
const PROGRESS_FLOW: Record<ProgressFlow, { steps: string[]; hints: string[]; index: Record<string, number> }> = {
  prepare: {
    steps: ['讀取產品資料', '辨認產品結構', '整理尺寸證據'],
    hints: ['正在讀取產品資料，請稍候…', '正在讀取產品圖的部件、結構及尺寸標註，請稍候…', '正在整理尺寸來源，請稍候…'],
    index: {
      '準備生成 SKP': 0,
      '準備生成 FBX': 0,
      '檢查 SKP 生成環境': 0,
      '辨認產品圖': 1,
      '整理結構': 2,
      '結構已辨認': 2,
    },
  },
  generate: {
    steps: ['建立模型', '儲存模型', '生成檔案'],
    hints: ['正在建立模型，請稍候…', '正在儲存模型，請稍候…', '正在寫出模型檔，請稍候…'],
    index: {
      '建立模型': 0,
      '檢查 SKP 生成環境': 0,
      '儲存模型': 1,
      '排入 SKP 生成': 2,
      '寫出 GLB': 2,
      '寫出 FBX': 2,
      'SKP 已可下載': 2,
      '已排入 SKP 生成': 2,
      'FBX 已可下載': 2,
      'FBX 生成失敗': 2,
    },
  },
};

/** Lavender icon disc wrapped by a determinate progress ring. */
function ProgressRing({ percent, children }: { percent: number; children: React.ReactNode }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <span className="relative grid h-14 w-14 place-items-center">
      <svg
        viewBox="0 0 72 72"
        aria-hidden="true"
        className="absolute -left-2 -top-2 -rotate-90"
        style={{ width: 72, height: 72 }}
      >
        <circle cx="36" cy="36" r={radius} fill="none" strokeWidth="3" stroke="currentColor" className="text-primary/15" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="text-primary transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {children}
    </span>
  );
}

function ProgressSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-hidden="true">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <Fragment key={step}>
            {index > 0 && <span className="hidden h-px min-w-4 flex-1 bg-border sm:block" />}
            <span className="flex shrink-0 items-center gap-2">
              {state === 'done' ? (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
              ) : state === 'active' ? (
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
              ) : (
                <span className="h-7 w-7 rounded-full bg-muted" />
              )}
              <span
                className={cn(
                  'whitespace-nowrap text-[13px] sm:text-sm',
                  state === 'active' ? 'font-semibold text-primary' : state === 'done' ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {step}
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function ProductModelsSection({
  product,
  canManage,
  onChanged,
  onFiles,
  appearance = 'plain',
}: {
  product: ProductDetail;
  /** admin / uploader may upload and remove files. */
  canManage: boolean;
  onChanged: () => void;
  onFiles?: (files: ProductModelFile[]) => void;
  appearance?: 'plain' | 'workbench';
}) {
  const productId = product.id;

  const catalogDimensions = useMemo(
    () => ({
      width_mm: measuredMm(product.dimension_l_mm),
      depth_mm: measuredMm(product.dimension_w_mm),
      height_mm: measuredMm(product.dimension_h_mm),
    }),
    [product.dimension_h_mm, product.dimension_l_mm, product.dimension_w_mm],
  );

  const [files, setFiles] = useState<ProductModelFile[] | null>(null);
  const [busy, setBusy] = useState<null | ModelTarget | 'upload'>(null);
  const [reload, setReload] = useState(0);
  const [filesError, setFilesError] = useState(false);
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const [reuse, setReuse] = useState<{ target: ModelTarget; files: ProductModelFile[] } | null>(null);
  const [versions, setVersions] = useState<FurnitureModelVersion[] | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  /** AI re-recognition waiting for the person to adopt each difference (AC-06). */
  const [suggestion, setSuggestion] = useState<{ parts: CustomPartSpec[]; changes: PartChange[]; structure?: StructureEvidence; notes: string | null; labels: unknown } | null>(null);
  /** Inputs the evidence was built from, so a new AI reading can add to them. */
  const evidenceInputRef = useRef<Omit<EvidenceInput, 'previous' | 'keyDimensions'> | null>(null);
  /** Who confirms values in this session (shown in the evidence and stored with it). */
  const [userLabel, setUserLabel] = useState('');
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserLabel(data.user?.email ?? data.user?.id ?? ''));
  }, []);
  /** Answers for a previous product or an older request must not land on the current draft. */
  const requestSeq = useRef(0);
  const [previewFile, setPreviewFile] = useState<ProductModelFile | null>(null);
  const [skp, setSkp] = useState<SkpStatus | null>(null);
  const [skpModelId, setSkpModelId] = useState<string | null>(null);
  const savedRef = useRef<{ key: string; id: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  /** 上載模型前先問版本說明（取代 window.prompt）。 */
  const [pendingModel, setPendingModel] = useState<{ file: File } | null>(null);
  const [pendingModelNote, setPendingModelNote] = useState('');
  const [extraPhotos, setExtraPhotos] = useState<File[]>([]);
  const [scopeChoice, setScopeChoice] = useState<ProductScopeChoice>();
  const [scopeRequest, setScopeRequest] = useState<{ target: ModelTarget | 'parts'; detection: ProductCountDetection } | null>(null);
  const [photoRequest, setPhotoRequest] = useState<{ target: ModelTarget | 'parts'; message: string } | null>(null);
  const modelPhotos: (string | File)[] = [...extraPhotos, ...new Set((product.images ?? []).filter(src => /^https?:\/\//i.test(src)))];
  useEffect(() => {
    requestSeq.current++;
    setExtraPhotos([]); setDraft(null); setPhotoRequest(null); setSuggestion(null); setVersions(null); setReviewId(null);
  }, [productId]);
  useEffect(() => { setScopeChoice(undefined); setScopeRequest(null); }, [productId, extraPhotos, product.images]);
  const [genProgress, setGenProgress] = useState<{ percent: number; label: string } | null>(null);
  const skpRequirements = useSkpRequirements();
  /** Gate for the structure form: opened once the progress dialog hands over. */
  const [confirmShown, setConfirmShown] = useState(false);
  const [progressFlow, setProgressFlow] = useState<ProgressFlow>('prepare');
  const creepRef = useRef<number | null>(null);
  const progressCloseRef = useRef<number | null>(null);
  const lastProgressRef = useRef<{ percent: number; label: string } | null>(null);

  const stopCreep = () => {
    if (creepRef.current != null) {
      window.clearInterval(creepRef.current);
      creepRef.current = null;
    }
  };

  const showProgress = (percent: number, label: string) => {
    setGenProgress({ percent: Math.max(0, Math.min(100, Math.round(percent))), label });
  };

  /** While an AI call is in flight, ease the number forward but stop short of the next real step. */
  const creepToward = (cap: number) => {
    stopCreep();
    creepRef.current = window.setInterval(() => {
      setGenProgress((current) => {
        if (!current || current.percent >= cap) return current;
        return { ...current, percent: current.percent + 1 };
      });
    }, 450);
  };

  const clearProgress = () => {
    stopCreep();
    if (progressCloseRef.current != null) {
      window.clearTimeout(progressCloseRef.current);
      progressCloseRef.current = null;
    }
    setGenProgress(null);
  };

  const closeProgressSoon = (label: string) => {
    stopCreep();
    showProgress(100, label);
    if (progressCloseRef.current != null) window.clearTimeout(progressCloseRef.current);
    progressCloseRef.current = window.setTimeout(() => {
      progressCloseRef.current = null;
      setGenProgress(null);
    }, 700);
  };

  /** Hold 100%, then cross-fade into the structure form. */
  const handoffToConfirm = () => {
    stopCreep();
    showProgress(100, '結構已辨認');
    if (progressCloseRef.current != null) window.clearTimeout(progressCloseRef.current);
    progressCloseRef.current = window.setTimeout(() => {
      progressCloseRef.current = null;
      setConfirmShown(true);
      setGenProgress(null);
    }, 420);
  };

  useEffect(() => () => {
    stopCreep();
    if (progressCloseRef.current != null) window.clearTimeout(progressCloseRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchProductModels(productId)
      .then((rows) => {
        if (cancelled) return;
        setFiles(rows);
        setFilesError(false);
        onFiles?.(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
        setFilesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, reload, onFiles]);

  const skpPending = skp?.status === 'queued' || skp?.status === 'running';
  useEffect(() => {
    if (!skpModelId || !skpPending) return;
    const timer = window.setInterval(() => {
      fetchSkpStatus(skpModelId)
        .then((next) => {
          setSkp(next);
          if (next.status === 'ready') {
            setReload((n) => n + 1);
            onChanged();
          }
        })
        .catch(() => undefined);
    }, SKP_POLL_MS);
    return () => window.clearInterval(timer);
  }, [skpModelId, skpPending, onChanged]);

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy('upload');
    try {
      await work();
      setReload((n) => n + 1);
      onChanged();
    } catch (err) {
      toast.error(failure, { description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  /** Every change is a new version; identical parameters return the existing one (server-side hash). */
  const ensureSaved = async (model: ParametricModel, parentId?: string | null): Promise<string> => {
    const key = JSON.stringify([productId, parentId ?? null, model]);
    if (savedRef.current?.key === key) return savedRef.current.id;
    const id = await saveFurnitureModel(productId, model, parentId);
    savedRef.current = { key, id };
    return id;
  };

  useEffect(() => {
    let cancelled = false;
    fetchFurnitureModelVersions(productId)
      .then((rows) => { if (!cancelled) setVersions(rows); })
      .catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, [productId, reload]);

  /**
   * 已有檔案（用來判斷要不要問「沿用／重新生成」）。
   * SKP 只有 skp 一種；FBX 目標同時看 fbx 與 glb（glb 是預覽中間檔，不算完成）。
   */
  const existingFor = (target: ModelTarget) =>
    (files ?? []).filter((file) =>
      target === 'skp' ? file.format === 'skp' : file.format === 'fbx' || file.format === 'glb',
    );

  /** T-806: look for uploaded or earlier generated files before any AI call. */
  const start = (target: ModelTarget, force = false) => {
    if (filesError) {
      toast.error('讀不到現有模型檔，請重新載入後再生成');
      return;
    }
    const existing = existingFor(target);
    if (!force && (existing.length > 0 || (versions?.length ?? 0) > 0)) {
      setDraft(null);
      setReuse({ target, files: existing });
      return;
    }
    setReuse(null);
    void prepare(target);
  };

  /**
   * FDS-06 的按鈕行為：
   * - 已有可交付檔 → 直接下載（SKP／FBX 各自對應自己的格式）。
   * - 沒有 → 走生成流程。
   * - 生成失敗 → 按鈕轉成「重新生成」。
   */
  // SKP 檔不一定是本系統生成的：管理員可能直接上載 SKP。
  // 所以按鈕以「檔案在不在」為準，job status 只用來顯示生成中／失敗。
  const skpFile = latestSkpFile(files);
  const skpReady = skp?.status === 'ready' || skpFile != null;
  const skpFailed = !skpFile && (skp?.status === 'failed' || skp?.status === 'cancelled');
  const skpRunning = !skpFile && (skp?.status === 'queued' || skp?.status === 'running');
  const skpButtonLabel = skpFailed
    ? '重新生成 SKP'
    : skpReady
      ? '下載 SKP'
      : skpRunning
        ? 'SKP 生成中'
        : '生成 SKP';

  const onSkpAction = () => {
    if (skpReady) {
      if (!skpFile) {
        toast.error('找不到 SKP 檔', { description: '請重新載入後再試' });
        return;
      }
      void downloadModel(skpFile.storage_path, skpFile.file_name).catch((err) =>
        toast.error('SKP 下載失敗', { description: errorText(err) }),
      );
      return;
    }
    start('skp');
  };

  const fbxFile = latestFbxFile(files);
  // FDS-06：按鈕名稱必須跟實際動作一致。已有 FBX 就叫「下載 FBX」，
  // 重新生成另放在「下載模型」下拉選單，避免按鈕說一套做一套。
  const fbxButtonLabel = fbxFile ? '下載 FBX' : '生成 FBX';

  const onFbxAction = () => {
    if (fbxFile) {
      void downloadModel(fbxFile.storage_path, fbxFile.file_name).catch((err) =>
        toast.error('FBX 下載失敗', { description: errorText(err) }),
      );
      return;
    }
    start('fbx');
  };

  /** T-801 / FR-03: read kind, parts and printed sizes, then hand the draft and its evidence to the user. */
  const prepare = async (target: ModelTarget, choice = scopeChoice) => {
    if (modelPhotos.length < 2) {
      setPhotoRequest({ target, message: `目前只有 ${modelPhotos.length} 張候選圖片，最少需要 2 張不同角度圖片。` });
      return;
    }
    const seq = ++requestSeq.current;
    setBusy(target);
    setConfirmShown(false);
    clearProgress();
    setProgressFlow('prepare');
    showProgress(8, modelTargetAction(target, '生成'));
    try {
      if (target === 'skp') {
        showProgress(8, '檢查 SKP 生成環境');
        if (!await skpRequirements.check()) {
          clearProgress();
          return;
        }
      }
      const text = [product.title, product.model, product.category, product.level1_category, product.level2_category]
        .filter(Boolean)
        .join(' ');
      let kind = inferFurnitureKindFrom([
        product.level2_category,
        product.title,
        product.level1_category,
        product.category,
        product.model,
      ]);
      const catalog = { width: catalogDimensions.width_mm, depth: catalogDimensions.depth_mm, height: catalogDimensions.height_mm };
      const arrangement = choice?.scope === 'arrangement';
      showProgress(34, '辨認產品圖');
      creepToward(70);
      let guess: ImageAnalysis | null;
      try {
        guess = await analyzeProductImages(modelPhotos, {
          product_scope: choice?.scope,
          product_count: choice?.count,
          title: [product.model, product.title].filter(Boolean).join(' '),
          width_mm: arrangement ? null : catalog.width,
          depth_mm: arrangement ? null : catalog.depth,
          height_mm: arrangement ? null : catalog.height,
        });
      } finally {
        stopCreep();
      }
      if (seq !== requestSeq.current) return;
      if (guess?.requires_product_scope_confirmation && guess.detection) {
        clearProgress();
        setScopeRequest({ target, detection: guess.detection });
        return;
      }
      if (!guess) throw new Error('無法辨認圖片');
      if (guess.kind) kind = guess.kind;
      const parts = ensurePartIds(sanitizeCustomParts(guess.parts));
      const structure = hasStructureEvidence(guess.structure) ? guess.structure : undefined;
      let style: Partial<ModelStyle> = initialModelStyle(kind, text, guess.style);
      showProgress(82, '整理結構');
      const tiers = kind === 'shelf' ? inferShelfTiers(text) : undefined;
      if (tiers !== undefined && style.shelves == null) style = { ...style, shelves: tiers - 2 };
      if (!structure) throw new Error('缺少結構辨認資料，請重新辨認圖片');
      const partsSize = customPartsSize(parts);
      const input: Omit<EvidenceInput, 'previous' | 'keyDimensions'> = {
        productScope: arrangement ? 'arrangement' : 'single',
        catalog,
        catalogScope: guess.source_dimensions_scope,
        aiOverall: {
          width: guess.width_mm ?? partsSize?.[0],
          depth: guess.depth_mm ?? partsSize?.[1],
          height: guess.height_mm ?? partsSize?.[2],
        },
        estimates: guess.dimension_estimates ?? [],
        labels: labelledDimensionsFrom(guess.labelled_dimensions),
      };
      evidenceInputRef.current = input;
      let evidence = buildEvidence(input);
      const size = OVERALL_KEYS.map((key) => valueOf(findDimension(evidence, key)!, evidence.product_scope));
      if (size.some((n) => n == null)) throw new Error('讀不到闊、深、高，請補充有尺寸的產品資料或圖片');
      const [width, depth, height] = size as number[];
      const selected = selectFurnitureGeometry({ kind: kind ?? 'custom', width_mm: width, depth_mm: depth, height_mm: height, style, parts });
      kind = selected.kind;
      if (kind === 'custom') evidence = refreshKeyDimensions(evidence, deriveKeyDimensions(fitCustomPartsWithConstraints(parts, width, depth, height).parts));
      const notes = `${selected.templateMatched ? '部件形狀與模板吻合。' : '按圖片實際部件建模，未套用固定模板。'}${guess.structure_notes ?? ''}`;
      setSuggestion(null);
      setDraft({
        structure,
        target,
        kind,
        width: String(width),
        depth: String(depth),
        height: String(height),
        estimated: estimatedOverallAxes(evidence),
        style,
        styleSource: 'image',
        notes,
        parts,
        dimensionEstimates: input.estimates,
        evidence,
        parentId: null,
      });
      handoffToConfirm();
    } catch (err) {
      if (seq !== requestSeq.current) return;
      clearProgress();
      setConfirmShown(false);
      if ((err as { code?: string })?.code === 'reference_images_required') setPhotoRequest({ target, message: errorText(err) });
      else toast.error(`${modelTargetAction(target, '生成')}失敗`, { description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  /** Overall fit by constraints, then the key dimensions a person confirmed. No AI involved. */
  const fitDraft = (current: ModelDraft): { parts: CustomPartSpec[]; conflicts: string[] } => {
    const [w, d, h] = [Number(current.width), Number(current.depth), Number(current.height)];
    if (!(w > 0 && d > 0 && h > 0)) return { parts: current.parts, conflicts: [] };
    const overall = fitCustomPartsWithConstraints(current.parts, w, d, h);
    const keyed = applyKeyDimensions(overall.parts, pinnedKeyValues(current.evidence));
    return { parts: keyed.parts, conflicts: [...overall.conflicts, ...keyed.conflicts] };
  };

  /** Keep the structure readings and estimated axes in step with the current parts. */
  const syncEvidence = (next: ModelDraft): ModelDraft => {
    if (!next.evidence) return next;
    const evidence = refreshKeyDimensions(next.evidence, next.kind === 'custom' ? deriveKeyDimensions(fitDraft(next).parts) : []);
    return { ...next, evidence, estimated: estimatedOverallAxes(evidence) };
  };

  const updateDraft = (patch: Partial<ModelDraft>, editedAxis?: SizeAxis) => {
    setDraft((current) => {
      if (!current) return current;
      const { structure: patchedStructure, ...rest } = patch;
      const next: ModelDraft = {
        ...current,
        ...rest,
        ...(hasStructureEvidence(patchedStructure) ? { structure: patchedStructure } : {}),
        ...(patch.style ? { style: { ...current.style, ...patch.style } } : {}),
      };
      if (editedAxis) {
        const n = Number(next[editedAxis]);
        if (next.evidence && n > 0 && n <= 10000) next.evidence = enterManual(next.evidence, editedAxis, n, userLabel);
        else if (!next.evidence) next.estimated = current.estimated.filter((axis) => axis !== editedAxis);
      }
      return syncEvidence(next);
    });
  };

  /** The evidence panel chose or entered a value: overall sizes follow the chosen value. */
  const changeEvidence = (evidence: ModelEvidence) => {
    setDraft((current) => {
      if (!current) return current;
      const next: ModelDraft = { ...current, evidence };
      for (const key of OVERALL_KEYS) {
        const record = findDimension(evidence, key);
        const value = record ? valueOf(record, evidence.product_scope) : null;
        if (value != null) next[key] = String(value);
      }
      return syncEvidence(next);
    });
  };

  /** Printed labels from a new AI reading are added as candidates; people's choices stay (AC-06). */
  const addReading = (current: ModelDraft, labels: unknown): ModelDraft => {
    if (!current.evidence) return current;
    const extra = labelledDimensionsFrom(labels);
    if (extra.length === 0) return current;
    const base = evidenceInputRef.current ?? { productScope: current.evidence.product_scope, catalog: { width: catalogDimensions.width_mm, depth: catalogDimensions.depth_mm, height: catalogDimensions.height_mm } };
    const input = { ...base, labels: [...(base.labels ?? []), ...extra] };
    evidenceInputRef.current = input;
    return { ...current, evidence: buildEvidence({ ...input, previous: current.evidence }) };
  };

  const [partsBusy, setPartsBusy] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** No template fits, or a new reading: ask the AI for parts. A reading over existing parts is only a suggestion. */
  const loadParts = async (choice = scopeChoice) => {
    const start = draftRef.current;
    if (!start) return;
    const photos = modelPhotos;
    if (photos.length < 2) {
      setConfirmShown(false);
      setPhotoRequest({ target: 'parts', message: '最少需要 2 張不同角度圖片，請補充參考圖。' });
      return;
    }
    const seq = requestSeq.current;
    const size = (value: string) => (Number(value) > 0 ? Number(value) : null);
    setPartsBusy(true);
    try {
      const result = await analyzeProductImages(photos, {
        product_scope: choice?.scope,
        product_count: choice?.count,
        mode: 'parts',
        title: [product.model, product.title].filter(Boolean).join(' '),
        width_mm: size(start.width),
        depth_mm: size(start.depth),
        height_mm: size(start.height),
      });
      const current = draftRef.current;
      if (seq !== requestSeq.current || !current) return;
      if (result?.requires_product_scope_confirmation && result.detection) {
        setConfirmShown(false);
        setScopeRequest({ target: 'parts', detection: result.detection });
        return;
      }
      const parts = ensurePartIds(sanitizeCustomParts(result?.parts));
      if (parts.length === 0) throw new Error('AI 沒有給出可用的部件');
      const structure = hasStructureEvidence(result?.structure) ? result.structure : undefined;
      if (current.parts.length > 0) {
        setSuggestion({ parts, changes: diffParts(current.parts, parts), structure, notes: result?.structure_notes ?? null, labels: result?.labelled_dimensions });
        return;
      }
      const missing = (['width', 'depth', 'height'] as SizeAxis[]).filter((axis) => !(Number(current[axis]) > 0));
      const partsSize = customPartsSize(parts);
      setDraft((draftNow) => draftNow && syncEvidence(addReading({
        ...draftNow,
        parts,
        ...(structure ? { structure } : {}),
        notes: result?.structure_notes ?? draftNow.notes,
        ...(partsSize ? Object.fromEntries(missing.map((axis) => [axis, String(partsSize[AXIS_INDEX[axis]])])) : {}),
        estimated: [...new Set([...draftNow.estimated, ...missing])],
      }, result?.labelled_dimensions)));
    } catch (err) {
      if ((err as { code?: string })?.code === 'reference_images_required') {
        setConfirmShown(false);
        setPhotoRequest({ target: 'parts', message: errorText(err) });
      } else toast.error('拆部件失敗', { description: errorText(err) });
    } finally {
      setPartsBusy(false);
    }
  };

  /** Adopt the chosen differences; with every item adopted the new structure reading comes too. */
  const applySuggestion = (adopted: Set<string>, all: boolean) => {
    const pending = suggestion;
    if (!pending) return;
    setSuggestion(null);
    setDraft((current) => {
      if (!current) return current;
      const parts = applyPartChanges(current.parts, pending.parts, adopted);
      let structure = current.structure;
      if (all && pending.structure) structure = pending.structure;
      else if (structure) {
        // A person picked which parts exist; the confirmed counts follow that choice.
        const part_counts = Object.fromEntries(Object.keys(structure.part_counts).map((role) => [role, parts.filter((p) => (p.role ?? 'other') === role).length]));
        structure = { ...structure, part_counts, leg_count: part_counts.leg ?? structure.leg_count };
      }
      return syncEvidence(addReading({ ...current, parts, structure, notes: all ? pending.notes ?? current.notes : current.notes }, pending.labels));
    });
  };

  /** The parts at the overall size in the form, which is what the preview and generation use. */
  const fittedParts = (current: ModelDraft): CustomPartSpec[] => fitDraft(current).parts;

  /**
   * After deleting or resizing one part the overall size follows the parts instead of stretching them,
   * except on axes a person confirmed: those keep their value and any contradiction is reported.
   */
  const commitParts = (parts: CustomPartSpec[]) => {
    const size = customPartsSize(parts);
    setDraft((current) => {
      if (!current) return current;
      const next: ModelDraft = { ...current, parts };
      if (size) {
        for (const axis of ['width', 'depth', 'height'] as SizeAxis[]) {
          const value = size[AXIS_INDEX[axis]];
          if (!next.evidence) next[axis] = String(value);
          else if (findDimension(next.evidence, axis)?.status !== 'confirmed') {
            next.evidence = setModelOverall(next.evidence, axis, value, userLabel);
            next[axis] = String(valueOf(findDimension(next.evidence, axis)!, next.evidence.product_scope) ?? value);
          }
        }
      }
      return syncEvidence(next);
    });
  };

  const editParts = (edit: (parts: CustomPartSpec[]) => CustomPartSpec[], resizes = false) => {
    const current = draftRef.current;
    if (!current) return;
    if (resizes) commitParts(edit(fittedParts(current)));
    else updateDraft({ parts: edit(current.parts) });
  };

  const resizePart = (index: number, axis: 0 | 1 | 2, value: string) => {
    if (!draft) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 3 || n > 10000) return;
    commitParts(
      fittedParts(draft).map((part, i) => {
        if (i !== index) return part;
        const ratio = n / part.size_mm[axis];
        const size_mm = part.size_mm.map((v, k) => (k === axis ? n : v)) as CustomPartSpec['size_mm'];
        if (part.shape === 'sweep') return { ...part, size_mm, geometry_scale: [0, 1, 2].map(k => (part.geometry_scale?.[k] ?? 1) * (k === axis ? ratio : 1)) as [number, number, number] };
        if (!part.points_mm || !part.axis) return { ...part, size_mm };
        // A profile's outline is its shape across the axis; stretch it with the size.
        const cross = PART_PLANE[part.axis];
        const points_mm = part.points_mm.map(
          (point) => point.map((v, j) => (cross[j] === axis ? Math.round(v * ratio) : v)) as [number, number],
        );
        return { ...part, size_mm, points_mm };
      }),
    );
  };

  const draftFit = useMemo(() => (draft ? fitDraft(draft) : null), [draft]);
  const previewModel = useMemo(() => {
    if (!draft?.kind || !draftFit) return null;
    const [w, d, h] = [Number(draft.width), Number(draft.depth), Number(draft.height)];
    if (!(w > 0 && d > 0 && h > 0)) return null;
    try {
      const model = buildParametric({
        kind: draft.kind,
        width_mm: w,
        depth_mm: d,
        height_mm: h,
        estimated_axes: draft.estimated,
        style: draft.style,
        parts: draft.kind === 'custom' ? draftFit.parts : [],
      });
      model.structure_evidence = draft.structure;
      model.structure_parts = draft.parts;
      return model;
    } catch {
      return null;
    }
  }, [draft, draftFit]);
  const structureErrors = useMemo(() => {
    if (!draft || !previewModel || !draftFit) return ['請填寫有效尺寸及完整部件後再生成'];
    try {
      return [...(draft.kind === 'custom' ? draftFit.conflicts : []), ...validateFurnitureStructure(previewModel, draft.structure, draftFit.parts)];
    } catch (error) { return [errorText(error)]; }
  }, [draft, draftFit, previewModel]);
  const evidenceBlockers = useMemo(() => (draft?.evidence ? generationBlockers(draft.evidence) : []), [draft?.evidence]);
  const estimateDraft = Boolean(draft?.evidence?.dimensions.some((d) => d.critical && d.status === 'estimated'));

  /** The model as saved: confirmed geometry plus where every key value came from. */
  const modelForSave = (blockers: string[]): ParametricModel | null => {
    if (!previewModel || !draft) return null;
    return {
      ...previewModel,
      ...(draft.evidence ? { evidence: { ...withStatuses(draft.evidence), blockers } } : {}),
    };
  };

  /** 待補資料：keep the version without files so it can be continued later. */
  const saveDraftOnly = async () => {
    const current = draftRef.current;
    const model = modelForSave([...evidenceBlockers, ...structureErrors]);
    if (!current || !model) return;
    try {
      const id = await ensureSaved(model, current.parentId);
      toast.success('已保存草稿', { description: `版本 ${id.slice(0, 8)}；可在「已有模型」中以此版本繼續修改。` });
      setReload((n) => n + 1);
    } catch (err) {
      toast.error('保存草稿失敗', { description: errorText(err) });
    }
  };

  /** 以此版本修改：load the saved parameters, no AI call; saving creates a child version. */
  const editVersion = async (version: FurnitureModelVersion, target: ModelTarget) => {
    const seq = ++requestSeq.current;
    try {
      const detail = await fetchFurnitureModelDetail(version.id);
      if (seq !== requestSeq.current) return;
      const m = detail.parametric;
      const parts = ensurePartIds(sanitizeCustomParts(m.structure_parts ?? m.custom_parts ?? []));
      const structure = hasStructureEvidence(m.structure_evidence) ? m.structure_evidence : undefined;
      evidenceInputRef.current = null;
      setReuse(null);
      setSuggestion(null);
      setDraft(syncEvidence({
        structure,
        target,
        kind: m.kind,
        width: String(m.width_mm),
        depth: String(m.depth_mm),
        height: String(m.height_mm),
        estimated: m.estimated_axes ?? [],
        style: m.style ?? {},
        styleSource: 'image',
        notes: `以版本 ${version.id.slice(0, 8)} 修改；儲存後成為新版本，需要重新驗收。`,
        parts,
        evidence: m.evidence ? withStatuses(m.evidence) : undefined,
        parentId: version.id,
      }));
      setConfirmShown(true);
    } catch (err) {
      toast.error('讀取版本失敗', { description: errorText(err) });
    }
  };

  /** T-804: build only what the user confirmed. */
  const generate = async () => {
    if (!draft) return;
    const { target, kind } = draft;
    if (!kind) {
      toast('請先選擇家具類型');
      return;
    }
    const width = Number(draft.width);
    const depth = Number(draft.depth);
    const height = Number(draft.height);
    if (![width, depth, height].every((n) => Number.isFinite(n) && n > 0)) {
      toast('請填寫闊、深、高（mm）');
      return;
    }
    if (evidenceBlockers.length > 0) {
      toast.error('關鍵尺寸未處理', { description: evidenceBlockers.join('；') });
      return;
    }
    if (kind === 'custom' && draft.parts.length === 0) {
      toast('請先讓 AI 拆部件');
      return;
    }
    if (structureErrors.length) { toast.error('結構校驗未通過', { description: structureErrors.join('；') }); return; }
    const seq = requestSeq.current;
    setBusy(target);
    setConfirmShown(false);
    setProgressFlow('generate');
    showProgress(12, '建立模型');
    try {
      // The Worker may have gone offline while the structure dialog was open.
      if (target === 'skp') {
        showProgress(12, '檢查 SKP 生成環境');
        if (!await skpRequirements.check()) {
          clearProgress();
          setConfirmShown(true);
          return;
        }
      }
      // Preview, GLB/FBX and SKP all come from this one saved geometry (FR-07).
      const model = modelForSave([]);
      if (!model) throw new Error('請填寫有效尺寸及完整部件後再生成');
      const errors = validateFurnitureStructure(model, draft.structure, fittedParts(draft));
      if (errors.length) throw new Error(errors.join('；'));
      showProgress(34, '儲存模型');
      const id = await ensureSaved(model, draft.parentId);
      setDraft(null);
      if (target === 'skp') {
        showProgress(68, '排入 SKP 生成');
        const status = await requestSkp(id);
        if (seq !== requestSeq.current) return;
        setSkpModelId(id);
        setSkp(status);
        if (status.status === 'ready') {
          setReload((n) => n + 1);
          onChanged();
        }
        const doneLabel = status.status === 'ready' ? 'SKP 已可下載' : '已排入 SKP 生成';
        toast.success(doneLabel);
        closeProgressSoon(doneLabel);
      } else {
        const base = (product.model || product.sku || model.label).replace(/[^\w.\-\u3400-\u9fff]+/g, '_').slice(0, 80);
        const problems: string[] = [];
        // GLB 是預覽用的中間格式，不是交付物；FBX 才是這次按鈕要的檔案。
        showProgress(70, '寫出 GLB');
        try {
          await registerGeneratedFile(id, buildFurnitureGlb(model), `${base}.glb`, 'glb');
        } catch (err) {
          problems.push(`GLB 預覽檔：${errorText(err)}`);
        }
        showProgress(82, '寫出 FBX');
        let fbxOk = false;
        try {
          await registerGeneratedFile(id, buildFurnitureFbx(model), `${base}.fbx`, 'fbx');
          fbxOk = true;
        } catch (err) {
          problems.push(`FBX：${errorText(err)}`);
        }
        setReload((n) => n + 1);
        onChanged();
        // FBX 失敗就是這次動作失敗；GLB 只是預覽，不算完成。
        if (!fbxOk) {
          showProgress(100, 'FBX 生成失敗');
          toast.error('FBX 生成失敗', { description: problems.join('；') });
          closeProgressSoon('FBX 生成失敗');
          return;
        }
        if (problems.length > 0) {
          toast.warning('FBX 已生成', { description: problems.join('；') });
          closeProgressSoon('FBX 已可下載');
        } else {
          toast.success('FBX 已可下載');
          closeProgressSoon('FBX 已可下載');
        }
      }
    } catch (err) {
      clearProgress();
      setConfirmShown(true);
      toast.error(`${modelTargetAction(target, '生成')}失敗`, { description: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const shownStyle = draft?.kind
    ? resolveStyle(draft.kind, Number(draft.width) || 0, Number(draft.depth) || 0, Number(draft.height) || 0, draft.style)
    : null;

  const workbench = appearance === 'workbench';
  /** Keep the last frame while the dialog animates out, so it never collapses empty. */
  if (genProgress) lastProgressRef.current = genProgress;
  const shownProgress = genProgress ?? lastProgressRef.current;
  const progressFlowConfig = PROGRESS_FLOW[progressFlow];
  const progressView = {
    steps: progressFlowConfig.steps,
    current: shownProgress
      ? shownProgress.percent >= 100
        ? progressFlowConfig.steps.length
        : progressFlowConfig.index[shownProgress.label] ?? 0
      : 0,
  };
  const progressHint = !shownProgress
      ? ''
      : shownProgress.percent >= 100
        ? '已完成'
        : progressFlowConfig.hints[progressFlowConfig.index[shownProgress.label] ?? 0] ?? '正在處理，請稍候…';
  const commitModelUpload = () => {
    const pending = pendingModel;
    if (!pending) return;
    const note = pendingModelNote.trim();
    setPendingModel(null);
    setPendingModelNote('');
    void run(() => uploadProductModel(productId, pending.file, note), '上載模型失敗');
  };

  const uploadInput = canManage ? (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".skp,.glb,.fbx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setPendingModelNote('');
          setPendingModel({ file });
        }}
      />
      <Modal
        open={pendingModel !== null}
        onOpenChange={(next) => {
          if (!next) setPendingModel(null);
        }}
        title="上載模型檔"
        description={pendingModel?.file.name}
        size="md"
        footer={
          <>
            <ModalButton variant="secondary" onClick={() => setPendingModel(null)}>
              取消
            </ModalButton>
            <ModalButton onClick={commitModelUpload}>上載</ModalButton>
          </>
        }
      >
        <label className="block text-sm font-medium text-foreground">
          版本說明（可留空）
          <Input
            autoFocus
            value={pendingModelNote}
            placeholder="例如：修正椅腳比例"
            onChange={(event) => setPendingModelNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitModelUpload();
            }}
            className="mt-1.5"
          />
        </label>
      </Modal>
    </>
  ) : null;

  if (!files) {
    return (
      <section className="space-y-1.5">
        {!workbench && <h3 className="text-sm font-medium">模型檔</h3>}
        <p className="flex items-center text-xs text-muted-foreground">
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> 載入模型…
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-1.5">
      {skpRequirements.dialog}
      <FurnitureProductScopeDialog detection={scopeRequest?.detection ?? null} images={modelPhotos}
        onCancel={() => { setScopeRequest(null); if (scopeRequest?.target === 'parts') setConfirmShown(true); }}
        onChoose={choice => {
          if (!scopeRequest) return;
          const target = scopeRequest.target;
          setScopeChoice(choice);
          setScopeRequest(null);
          if (target === 'parts') { setConfirmShown(true); void loadParts(choice); }
          else void prepare(target, choice);
        }} />
      <div className={workbench ? 'flex flex-wrap gap-2' : 'flex flex-wrap items-center justify-between gap-2'}>
        {!workbench && <h3 className="text-sm font-medium">模型檔</h3>}
        <div className="flex flex-wrap gap-1.5">
          {/* FDS-06：兩個明確動作，各自對應一個交付格式；GLB 不當主按鈕名稱。 */}
          <Button size="sm" className={workbench ? 'h-10 rounded-lg bg-[#5b4dff] px-4 hover:bg-[#4d40e6]' : 'h-7'} disabled={busy != null} onClick={onSkpAction}>
            {busy === 'skp' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : workbench ? <Sparkles className="mr-1 h-3.5 w-3.5" /> : null}
            {skpButtonLabel}
          </Button>
          <Button size="sm" variant="outline" className={workbench ? 'h-10 rounded-lg border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50' : 'h-7'} disabled={busy != null} onClick={onFbxAction}>
            {busy === 'fbx' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {fbxButtonLabel}
          </Button>
          {workbench ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-10 rounded-lg border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50" disabled={files.length === 0} title={files.length === 0 ? '未有可下載的檔案' : '下載已有的模型檔'}>
                  下載模型 <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {files.length === 0 ? (
                  <DropdownMenuItem disabled>未有可下載的檔案</DropdownMenuItem>
                ) : (
                  latestModelFiles(files).map((file) => (
                    <DropdownMenuItem
                      key={file.id}
                      onClick={() => void downloadModel(file.storage_path, file.file_name).catch((err) => toast.error('下載失敗', { description: errorText(err) }))}
                    >
                      {(file.format ?? '').toUpperCase()} · {modelSourceLabel(file.source)}
                      {file.size_bytes != null ? ` · ${modelSizeLabel(file.size_bytes)}` : ''}
                    </DropdownMenuItem>
                  ))
                )}
                {canManage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={busy != null} onClick={() => inputRef.current?.click()}>
                      上載 SKP／GLB／FBX
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {!workbench && canManage && (
            <Button size="sm" variant="outline" className="h-7" disabled={busy != null} onClick={() => inputRef.current?.click()}>
              {busy === 'upload' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              上載 SKP／GLB／FBX
            </Button>
          )}
          {uploadInput}
        </div>
      </div>
      {!workbench && (
        <p className="text-xs text-muted-foreground">
          用這件產品的尺寸和產品圖辨認結構，確認後生成。SU 是 SKP，完成後可下載；3D 會同時寫出 GLB 和 FBX。
        </p>
      )}
      {filesError && <p className="text-xs text-destructive">讀不到現有模型檔，暫時不能生成。</p>}
      <ProductModelPreviewModal
        file={previewFile}
        open={previewFile != null}
        onOpenChange={(open) => { if (!open) setPreviewFile(null); }}
        onPreviewChange={() => {
          setReload((n) => n + 1);
          onChanged();
        }}
      />
      <Modal
        open={photoRequest != null && busy == null && !partsBusy}
        onOpenChange={open => { if (!open) setPhotoRequest(null); }}
        size="md"
        title="請補充建模參考圖"
        description={extraPhotos.length > 0 ? '已加入補充圖片，繼續後會再次檢查可讀取且不重複的圖片數量。' : photoRequest?.message}
        style={workbench ? WORKBENCH_TONE : undefined}
        footer={<>
          <ModalButton disabled={modelPhotos.length < 2} onClick={() => {
            if (!photoRequest) return;
            const target = photoRequest.target;
            setPhotoRequest(null);
            if (target === 'parts') { setConfirmShown(true); void loadParts(); }
            else void prepare(target);
          }}>繼續生成</ModalButton>
          <ModalButton variant="secondary" onClick={() => setPhotoRequest(null)}>取消</ModalButton>
        </>}
      >
        <div className="space-y-3 text-sm">
          <p>請包含同款家具的正面、側面及背面／底部；重複或無法讀取的圖片不計算，最多使用 6 張。</p>
          <p>候選參考圖：{modelPhotos.length} 張</p>
          <Button size="sm" variant="outline" onClick={() => photoInputRef.current?.click()}>補充參考圖</Button>
          <input ref={photoInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = '';
            setExtraPhotos(current => [...current, ...selected].slice(0, 6));
          }} />
          {extraPhotos.length > 0 && <div className="space-y-1 text-xs text-muted-foreground"><p>補圖只用於本次建模：</p>{extraPhotos.map((file, index) => <button type="button" key={index} className="mr-2 break-all underline" aria-label={`移除 ${file.name}`} onClick={() => setExtraPhotos(current => current.filter((_, i) => i !== index))}>{file.name} ×</button>)}</div>}
        </div>
      </Modal>
      <Modal
        open={reuse != null && genProgress == null && draft == null}
        onOpenChange={(open) => { if (!open && busy == null) setReuse(null); }}
        size="md"
        icon={<Package className="h-6 w-6" />}
        title="已有模型"
        description="可直接下載、預覽或以某版本修改；沿用不會再呼叫 AI。「仍要重新生成」會重新讀圖並建立新版本，舊版本保留。"
        style={workbench ? WORKBENCH_TONE : undefined}
        bodyClassName="space-y-3"
        footer={
          <>
            <ModalButton
              variant="primary"
              disabled={busy != null}
              onClick={() => { if (reuse) start(reuse.target, true); }}
            >
              仍要重新生成
            </ModalButton>
            <ModalButton variant="secondary" onClick={() => setReuse(null)}>
              關閉
            </ModalButton>
          </>
        }
      >
        {(versions?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">參數版本（新到舊）</p>
            <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
              {versions!.map((version) => {
                const size = [version.width_mm, version.depth_mm, version.height_mm].every((n) => typeof n === 'number')
                  ? `${version.width_mm}×${version.depth_mm}×${version.height_mm} mm`
                  : '尺寸未知';
                const open = version.quality_status !== 'accepted' && version.quality_status !== 'rejected';
                return (
                  <li key={version.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <Badge variant={version.quality_status === 'accepted' ? 'default' : 'outline'} className="text-[10px]">{QUALITY_LABEL[version.quality_status]}</Badge>
                    <span className="tabular-nums">{size}</span>
                    <span className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleDateString('zh-HK')}</span>
                    {version.files.length > 0 && <span className="text-xs text-muted-foreground">{version.files.map((f) => f.format.toUpperCase()).join('／')}</span>}
                    {version.parent_id && <span className="text-xs text-muted-foreground">修改自 {version.parent_id.slice(0, 8)}</span>}
                    <span className="ml-auto flex gap-3">
                      <button type="button" className="text-xs text-primary hover:underline disabled:opacity-40" disabled={busy != null} onClick={() => { if (reuse) void editVersion(version, reuse.target); }}>
                        以此版本修改
                      </button>
                      {canManage && open && (
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setReviewId(version.id)}>
                          驗收
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {(reuse?.files.length ?? 0) > 0 && <p className="text-xs font-medium text-muted-foreground">模型檔</p>}
        <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
          {(reuse?.files ?? []).map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Badge variant="outline" className="text-[10px]">{file.format.toUpperCase()}</Badge>
              <span className="min-w-0 flex-1 truncate">{file.file_name ?? file.storage_path.split('/').pop()}</span>
              <span className="text-xs text-muted-foreground">{modelSourceLabel(file.source)}</span>
              {file.version_note && <span className="text-xs text-muted-foreground">「{file.version_note}」</span>}
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setPreviewFile(file)}
              >
                預覽
              </button>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => void downloadModel(file.storage_path, file.file_name).catch((err) => toast.error('下載失敗', { description: errorText(err) }))}
              >
                下載
              </button>
            </li>
          )          )}
        </ul>
      </Modal>
      <FurnitureModelReviewDialog
        modelId={reviewId}
        photos={modelPhotos.filter((src): src is string => typeof src === 'string')}
        onClose={() => setReviewId(null)}
        onReviewed={() => {
          setReviewId(null);
          setReload((n) => n + 1);
        }}
        style={workbench ? WORKBENCH_TONE : undefined}
      />
      <Modal
        open={genProgress != null}
        onOpenChange={() => { /* a running job cannot be dismissed */ }}
        size="2xl"
        hideClose
        icon={shownProgress ? (
          <ProgressRing percent={shownProgress.percent}>
            <Box className="h-7 w-7" strokeWidth={1.6} />
          </ProgressRing>
        ) : null}
        title={shownProgress?.label}
        description={shownProgress ? <span className="text-[15px]">{progressHint}</span> : undefined}
        headerAside={shownProgress ? (
          <span className="text-[28px] font-semibold leading-none tabular-nums text-primary">{shownProgress.percent}%</span>
        ) : null}
        headerClassName="px-6 pt-6 pb-5 sm:px-8 sm:pt-8 sm:pb-6"
        bodyClassName="px-6 pb-7 sm:px-8 sm:pb-8"
        style={workbench ? WORKBENCH_TONE : undefined}
      >
        {shownProgress ? (
          <div className="space-y-6">
            <Progress value={shownProgress.percent} className="h-2" />
            <ProgressSteps steps={progressView.steps} current={progressView.current} />
          </div>
        ) : null}
      </Modal>
      <ModalRoot
        open={!skpRequirements.open && confirmShown && draft != null}
        onOpenChange={(open) => {
          if (open || busy != null || partsBusy) return;
          setConfirmShown(false);
          setDraft(null);
        }}
      >
        <ModalContent
          className="flex h-[min(820px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] max-w-[min(1080px,calc(100vw-1.5rem))] flex-col gap-0 p-0"
          hideClose
          bodyClassName="p-0 sm:p-0 overflow-visible"
          style={workbench ? WORKBENCH_TONE : undefined}
          onInteractOutside={(event) => { if (busy != null || partsBusy) event.preventDefault(); }}
          onEscapeKeyDown={(event) => { if (busy != null || partsBusy) event.preventDefault(); }}
        >
          {draft && (
            <StructureConfirmForm
              draft={draft}
              shownStyle={shownStyle}
              preview={previewModel}
              validationErrors={structureErrors}
              generating={busy != null}
              partsBusy={partsBusy}
              onChange={updateDraft}
              onGenerate={() => void generate()}
              onCancel={() => {
                setDraft(null);
                setConfirmShown(false);
              }}
              onLoadParts={() => void loadParts()}
              onResizePart={resizePart}
              onPartsChange={editParts}
              fittedParts={draft.kind === 'custom' && draftFit ? draftFit.parts : []}
              blockers={evidenceBlockers}
              estimateDraft={estimateDraft}
              evidencePanel={draft.evidence ? <ModelEvidencePanel evidence={draft.evidence} by={userLabel} onChange={changeEvidence} /> : undefined}
              suggestionPanel={suggestion ? <PartSuggestionPanel changes={suggestion.changes} onApply={applySuggestion} onDismiss={() => setSuggestion(null)} /> : undefined}
              onSaveDraft={() => void saveDraftOnly()}
            />
          )}
        </ModalContent>
      </ModalRoot>
      {skp && skp.status !== 'none' && (
        <p className={skp.status === 'failed' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {skpStatusText(skp)}
        </p>
      )}
      {!workbench && files.length === 0 ? (
        <p className="text-xs text-muted-foreground">未有模型檔。</p>
      ) : !workbench ? (
        <ul className="space-y-1 text-xs">
          {latestModelFiles(files).map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-semibold">
                {(f.format ?? f.model_type).toUpperCase()}
              </Badge>
              <span className="truncate">{f.file_name ?? `${f.format ?? f.model_type}`}</span>
              {f.size_bytes != null && (
                <span className="text-muted-foreground">{modelSizeLabel(f.size_bytes)}</span>
              )}
              {f.source === 'generated' && <span className="text-muted-foreground">AI 生成</span>}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => void downloadModel(f.storage_path, f.file_name).catch((err) => toast.error('下載失敗', { description: errorText(err) }))}
              >
                下載
              </button>
              {canManage && f.source === 'uploaded' && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy != null}
                  onClick={async () => {
                    const ok = await confirm({
                      title: '刪除這個模型檔？',
                      description: '刪除後無法復原，需要重新上載。',
                      confirmLabel: '刪除',
                      destructive: true,
                    });
                    if (ok) void run(() => deleteProductModel(f.id), '刪除模型失敗');
                  }}
                >
                  刪除
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ProductDetailPage({
  productId,
  onClose,
  onOpenProduct,
  onOpenSource,
  onModelsChanged,
}: {
  productId: string;
  onClose: () => void;
  onOpenProduct: (productId: string) => void;
  onOpenSource: (request: SourcePageRequest & { title?: string | null }) => void;
  onModelsChanged: () => void;
}) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [compare, setCompare] = useState<SupplierCompare | null>(null);
  const [modelFiles, setModelFiles] = useState<ProductModelFile[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [resolvingPriceId, setResolvingPriceId] = useState<string | null>(null);

  const choosePrice = async (priceId: string) => {
    setResolvingPriceId(priceId);
    try {
      await resolveSupplierPriceConflict(priceId);
      toast.success('已採用這筆報價。同年其他價格仍保留，但不再當作有效價。');
      setReloadKey((key) => key + 1);
    } catch (err) {
      toast.error('未能採用報價', { description: errorText(err) });
    } finally {
      setResolvingPriceId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setCompare(null);
    fetchProductDetail(productId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        toast.error('讀取產品失敗', { description: errorText(err) });
        onClose();
      });
    fetchSupplierCompare(productId)
      .then((c) => {
        if (!cancelled) setCompare(c);
      })
      .catch((err) => {
        if (!cancelled) toast.error('讀取供應商比較失敗', { description: errorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [productId, onClose, reloadKey]);

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f4f6fb] text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
      </div>
    );
  }

  const quotes = detail.can_view_cost ? (
    <div className="space-y-4 text-slate-700">
      {detail.prices.length === 0 ? (
        <p className="text-xs text-slate-400">未有經審核的供應商報價。</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">規格</th>
                <th className="px-2 py-1.5 text-left font-medium">年份</th>
                <th className="px-2 py-1.5 text-left font-medium">價格</th>
                <th className="px-2 py-1.5 text-left font-medium">廠家</th>
                <th className="px-2 py-1.5 text-left font-medium">單位／MOQ</th>
                <th className="px-2 py-1.5 text-left font-medium">有效期</th>
                <th className="px-2 py-1.5 text-left font-medium">來源</th>
                <th className="px-2 py-1.5 text-left font-medium">匯入日期</th>
              </tr>
            </thead>
            <tbody>
              {detail.prices.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{row.variant_label ?? '標準'}</td>
                  <td className="px-2 py-1.5">{row.quote_year ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    <div>{row.cost != null ? `${row.currency ?? ''} ${row.cost}`.trim() : '—'}</div>
                    {row.price_conflict && (
                      <button
                        type="button"
                        className="mt-1 text-amber-800 underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={resolvingPriceId !== null}
                        onClick={() => void choosePrice(row.id)}
                      >
                        {resolvingPriceId === row.id ? '採用中…' : '同年衝突，採用此價'}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{row.factory_name ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    {[row.unit, row.moq != null ? `MOQ ${row.moq}` : null].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px] font-normal', VALIDITY_CLASS[row.validity])}>
                      {VALIDITY_LABELS[row.validity]}
                    </Badge>
                    {(row.valid_from || row.valid_to) && (
                      <div className="mt-0.5 text-slate-500">
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
                      canOpen={detail.can_open_source}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">{row.created_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SupplierCompareSection
        compare={compare}
        keepId={detail.id}
        canMerge={detail.can_view_cost}
        canOpenSource={detail.can_open_source}
        onOpenSource={onOpenSource}
        onMerged={() => setReloadKey((n) => n + 1)}
      />
    </div>
  ) : null;

  const documents = detail.sources.length === 0 ? (
    <p className="text-slate-400">未提供文件</p>
  ) : (
    <ul className="space-y-1 text-xs">
      {detail.sources.map((source) => (
        <li key={`${source.document_id}-${source.page_no}`} className="flex items-center gap-2">
          <span className="text-slate-500">{source.doc_type === 'catalog' ? '目錄' : '報價單'}</span>
          <SourceLink
            title={source.title}
            page={source.page_no}
            documentId={source.document_id}
            productId={detail.id}
            onOpen={onOpenSource}
            canOpen={detail.can_open_source}
          />
          {source.factory_name && <span className="text-slate-500">· {source.factory_name}</span>}
        </li>
      ))}
    </ul>
  );

  return (
    <ProductWorkbench
      detail={detail}
      onClose={onClose}
      onOpenProduct={onOpenProduct}
      actions={() => (
        <div
          className="text-slate-900"
          style={{
            ['--muted-foreground' as string]: '215 16% 47%',
            ['--foreground' as string]: '222 47% 11%',
            ['--muted' as string]: '210 40% 96%',
            ['--border' as string]: '214 32% 91%',
            ['--background' as string]: '0 0% 100%',
            ['--primary' as string]: '243 100% 68%',
            ['--primary-foreground' as string]: '0 0% 100%',
          }}
        >
          <ProductModelsSection
            product={detail}
            canManage={detail.can_view_cost}
            onChanged={onModelsChanged}
            onFiles={setModelFiles}
            appearance="workbench"
          />
        </div>
      )}
      quotes={quotes}
      documents={documents}
      modelFiles={modelFiles}
    />
  );
}

function SourceLink({
  title,
  page,
  documentId,
  productId,
  onOpen,
  canOpen = true,
}: {
  title?: string | null;
  page?: number | null;
  documentId?: string;
  productId: string;
  onOpen: (request: SourcePageRequest & { title?: string | null }) => void;
  /** Private supplier PDF: only admin / uploader may open it. */
  canOpen?: boolean;
}) {
  const label = `${title ?? '供應商文件'}${page != null ? ` · 第 ${page} 頁` : ''}`;
  if (!documentId || !canOpen) return <span className="text-muted-foreground">{label}</span>;
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
