/**
 * Identity printed on BWA PM documents.
 * Legal name, address and phone are not in the PRD, so they are not invented here.
 */
export const BWA_PM_BRAND = {
  brandName: 'BWA',
  moduleLabel: 'PM報價',
} as const;

export const PM_QUICK_PATH = '/fds/pm/quick';
export const PM_PRO_PDF_PATH = '/fds/pm/pro-pdf';

export function pmPathWithPitching(path: string, pitchingId: string): string {
  const params = new URLSearchParams({ pmsPitchingId: pitchingId });
  return `${path}?${params.toString()}`;
}
