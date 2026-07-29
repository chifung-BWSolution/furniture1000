/**
 * Analytics for 分析報表 — aggregate real usage from 傢俬報價 line items
 * (`bwf_quote_item`) and catalog product counts (`products`).
 *
 * Factory usage = each product line with a factory on the latest version of
 * each quote_id chain (matches 報價單一覽). Selecting a catalog product in
 * 快速報價 writes factory_name — that line counts once.
 */
import { supabase } from '@/lib/supabase';
import { normalizeFactoryDisplayName } from '@/lib/factoryNames';

const PAGE_SIZE = 1000;

export type QuoteProductUsageRow = {
  name: string;
  image: string | null;
  /** Number of quote line items. */
  usageCount: number;
  /** Distinct quotes that include this product. */
  quoteCount: number;
  /** Sum of line quantities. */
  quantitySum: number;
  factoryName: string | null;
};

export type QuoteFactoryUsageRow = {
  factoryName: string;
  usageCount: number;
  quoteCount: number;
  quantitySum: number;
  /** Distinct product labels used under this factory. */
  productCount: number;
};

export type FactoryCatalogCountRow = {
  factoryName: string;
  /**
   * A類：會／已上載 Shopify（`shopify_products` + `ready_to_shopify`）。
   */
  classACount: number;
  /** B類：產品目錄（`products`）。 */
  classBCount: number;
  /** A + B 合計（排名用）。 */
  productCount: number;
};

type QuoteItemScanRow = {
  name: string | null;
  factory_name: string | null;
  quantity: number | null;
  image: string | null;
  category: string | null;
  quote_uuid: string;
  is_section_title: boolean | null;
  is_custom_term: boolean | null;
};

type CatalogProductRef = {
  title: string;
  factoryName: string | null;
  image: string | null;
};

function normalizeProductName(name: string | null | undefined): string {
  return (name || '').trim().replace(/\s+/g, ' ');
}

function catalogKey(name: string): string {
  return normalizeProductName(name).toLowerCase();
}

/** Label for distinct product kinds when `name` is empty (common after 新建欄位). */
function productLabel(row: QuoteItemScanRow): string {
  return (
    normalizeProductName(row.name) ||
    normalizeProductName(row.category) ||
    '（未命名產品）'
  );
}

async function fetchAllQuoteItemRows(): Promise<QuoteItemScanRow[]> {
  const rows: QuoteItemScanRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bwf_quote_item')
      .select(
        'name, factory_name, quantity, image, category, quote_uuid, is_section_title, is_custom_term',
      )
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data || []) as QuoteItemScanRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/** Latest bwf_quote.id per quote_id chain (same grouping as 報價單一覽). */
async function fetchLatestQuoteUuidSet(): Promise<Set<string>> {
  const latestByQuoteId = new Map<string, { id: string; createdAt: number }>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('id, quote_id, created_at')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data || []) as Array<{
      id: string;
      quote_id: string | null;
      created_at: string | null;
    }>;
    for (const row of chunk) {
      const quoteId = String(row.quote_id || '').trim();
      const id = String(row.id || '').trim();
      if (!quoteId || !id) continue;
      if (latestByQuoteId.has(quoteId)) continue;
      latestByQuoteId.set(quoteId, {
        id,
        createdAt: row.created_at ? Date.parse(row.created_at) : 0,
      });
    }
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return new Set([...latestByQuoteId.values()].map((row) => row.id));
}

/** Load products.title → catalog metadata for matching quote line names. */
async function fetchCatalogProductIndex(): Promise<Map<string, CatalogProductRef>> {
  const index = new Map<string, CatalogProductRef>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('title, factories_display_name, image_url')
      .not('title', 'is', null)
      .neq('title', '')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data || []) as Array<{
      title?: string | null;
      factories_display_name?: string | null;
      image_url?: string | null;
    }>;
    for (const row of chunk) {
      const title = normalizeProductName(row.title);
      if (!title) continue;
      const key = catalogKey(title);
      if (index.has(key)) continue;
      index.set(key, {
        title,
        factoryName: normalizeFactoryDisplayName(row.factories_display_name) || null,
        image: row.image_url?.trim() || null,
      });
    }
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return index;
}

function isProductLine(row: QuoteItemScanRow): boolean {
  if (row.is_section_title) return false;
  if (row.is_custom_term) return false;
  return true;
}

function lineQuantity(row: QuoteItemScanRow): number {
  return typeof row.quantity === 'number' && Number.isFinite(row.quantity)
    ? row.quantity
    : 1;
}

/**
 * Popular products & factories from 傢俬報價 line items.
 * - Only the latest version of each quote_id is counted.
 * - Factory usage: every product line with factory_name (+1 per line).
 * - Product usage: lines whose name matches an existing products.title
 *   (empty-name 新建欄位 rows are excluded from product ranking).
 */
export async function fetchQuoteUsageRankings(): Promise<{
  products: QuoteProductUsageRow[];
  factories: QuoteFactoryUsageRow[];
}> {
  const [quoteRows, catalog, latestQuoteUuids] = await Promise.all([
    fetchAllQuoteItemRows(),
    fetchCatalogProductIndex(),
    fetchLatestQuoteUuidSet(),
  ]);

  const rows = quoteRows.filter(
    (row) =>
      isProductLine(row) && latestQuoteUuids.has(String(row.quote_uuid || '')),
  );

  type ProductAgg = {
    name: string;
    image: string | null;
    usageCount: number;
    quantitySum: number;
    quoteIds: Set<string>;
    factoryName: string | null;
  };
  type FactoryAgg = {
    factoryName: string;
    usageCount: number;
    quantitySum: number;
    quoteIds: Set<string>;
    productNames: Set<string>;
  };

  const products = new Map<string, ProductAgg>();
  const factories = new Map<string, FactoryAgg>();

  for (const row of rows) {
    const factoryName = normalizeFactoryDisplayName(row.factory_name) || null;
    const qty = lineQuantity(row);
    const quoteId = String(row.quote_uuid || '');
    const label = productLabel(row);

    // Factory ranking — driven by factory_name on the quote line.
    if (factoryName) {
      let f = factories.get(factoryName);
      if (!f) {
        f = {
          factoryName,
          usageCount: 0,
          quantitySum: 0,
          quoteIds: new Set(),
          productNames: new Set(),
        };
        factories.set(factoryName, f);
      }
      f.usageCount += 1;
      f.quantitySum += qty;
      if (quoteId) f.quoteIds.add(quoteId);
      f.productNames.add(label);
    }

    // Product ranking — catalog title match only (needs a real product name).
    const name = normalizeProductName(row.name);
    if (!name) continue;
    const catalogHit = catalog.get(catalogKey(name));
    if (!catalogHit) continue;

    const displayName = catalogHit.title;
    const pKey = catalogKey(displayName);
    const productFactory =
      factoryName || catalogHit.factoryName || null;

    let p = products.get(pKey);
    if (!p) {
      p = {
        name: displayName,
        image: catalogHit.image || row.image?.trim() || null,
        usageCount: 0,
        quantitySum: 0,
        quoteIds: new Set(),
        factoryName: productFactory,
      };
      products.set(pKey, p);
    }
    p.usageCount += 1;
    p.quantitySum += qty;
    if (quoteId) p.quoteIds.add(quoteId);
    if (!p.image) {
      p.image = catalogHit.image || row.image?.trim() || null;
    }
    if (!p.factoryName && productFactory) p.factoryName = productFactory;
  }

  const productRows = [...products.values()]
    .map((p) => ({
      name: p.name,
      image: p.image,
      usageCount: p.usageCount,
      quoteCount: p.quoteIds.size,
      quantitySum: p.quantitySum,
      factoryName: p.factoryName,
    }))
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount ||
        b.quoteCount - a.quoteCount ||
        a.name.localeCompare(b.name, 'zh-Hant'),
    );

  const factoryRows = [...factories.values()]
    .map((f) => ({
      factoryName: f.factoryName,
      usageCount: f.usageCount,
      quoteCount: f.quoteIds.size,
      quantitySum: f.quantitySum,
      productCount: f.productNames.size,
    }))
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount ||
        b.quoteCount - a.quoteCount ||
        a.factoryName.localeCompare(b.factoryName, 'zh-Hant'),
    );

  return { products: productRows, factories: factoryRows };
}

async function countFactoriesFromColumn(
  table: 'products' | 'shopify_products' | 'ready_to_shopify',
  column: 'factories_display_name' | 'vendor',
  opts?: { requireTitle?: boolean },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let from = 0;
  for (;;) {
    let query = supabase.from(table).select(column);
    if (opts?.requireTitle) {
      query = query.not('title', 'is', null).neq('title', '');
    }
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data || []) as Array<Record<string, string | null | undefined>>;
    for (const row of chunk) {
      const name = normalizeFactoryDisplayName(row[column]);
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return counts;
}

/**
 * Factory product counts:
 * - B類 = 產品目錄 `products`
 * - A類 = 已上載／準備上載 Shopify（`shopify_products` + `ready_to_shopify`）
 * - 產品數量 = A + B
 */
export async function fetchFactoryCatalogCounts(): Promise<FactoryCatalogCountRow[]> {
  const [classB, shopifyA, readyA] = await Promise.all([
    countFactoriesFromColumn('products', 'factories_display_name', {
      requireTitle: true,
    }),
    countFactoriesFromColumn('shopify_products', 'vendor'),
    countFactoriesFromColumn('ready_to_shopify', 'vendor'),
  ]);

  const classA = new Map<string, number>();
  for (const source of [shopifyA, readyA]) {
    for (const [factoryName, n] of source) {
      classA.set(factoryName, (classA.get(factoryName) || 0) + n);
    }
  }

  const factoryNames = new Set<string>([
    ...classA.keys(),
    ...classB.keys(),
  ]);

  return [...factoryNames]
    .map((factoryName) => {
      const a = classA.get(factoryName) || 0;
      const b = classB.get(factoryName) || 0;
      return {
        factoryName,
        classACount: a,
        classBCount: b,
        productCount: a + b,
      };
    })
    .sort(
      (a, b) =>
        b.productCount - a.productCount ||
        b.classBCount - a.classBCount ||
        a.factoryName.localeCompare(b.factoryName, 'zh-Hant'),
    );
}
