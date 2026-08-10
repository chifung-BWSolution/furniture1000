/**
 * Quote line items live in `bwf_quote_item` (not project_data.items).
 * Shared API for load / replace / image resolve.
 */
import { supabase } from '@/lib/supabase';
import {
  resolveQuoteItemImages,
  type QuoteItemImageFields,
} from '@/lib/quoteImageStorage';

/** Frontend quotation line shape (camelCase). */
export type BwfQuoteItemInput = QuoteItemImageFields & {
  id?: string;
  name?: string;
  /** Client-only display enrichment from the main published product. */
  sku?: string;
  /** Staff remarks from design-project zone_products.notes (portal display). */
  notes?: string;
  /** Linked zone_products.status when row comes from 設計專案. */
  zoneStatus?: 'pending' | 'discussing' | 'confirmed';
  unitPrice?: number;
  quantity?: number;
  unit?: string;
  costPrice?: number | null;
  exchangeRate?: number | null;
  hkdCostPrice?: number | null;
  category?: string;
  material?: string;
  color?: string;
  /** Freeform mm text (e.g. 1000+600). Legacy numeric values coerced to string. */
  dimensionLMm?: string | number | null;
  dimensionWMm?: string | number | null;
  dimensionHMm?: string | number | null;
  deliveryTermName?: string;
  factoryName?: string;
  factoryFromCatalog?: boolean;
  isCustomTerm?: boolean;
  /** Reference-only line — excluded from quote totals. */
  isOptional?: boolean;
  /**
   * When true, keep the line in the draft editor but omit it from
   * 報價單預覽 / Quotation Preview PDF (and PDF totals).
   */
  hideInPdf?: boolean;
  /** Section heading row (一、開放區) — not priced. */
  isSectionTitle?: boolean;
  /** Furniture-division heading within a zone (設計專案 傢俬劃分). */
  isDivisionTitle?: boolean;
  /** Transient UI field — never persisted. */
  exchangeRateInput?: string;
  /**
   * Transient catalog gallery URLs for portal product cards (main + extras).
   * Never persisted — hydrated from products table when linked to 設計專案.
   */
  galleryUrls?: string[];
};

export type BwfQuoteItemRow = {
  id: string;
  quote_uuid: string;
  sort_order: number;
  client_item_id: string | null;
  name: string;
  image: string;
  reference_image: string | null;
  remarks_image: string | null;
  unit_price: number;
  quantity: number;
  unit: string | null;
  cost_price: number | null;
  exchange_rate: number | null;
  hkd_cost_price: number | null;
  category: string | null;
  material: string | null;
  color: string | null;
  remarks: string | null;
  dimension_l_mm: string | number | null;
  dimension_w_mm: string | number | null;
  dimension_h_mm: string | number | null;
  delivery_term_name: string | null;
  factory_name: string | null;
  factory_from_catalog: boolean | null;
  is_custom_term: boolean | null;
  is_optional: boolean | null;
  hide_in_pdf?: boolean | null;
  is_section_title: boolean | null;
  /** Editor-only catalog SKU — not shown on customer PDF. */
  sku?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(v: unknown): number {
  const n = numOrNull(v);
  return n == null ? 0 : n;
}

/** Preserve freeform dimension text (1000+600); coerce legacy numbers to string. */
export function dimTextOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Map DB row → frontend item (preserves client_item_id as `id` when present). */
export function mapRowToItem(row: BwfQuoteItemRow): BwfQuoteItemInput {
  return {
    id: row.client_item_id || row.id,
    name: row.name || '',
    image: row.image || '',
    referenceImage: row.reference_image || undefined,
    remarksImage: row.remarks_image || undefined,
    remarks: row.remarks || undefined,
    unitPrice: numOrZero(row.unit_price),
    quantity: numOrZero(row.quantity) || 1,
    unit: row.unit || undefined,
    costPrice: numOrNull(row.cost_price),
    exchangeRate: numOrNull(row.exchange_rate),
    hkdCostPrice: numOrNull(row.hkd_cost_price),
    category: row.category || undefined,
    material: row.material || undefined,
    color: row.color || undefined,
    dimensionLMm: dimTextOrNull(row.dimension_l_mm),
    dimensionWMm: dimTextOrNull(row.dimension_w_mm),
    dimensionHMm: dimTextOrNull(row.dimension_h_mm),
    deliveryTermName: row.delivery_term_name || undefined,
    factoryName: row.factory_name || undefined,
    factoryFromCatalog: Boolean(row.factory_from_catalog),
    isCustomTerm: Boolean(row.is_custom_term),
    isOptional: Boolean(row.is_optional),
    hideInPdf: Boolean(row.hide_in_pdf),
    isSectionTitle: Boolean(row.is_section_title),
    sku: row.sku || undefined,
  };
}

/** Map frontend item → RPC JSON row (snake_case). */
export function mapItemToRow(
  item: BwfQuoteItemInput,
  sortOrder: number,
): Record<string, unknown> {
  const {
    exchangeRateInput: _exchangeRateInput,
    id,
    name,
    image,
    referenceImage,
    remarksImage,
    remarks,
    unitPrice,
    quantity,
    unit,
    costPrice,
    exchangeRate,
    hkdCostPrice,
    category,
    material,
    color,
    dimensionLMm,
    dimensionWMm,
    dimensionHMm,
    deliveryTermName,
    factoryName,
    factoryFromCatalog,
    isCustomTerm,
    isOptional,
    hideInPdf,
    isSectionTitle,
    sku,
  } = item;

  return {
    sort_order: sortOrder,
    client_item_id: id || null,
    name: name || '',
    image: image || '',
    reference_image: referenceImage || null,
    remarks_image: remarksImage || null,
    unit_price: numOrZero(unitPrice),
    quantity: numOrZero(quantity) || 1,
    unit: unit || null,
    cost_price: numOrNull(costPrice),
    exchange_rate: numOrNull(exchangeRate),
    hkd_cost_price: numOrNull(hkdCostPrice),
    category: category || null,
    material: material || null,
    color: color || null,
    remarks: remarks ?? null,
    dimension_l_mm: dimTextOrNull(dimensionLMm),
    dimension_w_mm: dimTextOrNull(dimensionWMm),
    dimension_h_mm: dimTextOrNull(dimensionHMm),
    delivery_term_name: deliveryTermName || null,
    factory_name: factoryName || null,
    factory_from_catalog: Boolean(factoryFromCatalog),
    is_custom_term: Boolean(isCustomTerm),
    is_optional: Boolean(isOptional),
    hide_in_pdf: Boolean(hideInPdf),
    is_section_title: Boolean(isSectionTitle),
    sku: sku?.trim() || null,
  };
}

/** Load items for a quote UUID, ordered by sort_order. */
export async function loadQuoteItems(
  quoteUuid: string,
): Promise<BwfQuoteItemInput[]> {
  const { data, error } = await supabase
    .from('bwf_quote_item')
    .select('*')
    .eq('quote_uuid', quoteUuid)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return ((data || []) as BwfQuoteItemRow[]).map(mapRowToItem);
}

/** Client Portal safe projection — never transfers cost/exchange/factory fields. */
export async function loadClientQuoteItems(
  quoteUuid: string,
): Promise<BwfQuoteItemInput[]> {
  const { data, error } = await supabase
    .from('bwf_quote_item')
    .select(
      'id,client_item_id,name,image,reference_image,remarks_image,remarks,unit_price,quantity,unit,category,material,color,dimension_l_mm,dimension_w_mm,dimension_h_mm,delivery_term_name,is_custom_term,is_optional,hide_in_pdf,is_section_title,sort_order,quote_uuid',
    )
    .eq('quote_uuid', quoteUuid)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data || []) as unknown as BwfQuoteItemRow[]).map(mapRowToItem);
}

/**
 * Replace all items for a quote (delete + insert via RPC).
 * Call after resolving images to Storage URLs.
 */
export async function replaceQuoteItems(
  quoteUuid: string,
  items: BwfQuoteItemInput[],
): Promise<void> {
  const payload = items.map((item, index) => mapItemToRow(item, index));
  const { error } = await supabase.rpc('save_bwf_quote_items', {
    p_quote_uuid: quoteUuid,
    p_items: payload,
  });
  if (error) throw error;
}

/** Upload any base64 image fields on items to Storage before DB write. */
export async function resolveItemImagesToStorage<T extends BwfQuoteItemInput>(
  items: T[],
  quoteScope: string,
): Promise<T[]> {
  return Promise.all(
    items.map(async (item, index) => {
      const itemKey = item.id || String(index);
      return resolveQuoteItemImages(item, quoteScope, itemKey);
    }),
  );
}

/**
 * Build frontend items from legacy project_data.items JSON (pre-migration rows
 * or drafts). Prefer loadQuoteItems when DB rows exist.
 */
export function itemsFromLegacyProjectData(
  projectData: Record<string, unknown> | null | undefined,
): BwfQuoteItemInput[] {
  const raw = projectData?.items;
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      return { id: String(index), name: '', image: '', unitPrice: 0, quantity: 1 };
    }
    const row = item as BwfQuoteItemInput;
    return {
      ...row,
      id: row.id || String(index),
      name: row.name || '',
      image: row.image || '',
      unitPrice: numOrZero(row.unitPrice),
      quantity: numOrZero(row.quantity) || 1,
    };
  });
}

/**
 * Sanitize `bwf_quote.project_data` before write.
 * - Line items live in `bwf_quote_item` (never embed `items`).
 * - Quote total lives in `bwf_quote.total_amount` (never embed `grandTotal`).
 */
export function stripItemsFromProjectData(
  projectData: Record<string, unknown>,
): Record<string, unknown> {
  const { items: _items, grandTotal: _grandTotal, ...rest } = projectData;
  void _items;
  void _grandTotal;
  // Defensive: also drop if somehow reassigned
  if ('items' in rest) {
    delete (rest as { items?: unknown }).items;
  }
  if ('grandTotal' in rest) {
    delete (rest as { grandTotal?: unknown }).grandTotal;
  }
  return rest;
}

/**
 * Resolve 報價單號 / chain code.
 * Prefer `quoteId` (`bwf_quote.quote_id` / wizard formData.quoteId).
 * Legacy pitchingCode / form JSON are read-only fallbacks.
 */
export function resolvePitchingCode(opts: {
  quoteId?: string | null;
  /** @deprecated Use quoteId */
  pitchingCode?: string | null;
  formData?: Record<string, unknown> | null;
  quoteMeta?: Record<string, unknown> | null;
}): string {
  const fromForm =
    (typeof opts.formData?.quoteId === 'string' && opts.formData.quoteId) ||
    (typeof opts.formData?.pitchingCode === 'string' && opts.formData.pitchingCode) ||
    (typeof opts.formData?.projectName === 'string' && opts.formData.projectName) ||
    '';
  const fromMeta =
    (typeof opts.quoteMeta?.quoteNumber === 'string' && opts.quoteMeta.quoteNumber) ||
    (typeof opts.quoteMeta?.projectName === 'string' && opts.quoteMeta.projectName) ||
    '';
  return (
    opts.quoteId ||
    opts.pitchingCode ||
    fromForm ||
    fromMeta ||
    ''
  ).trim();
}
