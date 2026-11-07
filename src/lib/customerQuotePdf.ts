/**
 * Client Portal PDF preview data.
 *
 * The portal must show the same quotation PDF as the editor. The editor builds
 * `QuotationPDFData` from its in-memory draft; the portal only has the
 * customer-safe payload from `get_quote_pdf_payload()` (see the migration
 * `20261107120000_fds24_portal_quote_pdf.sql`).
 *
 * This module fetches that payload and maps it to `QuotationPDFData` so the
 * shared `QuotationPDFPreviewModal` can render it without exposing cost / GP /
 * editor-only fields.
 */

import { supabase } from '@/lib/supabase';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import { mapRowToItem, type BwfQuoteItemInput, type BwfQuoteItemRow } from '@/lib/bwfQuoteItems';
import { quoteBillableSubtotal } from '@/lib/quoteItemTotals';
import {
  parsePhotoLayouts,
  parseZonePhotoLayouts,
  pruneZonePhotoLayouts,
} from '@/lib/quotePhotoLayouts';
import { parseQuotePhotoAssetRefs, quotePhotoRefUrl } from '@/lib/quotePhotoLibrary';
import { parseQuoteZoneImages, UNZONED_QUOTE_IMAGE_KEY } from '@/lib/quoteFloorPlan';
import { parseQuoteCatalogPages } from '@/lib/quoteCatalogPages';
import {
  injectDeliveryAddressIntoTermsHtml,
  resolveDeliveryAddress,
} from '@/lib/quotationDefaultTerms';
import {
  DEFAULT_COMPANY_ADDRESS,
  DEFAULT_COMPANY_WEBSITE,
  formatQuoteDisplayDate,
} from '@/lib/quotationLocale';
import { DEFAULT_QUOTE_COMPANY_PHONE } from '@/lib/quoteCompanyPhone';
import { displayQuoteVersion } from '@/lib/quoteVersions';
import { materialPlainText } from '@/lib/quotationMaterialHtml';

const DEFAULT_COMPANY_NAME = 'Branding Works Design Ltd';
const DEFAULT_COMPANY_EMAIL = 'sales@brandingworks-furniture.com';

export interface CustomerQuotePdfPayload {
  quote: {
    id: string;
    quote_id: string;
    version: string;
    status?: string | null;
    total_amount?: number | null;
    created_at?: string | null;
    modified_date?: string | null;
  };
  companyInfo?: Record<string, unknown> | null;
  clientInfo?: Record<string, unknown> | null;
  formData?: Record<string, unknown> | null;
  quoteMeta?: Record<string, unknown> | null;
  format?: {
    zoneSubtotalPlacement?: string | null;
    qrCaption?: string | null;
  } | null;
  deliveryDetails?: string | null;
  termsContent?: Record<string, unknown> | null;
  quotePhotoLayouts?: unknown;
  quotePhotoAssets?: unknown;
  zoneImages?: unknown;
  zonePhotoLayouts?: unknown;
  installationFee?: Record<string, unknown> | null;
  discountNote?: string | null;
  coverPages?: Array<{
    id?: string;
    title?: string;
    placement?: string;
    objectPath?: string;
    url?: string;
  }> | null;
  contentPages?: Array<{
    id?: string;
    title?: string;
    objectPath?: string;
    url?: string;
    pageNumber?: number;
  }> | null;
  catalogPages?: unknown;
  items?: BwfQuoteItemRow[] | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Same rule as the editor: section titles without content are omitted. */
function omitEmptyZones<T extends Pick<BwfQuoteItemInput, 'isSectionTitle'>>(rows: T[]): T[] {
  const keepTitle = new Set<number>();
  let titleIndex = -1;
  let hasBody = false;
  const closeZone = () => {
    if (titleIndex >= 0 && hasBody) keepTitle.add(titleIndex);
    titleIndex = -1;
    hasBody = false;
  };
  rows.forEach((item, index) => {
    if (item.isSectionTitle) {
      closeZone();
      titleIndex = index;
      return;
    }
    hasBody = true;
  });
  closeZone();
  return rows.filter((item, index) => !item.isSectionTitle || keepTitle.has(index));
}

function hasPdfContent(item: BwfQuoteItemInput): boolean {
  if (item.isSectionTitle || item.isCustomTerm) {
    return Boolean(text(item.name));
  }
  return Boolean(
    text(item.name)
    || text(item.category)
    || materialPlainText(item.material)
    || text(item.color)
    || text(item.remarks)
    || item.image
    || item.referenceImage
    || item.remarksImage
    || (item.unitPrice ?? 0) > 0
    || item.dimensionLMm != null
    || item.dimensionWMm != null
    || item.dimensionHMm != null
    || text(item.factoryName),
  );
}

function pdfItemOf(
  item: BwfQuoteItemInput,
  zoneImages: Record<string, string[]>,
): QuotationPDFData['items'][number] {
  return {
    image: item.image || '',
    referenceImage: item.referenceImage,
    name: item.name || '',
    unitPrice: item.unitPrice ?? 0,
    quantity: item.quantity ?? 0,
    category: item.category,
    material: item.material,
    color: item.color,
    remarks: item.remarks,
    remarksImage: item.remarksImage,
    dimensionLMm: item.dimensionLMm,
    dimensionWMm: item.dimensionWMm,
    dimensionHMm: item.dimensionHMm,
    dimensionMode: item.dimensionMode ?? 'lwh',
    isCustomTerm: item.isCustomTerm,
    isOptional: item.isOptional,
    isSectionTitle: item.isSectionTitle,
    id: item.isSectionTitle ? item.id : undefined,
    zoneImages: item.isSectionTitle && item.id ? zoneImages[item.id] : undefined,
    unit: item.unit,
  };
}

export async function fetchCustomerQuotePdfPayload(input: {
  quoteUuid: string;
  /** Share token for guest / QR sessions. Logged-in callers pass null. */
  token?: string | null;
}): Promise<CustomerQuotePdfPayload | null> {
  const quoteUuid = input.quoteUuid?.trim();
  if (!quoteUuid) return null;

  const { data, error } = await supabase.rpc('get_quote_pdf_payload', {
    p_quote_id: quoteUuid,
    p_token: input.token?.trim() || null,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') return null;
  return data as CustomerQuotePdfPayload;
}

/**
 * Map the customer-safe RPC payload to the shape expected by
 * `QuotationPDFPreviewModal`. Returns null when the payload has no quote.
 */
export function buildCustomerQuotePdfData(
  payload: CustomerQuotePdfPayload,
): QuotationPDFData | null {
  const quote = payload.quote;
  if (!quote?.id) return null;

  const company = payload.companyInfo ?? {};
  const info = payload.clientInfo ?? {};
  const form = payload.formData ?? {};
  const meta = payload.quoteMeta ?? {};
  const terms = payload.termsContent ?? {};

  const rawItems = (payload.items ?? []).map(mapRowToItem);
  const sourceItems = omitEmptyZones(
    rawItems.filter((item) => hasPdfContent(item) && !item.hideInPdf),
  );

  const zoneImages = parseQuoteZoneImages(payload.zoneImages);
  const sectionIds = sourceItems
    .filter((item) => item.isSectionTitle)
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id));
  const zonePhotoLayouts = pruneZonePhotoLayouts(
    parseZonePhotoLayouts(payload.zonePhotoLayouts),
    [...sectionIds, UNZONED_QUOTE_IMAGE_KEY],
  );

  const photoAssets = parseQuotePhotoAssetRefs(payload.quotePhotoAssets).map((asset) => ({
    id: asset.id,
    title: asset.title,
    url: quotePhotoRefUrl(asset),
    ...(asset.isGenerated ? { isGenerated: true } : {}),
  }));
  const photoGroups = parsePhotoLayouts(payload.quotePhotoLayouts);
  const quotePhotoLayouts =
    photoGroups.length > 0 || photoAssets.length > 0
      ? { groups: photoGroups, assets: photoAssets }
      : undefined;

  const coverPages = (payload.coverPages ?? [])
    .map((page) => {
      const url = quotePhotoRefUrl(page);
      return {
        id: text(page.id),
        title: text(page.title) || '圖片',
        placement: page.placement === 'back' ? ('back' as const) : ('cover' as const),
        url,
      };
    })
    .filter((page) => page.id && page.url);

  const contentPages = (payload.contentPages ?? [])
    .map((page) => {
      const url = quotePhotoRefUrl(page);
      const pageNumber = Math.max(1, Math.floor(Number(page.pageNumber) || 1));
      return {
        id: text(page.id),
        title: text(page.title) || '圖片',
        url,
        pageNumber,
      };
    })
    .filter((page) => page.id && page.url);

  const catalogPages = parseQuoteCatalogPages(payload.catalogPages);

  const termsHtml = text(terms.fullHtml);
  const deliveryAddress = resolveDeliveryAddress(termsHtml, text(meta.deliveryAddress));
  const fullHtml = termsHtml
    ? deliveryAddress
      ? injectDeliveryAddressIntoTermsHtml(termsHtml, deliveryAddress)
      : termsHtml
    : undefined;

  const rawInstallation = payload.installationFee ?? null;
  const installationFee = rawInstallation
    ? {
        title: text(rawInstallation.title) || undefined,
        subtitle: text(rawInstallation.subtitle) || undefined,
        conditionText: text(rawInstallation.conditionText) || undefined,
        freeLabel: text(rawInstallation.freeLabel) || undefined,
        chargeLabel: text(rawInstallation.chargeLabel) || undefined,
        amount: numberOrNull(rawInstallation.amount),
      }
    : undefined;

  const placement = payload.format?.zoneSubtotalPlacement;
  const zoneSubtotalPlacement =
    placement === 'summary_only' || placement === 'hidden'
      ? placement
      : 'section_and_summary';

  return {
    companyInfo: {
      name: text(company.name) || DEFAULT_COMPANY_NAME,
      address: text(company.address) || DEFAULT_COMPANY_ADDRESS.zh,
      showAddress: company.showAddressInPdf !== false,
      phone: text(company.phone) || DEFAULT_QUOTE_COMPANY_PHONE,
      email: text(company.email) || DEFAULT_COMPANY_EMAIL,
      website: text(company.website) || DEFAULT_COMPANY_WEBSITE,
    },
    clientInfo: {
      name: text(info.name) || text(form.clientName),
      contactName: text(info.contactName) || text(form.clientContactName),
      phone: text(info.phone) || text(form.clientPhone),
      email: text(info.email) || text(form.clientEmail),
    },
    quoteMeta: {
      projectName: text(quote.quote_id),
      pmName: text(meta.pmName),
      validity: text(meta.validity),
      deliveryAddress,
      quoteNumber: text(quote.quote_id),
      version: displayQuoteVersion(quote.version),
      date: formatQuoteDisplayDate(text(meta.date) || quote.created_at, 'zh'),
    },
    format: {
      zoneSubtotalPlacement,
      qrCaption: text(payload.format?.qrCaption) || '線上選擇／修改產品',
    },
    locale: 'zh',
    deliveryDetails: text(payload.deliveryDetails),
    termsContent: {
      transport: text(terms.transport) || undefined,
      extraFees: text(terms.extraFees) || undefined,
      warranty: text(terms.warranty) || undefined,
      other: text(terms.other) || undefined,
      payment: text(terms.payment) || undefined,
      fullHtml,
    },
    leadImages: zoneImages[UNZONED_QUOTE_IMAGE_KEY] ?? [],
    zonePhotoLayouts,
    items: sourceItems.map((item) => pdfItemOf(item, zoneImages)),
    subtotal: sourceItems.length
      ? quoteBillableSubtotal(sourceItems)
      : Number(quote.total_amount) || 0,
    discountNote: text(payload.discountNote) || undefined,
    quotePhotoLayouts,
    quoteCoverPages: coverPages,
    quoteContentPages: contentPages,
    installationFee,
    catalogPages: catalogPages.length ? catalogPages : undefined,
  };
}
