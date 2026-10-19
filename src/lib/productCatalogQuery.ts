import { supabase } from '@/lib/supabase';
import {
  passesSystemCatalogReadyStock,
  READY_STOCK_LEAD_TIME,
} from '@/lib/quoteStockFilter';

export type CatalogSourceType = 'shopify' | 'system';

export type CatalogProductRow = {
  id: string;
  sourceKind: 'rts' | 'shopify' | 'products';
  productId: string | null;
  title: string;
  sku: string | null;
  image_url: string | null;
  sale_price: number | null;
  cost_price: number | null;
  factory_name: string | null;
  category: string | null;
  level1_category: string | null;
  level2_category: string | null;
  product_category_id: string | null;
  material: string | null;
  dimension_l_mm: number | null;
  dimension_w_mm: number | null;
  dimension_h_mm: number | null;
  color: string | null;
  remarks: string | null;
  delivery_term_name: string | null;
  shopify_product_id: string | null;
  sort_ts: string;
};

export type CatalogQueryParams = {
  source: CatalogSourceType;
  search?: string;
  factory_name?: string;
  level1?: string;
  level2?: string;
  /** When set (and level1 filter empty), matching products appear first in results. */
  priority_level1?: string[];
  /** Only ready-stock products (現貨 / 3-7天). */
  stock_only?: boolean;
  page?: number;
  page_size?: number;
};

export type CatalogQueryResult = {
  products: CatalogProductRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function parseProductType(productType: string | null | undefined): {
  level1: string | null;
  level2: string | null;
} {
  const raw = (productType || '').trim();
  if (!raw) return { level1: null, level2: null };
  const parts = raw.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { level1: parts[0], level2: parts[parts.length - 1] };
  }
  return { level1: null, level2: parts[0] || null };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s || null;
}

function firstImage(images: unknown, fallback?: string | null): string | null {
  if (fallback?.trim()) return fallback.trim();
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
    if (first && typeof first === 'object' && 'src' in first) {
      const src = (first as { src?: string }).src;
      if (src?.trim()) return src.trim();
    }
  }
  return null;
}

function mapProductsRow(row: Record<string, unknown>): CatalogProductRow {
  const images = row.images;
  return {
    id: `products:${String(row.id)}`,
    sourceKind: 'products',
    productId: String(row.id),
    title: String(row.title || ''),
    sku: strOrNull(row.sku),
    image_url: firstImage(images, strOrNull(row.image_url)),
    sale_price: numOrNull(row.sale_price) ?? numOrNull(row.price),
    cost_price: numOrNull(row.cost_price),
    factory_name: strOrNull(row.factories_display_name),
    category: strOrNull(row.level2_category) || strOrNull(row.category),
    level1_category: strOrNull(row.level1_category),
    level2_category: strOrNull(row.level2_category),
    product_category_id: strOrNull(row.product_category_id),
    material: strOrNull(row.material),
    dimension_l_mm: numOrNull(row.dimension_l_mm),
    dimension_w_mm: numOrNull(row.dimension_w_mm),
    dimension_h_mm: numOrNull(row.dimension_h_mm),
    color: strOrNull(row.color),
    remarks: strOrNull(row.remarks),
    delivery_term_name: strOrNull(row.delivery_term_name),
    shopify_product_id: strOrNull(row.shopify_product_id),
    sort_ts: strOrNull(row.modified_date) || strOrNull(row.created_at) || '',
  };
}

function mapRtsRow(
  row: Record<string, unknown>,
  product?: Record<string, unknown> | null,
): CatalogProductRow {
  const parsed = parseProductType(strOrNull(row.product_type));
  const p = product || {};
  return {
    id: `rts:${String(row.id)}`,
    sourceKind: 'rts',
    productId: strOrNull(row.product_id) || strOrNull(p.id),
    title: String(row.title || p.title || ''),
    sku: strOrNull(row.sku) || strOrNull(p.sku),
    image_url: firstImage(row.images, strOrNull(row.image_url) || strOrNull(p.image_url)),
    sale_price: numOrNull(row.price) ?? numOrNull(p.sale_price) ?? numOrNull(p.price),
    cost_price: numOrNull((row as { cost?: unknown }).cost) ?? numOrNull(p.cost_price),
    factory_name: strOrNull(row.vendor) || strOrNull(p.factories_display_name),
    category:
      strOrNull(p.level2_category) ||
      parsed.level2 ||
      strOrNull(p.category),
    level1_category: strOrNull(p.level1_category) || parsed.level1,
    level2_category: strOrNull(p.level2_category) || parsed.level2,
    product_category_id: strOrNull(p.product_category_id),
    material: strOrNull(row.material) || strOrNull(p.material),
    dimension_l_mm: numOrNull(row.dimension_l_mm) ?? numOrNull(p.dimension_l_mm),
    dimension_w_mm: numOrNull(row.dimension_w_mm) ?? numOrNull(p.dimension_w_mm),
    dimension_h_mm: numOrNull(row.dimension_h_mm) ?? numOrNull(p.dimension_h_mm),
    color: strOrNull(row.color) || strOrNull(p.color),
    remarks: strOrNull(row.remarks) || strOrNull(p.remarks),
    delivery_term_name: strOrNull(p.delivery_term_name),
    shopify_product_id: strOrNull(row.shopify_product_id),
    sort_ts: strOrNull(row.imported_at) || '',
  };
}

function mapShopifyProductsRow(
  row: Record<string, unknown>,
  product?: Record<string, unknown> | null,
): CatalogProductRow {
  const parsed = parseProductType(strOrNull(row.product_type));
  const p = product || {};
  const variantSku = Array.isArray(row.variants)
    ? (row.variants as Array<{ sku?: string }>)
        .map((v) => strOrNull(v.sku))
        .find(Boolean)
    : null;
  return {
    id: `shopify:${String(row.id)}`,
    sourceKind: 'shopify',
    // A 類: products.id via mirror source_product_id — never shopify_products.id (UUID).
    productId: strOrNull(row.source_product_id) || strOrNull(p.id),
    title: String(row.title || p.title || ''),
    sku: strOrNull(row.sku) || variantSku || strOrNull(p.sku),
    image_url: firstImage(row.images, strOrNull(row.image_url) || strOrNull(p.image_url)),
    sale_price: numOrNull(row.price) ?? numOrNull(p.sale_price) ?? numOrNull(p.price),
    cost_price: numOrNull(row.cost) ?? numOrNull(p.cost_price),
    factory_name: strOrNull(row.vendor) || strOrNull(p.factories_display_name),
    category:
      strOrNull(p.level2_category) ||
      parsed.level2 ||
      strOrNull(p.category),
    level1_category: strOrNull(p.level1_category) || parsed.level1,
    level2_category: strOrNull(p.level2_category) || parsed.level2,
    product_category_id: strOrNull(p.product_category_id),
    material: strOrNull(p.material),
    dimension_l_mm: numOrNull(p.dimension_l_mm),
    dimension_w_mm: numOrNull(p.dimension_w_mm),
    dimension_h_mm: numOrNull(p.dimension_h_mm),
    color: strOrNull(p.color),
    remarks: strOrNull(p.remarks),
    delivery_term_name: strOrNull(p.delivery_term_name),
    shopify_product_id: strOrNull(row.shopify_product_id),
    sort_ts:
      strOrNull(row.imported_at) ||
      strOrNull(row.published_at) ||
      strOrNull(row.shopify_updated_at) ||
      '',
  };
}

function applySearchToQuery<T extends { or: Function; ilike: Function }>(
  query: T,
  search: string,
  titleCol = 'title',
  skuCol = 'sku',
): T {
  const q = search.trim();
  if (!q) return query;
  const pattern = `%${escapeIlike(q)}%`;
  return query.or(`${titleCol}.ilike.${pattern},${skuCol}.ilike.${pattern}`) as T;
}

const PRODUCTS_CATALOG_SELECT =
  'id, title, sku, image_url, sale_price, price, cost_price, factories_display_name, level1_category, level2_category, product_category_id, category, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, delivery_term_name, shopify_product_id, modified_date, created_at, in_stock, customize, tags';

const SHOPIFY_CATALOG_SELECT =
  'id, shopify_product_id, source_product_id, title, sku, image_url, price, cost, vendor, product_type, variants, imported_at, published_at, shopify_updated_at, in_stock, customize, "my_fields.production_time"';

const RTS_CATALOG_SELECT =
  'id, product_id, shopify_product_id, title, sku, image_url, price, vendor, product_type, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, imported_at, cost, in_stock, customize, tags';

function applyProductsCatalogFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  params: CatalogQueryParams,
  opts?: { priorityOnly?: boolean; excludePriority?: string[] },
) {
  const search = params.search || '';
  const factory = params.factory_name || '';
  const level1 = params.level1 || '';
  const level2 = params.level2 || '';
  let q = applySearchToQuery(query, search);
  if (factory.trim()) q = q.eq('factories_display_name', factory.trim());
  if (level1.trim()) q = q.eq('level1_category', level1.trim());
  if (level2.trim()) q = q.eq('level2_category', level2.trim());
  if (opts?.priorityOnly && params.priority_level1?.length) {
    q = q.in('level1_category', params.priority_level1);
  }
  if (opts?.excludePriority?.length) {
    const quoted = opts.excludePriority.map((p) => `"${p.replace(/"/g, '""')}"`).join(',');
    q = q.or(`level1_category.is.null,level1_category.not.in.(${quoted})`);
  }
  if (params.stock_only) {
    // products.in_stock = true OR products.customize = 3-7天
    q = q.or(`in_stock.eq.true,customize.eq."${READY_STOCK_LEAD_TIME}"`);
  }
  return q;
}

async function enrichProductRows(
  productRows: Record<string, unknown>[],
  opts?: { stockOnly?: boolean },
): Promise<CatalogProductRow[]> {
  const productIds = productRows.map((row) => String(row.id));

  const [spRes, rtsRes] = await Promise.all([
    productIds.length
      ? supabase
          .from('shopify_products')
          .select(SHOPIFY_CATALOG_SELECT)
          .in('source_product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase
          .from('ready_to_shopify')
          .select(RTS_CATALOG_SELECT)
          .in('product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (spRes.error) throw spRes.error;
  if (rtsRes.error) throw rtsRes.error;

  const spByProductId = new Map<string, Record<string, unknown>>();
  for (const row of spRes.data || []) {
    const pid = strOrNull((row as { source_product_id?: string }).source_product_id);
    if (pid) spByProductId.set(pid, row as Record<string, unknown>);
  }
  const rtsByProductId = new Map<string, Record<string, unknown>>();
  for (const row of rtsRes.data || []) {
    const pid = strOrNull((row as { product_id?: string }).product_id);
    if (pid && !spByProductId.has(pid)) rtsByProductId.set(pid, row as Record<string, unknown>);
  }

  const rows: CatalogProductRow[] = [];
  for (const product of productRows) {
    const pid = String(product.id);
    const sp = spByProductId.get(pid);
    const rts = rtsByProductId.get(pid);
    if (opts?.stockOnly && !passesSystemCatalogReadyStock(product, sp, rts)) continue;

    if (sp) rows.push(mapShopifyProductsRow(sp, product));
    else if (rts) rows.push(mapRtsRow(rts, product));
    else rows.push(mapProductsRow(product));
  }
  return rows;
}

async function fetchSystemSourceRows(params: CatalogQueryParams): Promise<{
  rows: CatalogProductRow[];
  total: number;
}> {
  const priority = (params.priority_level1 || []).filter(Boolean);
  if (priority.length > 0 && !(params.level1 || '').trim()) {
    return fetchSystemSourceRowsWithPriority(params, priority);
  }

  const page = params.page || 1;
  const pageSize = params.page_size || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = applyProductsCatalogFilters(
    supabase
      .from('products')
      .select(PRODUCTS_CATALOG_SELECT, { count: 'exact' })
      .not('title', 'is', null)
      .neq('title', ''),
    params,
  );

  query = query
    .order('modified_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = await enrichProductRows((data || []) as Record<string, unknown>[], {
    stockOnly: params.stock_only,
  });
  return { rows, total: count || 0 };
}

async function fetchSystemSourceRowsWithPriority(
  params: CatalogQueryParams,
  priority: string[],
): Promise<{ rows: CatalogProductRow[]; total: number }> {
  const page = params.page || 1;
  const pageSize = params.page_size || 20;
  const offset = (page - 1) * pageSize;

  const base = () =>
    applyProductsCatalogFilters(
      supabase
        .from('products')
        .select(PRODUCTS_CATALOG_SELECT)
        .not('title', 'is', null)
        .neq('title', ''),
      params,
    )
      .order('modified_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

  const [{ count: priorityCount }, { count: totalCount }] = await Promise.all([
    applyProductsCatalogFilters(
      supabase.from('products').select('id', { count: 'exact', head: true }).not('title', 'is', null).neq('title', ''),
      params,
      { priorityOnly: true },
    ),
    applyProductsCatalogFilters(
      supabase.from('products').select('id', { count: 'exact', head: true }).not('title', 'is', null).neq('title', ''),
      params,
    ),
  ]);

  const pTotal = priorityCount || 0;
  const tTotal = totalCount || 0;
  const productRows: Record<string, unknown>[] = [];

  if (offset < pTotal) {
    const priorityTo = Math.min(offset + pageSize - 1, pTotal - 1);
    const { data: priorityData, error: priorityErr } = await applyProductsCatalogFilters(
      base(),
      params,
      { priorityOnly: true },
    ).range(offset, priorityTo);
    if (priorityErr) throw priorityErr;
    productRows.push(...((priorityData || []) as Record<string, unknown>[]));

    const remaining = pageSize - productRows.length;
    if (remaining > 0 && pTotal < tTotal) {
      const { data: fillData, error: fillErr } = await applyProductsCatalogFilters(
        base(),
        params,
        { excludePriority: priority },
      ).range(0, remaining - 1);
      if (fillErr) throw fillErr;
      productRows.push(...((fillData || []) as Record<string, unknown>[]));
    }
  } else {
    const nonOffset = offset - pTotal;
    const nonTo = nonOffset + pageSize - 1;
    const { data: nonData, error: nonErr } = await applyProductsCatalogFilters(
      base(),
      params,
      { excludePriority: priority },
    ).range(nonOffset, nonTo);
    if (nonErr) throw nonErr;
    productRows.push(...((nonData || []) as Record<string, unknown>[]));
  }

  const rows = await enrichProductRows(productRows, { stockOnly: params.stock_only });
  return { rows, total: tTotal };
}

export async function fetchProductCatalog(
  params: CatalogQueryParams,
): Promise<CatalogQueryResult> {
  const page = params.page || 1;
  const page_size = params.page_size || 20;

  if (params.source === 'shopify') {
    return fetchShopifyCatalogPage(params, page, page_size);
  }

  const { rows, total } = await fetchSystemSourceRows({ ...params, page, page_size });
  return {
    products: rows,
    total,
    page,
    page_size,
    total_pages: Math.max(1, Math.ceil(total / page_size)),
  };
}

function asCatalogRow(raw: Record<string, unknown>): CatalogProductRow {
  const kind = raw.sourceKind === 'rts' ? 'rts' : 'shopify';
  return {
    id: String(raw.id || ''),
    sourceKind: kind,
    productId: strOrNull(raw.productId),
    title: String(raw.title || ''),
    sku: strOrNull(raw.sku),
    image_url: strOrNull(raw.image_url),
    sale_price: numOrNull(raw.sale_price),
    cost_price: numOrNull(raw.cost_price),
    factory_name: strOrNull(raw.factory_name),
    category: strOrNull(raw.category),
    level1_category: strOrNull(raw.level1_category),
    level2_category: strOrNull(raw.level2_category),
    product_category_id: strOrNull(raw.product_category_id),
    material: strOrNull(raw.material),
    dimension_l_mm: numOrNull(raw.dimension_l_mm),
    dimension_w_mm: numOrNull(raw.dimension_w_mm),
    dimension_h_mm: numOrNull(raw.dimension_h_mm),
    color: strOrNull(raw.color),
    remarks: strOrNull(raw.remarks),
    delivery_term_name: strOrNull(raw.delivery_term_name),
    shopify_product_id: strOrNull(raw.shopify_product_id),
    sort_ts: strOrNull(raw.sort_ts) || '',
  };
}

/** One round trip: join, filter, priority-sort, and return this page only. */
async function fetchShopifyCatalogPage(
  params: CatalogQueryParams,
  page: number,
  page_size: number,
): Promise<CatalogQueryResult> {
  const priority = (params.priority_level1 || []).map((level) => level.trim()).filter(Boolean);
  const level1 = (params.level1 || '').trim();
  const { data, error } = await supabase.rpc('get_quote_catalog_page', {
    p_search: (params.search || '').trim() || null,
    p_factory: (params.factory_name || '').trim() || null,
    p_level1: level1 || null,
    p_level2: (params.level2 || '').trim() || null,
    p_priority: !level1 && priority.length > 0 ? priority : null,
    p_stock_only: Boolean(params.stock_only),
    p_limit: page_size,
    p_offset: (page - 1) * page_size,
  });
  if (error) throw error;
  const payload = (data && typeof data === 'object' ? data : {}) as {
    total?: number;
    products?: Record<string, unknown>[];
  };
  const total = Number(payload.total) || 0;
  const products = (payload.products || []).map((row) => asCatalogRow(row));
  return {
    products,
    total,
    page,
    page_size,
    total_pages: Math.max(1, Math.ceil(total / page_size)),
  };
}

export async function fetchCatalogFactoryNames(
  source: CatalogSourceType,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('quote_catalog_factory_names', {
    p_source: source,
  });
  if (error) throw error;
  const names = Array.isArray(data) ? data.map((name) => String(name || '').trim()).filter(Boolean) : [];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
