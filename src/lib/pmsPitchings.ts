import { supabase } from '@/lib/supabase';

export interface PmsPitchingListItem {
  id: string;
  pitching_code: string | null;
  pitching_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  main_pm_id: string | null;
  main_pm_name: string | null;
  pitching_stages: string | null;
  estimated_income: number | string | null;
  enquiry_date: string | null;
}

/**
 * Search PMS v3 bwf_pitchings for 快速報價 Step 1 selection.
 */
export async function fetchPmsPitchings(options?: {
  search?: string;
  limit?: number;
}): Promise<PmsPitchingListItem[]> {
  try {
    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-pms-pitchings',
      {
        body: {
          search: options?.search?.trim() || '',
          limit: options?.limit ?? 40,
        },
      },
    );

    if (error) {
      console.warn('[fetchPmsPitchings]', error.message);
      return [];
    }
    if (data?.error) {
      console.warn('[fetchPmsPitchings]', data.error);
      return [];
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .map((row: Record<string, unknown>) => ({
        id: String(row.id || ''),
        pitching_code: row.pitching_code ? String(row.pitching_code) : null,
        pitching_name: row.pitching_name ? String(row.pitching_name) : null,
        customer_id: row.customer_id ? String(row.customer_id) : null,
        customer_name: row.customer_name ? String(row.customer_name) : null,
        main_pm_id: row.main_pm_id ? String(row.main_pm_id) : null,
        main_pm_name: row.main_pm_name ? String(row.main_pm_name) : null,
        pitching_stages: row.pitching_stages ? String(row.pitching_stages) : null,
        estimated_income: (row.estimated_income as number | string | null) ?? null,
        enquiry_date: row.enquiry_date ? String(row.enquiry_date) : null,
      }))
      .filter((row: PmsPitchingListItem) => Boolean(row.id));
  } catch (err) {
    console.warn('[fetchPmsPitchings] invoke failed:', err);
    return [];
  }
}

export function formatPmsPitchingLabel(item: PmsPitchingListItem): string {
  const code = item.pitching_code?.trim() || '未命名 Pitching';
  const customer = item.customer_name?.trim();
  return customer ? `${code} · ${customer}` : code;
}
