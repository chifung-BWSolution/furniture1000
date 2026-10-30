/**
 * Pull a presentation draft from an existing quotation.
 * Floor plan, zones and line items stay on the quote; this only reads them.
 */
import { supabase } from '@/lib/supabase';
import { isHttpImageUrl } from '@/lib/imageStorage';
import { loadQuoteItems, type BwfQuoteItemInput } from '@/lib/bwfQuoteItems';
import { loadPitchingsForQuoteRows, pitchingDisplayTitle } from '@/lib/pmsPitchings';
import {
  normalizeZoneRect,
  parseQuoteFloorPlan,
  parseQuoteZoneImages,
  UNZONED_QUOTE_IMAGE_KEY,
  type QuoteZoneRect,
} from '@/lib/quoteFloorPlan';
import type { SearchProduct } from '@/lib/productSearch';
import type { PresentationProductDraft, PresentationZoneDraft } from '@/lib/presentationOutlineModel';
import { fetchZoneProducts, fetchZones } from '@/lib/solutionsApi';
import { QUOTE_TRASH_STATUS } from '@/lib/quoteTrash';
import { compareQuoteVersion, displayQuoteVersion } from '@/lib/quoteVersions';
import type { ProjectZone, ZoneProduct } from '@/types/solutions';

const PICKER_COLUMNS = [
  'id',
  'quote_id',
  'version',
  'status',
  'total_amount',
  'created_at',
  'modified_date',
  'bwf_pitching_id',
  'bwf_project_id',
  'client_name:project_data->formData->>clientName',
  'contact_name:project_data->formData->>clientContactName',
  'client_info_name:project_data->clientInfo->>name',
  'design_project_id:project_data->>designProjectId',
  'floor_plan_url:project_data->floorPlan->>url',
  'floor_preview_url:project_data->floorPlan->>previewUrl',
].join(',');

const DETAIL_COLUMNS = [
  'id',
  'quote_id',
  'version',
  'total_amount',
  'bwf_pitching_id',
  'bwf_project_id',
  'floor_plan:project_data->floorPlan',
  'zone_images:project_data->zoneImages',
  'form_data:project_data->formData',
  'client_info:project_data->clientInfo',
  'design_project_id:project_data->>designProjectId',
].join(',');

const PRODUCT_COLUMNS = [
  'id',
  'title',
  'model',
  'sku',
  'image_url',
  'image_url_2',
  'image_url_3',
  'material',
  'color',
  'dimension_l_mm',
  'dimension_w_mm',
  'dimension_h_mm',
  'level1_category',
  'level2_category',
  'created_at',
  'sale_price',
  'factories_display_name',
].join(',');

const TITLE_MAX = 100;
const PURPOSE_MAX = 200;
const CONTENT_MAX = 1000;
const ZONE_CAP = 24;

export interface PresentationQuoteOption {
  id: string;
  quoteId: string;
  version: string;
  versionLabel: string;
  clientName: string;
  totalAmount: number;
  updatedAt: string;
  hasFloorPlan: boolean;
}

export interface PresentationQuoteImport {
  quoteId: string;
  versionLabel: string;
  client: string;
  project: string;
  /** design_projects.id when the quote is linked to a furniture scheme. */
  projectId?: string;
  pmsClientId?: string;
  pmsProjectId?: string;
  title: string;
  purpose: string;
  content: string;
  coverImageUrl: string;
  floorImageUrl: string;
  /** JPEG/PNG preview that can be cropped in the browser. PDF originals are not. */
  floorIsImage: boolean;
  zones: PresentationZoneDraft[];
  products: SearchProduct[];
  productZone: Record<string, string>;
  productDrafts: Record<string, PresentationProductDraft>;
  skippedProducts: number;
}

type PickerRow = {
  id: string;
  quote_id?: string | null;
  version?: string | null;
  total_amount?: number | string | null;
  created_at?: string | null;
  modified_date?: string | null;
  bwf_pitching_id?: string | null;
  client_name?: string | null;
  contact_name?: string | null;
  client_info_name?: string | null;
  floor_plan_url?: string | null;
  floor_preview_url?: string | null;
};

type CatalogRow = {
  id: string;
  title?: string | null;
  model?: string | null;
  sku?: string | null;
  image_url?: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  material?: string | null;
  color?: string | null;
  dimension_l_mm?: number | string | null;
  dimension_w_mm?: number | string | null;
  dimension_h_mm?: number | string | null;
  level1_category?: string | null;
  level2_category?: string | null;
  created_at?: string | null;
  sale_price?: number | string | null;
  factories_display_name?: string | null;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Quote forms sometimes store the placeholder N/A instead of leaving the name blank. */
function named(value: unknown): string {
  const valueText = text(value);
  if (!valueText || /^n\/?a$/i.test(valueText) || valueText === '-' || valueText === '—') return '';
  return valueText;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function money(value: unknown): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `HK$ ${amount.toLocaleString('en-HK', { maximumFractionDigits: 0 })}`;
}

function dimNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    if (parsed > 0) return parsed;
  }
  return undefined;
}

function dimLabel(l: unknown, w: unknown, h: unknown): string {
  const parts = [l, w, h].map((part) => text(part == null ? '' : String(part))).filter(Boolean);
  return parts.length ? `${parts.join(' × ')} mm` : '';
}

function httpUrl(value: unknown): string {
  const url = text(value);
  return isHttpImageUrl(url) ? url : '';
}

function isPdf(url: string, mime = ''): boolean {
  if (mime.toLowerCase().includes('pdf')) return true;
  return /\.pdf($|\?)/i.test(url);
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function optionFromRow(row: PickerRow): PresentationQuoteOption {
  const updatedAt = text(row.modified_date) || text(row.created_at);
  const floor = httpUrl(row.floor_preview_url) || httpUrl(row.floor_plan_url);
  return {
    id: row.id,
    quoteId: text(row.quote_id),
    version: text(row.version),
    versionLabel: displayQuoteVersion(row.version),
    clientName: named(row.client_name) || named(row.client_info_name) || named(row.contact_name),
    totalAmount: Number(row.total_amount) || 0,
    updatedAt,
    hasFloorPlan: Boolean(floor),
  };
}

function keepLatest(options: PresentationQuoteOption[]): PresentationQuoteOption[] {
  const best = new Map<string, PresentationQuoteOption>();
  for (const option of options) {
    const key = option.quoteId || option.id;
    const previous = best.get(key);
    if (!previous || compareQuoteVersion(option.version, previous.version) > 0) {
      best.set(key, option);
      continue;
    }
    if (compareQuoteVersion(option.version, previous.version) === 0 && option.updatedAt > previous.updatedAt) {
      best.set(key, option);
    }
  }
  return [...best.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function searchPresentationQuotes(query: string): Promise<PresentationQuoteOption[]> {
  const term = query.trim().replace(/[%_\\,]/g, '');
  if (!term) {
    const { data: ids, error } = await supabase
      .rpc('latest_quote_version_ids', { p_large_amount: false })
      .range(0, 29);
    if (error) throw error;
    const idList = (ids ?? []).map((row: { id: string }) => row.id).filter(Boolean);
    if (idList.length) {
      const { data, error: rowsError } = await supabase
        .from('bwf_quote')
        .select(PICKER_COLUMNS)
        .in('id', idList);
      if (rowsError) throw rowsError;
      const latest = keepLatest(((data ?? []) as unknown as PickerRow[]).map(optionFromRow));
      if (latest.length) return latest;
    }
    const recent = await supabase
      .from('bwf_quote')
      .select(PICKER_COLUMNS)
      .neq('status', QUOTE_TRASH_STATUS)
      .order('created_at', { ascending: false })
      .limit(80);
    if (recent.error) throw recent.error;
    return keepLatest(((recent.data ?? []) as unknown as PickerRow[]).map(optionFromRow)).slice(0, 30);
  }

  const pattern = `%${term}%`;
  const listed = () => supabase
    .from('bwf_quote')
    .select(PICKER_COLUMNS)
    .neq('status', QUOTE_TRASH_STATUS)
    .order('created_at', { ascending: false })
    .limit(40);
  const byCode = await listed().ilike('quote_id', pattern);
  if (byCode.error) throw byCode.error;
  const extras = await Promise.all([
    listed().filter('project_data->formData->>clientName', 'ilike', pattern),
    listed().filter('project_data->clientInfo->>name', 'ilike', pattern),
    listed().filter('project_data->formData->>clientContactName', 'ilike', pattern),
  ]);
  const rows = [...(byCode.data ?? [])] as unknown as PickerRow[];
  for (const result of extras) {
    if (!result.error && result.data) rows.push(...(result.data as unknown as PickerRow[]));
  }
  const unique = new Map<string, PickerRow>();
  for (const row of rows) unique.set(row.id, row);
  return keepLatest([...unique.values()].map(optionFromRow)).slice(0, 30);
}

type FurnitureLine = {
  key: string;
  sourceId: string;
  productId: string;
  name: string;
  image: string;
  extraImages: string[];
  sku: string;
  material: string;
  color: string;
  dimensionL: unknown;
  dimensionW: unknown;
  dimensionH: unknown;
  quantity: number;
  unit: string;
  unitPrice: number;
  remarks: string;
  optional: boolean;
  delivery: string;
  factory: string;
  zoneKey: string;
};

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lineFromQuoteItem(item: BwfQuoteItemInput, zoneKey: string): FurnitureLine | null {
  if (item.isSectionTitle || item.isDivisionTitle || item.isCustomTerm) return null;
  const productId = text(item.productId);
  const name = text(item.name) || text(item.sku) || text(item.category);
  if (!name && !productId && !httpUrl(item.image)) return null;
  return {
    key: '',
    sourceId: text(item.id) || crypto.randomUUID(),
    productId,
    name: name || '未命名產品',
    image: httpUrl(item.image),
    extraImages: [httpUrl(item.referenceImage), httpUrl(item.remarksImage)].filter(Boolean),
    sku: text(item.sku),
    material: plainText(text(item.material)),
    color: text(item.color),
    dimensionL: item.dimensionLMm,
    dimensionW: item.dimensionWMm,
    dimensionH: item.dimensionHMm,
    quantity: item.quantity && item.quantity > 0 ? item.quantity : 1,
    unit: text(item.unit),
    unitPrice: Number(item.unitPrice) || 0,
    remarks: plainText(text(item.remarks)),
    optional: Boolean(item.isOptional),
    delivery: text(item.deliveryTermName),
    factory: text(item.factoryName),
    zoneKey,
  };
}

function lineFromZoneProduct(row: ZoneProduct, zoneKey: string): FurnitureLine | null {
  const name = text(row.productTitle);
  const productId = text(row.productId);
  if (!name && !productId) return null;
  return {
    key: '',
    sourceId: row.id,
    productId,
    name,
    image: httpUrl(row.productImageUrl),
    extraImages: [],
    sku: '',
    material: '',
    color: '',
    dimensionL: row.dimensionLMm,
    dimensionW: row.dimensionWMm,
    dimensionH: row.dimensionHMm,
    quantity: row.quantity > 0 ? row.quantity : 1,
    unit: '',
    unitPrice: Number(row.salePrice) || 0,
    remarks: text(row.notes),
    optional: false,
    delivery: '',
    factory: '',
    zoneKey,
  };
}

function assignLineKeys(lines: FurnitureLine[]): FurnitureLine[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    counts.set(line.productId, (counts.get(line.productId) ?? 0) + 1);
  }
  return lines.map((line) => ({
    ...line,
    key: line.productId && counts.get(line.productId) === 1
      ? line.productId
      : `quote-line:${line.sourceId}`,
  }));
}

function zoneDraft(id: string, name: string, rects: QuoteZoneRect[], imageUrl: string): PresentationZoneDraft {
  return {
    id,
    name: name || '未命名分區',
    ...(rects.length ? { rect: rects[0], rects } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

async function loadCatalog(ids: string[]): Promise<Map<string, CatalogRow>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, CatalogRow>();
  for (let index = 0; index < unique.length; index += 80) {
    const chunk = unique.slice(index, index + 80);
    const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).in('id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as CatalogRow[]) map.set(row.id, row);
  }
  return map;
}

function toSearchProduct(line: FurnitureLine, catalog: CatalogRow | undefined): SearchProduct {
  const catalogImages = [catalog?.image_url, catalog?.image_url_2, catalog?.image_url_3].map(httpUrl).filter(Boolean);
  const images = [...new Set([line.image, ...line.extraImages, ...catalogImages].filter(Boolean))];
  return {
    id: line.key,
    title: line.name || text(catalog?.title) || '未命名產品',
    model: text(catalog?.model) || line.sku || text(catalog?.sku),
    sku: line.sku || text(catalog?.sku),
    image_url: images[0] || '',
    image_urls: images,
    factory_name: line.factory || text(catalog?.factories_display_name),
    dimension_l_mm: dimNumber(line.dimensionL) ?? dimNumber(catalog?.dimension_l_mm),
    dimension_w_mm: dimNumber(line.dimensionW) ?? dimNumber(catalog?.dimension_w_mm),
    dimension_h_mm: dimNumber(line.dimensionH) ?? dimNumber(catalog?.dimension_h_mm),
    material: line.material || text(catalog?.material),
    color: line.color || text(catalog?.color),
    level1_category: text(catalog?.level1_category),
    level2_category: text(catalog?.level2_category),
    created_at: text(catalog?.created_at) || new Date().toISOString(),
    on_shopify: false,
    in_catalog: Boolean(catalog),
    sale_price: Number(catalog?.sale_price) || undefined,
    exact: true,
  };
}

function toDraft(line: FurnitureLine, product: SearchProduct): PresentationProductDraft {
  const size = dimLabel(line.dimensionL, line.dimensionW, line.dimensionH)
    || dimLabel(product.dimension_l_mm, product.dimension_w_mm, product.dimension_h_mm);
  const facts = [
    product.material ? `材質：${product.material}` : '',
    product.color ? `顏色：${product.color}` : '',
    size ? `尺寸：${size}` : '',
    line.quantity ? `數量：${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : '',
    line.delivery ? `交貨期：${line.delivery}` : '',
    line.optional ? '此項在報價單標為可選。' : '',
  ].filter(Boolean);
  const catalogPrice = Number(product.sale_price) || 0;
  return {
    displayName: line.optional ? `${product.title}（可選）` : product.title,
    model: product.model || product.sku || '',
    description: facts.join('\n'),
    sellingPoints: line.remarks,
    marketPrice: catalogPrice > 0 && catalogPrice !== line.unitPrice ? money(catalogPrice) : '',
    projectPrice: money(line.unitPrice),
    imageUrl: product.image_url || '',
    noBackground: false,
    sampleImageUrl: '',
  };
}

export async function loadPresentationQuote(
  quoteUuid: string,
  productCap = 30,
): Promise<PresentationQuoteImport> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select(DETAIL_COLUMNS)
    .eq('id', quoteUuid)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('找不到這張報價單');

  const row = data as unknown as Record<string, unknown>;
  const quoteId = text(row.quote_id);
  const versionLabel = displayQuoteVersion(text(row.version));
  const form = asRecord(row.form_data);
  const clientInfo = asRecord(row.client_info);
  const floorPlan = parseQuoteFloorPlan(row.floor_plan);
  const zoneImages = parseQuoteZoneImages(row.zone_images);
  const designProjectId = text(row.design_project_id);
  const items = await loadQuoteItems(quoteUuid);

  let designName = '';
  let designClient = '';
  let designFloor = '';
  let designZones: ProjectZone[] = [];
  let designProducts: ZoneProduct[] = [];
  if (designProjectId) {
    const [project, zones, products] = await Promise.all([
      supabase.from('design_projects').select('id, name, client_name, floor_plan_url').eq('id', designProjectId).maybeSingle(),
      fetchZones(designProjectId),
      fetchZoneProducts(designProjectId),
    ]);
    if (!project.error && project.data) {
      designName = text(project.data.name);
      designClient = text(project.data.client_name);
      designFloor = httpUrl(project.data.floor_plan_url);
    }
    designZones = zones;
    designProducts = products;
  }

  let pitchingName = '';
  let pitchingCustomer = '';
  let pitchingCustomerId = '';
  let pitchingPm = '';
  let pitchingIndustry = '';
  const pitchingId = text(row.bwf_pitching_id);
  if (pitchingId || quoteId) {
    const [attached] = await loadPitchingsForQuoteRows([{
      bwf_pitching_id: pitchingId || null,
      quote_id: quoteId,
    }]).catch(() => []);
    const pitching = attached?.pitching;
    if (pitching) {
      pitchingName = pitchingDisplayTitle(pitching);
      pitchingCustomer = text(pitching.customer_name);
      pitchingCustomerId = text(pitching.customer_id);
      pitchingPm = text(pitching.main_pm_name);
      pitchingIndustry = text(pitching.client_industry);
    }
  }

  const client = named(form.clientName) || named(clientInfo.name) || named(designClient) || named(pitchingCustomer) || named(form.clientContactName) || named(clientInfo.contactName);
  const project = designName || (pitchingName && pitchingName !== quoteId ? pitchingName : '');
  const floorMime = floorPlan?.mimeType || '';
  const quoteImage = floorPlan?.previewUrl
    || (floorPlan?.url && !isPdf(floorPlan.url, floorMime) ? floorPlan.url : '');
  const designImage = designFloor && !isPdf(designFloor) ? designFloor : '';
  const floorImageUrl = quoteImage || designImage || floorPlan?.url || designFloor;
  const floorIsImage = Boolean(quoteImage || designImage);
  const coverImageUrl = (zoneImages[UNZONED_QUOTE_IMAGE_KEY] ?? []).find((url) => httpUrl(url)) || '';

  const designByName = new Map(designZones.map((zone) => [zone.name.trim().toLowerCase(), zone]));
  const zones: PresentationZoneDraft[] = [];
  const zoneIdByKey = new Map<string, string>();

  const sectionTitles = items.filter((item) => item.isSectionTitle && text(item.name));
  if (sectionTitles.length) {
    for (const item of items) {
      if (!item.isSectionTitle) continue;
      if (zones.length >= ZONE_CAP) break;
      const sourceId = text(item.id);
      const id = crypto.randomUUID();
      const name = text(item.name) || '未命名分區';
      // A quote space can sit in several places; keep every copied area for the deck.
      const regions = (floorPlan?.regions ?? [])
        .filter((entry) => entry.zoneId === sourceId)
        .map((entry) => entry.rect);
      const matched = designByName.get(name.toLowerCase());
      const fallback = matched ? normalizeZoneRect(matched.bounds) : null;
      const rects = regions.length ? regions : fallback ? [fallback] : [];
      const imageUrl = (zoneImages[sourceId] ?? []).find((url) => httpUrl(url)) || '';
      zones.push(zoneDraft(id, name, rects, imageUrl));
      if (sourceId) zoneIdByKey.set(sourceId, id);
    }
  } else if (designZones.length) {
    for (const zone of designZones) {
      if (zones.length >= ZONE_CAP) break;
      const id = crypto.randomUUID();
      const rect = normalizeZoneRect(zone.bounds);
      zones.push(zoneDraft(id, zone.name || zone.code || '分區', rect ? [rect] : [], ''));
      zoneIdByKey.set(zone.id, id);
    }
  }

  const quoteLines: FurnitureLine[] = [];
  let activeKey = '';
  if (sectionTitles.length) {
    for (const item of items) {
      if (item.isSectionTitle) {
        activeKey = text(item.id);
        continue;
      }
      const line = lineFromQuoteItem(item, activeKey);
      if (line) quoteLines.push(line);
    }
  } else {
    for (const item of items) {
      const line = lineFromQuoteItem(item, '');
      if (line) quoteLines.push(line);
    }
  }

  let lines = quoteLines;
  if (!lines.length && designProducts.length) {
    const seen = new Set<string>();
    lines = [];
    for (const row of designProducts) {
      const dedupe = `${row.zoneId || ''}:${row.productId || row.id}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const line = lineFromZoneProduct(row, text(row.zoneId));
      if (line) lines.push(line);
    }
  } else if (lines.length && !sectionTitles.length && designProducts.length) {
    const zoneByProduct = new Map<string, string>();
    for (const row of designProducts) {
      const productId = text(row.productId);
      const zoneId = text(row.zoneId);
      if (productId && zoneId && !zoneByProduct.has(productId)) zoneByProduct.set(productId, zoneId);
    }
    lines = lines.map((line) => ({
      ...line,
      zoneKey: line.productId ? zoneByProduct.get(line.productId) || '' : '',
    }));
  }

  if (lines.some((line) => !line.zoneKey || !zoneIdByKey.has(line.zoneKey))) {
    let fallback = zones[0]?.id;
    if (!fallback) {
      fallback = crypto.randomUUID();
      zones.push(zoneDraft(fallback, '報價項目', null, ''));
    }
    zoneIdByKey.set('__fallback__', fallback);
  }

  const keyed = assignLineKeys(lines);
  const kept = keyed.slice(0, Math.max(0, productCap));
  const catalog = await loadCatalog(kept.map((line) => line.productId));
  const products: SearchProduct[] = [];
  const productZone: Record<string, string> = {};
  const productDrafts: Record<string, PresentationProductDraft> = {};
  for (const line of kept) {
    const product = toSearchProduct(line, line.productId ? catalog.get(line.productId) : undefined);
    const zoneId = zoneIdByKey.get(line.zoneKey) || zoneIdByKey.get('__fallback__') || zones[0]?.id || '';
    products.push(product);
    if (zoneId) productZone[product.id] = zoneId;
    productDrafts[product.id] = toDraft(line, product);
  }

  const total = money(row.total_amount);
  const purpose = [
    `根據報價單 ${quoteId || '未編號'} ${versionLabel} 整理方案`,
    total ? `報價總額 ${total}` : '',
  ].filter(Boolean).join('，');
  const content = [
    text(form.clientContactName) || text(clientInfo.contactName) ? `聯絡人：${text(form.clientContactName) || text(clientInfo.contactName)}` : '',
    text(clientInfo.phone) || text(form.clientPhone) ? `電話：${text(clientInfo.phone) || text(form.clientPhone)}` : '',
    text(clientInfo.email) || text(form.clientEmail) ? `電郵：${text(clientInfo.email) || text(form.clientEmail)}` : '',
    text(form.projectManager) || pitchingPm ? `負責同事：${text(form.projectManager) || pitchingPm}` : '',
    pitchingIndustry ? `客戶產業：${pitchingIndustry}` : '',
  ].filter(Boolean).join('\n');
  const sameCustomer = Boolean(pitchingCustomerId && pitchingCustomer && client === pitchingCustomer);

  return {
    quoteId,
    versionLabel,
    client,
    project,
    projectId: designProjectId || undefined,
    pmsClientId: sameCustomer ? pitchingCustomerId : undefined,
    pmsProjectId: text(row.bwf_project_id) || undefined,
    title: clip(
      [...new Set([client, project].filter(Boolean))].join(' ') || `${quoteId} 方案匯報`,
      TITLE_MAX,
    ),
    purpose: clip(purpose, PURPOSE_MAX),
    content: clip(content, CONTENT_MAX),
    coverImageUrl,
    floorImageUrl,
    floorIsImage,
    zones,
    products,
    productZone,
    productDrafts,
    skippedProducts: Math.max(0, keyed.length - kept.length),
  };
}
