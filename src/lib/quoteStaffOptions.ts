import { supabase } from '@/lib/supabase';
import { fetchPmsPitchings } from '@/lib/pmsPitchings';
import { canonicalStaffNames } from '@/lib/staffDisplay';

type QuoteStaffSourceRow = {
  pitching?: {
    main_pm_name?: string | null;
    main_designer_name?: string | null;
  } | null;
  submitter?: string | null;
  project_data?: {
    formData?: {
      projectManager?: string;
    };
  };
};

function sortStaffNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

/** Resolve PM / designer names for one quote row (same rules as 報價一覽). */
export function staffNamesForQuoteRow(row: QuoteStaffSourceRow): string[] {
  if (row.pitching) {
    const names = canonicalStaffNames([
      row.pitching.main_pm_name,
      row.pitching.main_designer_name,
    ]);
    if (names.length > 0) return names;
  }
  const pm = row.project_data?.formData?.projectManager;
  if (pm?.trim()) return canonicalStaffNames([pm]);
  const sub = row.submitter;
  if (sub?.trim()) return canonicalStaffNames([sub]);
  return [];
}

/** Collect canonical PM / designer names from loaded quote rows (報價一覽 filter source). */
export function collectStaffNamesFromQuoteRows(
  rows: QuoteStaffSourceRow[],
): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const name of staffNamesForQuoteRow(row)) {
      names.add(name);
    }
  }
  return sortStaffNames([...names]);
}

let cachedOptions: string[] | null = null;
let inflight: Promise<string[]> | null = null;

/**
 * Load the same PM / designer name list used by 報價一覽 filter.
 * Cached for the session to avoid repeated lookups while submitting reviews.
 */
export async function fetchQuoteStaffFilterOptions(): Promise<string[]> {
  if (cachedOptions) return cachedOptions;
  if (inflight) return inflight;

  inflight = (async () => {
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('submitter, bwf_pitching_id, project_data')
      .order('modified_date', { ascending: false, nullsFirst: false })
      .limit(500);

    if (error) {
      console.warn('[fetchQuoteStaffFilterOptions]', error.message);
      return [];
    }

    const rows = data ?? [];
    const pitchingIds = [
      ...new Set(
        rows
          .map((row) => row.bwf_pitching_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    let pitchingById = new Map<
      string,
      NonNullable<QuoteStaffSourceRow['pitching']>
    >();
    if (pitchingIds.length > 0) {
      const pitchings = await fetchPmsPitchings({
        ids: pitchingIds,
        limit: pitchingIds.length,
      });
      pitchingById = new Map(
        pitchings.map((pitching) => [
          pitching.id,
          {
            main_pm_name: pitching.main_pm_name,
            main_designer_name: pitching.main_designer_name,
          },
        ]),
      );
    }

    const quoteRows: QuoteStaffSourceRow[] = rows.map((row) => ({
      submitter: row.submitter,
      project_data: row.project_data as QuoteStaffSourceRow['project_data'],
      pitching: row.bwf_pitching_id
        ? pitchingById.get(row.bwf_pitching_id) ?? null
        : null,
    }));

    const options = collectStaffNamesFromQuoteRows(quoteRows);
    cachedOptions = options;
    return options;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function clearQuoteStaffFilterOptionsCache(): void {
  cachedOptions = null;
  inflight = null;
}
