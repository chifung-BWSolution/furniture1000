import { supabase } from '@/lib/supabase';
import { fetchPmsPitchings, type PmsPitchingListItem } from '@/lib/pmsPitchings';
import { resolvePmsStaffByIds } from '@/lib/pmsStaff';
import { staffDisplayLabel } from '@/lib/staffDisplay';
import type { DesignProject } from '@/types/solutions';

function quoteChainIdFromProject(project: DesignProject): string {
  const meta = project.meta || {};
  return String(meta.quoteId || meta.pitchingCode || '').trim();
}

function pmFromPitching(pitching: PmsPitchingListItem | null | undefined): string {
  if (!pitching) return '';
  return staffDisplayLabel([
    pitching.main_pm_name,
    pitching.main_designer_name,
  ]);
}

/** Resolve 項目經理 labels — prefer 報價一覽 / PMS pitching PM & designer. */
export async function resolveDesignProjectPmLabels(
  projects: DesignProject[],
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  const quoteIds = [
    ...new Set(projects.map(quoteChainIdFromProject).filter(Boolean)),
  ];

  const pitchingIdByQuoteId = new Map<string, string>();
  if (quoteIds.length > 0) {
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('quote_id, bwf_pitching_id')
      .in('quote_id', quoteIds)
      .not('bwf_pitching_id', 'is', null);
    if (!error) {
      for (const row of data ?? []) {
        const quoteId = String(row.quote_id || '').trim();
        const pitchingId = String(row.bwf_pitching_id || '').trim();
        if (quoteId && pitchingId && !pitchingIdByQuoteId.has(quoteId)) {
          pitchingIdByQuoteId.set(quoteId, pitchingId);
        }
      }
    }
  }

  const pitchingById = new Map<string, PmsPitchingListItem>();
  const pitchingIds = [...new Set(pitchingIdByQuoteId.values())];
  if (pitchingIds.length > 0) {
    const pitchings = await fetchPmsPitchings({
      ids: pitchingIds,
      limit: pitchingIds.length,
    });
    for (const pitching of pitchings) {
      pitchingById.set(pitching.id, pitching);
    }
  }

  const pitchingByCode = new Map<string, PmsPitchingListItem>();
  const codesToSearch = quoteIds.filter((code) => !pitchingIdByQuoteId.has(code));
  await Promise.all(
    codesToSearch.map(async (code) => {
      const pitchings = await fetchPmsPitchings({ search: code, limit: 10 });
      const match = pitchings.find(
        (row) => row.pitching_code?.trim() === code,
      );
      if (match) pitchingByCode.set(code, match);
    }),
  );

  const staffIds = [
    ...new Set(
      projects
        .flatMap((project) => [project.creatorStaffId, project.editorStaffId])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const staffById = await resolvePmsStaffByIds(staffIds);

  for (const project of projects) {
    const quoteId = quoteChainIdFromProject(project);
    let label = '';

    if (quoteId) {
      const pitchingId = pitchingIdByQuoteId.get(quoteId);
      label = pmFromPitching(
        pitchingId ? pitchingById.get(pitchingId) : pitchingByCode.get(quoteId),
      );
    }

    if (!label) {
      const creator = project.creatorStaffId
        ? staffById.get(project.creatorStaffId)
        : null;
      const editor = project.editorStaffId
        ? staffById.get(project.editorStaffId)
        : null;
      label = staffDisplayLabel([creator?.name, editor?.name]);
    }

    labels[project.id] = label || '未指定項目經理';
  }

  return labels;
}
