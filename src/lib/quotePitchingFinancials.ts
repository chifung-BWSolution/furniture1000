/**
 * Overlay Quick Quote pitching-list「預計收入 / 預計毛利」with values from the
 * latest Furniture `bwf_quote` for that pitching (Contract Sum / GP).
 */
import { supabase } from '@/lib/supabase';
import { parseGpSummary } from '@/lib/quoteGpSummary';
import type { PmsPitchingListItem } from '@/lib/pmsPitchings';

type QuoteFinancialRow = {
  bwf_pitching_id: string | null;
  total_amount: number | null;
  cost_price: number | null;
  project_data: unknown;
  modified_date?: string | null;
  created_at?: string | null;
};

function quoteSortKey(row: QuoteFinancialRow): number {
  const modified = row.modified_date ? Date.parse(row.modified_date) : NaN;
  if (Number.isFinite(modified)) return modified;
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  return Number.isFinite(created) ? created : 0;
}

/** GP = Contract Sum − product cost − Ship − Installation (same as draft editor). */
export function quoteGpFromSavedQuote(row: {
  total_amount?: number | null;
  cost_price?: number | null;
  project_data?: unknown;
}): number {
  const contractSum = Number(row.total_amount) || 0;
  const productCost = Number(row.cost_price) || 0;
  const projectData =
    row.project_data && typeof row.project_data === 'object'
      ? (row.project_data as { gpSummary?: unknown })
      : null;
  const gpSummary = parseGpSummary(projectData?.gpSummary);
  return contractSum - productCost - gpSummary.ship - gpSummary.installation;
}

/**
 * For each pitching, prefer the latest linked quote's Contract Sum / GP.
 * Pitchings without a quote keep PMS estimated_income / estimated_gross_profit.
 */
export async function overlayPitchingFinancialsFromQuotes(
  pitchings: PmsPitchingListItem[],
): Promise<PmsPitchingListItem[]> {
  const ids = [
    ...new Set(pitchings.map((row) => row.id).filter((id): id is string => Boolean(id))),
  ];
  if (ids.length === 0) return pitchings;

  const { data, error } = await supabase
    .from('bwf_quote')
    .select(
      'bwf_pitching_id, total_amount, cost_price, project_data, modified_date, created_at',
    )
    .in('bwf_pitching_id', ids)
    .order('modified_date', { ascending: false, nullsFirst: false });

  if (error) {
    console.warn('[overlayPitchingFinancialsFromQuotes]', error.message);
    return pitchings;
  }

  const latestByPitching = new Map<string, QuoteFinancialRow>();
  for (const row of (data || []) as QuoteFinancialRow[]) {
    const pitchingId = String(row.bwf_pitching_id || '').trim();
    if (!pitchingId) continue;
    const existing = latestByPitching.get(pitchingId);
    if (!existing || quoteSortKey(row) > quoteSortKey(existing)) {
      latestByPitching.set(pitchingId, row);
    }
  }

  if (latestByPitching.size === 0) return pitchings;

  return pitchings.map((row) => {
    const quote = latestByPitching.get(row.id);
    if (!quote) return row;
    return {
      ...row,
      estimated_income: Number(quote.total_amount) || 0,
      estimated_gross_profit: quoteGpFromSavedQuote(quote),
    };
  });
}
