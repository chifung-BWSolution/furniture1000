// ============================================================================
// FDS 2.1 產品搜索與匯入（F-AI-003 / F-AI-005，T-401～T-405）
// 搜索經 fds_search_products／fds_product_detail RPC：任何角色都不回傳成本價。
// 所有人看到折扣價（售價 × 0.8）和原價。匯入經 fds_import_extracted_products，只收已通過的提取項目（BR-02）。
// ============================================================================
import { supabase } from '@/lib/supabase';
import { COLOR_MAP, autoMatchColor } from '@/constants/color-map';
import { MATERIAL_TAG_RULES, materialTermsForTags } from '@/constants/material-tags';

export type PriceValidity = 'valid' | 'expired' | 'future' | 'unmarked';
export type SearchScope = 'all' | 'catalog' | 'shopify' | 'quoted';
export type SearchSort =
  | 'relevance'
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'size'
  /** 常用傢俬：PMS 落單類別熱度 → 類內報價用量。 */
  | 'popular_demand'
  /** 常用傢俬：出現於幾多張報價單。 */
  | 'popular_quotes'
  /** 常用傢俬：總件數。 */
  | 'popular_quantity'
  /** 常用傢俬：報價金額。 */
  | 'popular_amount';

export interface SearchQuote {
  cost?: number;
  currency?: string;
  unit?: string;
  moq?: number;
  variant_label?: string;
  factory_name?: string;
  valid_from?: string;
  valid_to?: string;
  validity: PriceValidity;
  count: number;
}

export interface SearchSource {
  document_id: string;
  title: string | null;
  page_no: number | null;
  doc_type: 'quote' | 'catalog';
}

export interface SearchProduct {
  id: string;
  title: string;
  model?: string;
  sku?: string;
  image_url?: string;
  /** HTTP gallery only: main, image 2, image 3, lifestyle. No base64. */
  image_urls?: string[];
  factory_id?: string;
  factory_name?: string;
  dimension_l_mm?: number;
  dimension_w_mm?: number;
  dimension_h_mm?: number;
  material?: string;
  color?: string;
  category?: string;
  level1_category?: string;
  level2_category?: string;
  in_stock?: boolean;
  lead_time?: string;
  created_at: string;
  on_shopify: boolean;
  in_catalog: boolean;
  /** 常用傢俬：出現在幾張報價單（只計最新版本）。 */
  usage_quote_count?: number;
  /** 常用傢俬：報價單內的行數。 */
  usage_line_count?: number;
  /** 常用傢俬：總件數。 */
  usage_quantity?: number;
  /** 常用傢俬：報價金額合計。 */
  usage_amount?: number;
  /** 常用傢俬：所屬類別在 PMS 的落單件數（類別層級）。 */
  category_demand_qty?: number;
  /** 常用傢俬：所屬類別在 PMS 的落單行數（類別層級）。 */
  category_demand_lines?: number;
  middle_price?: number;
  sale_price?: number;
  legacy_cost?: number;
  exact: boolean;
  /** Supplier quote standing: matched latest year, same-year conflict, or no usable price. */
  price_status?: 'matched' | 'conflict' | 'unmatched';
  /** 0–1 cosine similarity. Present only on image-search hits. */
  similarity?: number;
  /** Image search never claims a hit is the same product. */
  relation?: 'similar';
  quote?: SearchQuote;
  source?: SearchSource;
}

export interface SearchResult {
  total: number;
  can_view_cost: boolean;
  /** Private supplier PDF: only admin / uploader may open it. */
  can_open_source: boolean;
  items: SearchProduct[];
}

export interface SearchFilters {
  query: string;
  factory: string;
  level1: string;
  level2: string;
  /** English W3C names, as stored in products.color. */
  colors: string[];
  materialTags: string[];
  priceMin: string;
  priceMax: string;
  lMin: string;
  lMax: string;
  wMin: string;
  wMax: string;
  hMin: string;
  hMax: string;
  inStock: boolean;
  scope: SearchScope;
  sort: SearchSort;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  query: '',
  factory: '',
  level1: '',
  level2: '',
  colors: [],
  materialTags: [],
  priceMin: '',
  priceMax: '',
  lMin: '',
  lMax: '',
  wMin: '',
  wMax: '',
  hMin: '',
  hMax: '',
  inStock: false,
  scope: 'all',
  sort: 'relevance',
};

export interface SearchFacets {
  factories: { name: string; count: number }[];
  categories: { level1: string; level2: string | null; count: number }[];
}

export interface ProductPriceRow {
  id: string;
  cost?: number;
  currency?: string;
  unit?: string;
  moq?: number;
  variant_label?: string;
  factory_name?: string;
  valid_from?: string;
  valid_to?: string;
  validity: PriceValidity;
  quote_year?: number;
  price_conflict?: boolean;
  page_no?: number;
  document_id?: string;
  document_title?: string;
  storage_path?: string;
  created_at: string;
}

export interface ProductSourceRow {
  document_id: string;
  title?: string;
  factory_name?: string;
  doc_type: 'quote' | 'catalog';
  page_no?: number;
  storage_path?: string;
  created_at: string;
}

export type PriceTrend = 'up' | 'down' | 'flat';

export interface SupplierOffer {
  id: string;
  current: boolean;
  cost?: number;
  currency?: string;
  fx_recorded: boolean;
  unit?: string;
  moq?: number;
  variant_label?: string;
  valid_from?: string;
  valid_to?: string;
  validity: PriceValidity;
  trend?: PriceTrend;
  page_no?: number;
  document_id?: string;
  document_title?: string;
  created_at: string;
}

export interface SupplierCompareRow {
  product_id: string;
  is_current: boolean;
  same_supplier: boolean;
  model?: string;
  factory_name?: string;
  dimension_l_mm?: number;
  dimension_w_mm?: number;
  dimension_h_mm?: number;
  material?: string;
  color?: string;
  /** Middle price (sale price × 0.8). Every role sees it; cost stays masked. */
  middle_price?: number;
  sale_price?: number;
  offers: SupplierOffer[];
}

export interface SupplierCompare {
  model_key: string | null;
  auto_selected: false;
  can_view_cost: boolean;
  truncated: boolean;
  suppliers: SupplierCompareRow[];
}

export interface ProductUsage {
  /** 出現於幾張報價單（只計最新版本，排除回收桶）。 */
  quote_count: number;
  /** 報價單內的行數。 */
  line_count: number;
  /** 總件數。 */
  quantity_sum: number;
  /** 報價金額合計。 */
  amount_sum: number;
}

export interface ProductDetail extends Omit<SearchProduct, 'exact' | 'quote' | 'source'> {
  description?: string;
  specifications?: string;
  remarks?: string;
  can_view_cost: boolean;
  can_open_source: boolean;
  images: string[];
  prices: ProductPriceRow[];
  sources: ProductSourceRow[];
  /** 報價用量（常用傢俬的數據來源）。 */
  usage?: ProductUsage;
  /** 類別熱度：PMS 落單聚合（常用傢俬的第二層）。 */
  category_demand?: {
    level1: string;
    qty: number;
    lines: number;
  };
}

export interface ImportResult {
  created: number;
  linked: number;
  prices: number;
  pending: number;
  skipped: { id: string; reason: string }[];
}

export const VALIDITY_LABELS: Record<PriceValidity, string> = {
  valid: '有效',
  expired: '已過期',
  future: '未生效',
  unmarked: '有效期未標示',
};

function rpcErrorMessage(message: string): string {
  if (message.includes('permission_denied')) return '沒有權限（只限公司職員）';
  if (message.includes('document_factory_missing')) return '文件未指定廠家，無法以「型號＋廠家」建立產品';
  if (message.includes('document_not_found')) return '找不到文件';
  if (message.includes('product_not_found')) return '找不到產品';
  if (message.includes('price_not_reviewed')) return '未審核的價格不能寫成正式價';
  if (message.includes('price_not_found')) return '找不到這筆報價';
  if (message.includes('model_mismatch')) return '型號不同，不能合併';
  if (message.includes('different_supplier')) return '不同供應商要留作比較，不能合併';
  if (message.includes('published_product')) return '已上架的產品不能被合併掉';
  if (message.includes('same_product')) return '不能和自己合併';
  return message;
}

function num(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Colors are stored as English names, so a Chinese colour word typed in the
 * keyword box (「梳化 墨綠」) is moved into the colour filter instead.
 */
export function splitColorTerms(query: string): { text: string; colors: string[] } {
  const colors: string[] = [];
  const rest: string[] = [];
  for (const term of query.trim().split(/\s+/).filter(Boolean)) {
    const en = colorForTerm(term);
    if (en) colors.push(en, term);
    else rest.push(term);
  }
  return { text: rest.join(' '), colors };
}

const BASIC_COLOR_CHARS = /[白黑灰紅藍綠棕咖金銀粉紫橙黃]/;
const MATERIAL_WORDS = new Set(MATERIAL_TAG_RULES.flatMap((rule) => rule.terms.map((t) => t.toLowerCase())));

function colorForTerm(term: string): string | null {
  if (MATERIAL_WORDS.has(term.toLowerCase())) return null;
  const bare = term.replace(/色$/, '');
  const exact = COLOR_MAP.find((c) => c.cn === term || c.cn.replace(/色$/, '') === bare);
  if (exact) return exact.en;
  if (term.length <= 3 && BASIC_COLOR_CHARS.test(term)) return autoMatchColor(term) || null;
  return null;
}

/** English swatch value and the Chinese label stored on imported products. */
export function expandColorFilters(colors: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };
  for (const color of colors) {
    add(color);
    const trimmed = color.trim();
    const mapped = COLOR_MAP.find(
      (entry) => entry.en.toLowerCase() === trimmed.toLowerCase() || entry.cn === trimmed,
    );
    if (!mapped) continue;
    add(mapped.en);
    add(mapped.cn);
  }
  return out;
}

export interface SearchExtra {
  /** Only products created within this many days. */
  sinceDays?: number | null;
  /** 常用傢俬：只顯示有報價用量的產品（全公司共用，非個人清單）。 */
  commonOnly?: boolean;
  /** Products linked to one supplier PDF. */
  documentId?: string | null;
}

export async function searchProducts(
  filters: SearchFilters,
  page: number,
  pageSize: number,
  extra?: SearchExtra,
): Promise<SearchResult> {
  const { text, colors: queryColors } = splitColorTerms(filters.query);
  // Swatches submit English names (White). Imported rows may still say 白色.
  const colors = expandColorFilters([...filters.colors, ...queryColors]);
  const materials = materialTermsForTags(filters.materialTags);
  const { data, error } = await supabase.rpc('fds_search_products', {
    p_query: text || null,
    p_factory: filters.factory || null,
    p_level1: filters.level1 || null,
    p_level2: filters.level2 || null,
    p_colors: colors.length > 0 ? colors : null,
    p_materials: materials.length > 0 ? materials : null,
    p_price_min: num(filters.priceMin),
    p_price_max: num(filters.priceMax),
    p_l_min: num(filters.lMin),
    p_l_max: num(filters.lMax),
    p_w_min: num(filters.wMin),
    p_w_max: num(filters.wMax),
    p_h_min: num(filters.hMin),
    p_h_max: num(filters.hMax),
    p_in_stock: filters.inStock || null,
    p_scope: filters.scope,
    p_sort: filters.sort,
    p_limit: pageSize,
    p_offset: page * pageSize,
    p_since_days: extra?.sinceDays && extra.sinceDays > 0 ? extra.sinceDays : null,
    p_common: extra?.commonOnly ? true : null,
    p_document_id: extra?.documentId || null,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
  return data as SearchResult;
}

export async function fetchSearchFacets(): Promise<SearchFacets> {
  const { data, error } = await supabase.rpc('fds_product_search_facets');
  if (error) throw new Error(rpcErrorMessage(error.message));
  return data as SearchFacets;
}

export async function fetchProductDetail(productId: string): Promise<ProductDetail> {
  const { data, error } = await supabase.rpc('fds_product_detail', { p_product_id: productId });
  if (error) throw new Error(rpcErrorMessage(error.message));
  return data as ProductDetail;
}

export async function fetchSupplierCompare(productId: string): Promise<SupplierCompare> {
  const { data, error } = await supabase.rpc('fds_compare_supplier_prices', { p_product_id: productId });
  if (error) throw new Error(rpcErrorMessage(error.message));
  return data as SupplierCompare;
}

export async function mergeDuplicateProduct(keepId: string, dropId: string): Promise<void> {
  const { error } = await supabase.rpc('fds_merge_duplicate_product', {
    p_keep_id: keepId,
    p_drop_id: dropId,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
}

export async function resolveSupplierPriceConflict(priceId: string): Promise<void> {
  const { error } = await supabase.rpc('fds_resolve_supplier_price_conflict', {
    p_price_id: priceId,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
}

export async function importExtractedProducts(documentId: string, itemIds?: string[]): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('fds_import_extracted_products', {
    p_document_id: documentId,
    p_item_ids: itemIds && itemIds.length > 0 ? itemIds : null,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
  return data as ImportResult;
}

export function sizeLabel(p: Pick<SearchProduct, 'dimension_l_mm' | 'dimension_w_mm' | 'dimension_h_mm'>): string | null {
  const dims = [p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm];
  if (dims.every((d) => d == null || d <= 0)) return null;
  return dims.map((d) => (d == null || d <= 0 ? '?' : Math.round(d))).join(' × ');
}

export function moneyLabel(value: number | null | undefined, currency?: string | null): string | null {
  if (value == null) return null;
  const amount = value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return currency ? `${currency} ${amount}` : amount;
}
