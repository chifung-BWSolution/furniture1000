import { supabase } from '@/lib/supabase';

export const PMS_INDUSTRY_COLLECTION_ID =
  '4f5de598-2dcb-45a6-a106-9d933e9a8007';

export interface PmsIndustryOption {
  id: string;
  display: string;
}

export interface PmsPitchingQuoteDefaults {
  pitching_id: string | null;
  project_id: string | null;
  pitching_code: string | null;
  project_code: string | null;
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
 * Pass pitching_id and/or project_id — edge function resolves the cross-link:
 * - project_id → always yields related pitching_id
 * - pitching_id → yields related project_id when a bwf_projects row exists
 */
export async function fetchPmsPitchingQuoteDefaults(options?: {
  pitchingId?: string | null;
  projectId?: string | null;
} | string | null): Promise<PmsPitchingQuoteDefaults | null> {
  // Back-compat: older call sites passed a pitching id string.
  const pitchingId =
    typeof options === 'string' || options == null
      ? (options || '').trim()
      : (options.pitchingId || '').trim();
  const projectId =
    typeof options === 'string' || options == null
      ? ''
      : (options.projectId || '').trim();

  try {
    const body: Record<string, string> = {};
    if (pitchingId) body.pitching_id = pitchingId;
    if (projectId) body.project_id = projectId;

    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-pms-pitching-quote-defaults',
      { body },
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
      pitching_id: data.pitching_id ? String(data.pitching_id) : null,
      project_id: data.project_id ? String(data.project_id) : null,
      pitching_code: data.pitching_code ?? null,
      project_code: data.project_code ?? null,
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
