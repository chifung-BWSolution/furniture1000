import { mapConcurrent } from '@/lib/mapConcurrent';
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
import { QUOTE_TRASH_STATUS } from '@/lib/quoteTrash';

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
  /** B類：圖冊（`products`）。 */
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
  id: string;
  title: string;
  factoryName: string | null;
  image: string | null;
  category: string | null;
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

async function fetchAllQuoteItemRows(latestQuoteUuids: Set<string>): Promise<QuoteItemScanRow[]> {
  const ids = [...latestQuoteUuids];
  const chunks = Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, (i + 1) * 150));
  const pages = await mapConcurrent(chunks, async (quoteIds) => {
    const rows: QuoteItemScanRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase.from('bwf_quote_item')
        .select('name,factory_name,quantity,image,category,quote_uuid,is_section_title,is_custom_term')
        .in('quote_uuid', quoteIds)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const chunk = (data || []) as QuoteItemScanRow[];
      rows.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
    }
    return rows;
  });
  return pages.flat();
}

/**
 * Latest non-trash bwf_quote.id per quote_id chain (same grouping as 報價一覽).
 * Scans headers instead of latest_quote_version_ids, which still returns a
 * version after it has been moved to 回收桶.
 */
async function fetchLatestQuoteUuidSet(): Promise<Set<string>> {
  const latestByQuoteId = new Map<string, { id: string; createdAt: number }>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('id, quote_id, created_at')
      .neq('status', QUOTE_TRASH_STATUS)
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
async function loadCatalogProductIndex(): Promise<Map<string, CatalogProductRef>> {
  const index = new Map<string, CatalogProductRef>();
  for (let from = 0; ; from += PAGE_SIZE * 3) {
    const pages = await mapConcurrent([from, from + PAGE_SIZE, from + PAGE_SIZE * 2], async (offset) => {
      const { data, error } = await supabase
        .from('products')
        .select('id, title, factories_display_name, image_url, category')
        .not('title', 'is', null)
        .neq('title', '')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      return data || [];
    });
    const data = pages.flat();
    const chunk = (data || []) as Array<{
      id?: string | null;
      title?: string | null;
      factories_display_name?: string | null;
      image_url?: string | null;
      category?: string | null;
    }>;
    for (const row of chunk) {
      const title = normalizeProductName(row.title);
      if (!title) continue;
      const key = catalogKey(title);
      if (index.has(key)) continue;
      index.set(key, {
        id: String(row.id || ''),
        title,
        factoryName: normalizeFactoryDisplayName(row.factories_display_name) || null,
        image: row.image_url?.trim() || null,
        category: normalizeProductName(row.category) || null,
      });
    }
    if (pages.some((page) => page.length < PAGE_SIZE)) break;
  }
  return index;
}

/**
 * 圖冊索引掃描一次要跑完整張 `products`，但目錄內容不常變。
 * 5 分鐘內的多次載入（切換日期區間、兩個報告頁）共用同一份結果。
 */
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogCache: { at: number; promise: Promise<Map<string, CatalogProductRef>> } | null = null;

function fetchCatalogProductIndex(): Promise<Map<string, CatalogProductRef>> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_CACHE_TTL_MS) {
    return catalogCache.promise;
  }
  const promise = loadCatalogProductIndex();
  catalogCache = { at: Date.now(), promise };
  promise.catch(() => {
    catalogCache = null;
  });
  return promise;
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
  const [quoteRows, catalog] = await Promise.all([
    fetchLatestQuoteUuidSet().then(fetchAllQuoteItemRows),
    fetchCatalogProductIndex(),
  ]);

  const rows = quoteRows.filter(isProductLine);

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

  // Preferred: server-side GROUP BY (one round-trip).
  const { data: rpcRows, error: rpcErr } = await supabase.rpc('factory_counts', { p_source: table });
  if (!rpcErr && rpcRows) {
    for (const row of rpcRows as { factory_name: string | null; cnt: number }[]) {
      const name = normalizeFactoryDisplayName(row.factory_name);
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + (Number(row.cnt) || 0));
    }
    return counts;
  }
  console.warn('[quoteUsageReports] factory_counts RPC unavailable, falling back to scan:', rpcErr?.message);

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
 * - B類 = 圖冊 `products`
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

/* ── 產品報告：日期區間 + 同期對比 ─────────────────────────────── */

export type ProductReportRange = { from: Date; to: Date };

export type ProductReportRow = QuoteProductUsageRow & {
  /** 圖冊 `products.id`（查看詳情用）。 */
  productId: string | null;
  /** 圖冊分類，作為名稱下方的副標。 */
  category: string | null;
  /** 期間內用過此產品的報價單編號（新 → 舊）。 */
  quoteNumbers: string[];
  /** 期間內最後一次使用的報價建立時間（ISO）。 */
  lastUsedAt: string | null;
};

export type ProductReportTotals = {
  /** 有報價紀錄的產品數。 */
  productCount: number;
  /** 產品列總數（每次使用計 1）。 */
  usageCount: number;
  /** 含產品列的報價單數（去重）。 */
  quoteCount: number;
  /** 有產品被使用的廠家數。 */
  factoryCount: number;
};

export type ProductReportResult = {
  rows: ProductReportRow[];
  totals: ProductReportTotals;
  /** 上一個等長期間的數字，用於「較上期」比較。 */
  previousTotals: ProductReportTotals;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
};

type QuoteHeader = {
  id: string;
  quoteId: string;
  createdAt: Date | null;
};

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 最新版本報價單表頭，只往前掃到 `since` 為止。
 * 表頭以 created_at 由新到舊排序，同一 quote_id 鏈第一筆即最新版本；
 * 一旦整批都早於 `since`，更舊的版本不可能落進比較區間，可直接停。
 */
async function fetchQuoteHeadersSince(since: Date): Promise<QuoteHeader[]> {
  const latest = new Map<string, QuoteHeader>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('id, quote_id, created_at')
      .neq('status', QUOTE_TRASH_STATUS)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data || []) as Array<{
      id: string | null;
      quote_id: string | null;
      created_at: string | null;
    }>;
    let reachedOlder = false;
    for (const row of chunk) {
      const quoteId = String(row.quote_id || '').trim();
      const id = String(row.id || '').trim();
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      if (createdAt && createdAt.getTime() < since.getTime()) reachedOlder = true;
      if (!quoteId || !id) continue;
      if (latest.has(quoteId)) continue;
      latest.set(quoteId, { id, quoteId, createdAt });
    }
    if (chunk.length < PAGE_SIZE || reachedOlder) break;
    from += PAGE_SIZE;
  }
  return [...latest.values()];
}

function aggregateProductReportRows(
  items: QuoteItemScanRow[],
  catalog: Map<string, CatalogProductRef>,
  headersByUuid: Map<string, QuoteHeader>,
): { rows: ProductReportRow[]; totals: ProductReportTotals } {
  type Agg = {
    name: string;
    productId: string | null;
    category: string | null;
    image: string | null;
    usageCount: number;
    quantitySum: number;
    factoryName: string | null;
    /** quote_id → 報價建立時間（毫秒）。 */
    quotes: Map<string, number>;
  };

  const agg = new Map<string, Agg>();
  const quoteUuids = new Set<string>();

  for (const row of items) {
    if (!isProductLine(row)) continue;
    const name = normalizeProductName(row.name);
    if (!name) continue;
    const catalogHit = catalog.get(catalogKey(name));
    if (!catalogHit) continue;

    const pKey = catalogKey(catalogHit.title);
    let entry = agg.get(pKey);
    if (!entry) {
      entry = {
        name: catalogHit.title,
        productId: catalogHit.id || null,
        category: catalogHit.category,
        image: catalogHit.image || row.image?.trim() || null,
        usageCount: 0,
        quantitySum: 0,
        factoryName: null,
        quotes: new Map(),
      };
      agg.set(pKey, entry);
    }
    entry.usageCount += 1;
    entry.quantitySum += lineQuantity(row);

    const factoryName = normalizeFactoryDisplayName(row.factory_name) || catalogHit.factoryName;
    if (!entry.factoryName && factoryName) entry.factoryName = factoryName;

    const quoteUuid = String(row.quote_uuid || '');
    if (quoteUuid) {
      quoteUuids.add(quoteUuid);
      const header = headersByUuid.get(quoteUuid);
      if (header && !entry.quotes.has(header.quoteId)) {
        entry.quotes.set(header.quoteId, header.createdAt ? header.createdAt.getTime() : 0);
      }
    }
  }

  const rows: ProductReportRow[] = [...agg.values()]
    .map((entry) => {
      const quotes = [...entry.quotes.entries()].sort((a, b) => b[1] - a[1]);
      return {
        name: entry.name,
        image: entry.image,
        usageCount: entry.usageCount,
        quoteCount: quotes.length,
        quantitySum: entry.quantitySum,
        factoryName: entry.factoryName,
        productId: entry.productId,
        category: entry.category,
        quoteNumbers: quotes.map(([number]) => number),
        lastUsedAt: quotes[0]?.[1] ? new Date(quotes[0][1]).toISOString() : null,
      };
    })
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount ||
        b.quoteCount - a.quoteCount ||
        a.name.localeCompare(b.name, 'zh-Hant'),
    );

  const factoryNames = new Set(
    rows.map((row) => row.factoryName).filter((name): name is string => Boolean(name)),
  );

  return {
    rows,
    totals: {
      productCount: rows.length,
      usageCount: rows.reduce((sum, row) => sum + row.usageCount, 0),
      quoteCount: quoteUuids.size,
      factoryCount: factoryNames.size,
    },
  };
}

/**
 * 產品報告：某段期間內（依報價單建立日期）最受歡迎的產品，
 * 並回傳上一個等長期間的匯總數字作「較上期」比較。
 */
export async function fetchProductReport(
  range: ProductReportRange,
): Promise<ProductReportResult> {
  const start = new Date(range.from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(range.to);
  end.setHours(23, 59, 59, 999);

  const spanMs = Math.max(end.getTime() - start.getTime(), 1);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(start.getTime() - spanMs);

  const [headers, catalog] = await Promise.all([
    fetchQuoteHeadersSince(previousStart),
    fetchCatalogProductIndex(),
  ]);

  const currentHeaders = headers.filter(
    (header) =>
      header.createdAt &&
      header.createdAt.getTime() >= start.getTime() &&
      header.createdAt.getTime() <= end.getTime(),
  );
  const previousHeaders = headers.filter(
    (header) =>
      header.createdAt &&
      header.createdAt.getTime() >= previousStart.getTime() &&
      header.createdAt.getTime() <= previousEnd.getTime(),
  );

  const headersByUuid = new Map<string, QuoteHeader>();
  for (const header of [...headers, ...currentHeaders, ...previousHeaders]) {
    headersByUuid.set(header.id, header);
  }
  const currentUuids = new Set(currentHeaders.map((header) => header.id));
  const previousUuids = new Set(previousHeaders.map((header) => header.id));

  const scanUuids = new Set([...currentUuids, ...previousUuids]);
  const items = scanUuids.size ? await fetchAllQuoteItemRows(scanUuids) : [];

  const currentItems = items.filter((row) => currentUuids.has(String(row.quote_uuid || '')));
  const previousItems = items.filter((row) => previousUuids.has(String(row.quote_uuid || '')));

  const current = aggregateProductReportRows(currentItems, catalog, headersByUuid);
  const previous = aggregateProductReportRows(previousItems, catalog, headersByUuid);

  return {
    rows: current.rows,
    totals: current.totals,
    previousTotals: previous.totals,
    range: { from: isoDate(start), to: isoDate(end) },
    previousRange: { from: isoDate(previousStart), to: isoDate(previousEnd) },
  };
}
