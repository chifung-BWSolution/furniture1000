/**
 * Analytics for 分析報表 — aggregate real usage from 傢俬報價 line items
 * (`bwf_quote_item`) and catalog product counts (`products`).
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
  /** Distinct product names used under this factory. */
  productCount: number;
};

export type FactoryCatalogCountRow = {
  factoryName: string;
  productCount: number;
};

type QuoteItemScanRow = {
  name: string | null;
  factory_name: string | null;
  quantity: number | null;
  image: string | null;
  quote_uuid: string;
  is_section_title: boolean | null;
  is_custom_term: boolean | null;
};

function normalizeProductName(name: string | null | undefined): string {
  return (name || '').trim().replace(/\s+/g, ' ');
}

async function fetchAllQuoteItemRows(): Promise<QuoteItemScanRow[]> {
  const rows: QuoteItemScanRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bwf_quote_item')
      .select(
        'name, factory_name, quantity, image, quote_uuid, is_section_title, is_custom_term',
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

function isCountableQuoteItem(row: QuoteItemScanRow): boolean {
  if (row.is_section_title) return false;
  if (!normalizeProductName(row.name)) return false;
  return true;
}

/** Popular products & factories from 傢俬報價 line items. */
export async function fetchQuoteUsageRankings(): Promise<{
  products: QuoteProductUsageRow[];
  factories: QuoteFactoryUsageRow[];
}> {
  const rows = (await fetchAllQuoteItemRows()).filter(isCountableQuoteItem);

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
    const name = normalizeProductName(row.name);
    const factoryName = normalizeFactoryDisplayName(row.factory_name) || null;
    const qty =
      typeof row.quantity === 'number' && Number.isFinite(row.quantity)
        ? row.quantity
        : 1;
    const quoteId = String(row.quote_uuid || '');

    const pKey = name.toLowerCase();
    let p = products.get(pKey);
    if (!p) {
      p = {
        name,
        image: row.image?.trim() || null,
        usageCount: 0,
        quantitySum: 0,
        quoteIds: new Set(),
        factoryName,
      };
      products.set(pKey, p);
    }
    p.usageCount += 1;
    p.quantitySum += qty;
    if (quoteId) p.quoteIds.add(quoteId);
    if (!p.image && row.image?.trim()) p.image = row.image.trim();
    if (!p.factoryName && factoryName) p.factoryName = factoryName;

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
      f.productNames.add(name);
    }
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

/** All factories ranked by current product catalog count (`products` table). */
export async function fetchFactoryCatalogCounts(): Promise<FactoryCatalogCountRow[]> {
  const counts = new Map<string, number>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('factories_display_name')
      .not('title', 'is', null)
      .neq('title', '')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data || []) as Array<{ factories_display_name?: string | null }>;
    for (const row of chunk) {
      const name = normalizeFactoryDisplayName(row.factories_display_name);
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return [...counts.entries()]
    .map(([factoryName, productCount]) => ({ factoryName, productCount }))
    .sort(
      (a, b) =>
        b.productCount - a.productCount ||
        a.factoryName.localeCompare(b.factoryName, 'zh-Hant'),
    );
}
