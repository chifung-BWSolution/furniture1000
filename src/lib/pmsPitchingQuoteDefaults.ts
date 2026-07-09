import { supabase } from '@/lib/supabase';

export const PMS_INDUSTRY_COLLECTION_ID =
  '4f5de598-2dcb-45a6-a106-9d933e9a8007';

export interface PmsIndustryOption {
  id: string;
  display: string;
}

export interface PmsPitchingQuoteDefaults {
  pitching_id: string;
  pitching_code: string | null;
  customer_id: string | null;
  client_name: string | null;
  estimated_income: number | string | null;
  budget_min: string | null;
  budget_max: string | null;
  industry_options: PmsIndustryOption[];
  selected_industries: string[];
}

/**
 * Load PMS pitching defaults for 快速報價 (client name, industry tags, budget).
 */
export async function fetchPmsPitchingQuoteDefaults(
  pitchingId?: string | null,
): Promise<PmsPitchingQuoteDefaults | null> {
  const id = pitchingId?.trim() || '';

  try {
    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-pms-pitching-quote-defaults',
      { body: id ? { pitching_id: id } : {} },
    );

    if (error) {
      console.warn('[fetchPmsPitchingQuoteDefaults]', error.message);
      return null;
    }
    if (data?.error) {
      console.warn('[fetchPmsPitchingQuoteDefaults]', data.error);
      return null;
    }
    if (!data) return null;

    return {
      pitching_id: String(data.pitching_id || id || ''),
      pitching_code: data.pitching_code ?? null,
      customer_id: data.customer_id ?? null,
      client_name: data.client_name ?? null,
      estimated_income: data.estimated_income ?? null,
      budget_min: data.budget_min ?? null,
      budget_max: data.budget_max ?? null,
      industry_options: Array.isArray(data.industry_options)
        ? data.industry_options
            .map((o: { id?: string; display?: string }) => ({
              id: String(o?.id || ''),
              display: String(o?.display || '').trim(),
            }))
            .filter((o: PmsIndustryOption) => o.id && o.display)
        : [],
      selected_industries: Array.isArray(data.selected_industries)
        ? data.selected_industries.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [],
    };
  } catch (err) {
    console.warn('[fetchPmsPitchingQuoteDefaults] invoke failed:', err);
    return null;
  }
}
