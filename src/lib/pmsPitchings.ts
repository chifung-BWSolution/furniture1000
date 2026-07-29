import { supabase } from '@/lib/supabase';

export interface PmsPitchingListItem {
  id: string;
  pitching_code: string | null;
  pitching_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  main_pm_id: string | null;
  main_pm_name: string | null;
  main_designer_id?: string | null;
  main_designer_name?: string | null;
  pitching_stages: string | null;
  estimated_income: number | string | null;
  estimated_expense?: number | string | null;
  estimated_gross_profit?: number | string | null;
  enquiry_date: string | null;
  remaining_days?: number | null;
  customer_type?: string | null;
  /** PMS customer industry tags (客戶產業), joined with 、 */
  client_industry?: string | null;
  service_type?: string | null;
}

/**
 * Search PMS v3 bwf_pitchings for 快速報價 pitching selection.
 * Pass `ids` to batch-load related pitchings for 報價單一覽 enrichment.
 */
export async function fetchPmsPitchings(options?: {
  search?: string;
  limit?: number;
  ids?: string[];
}): Promise<PmsPitchingListItem[]> {
  try {
    const ids = (options?.ids || []).map((id) => id.trim()).filter(Boolean);

    // Chunk id lookups — edge MAX_LIMIT is 150
    if (ids.length > 150) {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 150) {
        chunks.push(ids.slice(i, i + 150));
      }
      const parts = await Promise.all(
        chunks.map((chunk) =>
          fetchPmsPitchings({ ids: chunk, limit: chunk.length }),
        ),
      );
      return parts.flat();
    }

    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-pms-pitchings',
      {
        body: {
          search: options?.search?.trim() || '',
          limit: options?.limit ?? (ids.length > 0 ? ids.length : 80),
          ...(ids.length > 0 ? { ids } : {}),
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
        main_designer_id: row.main_designer_id
          ? String(row.main_designer_id)
          : null,
        main_designer_name: row.main_designer_name
          ? String(row.main_designer_name)
          : null,
        pitching_stages: row.pitching_stages
          ? String(row.pitching_stages)
          : null,
        estimated_income: (row.estimated_income as number | string | null) ?? null,
        estimated_expense:
          (row.estimated_expense as number | string | null) ?? null,
        estimated_gross_profit:
          (row.estimated_gross_profit as number | string | null) ?? null,
        enquiry_date: row.enquiry_date ? String(row.enquiry_date) : null,
        remaining_days:
          typeof row.remaining_days === 'number'
            ? row.remaining_days
            : row.remaining_days != null
              ? Number(row.remaining_days)
              : null,
        customer_type: row.customer_type ? String(row.customer_type) : null,
        client_industry: row.client_industry
          ? String(row.client_industry)
          : null,
        service_type: row.service_type ? String(row.service_type) : null,
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

export function pitchingDisplayTitle(item: PmsPitchingListItem): string {
  return (
    item.pitching_name?.trim() ||
    item.customer_name?.trim() ||
    item.pitching_code?.trim() ||
    '未命名 Pitching'
  );
}
