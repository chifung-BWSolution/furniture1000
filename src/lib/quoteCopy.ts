/**
 * Load quote body fields for「複製報價單」— items, delivery, terms (not header/meta).
 */
import { supabase } from '@/lib/supabase';
import {
  itemsFromLegacyProjectData,
  loadQuoteItems,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';
import {
  migrateTermsContentToCurrent,
  type SavedTermsContent,
} from '@/lib/quotationDefaultTerms';
import { parseGpSummary } from '@/lib/quoteGpSummary';

export type QuoteCopyInstallationFee = {
  title?: string;
  subtitle?: string;
  conditionText?: string;
  freeLabel?: string;
  chargeLabel?: string;
  amount?: number | null;
};

/** Fields copied from the source quote (報價內容 / 交付 / 條款). */
export type QuoteCopyPayload = {
  items: BwfQuoteItemInput[];
  deliveryDetails: string;
  deliveryDetailsEn?: string;
  termsContent: SavedTermsContent;
  termsContentEn?: SavedTermsContent;
  discountNote: string;
  installationFee: QuoteCopyInstallationFee;
  gpSummary: ReturnType<typeof parseGpSummary>;
  priceMultiplier?: number | string;
};

function newCopyItemId(index: number): string {
  return `copy-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

function remapCopyItems(items: BwfQuoteItemInput[]): BwfQuoteItemInput[] {
  return items.map((item, index) => ({
    ...item,
    id: newCopyItemId(index),
  }));
}

/** Fetch copy payload from bwf_quote.id (UUID). */
export async function loadQuoteCopyPayload(
  quoteUuid: string,
): Promise<QuoteCopyPayload> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select('id, project_data')
    .eq('id', quoteUuid)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error('來源報價單不存在');

  const projectData = (data.project_data || {}) as Record<string, unknown>;
  const quoteMeta = projectData.quoteMeta as
    | { deliveryAddress?: string }
    | undefined;

  let items = await loadQuoteItems(quoteUuid);
  if (items.length === 0) {
    items = itemsFromLegacyProjectData(projectData);
  }

  const savedInstallationFee = projectData.installationFee as
    | QuoteCopyInstallationFee
    | undefined;

  const discountRaw = projectData.discountNote;
  const termsContent = migrateTermsContentToCurrent(
    projectData.termsContent as SavedTermsContent | undefined,
    quoteMeta?.deliveryAddress,
  );

  const termsContentEnRaw = projectData.termsContentEn as
    | SavedTermsContent
    | undefined;

  return {
    items: remapCopyItems(items),
    deliveryDetails:
      typeof projectData.deliveryDetails === 'string'
        ? projectData.deliveryDetails
        : '',
    deliveryDetailsEn:
      typeof projectData.deliveryDetailsEn === 'string'
        ? projectData.deliveryDetailsEn
        : undefined,
    termsContent,
    termsContentEn: termsContentEnRaw?.fullHtml
      ? termsContentEnRaw
      : undefined,
    discountNote: discountRaw == null ? '' : String(discountRaw),
    installationFee: {
      title: savedInstallationFee?.title,
      subtitle: savedInstallationFee?.subtitle,
      conditionText: savedInstallationFee?.conditionText,
      freeLabel: savedInstallationFee?.freeLabel,
      chargeLabel: savedInstallationFee?.chargeLabel,
      amount:
        typeof savedInstallationFee?.amount === 'number'
          ? savedInstallationFee.amount
          : null,
    },
    gpSummary: parseGpSummary(projectData.gpSummary),
    priceMultiplier:
      projectData.priceMultiplier != null && projectData.priceMultiplier !== ""
        ? (projectData.priceMultiplier as number | string)
        : undefined,
  };
}
