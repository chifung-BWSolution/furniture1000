import { supabase } from '@/lib/supabase';

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

const MAX_SCAN_PER_TABLE = 800;

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

function catalogDedupeKey(row: {
  productId?: string | null;
  sku?: string | null;
  shopifyProductId?: string | null;
  id: string;
  sourceKind: 'rts' | 'shopify' | 'products';
}): string {
  if (row.productId) return `pid:${row.productId}`;
  if (row.shopifyProductId) return `shopify:${row.shopifyProductId}`;
  if (row.sku?.trim()) return `sku:${row.sku.trim().toLowerCase()}`;
  return `${row.sourceKind}:${row.id}`;
}

function matchesSearch(row: CatalogProductRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    row.title.toLowerCase().includes(q) ||
    (row.sku || '').toLowerCase().includes(q)
  );
}

function matchesFactory(row: CatalogProductRow, factory: string): boolean {
  const f = factory.trim();
  if (!f) return true;
  return (row.factory_name || '').trim() === f;
}

function matchesLevel(
  row: CatalogProductRow,
  level1: string,
  level2: string,
): boolean {
  if (level2.trim()) {
    return (row.level2_category || row.category || '').trim() === level2.trim();
  }
  if (level1.trim()) {
    return (row.level1_category || '').trim() === level1.trim();
  }
  return true;
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

function applyClientFilters(
  rows: CatalogProductRow[],
  params: CatalogQueryParams,
): CatalogProductRow[] {
  const search = params.search || '';
  const factory = params.factory_name || '';
  const level1 = params.level1 || '';
  const level2 = params.level2 || '';
  return rows.filter(
    (row) =>
      matchesSearch(row, search) &&
      matchesFactory(row, factory) &&
      matchesLevel(row, level1, level2) &&
      Boolean(row.title?.trim()),
  );
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const total_pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), total_pages);
  const from = (safePage - 1) * pageSize;
  return {
    items: rows.slice(from, from + pageSize),
    total,
    page: safePage,
    page_size: pageSize,
    total_pages,
  };
}

async function loadProductsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const unique = [...new Set(ids)];
  const chunkSize = 200;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('products')
      .select(
        'id, title, sku, image_url, images, sale_price, price, cost_price, factories_display_name, level1_category, level2_category, category, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, delivery_term_name, shopify_product_id, modified_date, created_at',
      )
      .in('id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      map.set(String((row as { id: string }).id), row as Record<string, unknown>);
    }
  }
  return map;
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

async function fetchShopifySourceRows(params: CatalogQueryParams): Promise<CatalogProductRow[]> {
  const search = params.search || '';
  const factory = params.factory_name || '';

  let spQuery = supabase
    .from('shopify_products')
    .select(
      'id, shopify_product_id, source_product_id, title, sku, image_url, images, price, cost, vendor, product_type, variants, imported_at, published_at, shopify_updated_at',
    )
    .is('configurable', null)
    .order('imported_at', { ascending: false })
    .limit(MAX_SCAN_PER_TABLE);
  spQuery = applySearchToQuery(spQuery, search);
  if (factory.trim()) spQuery = spQuery.eq('vendor', factory.trim());

  let rtsQuery = supabase
    .from('ready_to_shopify')
    .select(
      'id, product_id, shopify_product_id, title, sku, image_url, images, price, vendor, product_type, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, imported_at, cost',
    )
    .order('imported_at', { ascending: false })
    .limit(MAX_SCAN_PER_TABLE);
  rtsQuery = applySearchToQuery(rtsQuery, search);
  if (factory.trim()) rtsQuery = rtsQuery.eq('vendor', factory.trim());

  const [{ data: spData, error: spErr }, { data: rtsData, error: rtsErr }] =
    await Promise.all([spQuery, rtsQuery]);
  if (spErr) throw spErr;
  if (rtsErr) throw rtsErr;

  const productIds = [
    ...new Set(
      [...(spData || []), ...(rtsData || [])]
        .map((row) => strOrNull((row as { source_product_id?: string; product_id?: string }).source_product_id)
          || strOrNull((row as { product_id?: string }).product_id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const productsById = await loadProductsByIds(productIds);

  const merged = new Map<string, CatalogProductRow>();
  for (const row of spData || []) {
    const rec = row as Record<string, unknown>;
    const pid = strOrNull(rec.source_product_id);
    const mapped = mapShopifyProductsRow(rec, pid ? productsById.get(pid) : null);
    merged.set(catalogDedupeKey(mapped), mapped);
  }
  for (const row of rtsData || []) {
    const rec = row as Record<string, unknown>;
    const pid = strOrNull(rec.product_id);
    const mapped = mapRtsRow(rec, pid ? productsById.get(pid) : null);
    const key = catalogDedupeKey(mapped);
    if (!merged.has(key)) merged.set(key, mapped);
  }

  return applyClientFilters([...merged.values()], params);
}

async function fetchSystemSourceRows(params: CatalogQueryParams): Promise<{
  rows: CatalogProductRow[];
  total: number;
}> {
  const search = params.search || '';
  const factory = params.factory_name || '';
  const level1 = params.level1 || '';
  const level2 = params.level2 || '';
  const page = params.page || 1;
  const pageSize = params.page_size || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('products')
    .select(
      'id, title, sku, image_url, images, sale_price, price, cost_price, factories_display_name, level1_category, level2_category, category, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, delivery_term_name, shopify_product_id, modified_date, created_at',
      { count: 'exact' },
    )
    .not('title', 'is', null)
    .neq('title', '');

  query = applySearchToQuery(query, search);
  if (factory.trim()) query = query.eq('factories_display_name', factory.trim());
  if (level1.trim()) query = query.eq('level1_category', level1.trim());
  if (level2.trim()) query = query.eq('level2_category', level2.trim());

  query = query.order('modified_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const productRows = (data || []) as Record<string, unknown>[];
  const productIds = productRows.map((row) => String(row.id));

  const [spRes, rtsRes] = await Promise.all([
    productIds.length
      ? supabase
          .from('shopify_products')
          .select(
            'id, shopify_product_id, source_product_id, title, sku, image_url, images, price, cost, vendor, product_type, variants, imported_at, published_at, shopify_updated_at',
          )
          .in('source_product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase
          .from('ready_to_shopify')
          .select(
            'id, product_id, shopify_product_id, title, sku, image_url, images, price, vendor, product_type, material, dimension_l_mm, dimension_w_mm, dimension_h_mm, color, remarks, imported_at, cost',
          )
          .in('product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (spRes.error) throw spRes.error;
  if (rtsRes.error) throw rtsRes.error;

  const productsById = new Map(productRows.map((row) => [String(row.id), row]));
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

  const rows = productRows.map((product) => {
    const pid = String(product.id);
    const sp = spByProductId.get(pid);
    if (sp) return mapShopifyProductsRow(sp, product);
    const rts = rtsByProductId.get(pid);
    if (rts) return mapRtsRow(rts, product);
    return mapProductsRow(product);
  });

  return { rows, total: count || 0 };
}

export async function fetchProductCatalog(
  params: CatalogQueryParams,
): Promise<CatalogQueryResult> {
  const page = params.page || 1;
  const page_size = params.page_size || 20;

  if (params.source === 'shopify') {
    const filtered = await fetchShopifySourceRows(params);
    const paged = paginate(filtered, page, page_size);
    return {
      products: paged.items,
      total: paged.total,
      page: paged.page,
      page_size: paged.page_size,
      total_pages: paged.total_pages,
    };
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

export async function fetchCatalogFactoryNames(
  source: CatalogSourceType,
): Promise<string[]> {
  if (source === 'shopify') {
    const [sp, rts] = await Promise.all([
      supabase.from('shopify_products').select('vendor').not('vendor', 'is', null),
      supabase.from('ready_to_shopify').select('vendor').not('vendor', 'is', null),
    ]);
    const names = new Set<string>();
    for (const row of [...(sp.data || []), ...(rts.data || [])]) {
      const v = strOrNull((row as { vendor?: string }).vendor);
      if (v) names.add(v);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  const { data } = await supabase
    .from('products')
    .select('factories_display_name')
    .not('factories_display_name', 'is', null)
    .neq('factories_display_name', '');
  const names = new Set<string>();
  for (const row of data || []) {
    const v = strOrNull((row as { factories_display_name?: string }).factories_display_name);
    if (v) names.add(v);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
