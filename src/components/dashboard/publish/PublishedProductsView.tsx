import { Fragment, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCheck, Search, ArrowDownToLine, ArrowUpToLine, RotateCcw, ChevronDown,
  CloudDownload, Loader2, X, Store, RefreshCw, ArrowUp, ArrowDown, GitMerge, FolderTree,
  ScanSearch, Tag, BadgeDollarSign, Send, Database,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { PUBLISH_STATE_META, type PublishState } from '@/constants/analytics-mock';
import { supabase } from '@/lib/supabase';
import { invokeEdgeFunctionDirect } from '@/lib/invokeEdgeFunction';
import { resolveMirrorPrimaryImageUrl } from '@/lib/shopifyMirrorImages';
import {
  findSimilarProductGroups,
  paginateKeepingGroups,
  type SimilarProductCriterion,
  type SimilarProductGroup,
} from '@/lib/similarProducts';
import { withUpdateAuditFields } from '@/lib/pmsAudit';
import {
  sortByCategoryRegistryOrder,
  uniqueLevel1InOrder,
  uniqueLevel2InOrder,
} from '@/lib/productCategoryOptions';
import { toast } from 'sonner';
import { PublishedProductDetailModal, type PublishedDisplayProduct } from './PublishedProductDetailModal';
import { PublishedProductMergeModal } from './PublishedProductMergeModal';
import { CategoryTagPicker, type BwfCat } from './CategoryTagPicker';

/** Bulk sync: low concurrency + spacing to avoid Shopify 429 (2 req/s). */
const SHOPIFY_PUSH_CONCURRENCY_BULK = 1;
const SHOPIFY_PUSH_CONCURRENCY_SMALL = 2;
const SHOPIFY_PUSH_BULK_THRESHOLD = 10;
const SHOPIFY_PUSH_INTERVAL_MS = 700;
const SHOPIFY_PUSH_MAX_RETRIES = 4;
const SHOPIFY_PUSH_TIMEOUT_MS = 90 * 1000;
/** Above this count, SKU chip list starts collapsed to avoid pushing the table off-screen. */
const SELECTED_SKU_COLLAPSE_THRESHOLD = 12;
const CHANGE_LABEL_ZH: Record<string, string> = {
  title: '標題',
  description: '描述',
  vendor: '廠商',
  product_type: '分類',
  tags: '標籤',
  price: '價格',
  sku: 'SKU',
  variants: '款式',
  compare_at_price: '對比價',
  images: '圖片',
  variant_images: '款式圖',
  metafields: '屬性',
  seo: 'SEO',
};

function formatSyncChanges(changes: string[] | undefined): string {
  if (!changes?.length) return '';
  return changes.map((c) => CHANGE_LABEL_ZH[c] || c).join('、');
}

function isRateLimitError(msg: string): boolean {
  return /429|calls per second|rate limit|Reduce request rates/i.test(msg);
}

function parseSyncItemResult(data: Record<string, unknown> | null | undefined): {
  pushed: number;
  skipped: number;
  failed: number;
  changes?: string[];
  error?: string;
} {
  if (!data) return { pushed: 0, skipped: 0, failed: 1, error: '未知錯誤' };
  const itemResults = Array.isArray(data.results) ? data.results as {
    action?: string;
    changes?: string[];
    error?: string;
  }[] : [];
  const item = itemResults[0];
  if (item?.action === 'skipped') return { pushed: 0, skipped: 1, failed: 0 };
  if (item?.action === 'pushed') {
    return { pushed: 1, skipped: 0, failed: 0, changes: item.changes };
  }
  if (item?.action === 'failed') {
    const batchErr = Array.isArray(data.errors) && data.errors[0]?.error
      ? String((data.errors[0] as { error?: string }).error)
      : undefined;
    return {
      pushed: 0,
      skipped: 0,
      failed: 1,
      error: item.error || batchErr || (data.error as string) || '未知錯誤',
    };
  }
  return {
    pushed: Number(data.pushed ?? 0),
    skipped: Number(data.skipped ?? 0),
    failed: Number(data.failed ?? 0),
    error: data.error as string | undefined,
  };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  opts?: { intervalMs?: number },
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  let lastStartAt = 0;
  const intervalMs = opts?.intervalMs ?? 0;
  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        if (intervalMs > 0) {
          const now = Date.now();
          const wait = intervalMs - (now - lastStartAt);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          lastStartAt = Date.now();
        }
        await worker(items[i], i);
      }
    }),
  );
}

async function parseInvokeError(
  error: unknown,
  data?: { error?: string } | null,
): Promise<string> {
  if (data?.error) return data.error;
  if (!error || typeof error !== 'object') return '未知錯誤';
  const err = error as {
    message?: string;
    name?: string;
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  if (err.name === 'FunctionsHttpError' && err.context) {
    try {
      if (typeof err.context.json === 'function') {
        const body = await err.context.json() as { error?: string };
        if (body?.error) return body.error;
      } else if (typeof err.context.text === 'function') {
        const raw = await err.context.text();
        try {
          const body = JSON.parse(raw) as { error?: string };
          if (body?.error) return body.error;
        } catch {
          return raw.slice(0, 200);
        }
      }
    } catch { /* ignore parse errors */ }
  }
  return err.message || '未知錯誤';
}

interface ShopifyVariant {
  id?: string | number;
  title?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  sku?: string;
  price?: string | number;
  compare_at_price?: string | number | null;
  inventory_quantity?: number;
  cost?: number | string | null;
}

interface ShopifyImage {
  id?: string | number;
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  position?: number;
}

interface ShopifyPreviewProduct {
  shopify_product_id: string;
  title: string;
  body_html?: string;
  vendor: string;
  product_type: string;
  handle?: string;
  status: string;
  published_at: string | null;
  image_url: string | null;
  images?: ShopifyImage[];
  variants?: ShopifyVariant[];
  tags?: string[];
  price: number;
  compare_at_price?: number | null;
  shopify_created_at?: string | null;
  shopify_updated_at?: string | null;
  variants_count: number;
}

interface ShopifyProductRow {
  id: string;
  shopify_product_id: string;
  source_product_id?: string | null;
  title: string | null;
  body_html?: string | null;
  vendor: string | null;
  product_type: string | null;
  handle?: string | null;
  status: string | null;
  published_at: string | null;
  image_url: string | null;
  images?: ShopifyImage[] | null;
  variants?: ShopifyVariant[] | null;
  tags?: string[] | null;
  price: number | null;
  compare_at_price?: number | null;
  shopify_created_at?: string | null;
  shopify_updated_at: string | null;
  imported_at: string;
  shop_domain?: string | null;
  'my_fields.normal_size'?: string | null;
  'my_fields.materials'?: string | null;
  cost?: number | null;
  sku?: string | null;
  configurable?: string | null;
  shopify_page_title?: string | null;
  shopify_page_description?: string | null;
  shopify_url?: string | null;
}

interface DisplayProduct extends PublishedDisplayProduct {
  imageUrl: string;
  factory: string;
  publishedAt: string;
  views: number;
  lastEditor: string;
  costPrice: number | null;
}

type AuditListFilter = PublishState | 'all' | 'exclude-a';

const STATE_FILTERS: { key: PublishState | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已發佈' },
  { key: 'delisted', label: '已下架' },
];

/** 價錢核對：顯示 價格 ≤ 成本 × 倍數 的產品 */
const PRICE_CHECK_OPTIONS = [
  { value: 1.5, label: '≤1.5倍' },
  { value: 2, label: '≤2 倍' },
  { value: 3, label: '≤3 倍' },
  { value: 4, label: '≤4 倍' },
] as const;

type PriceCheckMultiplier = number;

function formatPriceCheckLabel(multiplier: number): string {
  const preset = PRICE_CHECK_OPTIONS.find((o) => o.value === multiplier);
  if (preset) return preset.label;
  const shown = Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1);
  return `≤${shown}倍`;
}

/** 自訂倍數：正數，最多一位小數（5、5.1、2.9）。 */
function parseOneDecimalMultiplier(raw: string): number | null {
  const s = String(raw).trim();
  if (!/^\d+(\.\d)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function sanitizeOneDecimalMultiplierInput(raw: string): string {
  let s = raw.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) {
    s = `${s.slice(0, dot)}.${s.slice(dot + 1).replace(/\./g, '').slice(0, 1)}`;
  }
  return s;
}

/** 列表／詳情：價格 ≤ 成本 × 此倍數時標紅 */
const PRICE_ALERT_MULTIPLIER = 1.5;

function matchesPriceCheckFilter(
  price: number | string | null | undefined,
  cost: number | null | undefined,
  multiplier: number,
): boolean {
  const p = typeof price === 'string' ? parseFloat(price) : Number(price);
  const c = cost != null ? Number(cost) : NaN;
  const priceMissingOrZero = !Number.isFinite(p) || p <= 0;
  const costMissingOrZero = !Number.isFinite(c) || c <= 0;
  // 沒有售價／成本（含 0）視為 ≤0.1 倍，因此會出現在所有 ≥0.1 的倍數篩選（1.5／2／3／4 與自訂）。
  if (priceMissingOrZero || costMissingOrZero) {
    return multiplier >= 0.1;
  }
  return p <= c * multiplier;
}

function resolveVariantCost(
  variant: ShopifyVariant | undefined,
  productCost: number | null | undefined,
): number | null | undefined {
  if (variant?.cost != null && variant.cost !== '') {
    const n = typeof variant.cost === 'string' ? parseFloat(variant.cost) : Number(variant.cost);
    if (Number.isFinite(n)) return n;
  }
  return productCost;
}

/** True if the visible list 價格 (or any extra variant) is ≤ cost × multiplier. */
function productMatchesPriceMultiplier(
  price: number | string | null | undefined,
  variants: ShopifyVariant[] | null | undefined,
  cost: number | null | undefined,
  multiplier: number,
): boolean {
  const list = Array.isArray(variants) ? variants : [];
  // Single / no variant: colour matches the number shown in 價格 (product.price).
  if (list.length <= 1) {
    return matchesPriceCheckFilter(price, resolveVariantCost(list[0], cost), multiplier);
  }
  if (matchesPriceCheckFilter(price, cost, multiplier)) return true;
  return list.some((v) => matchesPriceCheckFilter(v.price, resolveVariantCost(v, cost), multiplier));
}

/** True if the visible list 價格 (or any extra variant) is ≤ cost × 1.5. */
function productHasPriceAlert(
  price: number | string | null | undefined,
  variants: ShopifyVariant[] | null | undefined,
  cost: number | null | undefined,
): boolean {
  return productMatchesPriceMultiplier(price, variants, cost, PRICE_ALERT_MULTIPLIER);
}

function parsePriceMultiplierInput(raw: string): number | null {
  const n = parseFloat(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** cost × multiplier, round up to integer (avoid float dust under-ceiling). */
function ceilCostTimesMultiplier(cost: number, multiplier: number): number {
  const product = cost * multiplier;
  const cleaned = Math.round(product * 1e6) / 1e6;
  return Math.ceil(cleaned);
}

function variantPriceNumber(v: ShopifyVariant): number {
  const p = typeof v.price === 'string' ? parseFloat(v.price) : Number(v.price);
  return Number.isFinite(p) ? p : NaN;
}

function pricesAlreadyMatch(current: number, target: number): boolean {
  return Number.isFinite(current) && Math.abs(current - target) < 0.005;
}

function shopifyStatusToState(status: string | null): PublishState {
  if (status === 'active') return 'published';
  if (status === 'archived') return 'delisted';
  return 'unpublished';
}

function rowToDisplay(r: ShopifyProductRow, costFallback: number | null = null): DisplayProduct {
  return {
    id: r.id,
    shopify_product_id: r.shopify_product_id,
    title: r.title || '(未命名)',
    imageUrl: resolveMirrorPrimaryImageUrl(r),
    factory: r.vendor || '—',
    state: shopifyStatusToState(r.status),
    publishedAt: r.published_at || r.imported_at,
    views: 0,
    lastEditor: '—',
    costPrice: r.cost != null ? Number(r.cost) : costFallback,
    sourceKind: 'shopify',
    isOnShopify: true,
    raw: r,
  };
}

const CATALOG_LIST_COLUMNS =
  'id, title, image_url, tags, price, sale_price, cost_price, factories_display_name, level1_category, level2_category, sku, product_sku, shopify_product_id, dimension_l_mm, dimension_w_mm, dimension_h_mm, created_at';

type CatalogProductListRow = {
  id: string;
  title: string | null;
  image_url: string | null;
  tags?: string[] | null;
  price?: number | null;
  sale_price?: number | null;
  cost_price?: number | null;
  factories_display_name?: string | null;
  level1_category?: string | null;
  level2_category?: string | null;
  sku?: string | null;
  product_sku?: string | null;
  shopify_product_id?: string | null;
  dimension_l_mm?: number | null;
  dimension_w_mm?: number | null;
  dimension_h_mm?: number | null;
  created_at?: string | null;
};

function formatCatalogSize(row: CatalogProductListRow): string {
  const w = row.dimension_w_mm;
  const d = row.dimension_l_mm;
  const h = row.dimension_h_mm;
  if (w == null && d == null && h == null) return '';
  return `${w ?? '—'}(W) x ${d ?? '—'}(D) x ${h ?? '—'}(H)(mm)`;
}

type ShopifyCatalogLink = {
  shopify_product_id: string;
  title: string | null;
  imageUrl?: string;
};

function isStandaloneUploadedRow(row: { configurable?: unknown }): boolean {
  return !(typeof row.configurable === 'string' && row.configurable.trim());
}

function shopifyRowToCatalogLink(row: {
  shopify_product_id?: string | null;
  title?: string | null;
  image_url?: string | null;
  images?: unknown;
}): ShopifyCatalogLink | null {
  const sid = String(row.shopify_product_id || '').trim();
  if (!sid) return null;
  return {
    shopify_product_id: sid,
    title: row.title ?? null,
    imageUrl: resolveMirrorPrimaryImageUrl(row),
  };
}

function resolveCatalogListImage(
  row: CatalogProductListRow,
  shopifyLink?: ShopifyCatalogLink | null,
): string {
  const fromShopify = (shopifyLink?.imageUrl || '').trim();
  if (fromShopify.startsWith('http')) return fromShopify;
  const raw = (row.image_url || '').trim();
  if (raw && !raw.startsWith('data:')) return raw;
  return '';
}

function catalogRowToDisplay(
  row: CatalogProductListRow,
  shopifyLink?: ShopifyCatalogLink | null,
): DisplayProduct {
  const sale = row.sale_price != null ? Number(row.sale_price) : (row.price != null ? Number(row.price) : null);
  const cost = row.cost_price != null ? Number(row.cost_price) : null;
  const shopifyId = String(shopifyLink?.shopify_product_id || '').trim();
  const onShopify = Boolean(shopifyId);
  const l1 = (row.level1_category || '').trim();
  const l2 = (row.level2_category || '').trim();
  const imageUrl = resolveCatalogListImage(row, shopifyLink);
  const created = row.created_at || '';
  return {
    id: row.id,
    shopify_product_id: shopifyId,
    title: row.title || '(未命名)',
    imageUrl,
    factory: row.factories_display_name || '—',
    state: onShopify ? 'published' : 'unpublished',
    publishedAt: created,
    views: 0,
    lastEditor: '—',
    costPrice: Number.isFinite(cost as number) ? cost : null,
    sourceKind: 'catalog',
    isOnShopify: onShopify,
    shopifyTitle: shopifyLink?.title ?? null,
    raw: {
      id: row.id,
      shopify_product_id: shopifyId,
      source_product_id: row.id,
      title: row.title,
      vendor: row.factories_display_name || null,
      product_type: [l1, l2].filter(Boolean).join(' / ') || null,
      price: Number.isFinite(sale as number) ? sale : null,
      cost: Number.isFinite(cost as number) ? cost : null,
      sku: (row.product_sku || row.sku || '').trim() || null,
      variants: null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      status: onShopify ? 'active' : 'draft',
      image_url: imageUrl || null,
      published_at: null,
      imported_at: created,
      shopify_updated_at: created,
      'my_fields.normal_size': formatCatalogSize(row) || null,
    },
  };
}

function resolveProductSku(row: ShopifyProductRow): string {
  const direct = (row.sku || '').trim();
  if (direct) return direct;
  return formatVariantSkus(Array.isArray(row.variants) ? row.variants : []);
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return '—';
  return `$${num.toLocaleString()}`;
}

function formatVariantSkus(variants: ShopifyVariant[]): string {
  const skus = variants.map((v) => (v.sku || '').trim()).filter(Boolean);
  if (skus.length === 0) return '—';
  return skus.join(', ');
}

/** Primary SKU for sorting — prefers shopify_products.sku, then variants. */
function primarySortSku(row: ShopifyProductRow): string {
  const direct = (row.sku || '').trim();
  if (direct) return direct;
  return primarySortSkuFromVariants(row.variants);
}

function primarySortSkuFromVariants(variants: ShopifyVariant[] | null | undefined): string {
  const skus = (variants ?? [])
    .map((v) => (v.sku || '').trim())
    .filter(Boolean);
  if (skus.length === 0) return '';
  return skus.slice().sort(compareSkuNatural)[0];
}

function numericOrNaN(value: number | string | null | undefined): number {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function compareNullableNumber(a: number, b: number): number {
  const aOk = Number.isFinite(a);
  const bOk = Number.isFinite(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return a - b;
}

/** 「全部」：已發佈在前，已下架在後。 */
function publishGroupRank(state: PublishState): number {
  if (state === 'published') return 0;
  if (state === 'delisted') return 1;
  return 2;
}

/** 售價 ≤ 成本 × 1.5（紅字）排在該狀態組最前。 */
function priceAlertRank(p: DisplayProduct): number {
  const variants = Array.isArray(p.raw.variants) ? p.raw.variants : [];
  return productHasPriceAlert(p.raw.price, variants, p.costPrice) ? 0 : 1;
}

type UploadedListSortKey = 'sku' | 'price' | 'cost';

/** Letters a→z, then numeric chunks 1→9 (natural / alphanumeric order). */
function compareSkuNatural(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
}

export function PublishedProductsView({
  mode = 'catalog',
}: {
  mode?: 'catalog' | 'price-audit';
} = {}) {
  const priceAudit = mode === 'price-audit';
  const tableColCount = priceAudit ? 10 : 14;
  const thumbPx = priceAudit ? 180 : 150;
  const [items, setItems] = useState<DisplayProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<AuditListFilter>(
    priceAudit ? 'published' : 'all',
  );
  const [catalogClass, setCatalogClass] = useState<'A' | 'B'>('A');
  /** 與「已上載產品」相同：獨立 shopify_products（不含合併子產品）件數 */
  const [uploadedShopifyTotal, setUploadedShopifyTotal] = useState(0);
  const [factoryFilter, setFactoryFilter] = useState('全部');
  const [level1Filter, setLevel1Filter] = useState('');
  const [level2Filter, setLevel2Filter] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  /** Default SKU ↑. 價格／成本 start inactive (↓); click = green ↓ asc, click again = green ↑ desc. */
  const [sortKey, setSortKey] = useState<UploadedListSortKey>('sku');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [detailProduct, setDetailProduct] = useState<DisplayProduct | null>(null);
  const [previewProducts, setPreviewProducts] = useState<ShopifyPreviewProduct[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importSearch, setImportSearch] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [isRepairingMetafields, setIsRepairingMetafields] = useState(false);
  const [isReconcilingMirror, setIsReconcilingMirror] = useState(false);
  const [mergeProducts, setMergeProducts] = useState<DisplayProduct[]>([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [skuChipsExpanded, setSkuChipsExpanded] = useState(false);
  const [similarPopoverOpen, setSimilarPopoverOpen] = useState(false);
  const [similarCriteriaDraft, setSimilarCriteriaDraft] = useState<SimilarProductCriterion[]>([
    'name',
    'sku',
  ]);
  const [similarCriteriaActive, setSimilarCriteriaActive] = useState<SimilarProductCriterion[] | null>(
    null,
  );
  const [priceCheckMultiplier, setPriceCheckMultiplier] = useState<PriceCheckMultiplier | null>(
    priceAudit ? 1.5 : null,
  );
  const [priceCheckMenuOpen, setPriceCheckMenuOpen] = useState(false);
  const [priceCheckCustomDraft, setPriceCheckCustomDraft] = useState('');
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  const [bwfCats, setBwfCats] = useState<BwfCat[]>([]);
  const [bulkCategoryPickerOpen, setBulkCategoryPickerOpen] = useState(false);
  const [bulkEditL1, setBulkEditL1] = useState('');
  const [bulkEditL2, setBulkEditL2] = useState('');
  const [categoryConfirmOpen, setCategoryConfirmOpen] = useState(false);
  const [isBulkUpdatingCategory, setIsBulkUpdatingCategory] = useState(false);
  const [bulkAddTagsOpen, setBulkAddTagsOpen] = useState(false);
  const [bulkAddTags, setBulkAddTags] = useState<string[]>([]);
  const [isBulkAddingTags, setIsBulkAddingTags] = useState(false);
  const [bulkPriceEditOpen, setBulkPriceEditOpen] = useState(false);
  const [bulkPriceMultiplierInput, setBulkPriceMultiplierInput] = useState('');
  const [isBulkUpdatingPrice, setIsBulkUpdatingPrice] = useState(false);

  useEffect(() => {
    supabase
      .from('product_category')
      .select('level1, level2, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data: cats }) => {
        if (cats) setCategoryPairs(cats as { level1: string; level2: string }[]);
      });
    supabase
      .from('bwf_product_categories')
      .select('id,name,parent_id,level,sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data) setBwfCats(data as BwfCat[]);
      });
  }, []);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setBulkCategoryPickerOpen(false);
      setBulkEditL1('');
      setBulkEditL2('');
      setCategoryConfirmOpen(false);
      setBulkAddTagsOpen(false);
      setBulkAddTags([]);
    }
  }, [selectedIds.length]);

  const loadProducts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true);
    try {
      if (priceAudit && catalogClass === 'B') {
        const pageSize = 1000;
        const catalogRows: CatalogProductListRow[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from('products')
            .select(CATALOG_LIST_COLUMNS)
            .eq('in_catalog', true)
            .not('dismissed', 'is', true)
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);
          if (error) {
            toast.error('讀取目錄產品失敗', { description: error.message });
            setItems([]);
            return;
          }
          const pageRows = (data ?? []) as unknown as CatalogProductListRow[];
          catalogRows.push(...pageRows);
          if (!data || data.length < pageSize) break;
          from += pageSize;
        }

        const linkByProductId = new Map<string, ShopifyCatalogLink>();
        const liveByShopifyId = new Map<string, ShopifyCatalogLink>();
        const ids = catalogRows.map((r) => r.id);
        const uploadedSelect =
          'source_product_id,shopify_product_id,title,image_url,images,configurable';
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const { data: shopifyRows } = await supabase
            .from('shopify_products')
            .select(uploadedSelect)
            .in('source_product_id', chunk)
            .is('configurable', null);
          for (const row of shopifyRows ?? []) {
            if (!isStandaloneUploadedRow(row)) continue;
            const pid = String(row.source_product_id || '').trim();
            const link = shopifyRowToCatalogLink(row);
            if (pid && link) {
              linkByProductId.set(pid, link);
              liveByShopifyId.set(link.shopify_product_id, link);
            }
          }
        }
        const catalogShopifyIds = [...new Set(
          catalogRows
            .map((r) => String(r.shopify_product_id || '').trim())
            .filter((sid) => sid && !liveByShopifyId.has(sid)),
        )];
        for (let i = 0; i < catalogShopifyIds.length; i += 100) {
          const chunk = catalogShopifyIds.slice(i, i + 100);
          const { data: shopifyRows } = await supabase
            .from('shopify_products')
            .select(uploadedSelect)
            .in('shopify_product_id', chunk)
            .is('configurable', null);
          for (const row of shopifyRows ?? []) {
            if (!isStandaloneUploadedRow(row)) continue;
            const link = shopifyRowToCatalogLink(row);
            if (link) liveByShopifyId.set(link.shopify_product_id, link);
          }
        }

        const { count: uploadedCount } = await supabase
          .from('shopify_products')
          .select('id', { count: 'exact', head: true })
          .is('configurable', null);
        setUploadedShopifyTotal(uploadedCount ?? 0);

        setItems(catalogRows.map((row) => {
          const bySource = linkByProductId.get(row.id);
          const sid = String(row.shopify_product_id || '').trim();
          const byShopifyId = sid ? liveByShopifyId.get(sid) : undefined;
          return catalogRowToDisplay(row, bySource ?? byShopifyId ?? null);
        }));
        return;
      }

      // Only standalone listings: merged children have configurable = parent SKU and
      // must never appear in 全部 / 已發佈 / 已下架 (已下架 = manual delist only).
      const { data, error } = await supabase
        .from('shopify_products')
        .select('*')
        .is('configurable', null)
        .order('imported_at', { ascending: false })
        .order('published_at', { ascending: false, nullsFirst: true });
      if (error) {
        toast.error('讀取產品失敗', { description: error.message });
        setItems([]);
      } else {
        const rows = (data ?? []).filter(
          (r) => !(typeof r.configurable === 'string' && r.configurable.trim()),
        );
        const sourceIds = rows
          .map((r) => r.source_product_id)
          .filter(Boolean) as string[];
        const costByProductId: Record<string, number> = {};
        if (sourceIds.length > 0) {
          const { data: costRows } = await supabase
            .from('products')
            .select('id, cost_price')
            .in('id', sourceIds);
          costRows?.forEach((p: { id: string; cost_price: number | null }) => {
            if (p.cost_price != null) costByProductId[p.id] = Number(p.cost_price);
          });
        }
        setUploadedShopifyTotal(rows.length);
        setItems(rows.map((r) => ({
          ...rowToDisplay(
            r,
            r.source_product_id ? (costByProductId[r.source_product_id] ?? null) : null,
          ),
        })));
      }
    } finally {
      if (!opts?.silent) setIsLoading(false);
    }
  }, [priceAudit, catalogClass]);

  // Diff-first sync: one product per request, concurrent workers, skip unchanged items.
  // Optional localIds / toastId let callers (e.g. 修改售價) auto-push after a local write.
  const pushToShopify = useCallback(async (opts?: {
    localIds?: string[];
    toastId?: string | number;
    successTitle?: string;
    progressLabel?: string;
  }) => {
    const targetLocalIds = opts?.localIds ?? selectedIds;
    const selectedRows = items.filter((p) => targetLocalIds.includes(p.id));
    if (selectedRows.length === 0) {
      if (!opts?.localIds) toast.message('請先勾選要同步至 Shopify 的產品');
      return { pushed: 0, skipped: 0, failed: 0 };
    }
    const shopifyIds = [...new Set(
      selectedRows
        .map((p) => p.shopify_product_id)
        .filter((id) => /^\d+$/.test(id)),
    )];
    if (shopifyIds.length === 0) {
      toast.error('選中產品沒有有效的 Shopify Product ID，無法同步', {
        id: opts?.toastId,
      });
      return { pushed: 0, skipped: 0, failed: shopifyIds.length };
    }

    const titleByShopifyId = new Map(
      selectedRows.map((p) => [p.shopify_product_id, p.title] as const),
    );

    setIsSyncing(true);
    const progressLabel = opts?.progressLabel || '正在檢查並同步';
    const toastId = opts?.toastId
      ?? toast.loading(`${progressLabel} (0/${shopifyIds.length})…`);
    let pushed = 0;
    let skipped = 0;
    let failed = 0;
    let processed = 0;
    let firstErr: string | undefined;
    const skippedTitles: string[] = [];
    const updatedSummaries: string[] = [];

    const updateProgressToast = () => {
      const parts = [`${progressLabel} (${processed}/${shopifyIds.length})`];
      if (pushed > 0) parts.push(`已更新 ${pushed}`);
      if (skipped > 0) parts.push(`略過 ${skipped}`);
      if (failed > 0) parts.push(`失敗 ${failed}`);
      toast.loading(parts.join(' · '), { id: toastId });
    };

    const concurrency = shopifyIds.length > SHOPIFY_PUSH_BULK_THRESHOLD
      ? SHOPIFY_PUSH_CONCURRENCY_BULK
      : SHOPIFY_PUSH_CONCURRENCY_SMALL;
    const intervalMs = shopifyIds.length > SHOPIFY_PUSH_BULK_THRESHOLD
      ? SHOPIFY_PUSH_INTERVAL_MS
      : 350;

    const invokeOne = async (shopifyProductId: string) => {
      let lastError: string | undefined;
      let lastData: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt <= SHOPIFY_PUSH_MAX_RETRIES; attempt++) {
        const { data, error } = await invokeEdgeFunctionDirect(
          'supabase-functions-update-shopify-product',
          { push_from_mirror: true, shopify_product_id: shopifyProductId },
          { timeoutMs: SHOPIFY_PUSH_TIMEOUT_MS },
        );
        lastData = (data as Record<string, unknown> | null) ?? null;
        if (!error && !data?.error && data?.success !== false) {
          return { data: lastData, error: null as Error | null };
        }
        lastError = error?.message || (data?.error as string) || '未知錯誤';
        const isRetryable = /504|502|408|429|逾時|timeout|calls per second|rate limit/i.test(lastError);
        if (!isRetryable || attempt === SHOPIFY_PUSH_MAX_RETRIES) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      return { data: lastData, error: new Error(lastError || '未知錯誤') };
    };

    try {
      toast.loading(`${progressLabel} (0/${shopifyIds.length})…`, { id: toastId });

      await runWithConcurrency(shopifyIds, concurrency, async (sid) => {
        const result = await invokeOne(sid);
        processed += 1;

        if (!result.data && result.error) {
          failed += 1;
          if (!firstErr) firstErr = result.error.message;
        } else {
          const parsed = parseSyncItemResult(result.data);
          if (parsed.failed > 0) {
            failed += parsed.failed;
            if (!firstErr) {
              firstErr = parsed.error || result.error?.message || '未知錯誤';
            }
          }
          if (parsed.skipped > 0) {
            skipped += parsed.skipped;
            const title = titleByShopifyId.get(sid);
            if (title && skippedTitles.length < 5) skippedTitles.push(title);
          }
          if (parsed.pushed > 0) {
            pushed += parsed.pushed;
            const changeText = formatSyncChanges(parsed.changes);
            const title = titleByShopifyId.get(sid);
            if (title && updatedSummaries.length < 5) {
              updatedSummaries.push(changeText ? `${title}（${changeText}）` : title);
            }
          }
        }

        updateProgressToast();
      }, { intervalMs });

      if (pushed > 0) await loadProducts({ silent: true });

      const descParts: string[] = [];
      if (pushed > 0) descParts.push(`已更新 ${pushed} 件`);
      if (skipped > 0) descParts.push(`略過 ${skipped} 件（與 Shopify 一致）`);
      if (failed > 0) descParts.push(`失敗 ${failed} 件`);
      if (failed > 0 && isRateLimitError(firstErr || '')) {
        descParts.push('（Shopify API 速率限制，非略過）');
      }

      const detailLines: string[] = [];
      if (updatedSummaries.length > 0) {
        detailLines.push(`更新：${updatedSummaries.join('；')}`);
      }
      if (skippedTitles.length > 0) {
        const more = skipped > skippedTitles.length ? ` 等 ${skipped} 件` : '';
        detailLines.push(`略過：${skippedTitles.join('、')}${more}`);
      }
      const description = [descParts.join(' · '), ...detailLines].filter(Boolean).join('\n');
      const successTitle = opts?.successTitle || '同步完成';

      if (failed > 0 && (pushed > 0 || skipped > 0)) {
        toast.warning('部分產品同步失敗', {
          id: toastId,
          description: `${description}${firstErr ? `\n${firstErr.slice(0, 160)}` : ''}`,
          duration: 12000,
        });
      } else if (failed > 0) {
        toast.error(isRateLimitError(firstErr || '') ? 'Shopify API 速率限制' : '同步至 Shopify 失敗', {
          id: toastId,
          description: isRateLimitError(firstErr || '')
            ? `請減少一次選取數量，或稍後再試。${firstErr ? `\n${firstErr.slice(0, 160)}` : ''}`
            : (firstErr || '請稍後重試'),
          duration: 10000,
        });
      } else if (skipped > 0 && pushed === 0) {
        toast.message(opts?.successTitle ? successTitle : '無需同步', {
          id: toastId,
          description: description || `已檢查 ${shopifyIds.length} 件，均與 Shopify 一致`,
          duration: 8000,
        });
      } else {
        toast.success(successTitle, {
          id: toastId,
          description: description || `已處理 ${shopifyIds.length} 件`,
          duration: 8000,
        });
      }
      return { pushed, skipped, failed };
    } catch (e) {
      toast.error('同步至 Shopify 失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
      });
      return { pushed, skipped, failed: failed + 1 };
    } finally {
      setIsSyncing(false);
    }
  }, [items, selectedIds, loadProducts]);

  /** Rebuild core metafields (尺寸/材料/出貨時間) from source data and push to Shopify. */
  const repairMetafields = useCallback(async () => {
    const selectedRows = selectedIds.length > 0
      ? items.filter((p) => selectedIds.includes(p.id))
      : items.filter((p) => p.state === 'published' && /^\d+$/.test(p.shopify_product_id));
    if (selectedRows.length === 0) {
      toast.message('沒有可修復的已上載產品');
      return;
    }

    const shopifyIds = [...new Set(
      selectedRows
        .map((p) => p.shopify_product_id)
        .filter((id) => /^\d+$/.test(id)),
    )];

    setIsRepairingMetafields(true);
    const scopeLabel = selectedIds.length > 0 ? `已選 ${shopifyIds.length}` : `全部 ${shopifyIds.length}`;
    const toastId = toast.loading(`正在修復 Metafields（${scopeLabel}）…`);
    let repaired = 0;
    let skipped = 0;
    let failed = 0;
    let firstErr: string | undefined;

    const BATCH_SIZE = 5;
    const batches: string[][] = [];
    for (let i = 0; i < shopifyIds.length; i += BATCH_SIZE) {
      batches.push(shopifyIds.slice(i, i + BATCH_SIZE));
    }

    try {
      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        toast.loading(
          `正在修復 Metafields（批次 ${bi + 1}/${batches.length}，${batch.length} 件）…`,
          { id: toastId },
        );
        const { data, error } = await invokeEdgeFunctionDirect(
          'supabase-functions-update-shopify-product',
          { repair_metafields: true, shopify_product_ids: batch },
          { timeoutMs: 3 * 60 * 1000 },
        );
        if (error || data?.error) {
          failed += batch.length;
          if (!firstErr) firstErr = error?.message || (data?.error as string);
          continue;
        }
        repaired += Number(data?.repaired ?? 0);
        skipped += Number(data?.skipped ?? 0);
        failed += Number(data?.failed ?? 0);
        if (!firstErr && Array.isArray(data?.errors) && data.errors[0]?.error) {
          firstErr = String((data.errors[0] as { error?: string }).error);
        }
        if (bi < batches.length - 1) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      if (repaired > 0) await loadProducts({ silent: true });

      const parts: string[] = [];
      if (repaired > 0) parts.push(`已修復 ${repaired} 件`);
      if (skipped > 0) parts.push(`略過 ${skipped} 件（無來源資料）`);
      if (failed > 0) parts.push(`失敗 ${failed} 件`);

      if (failed > 0 && repaired > 0) {
        toast.warning('部分 Metafields 修復失敗', {
          id: toastId,
          description: `${parts.join(' · ')}${firstErr ? `\n${firstErr.slice(0, 160)}` : ''}`,
          duration: 12000,
        });
      } else if (failed > 0) {
        toast.error('Metafields 修復失敗', {
          id: toastId,
          description: firstErr || '請稍後重試',
          duration: 10000,
        });
      } else if (repaired === 0) {
        toast.message('無需修復', {
          id: toastId,
          description: parts.join(' · ') || '所選產品均無可回填的來源資料',
          duration: 8000,
        });
      } else {
        toast.success('Metafields 修復完成', {
          id: toastId,
          description: parts.join(' · '),
          duration: 8000,
        });
      }
    } catch (e) {
      toast.error('Metafields 修復失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
      });
    } finally {
      setIsRepairingMetafields(false);
    }
  }, [items, selectedIds, loadProducts]);

  /** Pull live Shopify catalog → shopify_products mirror (reconcile + remove deleted). */
  const reconcileMirrorFromShopify = useCallback(async () => {
    setIsReconcilingMirror(true);
    const toastId = toast.loading('正在從 Shopify 同步產品目錄…（約 1–3 分鐘）');
    try {
      const { data, error } = await invokeEdgeFunctionDirect(
        'supabase-functions-sync-shopify-mirror',
        { skip_seo: true },
        { timeoutMs: 5 * 60 * 1000 },
      );
      if (error || data?.error || data?.success === false) {
        toast.error('同步失敗', {
          id: toastId,
          description: error?.message || (data?.error as string) || '未知錯誤',
          duration: 8000,
        });
        return;
      }
      await loadProducts({ silent: true });
      toast.success('已更新 Shopify 目錄', {
        id: toastId,
        description: `Shopify ${data?.live ?? '?'} 件 · 更新 ${data?.upserted ?? 0} 件 · 移除 ${data?.deleted ?? 0} 件`,
        duration: 8000,
      });
    } catch (e) {
      toast.error('同步失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
      });
    } finally {
      setIsReconcilingMirror(false);
    }
  }, [loadProducts]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const openDetail = useCallback(async (p: DisplayProduct) => {
    if (p.sourceKind === 'catalog') {
      if (!p.isOnShopify || !p.shopify_product_id) {
        toast.message('此產品尚未上載 Shopify，無法在此開啟詳情');
        return;
      }
      const { data, error } = await supabase
        .from('shopify_products')
        .select('*')
        .eq('shopify_product_id', p.shopify_product_id)
        .maybeSingle();
      if (error || !data) {
        toast.error('讀取 Shopify 產品詳情失敗', { description: error?.message });
        return;
      }
      setDetailProduct(rowToDisplay(data as ShopifyProductRow, p.costPrice ?? null));
      return;
    }
    setDetailProduct(p);
  }, []);

  const openMergeModal = useCallback(() => {
    if (selectedIds.length < 2) {
      toast.message('請至少勾選 2 件產品進行合併（最先勾選的為主產品）');
      return;
    }
    const ordered = selectedIds
      .map((id) => items.find((p) => p.id === id))
      .filter((p): p is DisplayProduct => Boolean(p));
    if (ordered.length < 2) return;
    setMergeProducts(ordered);
    setShowMergeModal(true);
  }, [selectedIds, items]);

  const filteredPreview = useMemo(() =>
    importSearch.trim()
      ? previewProducts.filter(p => p.title.toLowerCase().includes(importSearch.toLowerCase()) || p.vendor.toLowerCase().includes(importSearch.toLowerCase()))
      : previewProducts,
    [previewProducts, importSearch]
  );

  // Step 1: Fetch preview list from Shopify (no DB write)
  const handleOpenImportDialog = async () => {
    setIsFetchingPreview(true);
    const toastId = toast.loading('正在讀取 Shopify 產品列表...');
    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-sync-from-shopify', { body: { preview_only: true } });
      if (error || data?.error) {
        toast.error('無法讀取 Shopify 產品', { id: toastId, description: error?.message || data?.error, duration: 8000 });
        return;
      }
      setPreviewProducts(data.products ?? []);
      setSelectedImportIds(new Set());
      setImportSearch('');
      setShowImportDialog(true);
      toast.dismiss(toastId);
    } catch (err) {
      toast.error('讀取失敗', { id: toastId, description: err instanceof Error ? err.message : '未知錯誤' });
    } finally {
      setIsFetchingPreview(false);
    }
  };

  // Step 2: Import selected products via edge function (basic data + metafields in batches)
  const handleConfirmImport = async () => {
    if (selectedImportIds.size === 0) { toast.error('請先選擇產品'); return; }
    setIsImporting(true);
    const productIds = Array.from(selectedImportIds);
    const toastId = toast.loading(`正在導入 ${productIds.length} 件產品...`);
    try {
      // Step A: Import basic product data via edge function
      const { data: importData, error: importErr } = await supabase.functions.invoke(
        'fetch-shopify-products',
        { body: { import: true, product_ids: productIds } }
      );
      if (importErr) throw new Error(importErr.message);
      if (importData?.error) throw new Error(importData.error);

      toast.loading(`基本資料已導入，正在抓取 Metafields...`, { id: toastId });

      // Step B: Sync metafields in batches of 10 to avoid timeout
      const BATCH = 10;
      let totalMfs = 0;
      for (let i = 0; i < productIds.length; i += BATCH) {
        const batch = productIds.slice(i, i + BATCH);
        const { data: mfData } = await supabase.functions.invoke(
          'fetch-shopify-products',
          { body: { sync_metafields: true, product_ids: batch } }
        );
        if (mfData?.total_metafields) totalMfs += mfData.total_metafields;
        if (productIds.length > BATCH) {
          toast.loading(`Metafields 進度：${Math.min(i + BATCH, productIds.length)} / ${productIds.length}`, { id: toastId });
        }
      }

      toast.success(`✅ 從 Shopify 導入完成`, {
        id: toastId,
        description: `已儲存 ${importData?.imported ?? productIds.length} 件產品，共 ${totalMfs} 個 metafield`,
        duration: 6000,
      });
      setShowImportDialog(false);
      await loadProducts();
    } catch (err) {
      toast.error('導入失敗', { id: toastId, description: err instanceof Error ? err.message : '未知錯誤' });
    } finally {
      setIsImporting(false);
    }
  };

  const toggleImportSelect = (id: string) => {
    setSelectedImportIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const factories = useMemo(
    () => ['全部', ...Array.from(new Set(items.map((p) => p.factory).filter(f => f && f !== '—')))],
    [items]
  );

  // L1/L2 category options derived from product_type ("L1 / L2") across all rows.
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of items) {
      const parts = (p.raw.product_type || '').split(' / ');
      const l1 = parts[0]?.trim();
      const l2 = parts[1]?.trim();
      if (l1) counts[`level1:${l1}`] = (counts[`level1:${l1}`] || 0) + 1;
      if (l1 && l2) counts[`level2:${l1}:${l2}`] = (counts[`level2:${l1}:${l2}`] || 0) + 1;
    }
    return counts;
  }, [items]);

  const registryL1Order = useMemo(() => uniqueLevel1InOrder(categoryPairs), [categoryPairs]);
  const l1Options = useMemo(() => {
    const present = new Set<string>();
    items.forEach((p) => {
      const l1 = (p.raw.product_type || '').split(' / ')[0]?.trim();
      if (l1) present.add(l1);
    });
    return sortByCategoryRegistryOrder([...present], registryL1Order);
  }, [items, registryL1Order]);
  const l2Options = useMemo(() => {
    if (!level1Filter) return [];
    const present = new Set<string>();
    items.forEach((p) => {
      const parts = (p.raw.product_type || '').split(' / ');
      if (parts[0]?.trim() === level1Filter && parts[1]?.trim()) present.add(parts[1].trim());
    });
    return sortByCategoryRegistryOrder(
      [...present],
      uniqueLevel2InOrder(categoryPairs, level1Filter),
    );
  }, [items, level1Filter, categoryPairs]);

  const baseFiltered = useMemo(() => items.filter((p) => {
    if (stateFilter === 'exclude-a') {
      if (p.isOnShopify) return false;
    } else if (stateFilter !== 'all' && p.state !== stateFilter) {
      return false;
    }
    if (factoryFilter !== '全部' && p.factory !== factoryFilter) return false;
    if (level1Filter) {
      const parts = (p.raw.product_type || '').split(' / ');
      if (parts[0]?.trim() !== level1Filter) return false;
      if (level2Filter && parts[1]?.trim() !== level2Filter) return false;
    }
    if (
      priceCheckMultiplier != null
      && !productMatchesPriceMultiplier(
        p.raw.price,
        p.raw.variants,
        p.costPrice,
        priceCheckMultiplier,
      )
    ) {
      return false;
    }
    return true;
  }), [items, stateFilter, factoryFilter, level1Filter, level2Filter, priceCheckMultiplier]);

  const similarGroups = useMemo((): SimilarProductGroup<DisplayProduct & { sku: string }>[] => {
    if (!similarCriteriaActive?.length) return [];
    const inputs = baseFiltered.map((p) => ({
      ...p,
      sku: resolveProductSku(p.raw),
    }));
    return findSimilarProductGroups(inputs, similarCriteriaActive);
  }, [baseFiltered, similarCriteriaActive]);

  const filtered = useMemo(() => {
    const matchesSearch = (p: DisplayProduct) => {
      if (!search) return true;
      const q = search.toLowerCase();
      const title = p.title.toLowerCase();
      const skuHay = resolveProductSku(p.raw).toLowerCase();
      return title.includes(q) || skuHay.includes(q);
    };

    if (similarCriteriaActive?.length) {
      return similarGroups.flatMap((g) => g.products).filter(matchesSearch);
    }
    return baseFiltered.filter(matchesSearch);
  }, [baseFiltered, search, similarCriteriaActive, similarGroups]);

  const sorted = useMemo(() => {
    const compareByActiveKey = (a: DisplayProduct, b: DisplayProduct): number => {
      let cmp = 0;
      if (sortKey === 'price') {
        cmp = compareNullableNumber(numericOrNaN(a.raw.price), numericOrNaN(b.raw.price));
      } else if (sortKey === 'cost') {
        cmp = compareNullableNumber(numericOrNaN(a.costPrice), numericOrNaN(b.costPrice));
      } else {
        cmp = compareSkuNatural(primarySortSku(a.raw), primarySortSku(b.raw));
      }
      if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
      return compareSkuNatural(primarySortSku(a.raw), primarySortSku(b.raw));
    };

    if (similarCriteriaActive?.length) {
      // Keep cluster order; sort within each group by the active key.
      const list: DisplayProduct[] = [];
      for (const group of similarGroups) {
        const members = [...group.products].sort(compareByActiveKey);
        if (search) {
          const q = search.toLowerCase();
          const kept = members.filter((p) => {
            const title = p.title.toLowerCase();
            const skuHay = resolveProductSku(p.raw).toLowerCase();
            return title.includes(q) || skuHay.includes(q);
          });
          if (kept.length >= 2) list.push(...kept);
        } else {
          list.push(...members);
        }
      }
      return list;
    }

    const list = [...filtered];
    list.sort((a, b) => {
      if (stateFilter === 'all') {
        const rank = publishGroupRank(a.state) - publishGroupRank(b.state);
        if (rank !== 0) return rank;
      }
      const alert = priceAlertRank(a) - priceAlertRank(b);
      if (alert !== 0) return alert;
      return compareByActiveKey(a, b);
    });
    return list;
  }, [filtered, sortKey, sortDir, similarCriteriaActive, similarGroups, search, stateFilter]);

  const visibleSimilarGroups = useMemo(() => {
    if (!similarCriteriaActive?.length) return [];
    const idSet = new Set(sorted.map((p) => p.id));
    return similarGroups
      .map((g) => ({
        ...g,
        products: g.products.filter((p) => idSet.has(p.id)),
      }))
      .filter((g) => g.products.length >= 2);
  }, [similarCriteriaActive, similarGroups, sorted]);

  const groupMetaByProductId = useMemo(() => {
    const map = new Map<string, { groupId: string; label: string; count: number; skus: string[] }>();
    for (const group of visibleSimilarGroups) {
      const skus = group.products.map((p) => resolveProductSku(p.raw));
      for (const p of group.products) {
        map.set(p.id, {
          groupId: group.id,
          label: group.label,
          count: group.products.length,
          skus,
        });
      }
    }
    return map;
  }, [visibleSimilarGroups]);

  /**
   * When「找相似產品」is active, paginate by whole groups so a cluster
   * (e.g. 2 款禮堂椅) is never split across pages. If the next group would
   * exceed pageSize, move the entire group to the following page.
   */
  const similarPages = useMemo(() => {
    if (!similarCriteriaActive?.length) return null;
    const orderedGroups: DisplayProduct[][] = [];
    let currentGroupId: string | null = null;
    let bucket: DisplayProduct[] = [];
    for (const product of sorted) {
      const groupId = groupMetaByProductId.get(product.id)?.groupId ?? product.id;
      if (currentGroupId == null) {
        currentGroupId = groupId;
        bucket = [product];
        continue;
      }
      if (groupId === currentGroupId) {
        bucket.push(product);
        continue;
      }
      orderedGroups.push(bucket);
      currentGroupId = groupId;
      bucket = [product];
    }
    if (bucket.length > 0) orderedGroups.push(bucket);
    return paginateKeepingGroups(orderedGroups, pageSize);
  }, [similarCriteriaActive, sorted, groupMetaByProductId, pageSize]);

  const totalPages = Math.max(
    1,
    similarPages
      ? similarPages.length
      : Math.ceil(sorted.length / pageSize),
  );
  const paged = useMemo(() => {
    if (similarPages) {
      return similarPages[currentPage - 1] ?? [];
    }
    return sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [similarPages, sorted, currentPage, pageSize]);

  const detailPageIndex = useMemo(() => {
    if (!detailProduct) return -1;
    return paged.findIndex((p) => p.id === detailProduct.id);
  }, [detailProduct, paged]);

  const goDetailSibling = useCallback(
    (dir: -1 | 1) => {
      if (detailPageIndex < 0) return;
      const next = paged[detailPageIndex + dir];
      if (next) setDetailProduct(next);
    },
    [detailPageIndex, paged],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [
    search,
    stateFilter,
    factoryFilter,
    level1Filter,
    level2Filter,
    pageSize,
    sortKey,
    sortDir,
    similarCriteriaActive,
    priceCheckMultiplier,
  ]);

  const toggleListSort = (key: UploadedListSortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
      return;
    }
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  };

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const toggleSimilarCriterionDraft = (criterion: SimilarProductCriterion, checked: boolean) => {
    setSimilarCriteriaDraft((prev) => {
      if (checked) return prev.includes(criterion) ? prev : [...prev, criterion];
      return prev.filter((c) => c !== criterion);
    });
  };

  const applySimilarSearch = () => {
    if (similarCriteriaDraft.length === 0) {
      toast.message('請至少選擇一個準則');
      return;
    }
    setSimilarCriteriaActive([...similarCriteriaDraft]);
    setSimilarPopoverOpen(false);
    setSelectedIds([]);
    const pool = baseFiltered.map((p) => ({
      ...p,
      sku: resolveProductSku(p.raw),
    }));
    const groups = findSimilarProductGroups(pool, similarCriteriaDraft);
    const total = groups.reduce((n, g) => n + g.products.length, 0);
    if (groups.length === 0) {
      toast.message('找不到符合準則的相似產品');
    } else {
      toast.success(`已找到 ${groups.length} 組相似產品`, {
        description: `共 ${total} 件，已按組別排列以便合併`,
      });
    }
  };

  const clearSimilarSearch = () => {
    setSimilarCriteriaActive(null);
    setSimilarPopoverOpen(false);
  };

  // Only drop selections when the product row no longer exists (e.g. deleted), not when filtered out by search.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.length === 0) return prev;
      const allIds = new Set(items.map((p) => p.id));
      const next = prev.filter((id) => allIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [items]);

  const selectedSkuChips = useMemo(
    () => selectedIds.map((id) => {
      const product = items.find((p) => p.id === id);
      return {
        id,
        sku: product ? resolveProductSku(product.raw) : id.slice(0, 8),
      };
    }),
    [selectedIds, items],
  );

  const pageAllSelected = paged.length > 0 && paged.every((p) => selectedIds.includes(p.id));
  const pageSomeSelected = paged.some((p) => selectedIds.includes(p.id)) && !pageAllSelected;
  const selectionSpansPages = useMemo(() => {
    if (selectedIds.length === 0) return false;
    const pageIdSet = new Set(paged.map((p) => p.id));
    return selectedIds.some((id) => !pageIdSet.has(id));
  }, [selectedIds, paged]);

  const showSkuChipList = selectedIds.length > 0
    && (skuChipsExpanded || selectedIds.length <= SELECTED_SKU_COLLAPSE_THRESHOLD);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setSkuChipsExpanded(false);
    } else if (selectedIds.length <= SELECTED_SKU_COLLAPSE_THRESHOLD) {
      setSkuChipsExpanded(true);
    }
  }, [selectedIds.length]);

  const clearAllSelection = () => setSelectedIds([]);

  const pageSelectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pageSelectAllRef.current) {
      pageSelectAllRef.current.indeterminate = pageSomeSelected;
    }
  }, [pageSomeSelected]);

  const togglePageSelectAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        const next = [...prev];
        for (const p of paged) {
          if (!next.includes(p.id)) next.push(p.id);
        }
        return next;
      }
      const pageIdSet = new Set(paged.map((p) => p.id));
      return prev.filter((id) => !pageIdSet.has(id));
    });
  };

  // Call delist-from-shopify edge function to archive products in Shopify,
  // then update the local shopify_products mirror table.
  const callDelistEdgeFunction = async (shopifyProductIds: string[]): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-delist-from-shopify', {
        body: { shopify_product_ids: shopifyProductIds },
      });
      if (error) return { ok: false, error: error.message };
      if (data?.error) return { ok: false, error: data.error };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const setProductState = async (row: DisplayProduct, state: PublishState, msg: string) => {
    // If delisting, call Shopify API via edge function first
    if (state === 'delisted' && row.shopify_product_id) {
      const toastId = toast.loading('正在從 Shopify 下架...');
      const result = await callDelistEdgeFunction([row.shopify_product_id]);
      if (!result.ok) {
        toast.error('下架失敗', { id: toastId, description: result.error });
        return;
      }
      setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, state } : p)));
      toast.success(msg, { id: toastId });
      return;
    }
    // For other state changes (re-publish etc.), update local DB only
    const newStatus = state === 'published' ? 'active' : state === 'delisted' ? 'archived' : 'draft';
    const { error } = await supabase
      .from('shopify_products')
      .update({ status: newStatus })
      .eq('id', row.id);
    if (error) { toast.error('更新失敗', { description: error.message }); return; }
    setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, state } : p)));
    toast.success(msg);
  };

  const toggle = (id: string) => setSelectedIds((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  ));

  const bulkDelist = async () => {
    const ids = [...selectedIds];
    if (!ids.length) { toast.message('請先勾選產品'); return; }
    // Collect Shopify product IDs for the selected rows
    const shopifyIds = items
      .filter(p => ids.includes(p.id) && p.shopify_product_id)
      .map(p => p.shopify_product_id);
    if (!shopifyIds.length) { toast.error('選中產品沒有 Shopify Product ID，無法下架'); return; }
    const toastId = toast.loading(`正在從 Shopify 下架 ${shopifyIds.length} 件產品...`);
    const result = await callDelistEdgeFunction(shopifyIds);
    if (!result.ok) {
      toast.error('批量下架失敗', { id: toastId, description: result.error });
      return;
    }
    setItems((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, state: 'delisted' } : p));
    setSelectedIds([]);
    toast.success(`已從 Shopify 下架 ${shopifyIds.length} 件產品`, { id: toastId });
  };

  const bulkEditL1Options = useMemo(
    () => uniqueLevel1InOrder(categoryPairs),
    [categoryPairs],
  );
  const bulkEditL2Options = useMemo(
    () => uniqueLevel2InOrder(categoryPairs, bulkEditL1),
    [categoryPairs, bulkEditL1],
  );

  const resetBulkCategoryPicker = () => {
    setBulkCategoryPickerOpen(false);
    setBulkEditL1('');
    setBulkEditL2('');
    setCategoryConfirmOpen(false);
  };

  const resetBulkAddTags = () => {
    setBulkAddTagsOpen(false);
    setBulkAddTags([]);
  };

  const resetBulkPriceEdit = () => {
    setBulkPriceEditOpen(false);
    setBulkPriceMultiplierInput('');
  };

  const mergeTagsUnique = (existing: string[], toAdd: string[]): string[] => {
    const out = [...existing];
    for (const t of toAdd) {
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  };

  const confirmBulkAddTags = async () => {
    const ids = [...selectedIds];
    if (!ids.length) { toast.message('請先勾選產品'); return; }
    if (!bulkAddTags.length) { toast.message('請先選擇要加入的標籤'); return; }
    setIsBulkAddingTags(true);
    const toastId = toast.loading(`正在為 ${ids.length} 件產品加入標籤...`);
    try {
      let updatedCount = 0;
      let skippedCount = 0;
      const nextById = new Map<string, string[]>();

      for (const p of items.filter((row) => ids.includes(row.id))) {
        const existing = Array.isArray(p.raw.tags) ? p.raw.tags.filter(Boolean) : [];
        const merged = mergeTagsUnique(existing, bulkAddTags);
        const unchanged =
          merged.length === existing.length && merged.every((t) => existing.includes(t));
        if (unchanged) {
          skippedCount += 1;
          continue;
        }

        const { error } = await supabase
          .from('shopify_products')
          .update({ tags: merged })
          .eq('id', p.id);
        if (error) {
          toast.error('加入標籤失敗', { id: toastId, description: error.message });
          return;
        }

        if (p.raw.source_product_id) {
          const sourceId = p.raw.source_product_id;
          const { error: productsErr } = await supabase
            .from('products')
            .update(await withUpdateAuditFields({ tags: merged }))
            .eq('id', sourceId);
          if (productsErr) {
            console.warn('[PublishedProductsView] products tags sync failed:', productsErr.message);
          }
          const { error: rtsErr } = await supabase
            .from('ready_to_shopify')
            .update({ tags: merged })
            .eq('product_id', sourceId);
          if (rtsErr) {
            console.warn('[PublishedProductsView] RTS tags sync failed:', rtsErr.message);
          }
        }

        nextById.set(p.id, merged);
        updatedCount += 1;
      }

      if (nextById.size > 0) {
        setItems((prev) => prev.map((p) => {
          const tags = nextById.get(p.id);
          return tags ? { ...p, raw: { ...p.raw, tags } } : p;
        }));
      }

      resetBulkAddTags();
      if (updatedCount === 0) {
        toast.message('所選產品皆已具備這些標籤，無需更新', { id: toastId });
      } else {
        toast.success(
          `已為 ${updatedCount} 件產品加入標籤` +
            (skippedCount > 0 ? `（${skippedCount} 件已具備、略過）` : ''),
          { id: toastId },
        );
      }
    } catch (err) {
      toast.error('加入標籤失敗', {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsBulkAddingTags(false);
    }
  };

  /**
   * 修改售價：新價 = ceil(成本 × 倍數)，寫入每個規格的 price。
   * - 有「價錢核對」：只改 售價 < 成本×輸入倍數 的規格
   * - 無「價錢核對」：已選產品的每一個規格都改成該新價（例如 1 倍 = 售價等於成本取整）
   */
  const confirmBulkModifyPrice = async () => {
    const ids = [...selectedIds];
    if (!ids.length) {
      toast.message('請先勾選產品');
      return;
    }
    const multiplier = parsePriceMultiplierInput(bulkPriceMultiplierInput);
    if (multiplier == null) {
      toast.message('請輸入有效倍數（須大於 0）');
      return;
    }

    const selective = priceCheckMultiplier != null;
    setIsBulkUpdatingPrice(true);
    const toastId = toast.loading(
      selective
        ? `正在依 ${multiplier} 倍更新售價（僅改低於門檻的規格）...`
        : `正在依 ${multiplier} 倍更新已選產品的全部規格售價...`,
    );

    try {
      let productsUpdated = 0;
      let variantsUpdated = 0;
      let skippedNoCost = 0;
      let skippedNoChange = 0;
      const nextById = new Map<string, { price: number; variants: ShopifyVariant[] | null }>();

      for (const p of items.filter((row) => ids.includes(row.id))) {
        const cost = p.costPrice != null ? Number(p.costPrice) : NaN;
        if (!Number.isFinite(cost) || cost <= 0) {
          skippedNoCost += 1;
          continue;
        }

        const targetPrice = ceilCostTimesMultiplier(cost, multiplier);
        const threshold = cost * multiplier;
        const existingVariants = Array.isArray(p.raw.variants) ? p.raw.variants : [];

        const shouldRewriteVariant = (current: number): boolean => {
          if (selective) {
            return Number.isFinite(current) && current < threshold;
          }
          // 無價錢核對：所有規格都改成 成本×倍數（已是該價則略過）
          return !pricesAlreadyMatch(current, targetPrice);
        };

        if (existingVariants.length === 0) {
          const current = numericOrNaN(p.raw.price);
          if (!shouldRewriteVariant(current)) {
            skippedNoChange += 1;
            continue;
          }

          const { error } = await supabase
            .from('shopify_products')
            .update({ price: targetPrice })
            .eq('id', p.id);
          if (error) {
            toast.error('修改售價失敗', { id: toastId, description: error.message });
            return;
          }

          if (p.raw.source_product_id) {
            const { error: productsErr } = await supabase
              .from('products')
              .update(await withUpdateAuditFields({ sale_price: targetPrice }))
              .eq('id', p.raw.source_product_id);
            if (productsErr) {
              console.warn('[PublishedProductsView] products sale_price sync failed:', productsErr.message);
            }
          }

          nextById.set(p.id, { price: targetPrice, variants: p.raw.variants ?? null });
          productsUpdated += 1;
          variantsUpdated += 1;
          continue;
        }

        let changedInProduct = 0;
        const nextVariants = existingVariants.map((v) => {
          const current = variantPriceNumber(v);
          if (selective) {
            if (!(Number.isFinite(current) && current < threshold)) return v;
            if (pricesAlreadyMatch(current, targetPrice)) return v;
          } else if (pricesAlreadyMatch(current, targetPrice)) {
            return v;
          }
          changedInProduct += 1;
          return { ...v, price: String(targetPrice) };
        });

        if (changedInProduct === 0) {
          skippedNoChange += 1;
          continue;
        }

        const productPrice = selective
          ? (Number.isFinite(variantPriceNumber(nextVariants[0]!))
              ? variantPriceNumber(nextVariants[0]!)
              : targetPrice)
          : targetPrice;

        const { error } = await supabase
          .from('shopify_products')
          .update({
            price: productPrice,
            variants: nextVariants,
          })
          .eq('id', p.id);
        if (error) {
          toast.error('修改售價失敗', { id: toastId, description: error.message });
          return;
        }

        if (p.raw.source_product_id) {
          const { error: productsErr } = await supabase
            .from('products')
            .update(await withUpdateAuditFields({ sale_price: productPrice }))
            .eq('id', p.raw.source_product_id);
          if (productsErr) {
            console.warn('[PublishedProductsView] products sale_price sync failed:', productsErr.message);
          }
        }

        nextById.set(p.id, { price: productPrice, variants: nextVariants });
        productsUpdated += 1;
        variantsUpdated += changedInProduct;
      }

      if (nextById.size > 0) {
        setItems((prev) => prev.map((p) => {
          const next = nextById.get(p.id);
          if (!next) return p;
          return {
            ...p,
            raw: {
              ...p.raw,
              price: next.price,
              variants: next.variants,
            },
          };
        }));
      }

      resetBulkPriceEdit();

      if (productsUpdated === 0) {
        const reasons: string[] = [];
        if (skippedNoCost > 0) reasons.push(`${skippedNoCost} 件無有效成本`);
        if (skippedNoChange > 0) reasons.push(`${skippedNoChange} 件無需變更`);
        toast.message('沒有產品被更新', {
          id: toastId,
          description: reasons.join('；') || '請確認已選產品與倍數',
        });
        return;
      }

      toast.loading(
        `已改 ${productsUpdated} 件（${variantsUpdated} 規格），正在同步至 Shopify…`,
        { id: toastId },
      );

      // Auto-push immediately — price-only edits should not rely on a second click.
      setIsBulkUpdatingPrice(false);
      const syncResult = await pushToShopify({
        localIds: [...nextById.keys()],
        toastId,
        progressLabel: '正在同步售價至 Shopify',
        successTitle: `售價已更新並同步（${productsUpdated} 件 / ${variantsUpdated} 規格）`,
      });
      if (
        syncResult
        && syncResult.failed > 0
        && syncResult.pushed === 0
      ) {
        toast.message('本地售價已更新，但尚未推送到 Shopify', {
          description: '可稍後再按「與 Shopify 同步」重試',
          duration: 8000,
        });
      }
    } catch (err) {
      toast.error('修改售價失敗', {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsBulkUpdatingPrice(false);
    }
  };

  const confirmBulkCategoryChange = async () => {
    const ids = [...selectedIds];
    if (!ids.length || !bulkEditL1 || !bulkEditL2) return;
    const productType = `${bulkEditL1} / ${bulkEditL2}`;
    setIsBulkUpdatingCategory(true);
    const toastId = toast.loading(`正在更新 ${ids.length} 件產品分類...`);
    try {
      const { error } = await supabase
        .from('shopify_products')
        .update({ product_type: productType })
        .in('id', ids);
      if (error) {
        toast.error('分類更新失敗', { id: toastId, description: error.message });
        return;
      }

      const sourceIds = items
        .filter((p) => ids.includes(p.id) && p.raw.source_product_id)
        .map((p) => p.raw.source_product_id as string);
      if (sourceIds.length > 0) {
        const { error: productsErr } = await supabase
          .from('products')
          .update(await withUpdateAuditFields({
            level1_category: bulkEditL1,
            level2_category: bulkEditL2,
          }))
          .in('id', sourceIds);
        if (productsErr) {
          console.warn('[PublishedProductsView] products category sync failed:', productsErr.message);
        }

        const { error: rtsErr } = await supabase
          .from('ready_to_shopify')
          .update({ product_type: productType })
          .in('product_id', sourceIds);
        if (rtsErr) {
          console.warn('[PublishedProductsView] RTS category sync failed:', rtsErr.message);
        }
      }

      setItems((prev) => prev.map((p) => (
        ids.includes(p.id)
          ? { ...p, raw: { ...p.raw, product_type: productType } }
          : p
      )));
      resetBulkCategoryPicker();
      toast.success(`已將 ${ids.length} 件產品改到「${bulkEditL1} > ${bulkEditL2}」`, { id: toastId });
    } catch (err) {
      toast.error('分類更新失敗', {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsBulkUpdatingCategory(false);
    }
  };

  const counts = {
    published: items.filter((p) => p.state === 'published').length,
    delisted: items.filter((p) => p.state === 'delisted').length,
    onShopify: items.filter((p) => p.isOnShopify).length,
  };

  const priceAuditUniverse = stateFilter === 'exclude-a'
    ? items.filter((p) => !p.isOnShopify)
    : catalogClass === 'B'
      ? items
      : items.filter((p) => p.state === 'published');

  const priceAuditReport = useMemo(() => {
    const countAt = (multiplier: number) =>
      priceAuditUniverse.filter((p) =>
        productMatchesPriceMultiplier(p.raw.price, p.raw.variants, p.costPrice, multiplier),
      ).length;
    return {
      published: priceAuditUniverse.length,
      buckets: PRICE_CHECK_OPTIONS.map((opt) => ({
        ...opt,
        count: countAt(opt.value),
      })),
    };
  }, [priceAuditUniverse]);

  const isCustomPriceCheck = (
    priceCheckMultiplier != null
    && !PRICE_CHECK_OPTIONS.some((o) => o.value === priceCheckMultiplier)
  );

  const customPriceCheckCount = useMemo(() => {
    if (!isCustomPriceCheck || priceCheckMultiplier == null) return null;
    return priceAuditUniverse.filter((p) =>
      productMatchesPriceMultiplier(p.raw.price, p.raw.variants, p.costPrice, priceCheckMultiplier),
    ).length;
  }, [priceAuditUniverse, isCustomPriceCheck, priceCheckMultiplier]);

  const applyCustomPriceCheck = () => {
    const n = parseOneDecimalMultiplier(priceCheckCustomDraft);
    if (n == null) {
      toast.message('請輸入有效倍數（大於 0，最多一位小數，如 5、5.1）');
      return;
    }
    if (stateFilter !== 'exclude-a') {
      setStateFilter(catalogClass === 'B' ? 'all' : 'published');
    }
    setPriceCheckMultiplier(n);
    setPriceCheckMenuOpen(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/30 px-6 py-3">
        {/* Row 1: title + action buttons */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {priceAudit
              ? <BadgeDollarSign className="h-4 w-4 shrink-0 text-primary" />
              : <CheckCheck className="h-4 w-4 shrink-0 text-primary" />}
            <h2 className="font-display text-sm font-bold shrink-0">
              {priceAudit ? '異常價錢產品' : '已上載產品'}
            </h2>
            <span className="font-mono-data text-[11px] text-muted-foreground truncate">
              {priceAudit && catalogClass === 'B'
                ? stateFilter === 'exclude-a'
                  ? `目錄 ${items.length} · 排除A類 ${items.length - counts.onShopify}`
                  : `目錄 ${items.length} · 已上架Shopify ${uploadedShopifyTotal}`
                : `已發佈 ${counts.published} · 已下架 ${counts.delisted}`}
            </span>
          </div>
          {!priceAudit ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => reconcileMirrorFromShopify()}
              disabled={isReconcilingMirror}
              title="從 Shopify 讀取最新產品目錄，更新本頁列表，並移除 Shopify 已刪除的產品（含合併後的子產品）"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isReconcilingMirror ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Store className="h-3.5 w-3.5" />}
              {isReconcilingMirror ? '同步中...' : '更新 Shopify 目錄'}
            </button>
            <button
              type="button"
              onClick={() => repairMetafields()}
              disabled={isRepairingMetafields || isSyncing}
              title="從產品資料重建尺寸、材料、出貨時間，並從 Shopify 圖片補寫 more_image_* Metafields。未勾選時修復全部已發佈產品。"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-800 dark:text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRepairingMetafields ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {isRepairingMetafields
                ? '修復中...'
                : selectedIds.length > 0
                  ? `修復 Metafields (${selectedIds.length})`
                  : '修復 Metafields（全部）'}
            </button>
            <button
              type="button"
              onClick={() => pushToShopify()}
              disabled={isSyncing}
              title="將已勾選產品的 Supabase 資料推送至 Shopify，更新現有產品（標題、描述、SEO、價格、Metafields 等）"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-700 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {isSyncing ? '推送中...' : selectedIds.length > 0 ? `與 Shopify 同步 (${selectedIds.length})` : '與 Shopify 同步'}
            </button>
            <button
              type="button"
              onClick={handleOpenImportDialog}
              disabled={isFetchingPreview}
              title="從 Shopify 導入產品資料至 Supabase，更新本頁列表（標題、描述、價格、Metafields 等）。不會推送至 Shopify。"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingPreview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
              {isFetchingPreview ? '讀取中...' : '從 Shopify 導入'}
            </button>
            <button
              type="button"
              onClick={openMergeModal}
              disabled={selectedIds.length < 2}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                selectedIds.length >= 2
                  ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                  : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
              title={selectedIds.length >= 2 ? '合併所選產品為多規格（最先勾選的為主產品）' : '請至少勾選 2 件產品'}
            >
              <GitMerge className="h-3.5 w-3.5" />
              合併產品
            </button>
          </div>
          ) : null}
        </div>

        {/* Row 2: search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋產品名稱或編碼 (SKU)..."
              className="h-8 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
            {[20, 25, 50, 100].map(n => <option key={n} value={n}>每頁 {n} 項</option>)}
          </select>
          <Select
            value={level1Filter || '__all__'}
            onValueChange={(val) => {
              setLevel1Filter(val === '__all__' ? '' : val);
              setLevel2Filter('');
            }}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs font-body gap-1">
              <FolderTree className="h-3 w-3 text-muted-foreground" />
              <SelectValue placeholder="一級分類" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部一級分類</SelectItem>
              {l1Options.map((l1) => {
                const cnt = (l1 === level1Filter && !level2Filter)
                  ? filtered.length
                  : categoryCounts[`level1:${l1}`];
                return (
                  <SelectItem key={l1} value={l1}>
                    <span className="flex items-center justify-between gap-3 w-full min-w-[120px]">
                      <span>{l1}</span>
                      {cnt != null && (
                        <span className="font-mono-data text-xs font-semibold text-foreground/70 ml-auto">{cnt}</span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {level1Filter && l2Options.length > 0 && (
            <Select
              value={level2Filter || '__all__'}
              onValueChange={(val) => setLevel2Filter(val === '__all__' ? '' : val)}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs font-body gap-1">
                <FolderTree className="h-3 w-3 text-muted-foreground" />
                <SelectValue placeholder="二級分類" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部二級分類</SelectItem>
                {l2Options.map((l2) => {
                  const cnt = l2 === level2Filter
                    ? filtered.length
                    : categoryCounts[`level2:${level1Filter}:${l2}`];
                  return (
                    <SelectItem key={l2} value={l2}>
                      <span className="flex items-center justify-between gap-3 w-full min-w-[120px]">
                        <span>{l2}</span>
                        {cnt != null && (
                          <span className="font-mono-data text-xs font-semibold text-foreground/70 ml-auto">{cnt}</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <select
              value={factoryFilter}
              onChange={(e) => setFactoryFilter(e.target.value)}
              className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {factories.map((f) => <option key={f} value={f}>{f === '全部' ? '篩選廠家：全部' : f}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          {priceAudit ? (
            <div className="inline-flex h-8 overflow-hidden rounded-lg border border-border bg-card">
              <button
                type="button"
                onClick={() => {
                  if (catalogClass !== 'A') {
                    setItems([]);
                    setIsLoading(true);
                    setCatalogClass('A');
                  }
                  setStateFilter('published');
                  setSelectedIds([]);
                  setCurrentPage(1);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 text-xs font-medium transition-colors',
                  catalogClass === 'A'
                    ? 'bg-indigo-500/15 text-indigo-600'
                    : 'bg-indigo-500/5 text-indigo-600/80 hover:bg-indigo-500/10',
                )}
                title="已上載 Shopify 的產品（shopify_products）"
              >
                <Send className="h-3 w-3 shrink-0" />
                A類 : 已上載Shopify
              </button>
              <button
                type="button"
                onClick={() => {
                  if (catalogClass !== 'B') {
                    setItems([]);
                    setIsLoading(true);
                    setCatalogClass('B');
                  }
                  setStateFilter('all');
                  setSelectedIds([]);
                  setCurrentPage(1);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 border-l border-border px-3 text-xs font-medium transition-colors',
                  catalogClass === 'B'
                    ? 'bg-emerald-500/15 text-emerald-600'
                    : 'bg-emerald-500/5 text-emerald-600/80 hover:bg-emerald-500/10',
                )}
                title="產品目錄全部產品（products）"
              >
                <Database className="h-3 w-3 shrink-0" />
                B類 : 系統所有產品
              </button>
            </div>
          ) : null}
          {!priceAudit ? (
          <>
          <Popover open={similarPopoverOpen} onOpenChange={setSimilarPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors',
                  similarCriteriaActive?.length
                    ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                    : 'border-border bg-card text-foreground hover:bg-muted/50',
                )}
                title="依名稱或 SKU 找出可合併的相似產品"
              >
                <ScanSearch className="h-3.5 w-3.5" />
                找相似產品
                {similarCriteriaActive?.length ? (
                  <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 font-mono-data text-[10px]">
                    {visibleSimilarGroups.length} 組
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
              <div className="space-y-3">
                <div>
                  <p className="font-body text-sm font-semibold text-foreground">找相似產品</p>
                  <p className="mt-0.5 font-body text-xs text-muted-foreground">
                    可選 1 項或全選。兩項都選時須同時符合（同名＋同廠家，且為同一產品碼的 SKU 變體），再按組別排列以便合併
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border/80 px-2.5 py-2 hover:bg-muted/40">
                    <Checkbox
                      checked={similarCriteriaDraft.includes('name')}
                      onCheckedChange={(v) => toggleSimilarCriterionDraft('name', v === true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-body text-xs font-semibold text-foreground">
                        1. 相似產品名稱
                      </span>
                      <span className="mt-0.5 block font-body text-[11px] leading-snug text-muted-foreground">
                        產品名稱完全相同，且廠家名稱相同
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border/80 px-2.5 py-2 hover:bg-muted/40">
                    <Checkbox
                      checked={similarCriteriaDraft.includes('sku')}
                      onCheckedChange={(v) => toggleSimilarCriterionDraft('sku', v === true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-body text-xs font-semibold text-foreground">
                        2. 相似產品 SKU
                      </span>
                      <span className="mt-0.5 block font-body text-[11px] leading-snug text-muted-foreground">
                        同一產品碼的變體才算相似（如 CUF-D366、CUF-D366-1、CUF-D366-A、CUF-D366A、CUFD366；不含 CUF-D380）
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {similarCriteriaActive?.length ? (
                    <button
                      type="button"
                      onClick={clearSimilarSearch}
                      className="rounded-md px-2 py-1.5 font-body text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      清除篩選
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={applySimilarSearch}
                    className="inline-flex h-8 items-center rounded-lg bg-primary px-3 font-body text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    開始尋找
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          {similarCriteriaActive?.length ? (
            <button
              type="button"
              onClick={clearSimilarSearch}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              清除相似篩選
            </button>
          ) : null}
          </>
          ) : null}
          {!priceAudit ? (
          <>
          <DropdownMenu open={priceCheckMenuOpen} onOpenChange={setPriceCheckMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors',
                  priceCheckMultiplier != null
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                    : 'border-border bg-card text-foreground hover:bg-muted/50',
                )}
                title="篩選價格相對於成本的倍率（價格 ≤ 成本 × 倍數）"
              >
                <BadgeDollarSign className="h-3.5 w-3.5" />
                價錢核對
                {priceCheckMultiplier != null ? (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono-data text-[10px]">
                    {formatPriceCheckLabel(priceCheckMultiplier)}
                  </span>
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[220px]">
              {PRICE_CHECK_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  className={cn(
                    'text-xs font-body',
                    priceCheckMultiplier === opt.value && 'bg-accent font-semibold',
                  )}
                  onSelect={() => setPriceCheckMultiplier(opt.value)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div
                className="px-2 py-1.5"
                onKeyDown={(e) => e.stopPropagation()}
              >
                <p className="mb-1.5 font-body text-xs font-semibold text-foreground">自訂</p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceCheckCustomDraft}
                    onChange={(e) => setPriceCheckCustomDraft(sanitizeOneDecimalMultiplierInput(e.target.value))}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const n = parseOneDecimalMultiplier(priceCheckCustomDraft);
                        if (n == null) {
                          toast.message('請輸入有效倍數（大於 0，最多一位小數，如 5、5.1）');
                          return;
                        }
                        setPriceCheckMultiplier(n);
                        setPriceCheckMenuOpen(false);
                      }
                    }}
                    placeholder="如 5、5.1"
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono-data text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const n = parseOneDecimalMultiplier(priceCheckCustomDraft);
                      if (n == null) {
                        toast.message('請輸入有效倍數（大於 0，最多一位小數，如 5、5.1）');
                        return;
                      }
                      setPriceCheckMultiplier(n);
                      setPriceCheckMenuOpen(false);
                    }}
                    className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-2.5 font-body text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    套用
                  </button>
                </div>
              </div>
              {priceCheckMultiplier != null ? (
                <DropdownMenuItem
                  className="text-xs font-body text-muted-foreground"
                  onSelect={() => {
                    setPriceCheckMultiplier(null);
                    setPriceCheckCustomDraft('');
                  }}
                >
                  清除篩選
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {priceCheckMultiplier != null ? (
            <button
              type="button"
              onClick={() => {
                setPriceCheckMultiplier(null);
                setPriceCheckCustomDraft('');
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              清除價錢核對
            </button>
          ) : null}
          </>
          ) : null}
        </div>
      </div>

      {priceAudit ? (
        <div className="shrink-0 border-b border-border bg-amber-500/[0.06] px-6 py-3">
          <p className="mb-2 font-body text-xs text-muted-foreground">
            售價相對成本的倍數（例：售價 $100、成本 $50 = 2 倍）。「少於或等於 N 倍」＝售價 ≤ 成本 × N；多規格只要任一規格符合即計入。沒有售價或沒有成本（含 0）的產品視為 ≤0.1 倍，會顯示在 1.5／2／3／4 倍與自訂倍數 ≥0.1。點選倍數或套用自訂倍數可篩選列表。
          </p>
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="rounded-lg border border-border bg-card px-4 py-2.5 min-w-[140px]">
              <div className="font-body text-[11px] text-muted-foreground">
                {stateFilter === 'exclude-a' ? '排除A類產品' : catalogClass === 'B' ? '目錄產品' : '已發佈產品'}
              </div>
              <div className="mt-0.5 font-mono-data text-lg font-bold text-foreground">
                {isLoading ? '—' : priceAuditReport.published}
                <span className="ml-0.5 text-sm font-medium text-muted-foreground">件</span>
              </div>
            </div>
            {priceAuditReport.buckets.map((b) => {
              const active = priceCheckMultiplier === b.value;
              return (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => {
                    if (stateFilter !== 'exclude-a') {
                      setStateFilter(catalogClass === 'B' ? 'all' : 'published');
                    }
                    setPriceCheckMultiplier(active ? null : b.value);
                  }}
                  title="篩選列表：售價 ≤ 成本 × 此倍數"
                  className={cn(
                    'rounded-lg border px-4 py-2.5 min-w-[160px] text-left transition-colors',
                    active
                      ? 'border-amber-500/50 bg-amber-500/15'
                      : 'border-border bg-card hover:border-amber-500/40 hover:bg-amber-500/10',
                  )}
                >
                  <div className="font-body text-[13px] text-muted-foreground">
                    少於或等於 {b.value} 倍
                  </div>
                  <div className={cn(
                    'mt-0.5 font-mono-data text-lg font-bold',
                    b.value === 1.5 ? 'text-red-600' : 'text-foreground',
                  )}>
                    {isLoading ? '—' : b.count}
                    <span className="ml-0.5 text-sm font-medium text-muted-foreground">件</span>
                  </div>
                </button>
              );
            })}
            <div
              className={cn(
                'rounded-lg border px-4 py-2.5 min-w-[220px] text-left',
                isCustomPriceCheck
                  ? 'border-amber-500/50 bg-amber-500/15'
                  : 'border-border bg-card',
              )}
            >
              <div className="font-body text-[13px] text-muted-foreground">自訂倍數</div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceCheckCustomDraft}
                  onChange={(e) => setPriceCheckCustomDraft(sanitizeOneDecimalMultiplierInput(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyCustomPriceCheck();
                    }
                  }}
                  placeholder="如 5、5.1"
                  className="h-8 w-[72px] rounded-md border border-border bg-background px-2 font-mono-data text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  title="最多一位小數"
                />
                <span className="shrink-0 font-body text-[13px] text-muted-foreground">倍</span>
                <button
                  type="button"
                  onClick={applyCustomPriceCheck}
                  className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-2.5 font-body text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  套用
                </button>
              </div>
              <div className="mt-1 font-mono-data text-lg font-bold text-foreground">
                {customPriceCheckCount != null ? (
                  <>
                    {customPriceCheckCount}
                    <span className="ml-0.5 text-sm font-medium text-muted-foreground">件</span>
                  </>
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">輸入後套用</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* state filter pills + selection summary */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-6 py-2">
        <div className="flex items-center gap-1.5">
          {STATE_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStateFilter(f.key)} className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors', stateFilter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
              {f.label}
            </button>
          ))}
          {priceAudit ? (
            <button
              type="button"
              onClick={() => {
                if (catalogClass !== 'B') {
                  setItems([]);
                  setIsLoading(true);
                  setCatalogClass('B');
                }
                setStateFilter('exclude-a');
                setSelectedIds([]);
                setCurrentPage(1);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors',
                stateFilter === 'exclude-a'
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
              title="產品目錄全部產品，隱藏已出現在「已上載產品」的 A 類"
            >
              排除A類
            </button>
          ) : null}
        </div>
        {selectedIds.length > 0 && (
          <span className="shrink-0 font-mono-data text-xs text-muted-foreground">
            已選 <span className="font-semibold text-foreground">{selectedIds.length}</span> 件
            {selectionSpansPages && <span className="text-primary">（含跨頁）</span>}
          </span>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="shrink-0 border-b border-border bg-muted/20 px-6 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="shrink-0 font-body text-xs font-medium text-muted-foreground">
              已選 SKU
              <span className="ml-1 font-mono-data text-foreground">({selectedIds.length})</span>
              {selectionSpansPages && (
                <span className="ml-1 text-primary">· 含跨頁</span>
              )}
            </span>
            <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
              {bulkCategoryPickerOpen && (
                <>
                  <Select
                    value={bulkEditL1 || undefined}
                    onValueChange={(val) => {
                      setBulkEditL1(val);
                      setBulkEditL2('');
                    }}
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs font-body gap-1">
                      <FolderTree className="h-3 w-3 text-muted-foreground" />
                      <SelectValue placeholder="一級分類" />
                    </SelectTrigger>
                    <SelectContent>
                      {bulkEditL1Options.map((l1) => (
                        <SelectItem key={l1} value={l1}>{l1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bulkEditL1 && (
                    <Select
                      value={bulkEditL2 || undefined}
                      onValueChange={(val) => {
                        setBulkEditL2(val);
                        setCategoryConfirmOpen(true);
                      }}
                    >
                      <SelectTrigger className="h-8 w-[150px] text-xs font-body gap-1">
                        <FolderTree className="h-3 w-3 text-muted-foreground" />
                        <SelectValue placeholder="二級分類" />
                      </SelectTrigger>
                      <SelectContent>
                        {bulkEditL2Options.map((l2) => (
                          <SelectItem key={l2} value={l2}>{l2}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <button
                    type="button"
                    onClick={resetBulkCategoryPicker}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    取消
                  </button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    批量修改
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px]">
                  <DropdownMenuItem
                    className="text-xs text-rose-600 focus:text-rose-600"
                    onSelect={() => { void bulkDelist(); }}
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    批量下架（{selectedIds.length}）
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={() => {
                      resetBulkAddTags();
                      resetBulkPriceEdit();
                      setBulkCategoryPickerOpen(true);
                      setBulkEditL1('');
                      setBulkEditL2('');
                    }}
                  >
                    <FolderTree className="h-3.5 w-3.5" />
                    更改一級/二級分類
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={() => {
                      resetBulkCategoryPicker();
                      resetBulkPriceEdit();
                      setBulkAddTags([]);
                      setBulkAddTagsOpen(true);
                    }}
                  >
                    <Tag className="h-3.5 w-3.5" />
                    加入標籤
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={() => {
                      resetBulkCategoryPicker();
                      resetBulkAddTags();
                      setBulkPriceMultiplierInput('');
                      setBulkPriceEditOpen(true);
                    }}
                  >
                    <BadgeDollarSign className="h-3.5 w-3.5" />
                    修改售價
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {selectedIds.length > SELECTED_SKU_COLLAPSE_THRESHOLD && (
                <button
                  type="button"
                  onClick={() => setSkuChipsExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSkuChipList && 'rotate-180')} />
                  {showSkuChipList ? '收起 SKU' : '展開 SKU'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  resetBulkCategoryPicker();
                  resetBulkAddTags();
                  resetBulkPriceEdit();
                  clearAllSelection();
                }}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                清除全部
              </button>
            </div>
          </div>
          {bulkPriceEditOpen && (
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs font-body text-foreground">
                <span className="shrink-0 text-muted-foreground">倍數 :</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  autoFocus
                  value={bulkPriceMultiplierInput}
                  onChange={(e) => setBulkPriceMultiplierInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void confirmBulkModifyPrice();
                    }
                  }}
                  placeholder="例如 2.5"
                  className="h-7 w-24 rounded border border-border bg-background px-2 font-mono-data text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <button
                type="button"
                onClick={() => { void confirmBulkModifyPrice(); }}
                disabled={isBulkUpdatingPrice || isSyncing || !bulkPriceMultiplierInput.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBulkUpdatingPrice || isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeDollarSign className="h-3.5 w-3.5" />}
                套用
              </button>
              <button
                type="button"
                onClick={resetBulkPriceEdit}
                disabled={isBulkUpdatingPrice || isSyncing}
                className="h-9 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <span className="font-body text-[11px] text-muted-foreground">
                新售價 = 成本 × 倍數（向上取整），套用後會自動同步至 Shopify
                {priceCheckMultiplier != null
                  ? '；價錢核對開啟：只改售價低於「成本×此倍數」的規格'
                  : '；未開價錢核對：已選產品的所有規格都會改成此倍數（例如 1 倍＝售價等於成本）'}
              </span>
            </div>
          )}
          {bulkAddTagsOpen && (
            <div className="mb-1.5 flex flex-wrap items-start gap-2">
              <div className="min-w-[260px] max-w-md flex-1">
                <CategoryTagPicker
                  tags={bulkAddTags}
                  categories={bwfCats}
                  onChange={setBulkAddTags}
                />
              </div>
              <button
                type="button"
                onClick={() => { void confirmBulkAddTags(); }}
                disabled={isBulkAddingTags || bulkAddTags.length === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBulkAddingTags ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
                儲存
              </button>
              <button
                type="button"
                onClick={resetBulkAddTags}
                disabled={isBulkAddingTags}
                className="h-9 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                取消
              </button>
            </div>
          )}
          {showSkuChipList ? (
            <div className="max-h-20 overflow-y-auto overflow-x-hidden pr-1">
              <div className="flex flex-wrap gap-1.5">
                {selectedSkuChips.map(({ id, sku }) => (
                  <span
                    key={id}
                    className="relative inline-flex max-w-[160px] items-center rounded-md border border-primary/30 bg-primary/5 pl-2 pr-6 py-1"
                  >
                    <span className="truncate font-mono-data text-xs text-foreground" title={sku}>
                      {sku}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                      title="取消選取"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="font-body text-xs text-muted-foreground">
              已選 {selectedIds.length} 件產品，點擊「展開 SKU」可查看或移除個別項目
            </p>
          )}
        </div>
      )}

      {/* table — catalog: 操作 sits at viewport right; 材質描述 + Factory ID scroll */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto p-6">
        <div
          className="overflow-hidden rounded-xl border border-border bg-card"
          style={
            priceAudit
              ? { width: '100%', minWidth: '100%' }
              : { width: 'calc(100% + 288px)', minWidth: 'calc(100% + 288px)' }
          }
        >
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: 44 }} />
              {priceAudit ? <col /> : <col style={{ width: 290 }} />}
              <col style={{ width: 96 }} />
              {!priceAudit ? <col /> : null}
              {!priceAudit ? <col style={{ width: 150 }} /> : null}
              <col style={{ width: 72 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 168 }} />
              {!priceAudit ? <col style={{ width: 200 }} /> : null}
              {!priceAudit ? <col style={{ width: 88 }} /> : null}
            </colgroup>
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th
                  className="px-0 py-2.5 sticky left-0 bg-muted/50 z-10 cursor-pointer"
                  title="全選本頁"
                  onClick={() => togglePageSelectAll(!pageAllSelected)}
                >
                  <div className="flex h-full min-h-[2.5rem] w-full items-center justify-center">
                    <input
                      ref={pageSelectAllRef}
                      type="checkbox"
                      className="pointer-events-none rounded border-border"
                      title="全選本頁"
                      checked={pageAllSelected}
                      readOnly
                      tabIndex={-1}
                    />
                  </div>
                </th>
                <th className="px-3 py-2.5 text-left font-medium sticky left-[44px] bg-muted/50 z-10">產品圖片</th>
                <th className="px-3 py-2.5 text-left font-medium">廠家</th>
                {!priceAudit ? <th className="px-3 py-2.5 text-left font-medium">描述</th> : null}
                {!priceAudit ? <th className="px-3 py-2.5 text-left font-medium">標籤</th> : null}
                <th className="px-3 py-2.5 text-right font-medium">
                  <button
                    type="button"
                    onClick={() => toggleListSort('price')}
                    title={
                      sortKey === 'price'
                        ? (sortDir === 'asc' ? '價格由小到大' : '價格由大到小')
                        : '按價格排序'
                    }
                    className="inline-flex w-full items-center justify-end gap-1 hover:text-foreground transition-colors"
                  >
                    價格
                    <ArrowDown
                      className={cn(
                        'h-3 w-3',
                        sortKey === 'price' && sortDir === 'asc' && 'text-emerald-600',
                        sortKey === 'price' && sortDir === 'desc' && 'hidden',
                        sortKey !== 'price' && 'text-muted-foreground',
                      )}
                    />
                    {sortKey === 'price' && sortDir === 'desc' ? (
                      <ArrowUp className="h-3 w-3 text-emerald-600" />
                    ) : null}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <button
                    type="button"
                    onClick={() => toggleListSort('cost')}
                    title={
                      sortKey === 'cost'
                        ? (sortDir === 'asc' ? '成本由小到大' : '成本由大到小')
                        : '按成本排序'
                    }
                    className="inline-flex w-full items-center justify-end gap-1 hover:text-foreground transition-colors"
                  >
                    成本
                    <ArrowDown
                      className={cn(
                        'h-3 w-3',
                        sortKey === 'cost' && sortDir === 'asc' && 'text-emerald-600',
                        sortKey === 'cost' && sortDir === 'desc' && 'hidden',
                        sortKey !== 'cost' && 'text-muted-foreground',
                      )}
                    />
                    {sortKey === 'cost' && sortDir === 'desc' ? (
                      <ArrowUp className="h-3 w-3 text-emerald-600" />
                    ) : null}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left font-medium">變體</th>
                <th className="px-3 py-2.5 text-left font-medium">尺寸（LWH）</th>
                <th className="px-3 py-2.5 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleListSort('sku')}
                    title={
                      sortKey === 'sku'
                        ? (sortDir === 'asc' ? 'SKU 升序（A→Z，1→9）' : 'SKU 降序（Z→A，9→1）')
                        : '按 SKU 排序'
                    }
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    SKU
                    {sortKey === 'sku' && sortDir === 'asc' ? (
                      <ArrowUp className="h-3 w-3 text-primary" />
                    ) : sortKey === 'sku' ? (
                      <ArrowDown className="h-3 w-3 text-primary" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left font-medium">狀態</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
                {!priceAudit ? <th className="px-3 py-2.5 text-left font-medium">材質描述</th> : null}
                {!priceAudit ? <th className="px-3 py-2.5 text-left font-medium">Factory ID</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {similarCriteriaActive?.length && visibleSimilarGroups.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={tableColCount} className="px-4 py-10 text-center font-body text-sm text-muted-foreground">
                    找不到符合所選準則的相似產品
                  </td>
                </tr>
              ) : null}
              {paged.map((p, pageIndex) => {
                const r = p.raw;
                const variants: ShopifyVariant[] = Array.isArray(r.variants) ? r.variants : [];
                const tags: string[] = priceAudit ? [] : (Array.isArray(r.tags) ? r.tags : []);
                const bodyText = priceAudit ? '' : (r.body_html ? r.body_html.replace(/<[^>]*>/g, '') : '');
                const skuText = resolveProductSku(r);
                const groupMeta = groupMetaByProductId.get(p.id);
                const prevGroupId =
                  pageIndex > 0
                    ? groupMetaByProductId.get(paged[pageIndex - 1].id)?.groupId
                    : null;
                const showGroupHeader =
                  Boolean(similarCriteriaActive?.length) &&
                  Boolean(groupMeta) &&
                  groupMeta!.groupId !== prevGroupId;
                return (
                  <Fragment key={p.id}>
                  {showGroupHeader && groupMeta ? (
                    <tr className="bg-violet-500/[0.07]">
                      <td colSpan={tableColCount} className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-body text-xs font-semibold text-violet-800 dark:text-violet-200">
                            {groupMeta.label} 已找到 {groupMeta.count} 款
                          </span>
                          <span className="font-mono-data text-[11px] text-muted-foreground">
                            {groupMeta.skus.join(' · ')}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const ids =
                                visibleSimilarGroups
                                  .find((g) => g.id === groupMeta.groupId)
                                  ?.products.map((x) => x.id) ?? [];
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                for (const id of ids) next.add(id);
                                return Array.from(next);
                              });
                            }}
                            className="ml-auto rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-body text-[11px] font-medium text-violet-700 hover:bg-violet-500/15 dark:text-violet-300"
                          >
                            選取此組
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  <tr className="hover:bg-muted/30 cursor-pointer" onClick={() => openDetail(p)}>
                    <td
                      className="px-0 py-0 sticky left-0 bg-card z-10 align-top cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(p.id);
                      }}
                    >
                      <div className="flex w-full items-start justify-center pt-3" style={{ minHeight: thumbPx }}>
                        <input
                          type="checkbox"
                          className="pointer-events-none rounded border-border"
                          checked={selectedIds.includes(p.id)}
                          readOnly
                          tabIndex={-1}
                          aria-label="選擇產品"
                        />
                      </div>
                    </td>
                    {/* 產品圖片（含名稱） */}
                    <td className="px-3 py-2.5 sticky left-[44px] bg-card z-10 align-top overflow-hidden">
                      <div className="flex items-start gap-3">
                        {p.imageUrl ? (
                          <img
                            key={p.imageUrl}
                            src={p.imageUrl}
                            alt={p.title}
                            loading="lazy"
                            className="rounded-md object-contain bg-muted flex-shrink-0"
                            style={{ height: thumbPx, width: thumbPx }}
                          />
                        ) : (
                          <div
                            className="flex items-center justify-center rounded-md bg-muted flex-shrink-0"
                            style={{ height: thumbPx, width: thumbPx }}
                          >
                            <Store className="h-8 w-8 text-muted-foreground/40" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1 pt-1">
                          {priceAudit && catalogClass === 'B' && p.isOnShopify ? (
                            <span
                              className="mb-1 inline-flex rounded px-1.5 py-0.5 bg-blue-600 text-white font-display text-[10px] font-semibold tracking-wide"
                              title={p.shopifyTitle ? `Shopify：${p.shopifyTitle}${p.shopify_product_id ? ` (ID: ${p.shopify_product_id})` : ''}` : '已上架 Shopify'}
                            >
                              已上架Shopify
                            </span>
                          ) : null}
                          <span
                            className={cn(
                              'block font-body font-medium text-foreground',
                              priceAudit ? 'text-[13px] line-clamp-2' : 'text-[12px] line-clamp-5',
                            )}
                            title={p.title}
                          >
                            {p.title}
                          </span>
                        </div>
                      </div>
                    </td>
                    {/* 廠家 */}
                    <td className="px-3 py-2.5 align-top overflow-hidden">
                      {r.vendor ? (
                        <span className="inline-block rounded-md bg-violet-500/10 px-2 py-0.5 font-body text-[11px] text-violet-600 truncate max-w-full">{r.vendor}</span>
                      ) : <span className="text-muted-foreground/50 text-[11px]">—</span>}
                    </td>
                    {/* 描述 */}
                    {!priceAudit ? (
                    <td className="px-3 py-2.5 align-top overflow-hidden">
                      <div
                        className="font-body text-muted-foreground"
                        style={{
                          fontSize: '11px',
                          lineHeight: 1.8,
                          maxHeight: 'calc(11px * 1.8 * 8)',
                          overflow: 'hidden',
                          wordBreak: 'break-word',
                          display: '-webkit-box',
                          WebkitLineClamp: 8,
                          WebkitBoxOrient: 'vertical',
                        }}
                        title={bodyText || undefined}
                      >
                        {bodyText || '—'}
                      </div>
                    </td>
                    ) : null}
                    {/* 標籤 — show up to 6, then +N */}
                    {!priceAudit ? (
                    <td className="px-3 py-2.5 align-top overflow-hidden">
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-x-1.5 gap-y-2">
                          {tags.slice(0, 6).map((t, i) => (
                            <span key={i} className="rounded-full bg-muted px-1.5 py-0.5 font-body text-[10px] text-foreground whitespace-nowrap">{t}</span>
                          ))}
                          {tags.length > 6 && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">
                              +{tags.length - 6}
                            </span>
                          )}
                        </div>
                      ) : <span className="text-muted-foreground/50 text-[11px]">—</span>}
                    </td>
                    ) : null}
                    {/* 價格 — 任規格 ≤ 成本×1.5 則整格標紅 */}
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right font-mono-data text-[12px] font-bold whitespace-nowrap align-top overflow-hidden',
                        productHasPriceAlert(r.price, variants, p.costPrice)
                          ? 'text-red-600'
                          : 'text-foreground',
                      )}
                      title={
                        productHasPriceAlert(r.price, variants, p.costPrice)
                          ? '價格 ≤ 成本 × 1.5（含任一規格）'
                          : undefined
                      }
                    >
                      {fmtMoney(r.price)}
                    </td>
                    {/* 成本 */}
                    <td className="px-3 py-2.5 text-right font-mono-data text-[11px] text-muted-foreground whitespace-nowrap align-top">
                      {fmtMoney(p.costPrice)}
                    </td>
                    {/* 變體 */}
                    <td className="px-3 py-2.5 align-top overflow-hidden">
                      <span className="font-mono-data text-[11px] text-muted-foreground">{variants.length} 個變體</span>
                    </td>
                    {/* 尺寸 (LWH) — wrap when wider than column */}
                    <td className="px-3 py-2.5 align-top overflow-hidden">
                      {r['my_fields.normal_size'] ? (
                        <span
                          className="font-mono-data text-[11px] text-muted-foreground block whitespace-normal break-words"
                          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                          title={r['my_fields.normal_size']}
                        >
                          {r['my_fields.normal_size']}
                        </span>
                      ) : (
                        <span className="font-mono-data text-[11px] text-muted-foreground/50">—</span>
                      )}
                    </td>
                    {/* SKU — 單行完整顯示 */}
                    <td className="px-3 py-2.5 align-top overflow-hidden">
                      <span
                        className="font-mono-data text-[11px] text-foreground block whitespace-nowrap"
                        title={skuText}
                      >
                        {skuText}
                      </span>
                    </td>
                    {/* 狀態 */}
                    <td className="px-2 py-2.5 align-top overflow-hidden">
                      <span className={cn('inline-flex max-w-full rounded-full border px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap', PUBLISH_STATE_META[p.state].className)}>
                        {PUBLISH_STATE_META[p.state].label}
                      </span>
                    </td>
                    {/* 操作 */}
                    <td className="px-2 py-2.5 align-top overflow-hidden" onClick={e => e.stopPropagation()}>
                      <div className="flex flex-col items-stretch gap-1">
                        {p.sourceKind === 'catalog' && !p.isOnShopify ? (
                          <span className="text-center text-[11px] text-muted-foreground/50">—</span>
                        ) : p.state === 'published' ? (
                          <button onClick={() => setProductState(p, 'delisted', '已下架')} className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10 whitespace-nowrap"><ArrowDownToLine className="h-3 w-3 shrink-0" /> 下架</button>
                        ) : (
                          <button onClick={() => setProductState(p, 'published', '已重新上架')} className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-emerald-600 hover:bg-emerald-500/10 whitespace-nowrap"><ArrowUpToLine className="h-3 w-3 shrink-0" /> 上架</button>
                        )}
                        {p.sourceKind === 'catalog' && !p.isOnShopify ? null : (
                          <button onClick={() => toast.success('已還原至上一版本')} className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap"><RotateCcw className="h-3 w-3 shrink-0" /> 還原</button>
                        )}
                      </div>
                    </td>
                    {/* 材質描述 */}
                    {!priceAudit ? (
                    <td className="px-3 py-2.5 align-top overflow-hidden">
                      {r['my_fields.materials'] ? (
                        <div
                          className="font-body text-[11px] text-muted-foreground break-words overflow-hidden"
                          style={{
                            lineHeight: 1.35,
                            maxHeight: 'calc(11px * 1.35 * 6)',
                            display: '-webkit-box',
                            WebkitLineClamp: 6,
                            WebkitBoxOrient: 'vertical',
                          }}
                          title={r['my_fields.materials']}
                        >
                          {r['my_fields.materials']}
                        </div>
                      ) : (
                        <span className="font-body text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    ) : null}
                    {/* Factory ID — scroll right to see */}
                    {!priceAudit ? (
                    <td className="px-3 py-2.5 align-top">
                      <span className="font-mono-data text-[11px] text-muted-foreground/50">—</span>
                    </td>
                    ) : null}
                  </tr>
                  </Fragment>
                );
              })}
              {sorted.length === 0 && !(similarCriteriaActive?.length && visibleSimilarGroups.length === 0) && (
                <tr><td colSpan={tableColCount} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">
                  {isLoading ? '載入中...' : similarCriteriaActive?.length ? '找不到符合所選準則的相似產品' : catalogClass === 'B' ? '目錄沒有產品' : '尚未從 Shopify 導入產品'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        {totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border bg-card px-6 py-2.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              上一頁
            </button>
            <span className="font-mono-data text-xs text-muted-foreground">
              第 {currentPage} / {totalPages} 頁 · 本頁 {paged.length} 件 · 共 {sorted.length} 件
              {similarCriteriaActive?.length ? '（同類不拆頁）' : ''}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              下一頁
            </button>
          </div>
        )}
      </div>

      {/* ── Shopify Import Dialog ─────────────────────────────────────── */}
      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => !isImporting && setShowImportDialog(false)}>
          <div className="relative flex flex-col bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[62rem] max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Store className="h-5 w-5 text-emerald-600" />
                <h3 className="font-display text-base font-bold">從 Shopify 導入產品</h3>
                <span className="font-mono-data text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  共 {previewProducts.length} 件 · 已選 {selectedImportIds.size} 件
                </span>
              </div>
              <button onClick={() => setShowImportDialog(false)} disabled={isImporting} className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0 bg-muted/20">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input value={importSearch} onChange={e => setImportSearch(e.target.value)} placeholder="搜尋產品名稱或廠商..." className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
            </div>

            {/* Product list */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border">
                  <tr className="text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={filteredPreview.length > 0 && filteredPreview.every(p => selectedImportIds.has(p.shopify_product_id))}
                        onChange={e => {
                          setSelectedImportIds(prev => {
                            const n = new Set(prev);
                            filteredPreview.forEach(p => e.target.checked ? n.add(p.shopify_product_id) : n.delete(p.shopify_product_id));
                            return n;
                          });
                        }}
                        className="rounded border-border"
                        title="全選"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium">產品</th>
                    <th className="px-3 py-2.5 text-left font-medium">廠商</th>
                    <th className="px-3 py-2.5 text-left font-medium">類型</th>
                    <th className="px-3 py-2.5 text-right font-medium">價格</th>
                    <th className="px-3 py-2.5 text-left font-medium">狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredPreview.map(p => (
                    <tr key={p.shopify_product_id} className={cn('hover:bg-muted/30 cursor-pointer', selectedImportIds.has(p.shopify_product_id) && 'bg-emerald-500/5')} onClick={() => toggleImportSelect(p.shopify_product_id)}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selectedImportIds.has(p.shopify_product_id)} onChange={() => toggleImportSelect(p.shopify_product_id)} onClick={e => e.stopPropagation()} className="rounded border-border" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.title} className="h-9 w-9 rounded-md object-cover bg-muted flex-shrink-0" />
                          ) : (
                            <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                              <Store className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}
                          <span className="font-medium text-foreground text-xs line-clamp-2 max-w-[220px]">{p.title}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.vendor || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.product_type || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono-data text-xs">{p.price > 0 ? `$${p.price.toLocaleString()}` : '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium border',
                          p.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                          p.status === 'draft' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                          'bg-muted text-muted-foreground border-border'
                        )}>{p.status === 'active' ? '已發佈' : p.status === 'draft' ? '草稿' : '已下架'}</span>
                      </td>
                    </tr>
                  ))}
                  {filteredPreview.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-10 text-center text-xs text-muted-foreground/60">找不到符合的產品</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-muted/20 shrink-0">
              <span className="text-xs text-muted-foreground">
                已選 <span className="font-semibold text-foreground">{selectedImportIds.size}</span> / {previewProducts.length} 件產品
              </span>
              <div className="flex gap-2">
                <button onClick={() => setShowImportDialog(false)} disabled={isImporting} className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
                  取消
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={isImporting || selectedImportIds.size === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                  {isImporting ? '導入中...' : `確定導入 ${selectedImportIds.size} 件`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Product Detail Modal (FG-style layout) ─────────────────────── */}
      {detailProduct && (
        <PublishedProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onSaved={loadProducts}
          canGoPrev={detailPageIndex > 0}
          canGoNext={
            detailPageIndex >= 0 && detailPageIndex < paged.length - 1
          }
          onGoPrev={() => goDetailSibling(-1)}
          onGoNext={() => goDetailSibling(1)}
        />
      )}

      <PublishedProductMergeModal
        products={mergeProducts}
        open={showMergeModal}
        onOpenChange={(open) => {
          setShowMergeModal(open);
          if (!open) setMergeProducts([]);
        }}
        onMerged={() => {
          setSelectedIds([]);
          void loadProducts({ silent: true });
        }}
      />

      <AlertDialog
        open={categoryConfirmOpen}
        onOpenChange={(open) => {
          setCategoryConfirmOpen(open);
          if (!open) setBulkEditL2('');
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-base">確認更改分類</AlertDialogTitle>
            <AlertDialogDescription className="font-body text-sm">
              是否把所選的{' '}
              <span className="font-mono-data font-semibold text-foreground">{selectedIds.length}</span>{' '}
              件產品改到「
              <span className="font-semibold text-foreground">{bulkEditL1} &gt; {bulkEditL2}</span>
              」？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="font-display text-xs font-bold"
              disabled={isBulkUpdatingCategory}
            >
              否
            </AlertDialogCancel>
            <AlertDialogAction
              className="font-display text-xs font-bold"
              disabled={isBulkUpdatingCategory}
              onClick={(e) => {
                e.preventDefault();
                void confirmBulkCategoryChange();
              }}
            >
              {isBulkUpdatingCategory ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  更新中...
                </>
              ) : (
                '是'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
