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
  /** PMS `bwf_pitchings.asana_link` (same field as `bwa_pitchings.asana_link`). */
  asana_link?: string | null;
}

const EDGE_MAX = 150;

function chunkList<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function mapPitchingRows(items: unknown[]): PmsPitchingListItem[] {
  return items
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id || ''),
        pitching_code: r.pitching_code ? String(r.pitching_code) : null,
        pitching_name: r.pitching_name ? String(r.pitching_name) : null,
        customer_id: r.customer_id ? String(r.customer_id) : null,
        customer_name: r.customer_name ? String(r.customer_name) : null,
        main_pm_id: r.main_pm_id ? String(r.main_pm_id) : null,
        main_pm_name: r.main_pm_name ? String(r.main_pm_name) : null,
        main_designer_id: r.main_designer_id
          ? String(r.main_designer_id)
          : null,
        main_designer_name: r.main_designer_name
          ? String(r.main_designer_name)
          : null,
        pitching_stages: r.pitching_stages
          ? String(r.pitching_stages)
          : null,
        estimated_income: (r.estimated_income as number | string | null) ?? null,
        estimated_expense:
          (r.estimated_expense as number | string | null) ?? null,
        estimated_gross_profit:
          (r.estimated_gross_profit as number | string | null) ?? null,
        enquiry_date: r.enquiry_date ? String(r.enquiry_date) : null,
        remaining_days:
          typeof r.remaining_days === 'number'
            ? r.remaining_days
            : r.remaining_days != null
              ? Number(r.remaining_days)
              : null,
        customer_type: r.customer_type ? String(r.customer_type) : null,
        client_industry: r.client_industry
          ? String(r.client_industry)
          : null,
        service_type: r.service_type ? String(r.service_type) : null,
        asana_link: r.asana_link ? String(r.asana_link).trim() : null,
      } satisfies PmsPitchingListItem;
    })
    .filter((row) => Boolean(row.id));
}

/**
 * Search PMS v3 bwf_pitchings for 快速報價 pitching selection.
 * Pass `ids` and/or `codes` to batch-load related pitchings for 報價單一覽 enrichment.
 */
export async function fetchPmsPitchings(options?: {
  search?: string;
  limit?: number;
  ids?: string[];
  /** Exact pitching_code values (e.g. BWF-OB26-113). */
  codes?: string[];
}): Promise<PmsPitchingListItem[]> {
  try {
    const ids = [...new Set((options?.ids || []).map((id) => id.trim()).filter(Boolean))];
    const codes = [
      ...new Set((options?.codes || []).map((code) => code.trim()).filter(Boolean)),
    ];

    // ids + codes: parallel fetch then merge (edge accepts one filter mode at a time).
    if (ids.length > 0 && codes.length > 0) {
      const [byId, byCode] = await Promise.all([
        fetchPmsPitchings({ ids, limit: ids.length }),
        fetchPmsPitchings({ codes, limit: codes.length }),
      ]);
      const map = new Map<string, PmsPitchingListItem>();
      for (const row of [...byId, ...byCode]) map.set(row.id, row);
      return [...map.values()];
    }

    if (ids.length > EDGE_MAX) {
      const parts = await Promise.all(
        chunkList(ids, EDGE_MAX).map((chunk) =>
          fetchPmsPitchings({ ids: chunk, limit: chunk.length }),
        ),
      );
      return parts.flat();
    }

    if (codes.length > EDGE_MAX) {
      const parts = await Promise.all(
        chunkList(codes, EDGE_MAX).map((chunk) =>
          fetchPmsPitchings({ codes: chunk, limit: chunk.length }),
        ),
      );
      return parts.flat();
    }

    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-pms-pitchings',
      {
        body: {
          search: options?.search?.trim() || '',
          limit:
            options?.limit ??
            (ids.length > 0 || codes.length > 0
              ? Math.max(ids.length, codes.length)
              : 80),
          ...(ids.length > 0 ? { ids } : {}),
          ...(codes.length > 0 ? { codes } : {}),
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
    return mapPitchingRows(items);
  } catch (err) {
    console.warn('[fetchPmsPitchings] invoke failed:', err);
    return [];
  }
}

/** Attach live PMS pitching by bwf_pitching_id, else by quote_id === pitching_code. */
export function attachPitchingsToQuoteRows<
  T extends { bwf_pitching_id?: string | null; quote_id: string },
>(
  rows: T[],
  pitchings: PmsPitchingListItem[],
): Array<T & { pitching: PmsPitchingListItem | null }> {
  const byId = new Map(pitchings.map((p) => [p.id, p]));
  const byCode = new Map<string, PmsPitchingListItem>();
  for (const p of pitchings) {
    const code = p.pitching_code?.trim();
    if (code && !byCode.has(code)) byCode.set(code, p);
  }
  return rows.map((row) => {
    const pitching =
      (row.bwf_pitching_id ? byId.get(row.bwf_pitching_id) : undefined) ||
      byCode.get((row.quote_id || '').trim()) ||
      null;
    return { ...row, pitching };
  });
}

/** Load + attach live PMS pitchings for quote list rows. */
export async function loadPitchingsForQuoteRows<
  T extends { bwf_pitching_id?: string | null; quote_id: string },
>(rows: T[]): Promise<Array<T & { pitching: PmsPitchingListItem | null }>> {
  if (rows.length === 0) return [];
  const ids = [
    ...new Set(
      rows
        .map((row) => row.bwf_pitching_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const codes = [
    ...new Set(
      rows
        .filter((row) => !row.bwf_pitching_id)
        .map((row) => (row.quote_id || '').trim())
        .filter(Boolean),
    ),
  ];
  const pitchings =
    ids.length === 0 && codes.length === 0
      ? []
      : await fetchPmsPitchings({
          ...(ids.length > 0 ? { ids } : {}),
          ...(codes.length > 0 ? { codes } : {}),
          limit: Math.max(ids.length, codes.length, 1),
        });
  return attachPitchingsToQuoteRows(rows, pitchings);
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

/** Only allow http(s) Asana / project links — reject javascript: and relative junk. */
export function safeAsanaHref(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}
