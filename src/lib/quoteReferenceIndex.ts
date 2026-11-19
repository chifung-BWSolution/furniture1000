import { fetchPmsPitchings } from '@/lib/pmsPitchings';
import {
  type QuoteReferenceCandidate,
} from '@/lib/quoteReferenceMatch';
import { supabase } from '@/lib/supabase';

interface QuoteReferenceIndexRow {
  id: string;
  quote_id: string;
  version: string | null;
  total_amount: number | string | null;
  created_at: string | null;
  bwf_pitching_id: string | null;
  industries: string[] | null;
  scopes: string[] | null;
  grades: string[] | null;
  work_period: string | null;
  item_count: number | null;
  sized_item_count: number | null;
  size_lt_1200: number | null;
  size_1200_1600: number | null;
  size_1600_2000: number | null;
  size_ge_2000: number | null;
}

function textList(value: string[] | null | undefined): string[] {
  return (value || []).map((item) => item.trim()).filter(Boolean);
}

function amount(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Latest formal quotes with the fields used for matching.
 * Customer type is read from the existing pitching list, in batches of 150.
 */
export async function loadQuoteReferenceCandidates(): Promise<QuoteReferenceCandidate[]> {
  const { data, error } = await supabase.rpc('fds_quote_reference_index');
  if (error) {
    const message = error.message?.trim() || '無法載入過往報價';
    throw new Error(
      /statement timeout/i.test(message) ? '過往報價載入逾時，請再試一次' : message,
    );
  }
  const rows = (data || []) as QuoteReferenceIndexRow[];
  const pitchingIds = [
    ...new Set(rows.map((row) => row.bwf_pitching_id?.trim() || '').filter(Boolean)),
  ];
  const pitchings = pitchingIds.length > 0 ? await fetchPmsPitchings({ ids: pitchingIds }) : [];
  const customerTypeByPitching = new Map(
    pitchings.map((row) => [row.id, row.customer_type?.trim() || null]),
  );

  return rows.map((row) => ({
    id: row.id,
    quoteId: row.quote_id,
    version: row.version,
    totalAmount: amount(row.total_amount),
    createdAt: row.created_at,
    pitchingId: row.bwf_pitching_id,
    industries: textList(row.industries),
    scopes: textList(row.scopes),
    grades: textList(row.grades),
    workPeriod: row.work_period?.trim() || null,
    itemCount: count(row.item_count),
    sizedItemCount: count(row.sized_item_count),
    sizeLt1200: count(row.size_lt_1200),
    size1200: count(row.size_1200_1600),
    size1600: count(row.size_1600_2000),
    sizeGe2000: count(row.size_ge_2000),
    customerType: row.bwf_pitching_id
      ? customerTypeByPitching.get(row.bwf_pitching_id) ?? null
      : null,
  }));
}
