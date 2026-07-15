/** Alternate PMS staff labels mapped to canonical list/filter names. */
const STAFF_DISPLAY_ALIASES: Record<string, string> = {
  'winnie zhu f04': 'Winnie',
  'mark jiao f01': 'Mark',
};

export function canonicalStaffName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return STAFF_DISPLAY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Deduplicate staff names after applying canonical aliases. */
export function canonicalStaffNames(
  names: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of names) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;

    const canonical = canonicalStaffName(trimmed);
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(canonical);
  }

  return result;
}

export function staffDisplayLabel(
  names: Array<string | null | undefined>,
): string {
  const canonical = canonicalStaffNames(names);
  return canonical.length > 0 ? canonical.join(' / ') : '—';
}

export function matchesStaffFilter(
  names: Array<string | null | undefined>,
  filter: string,
): boolean {
  const target = canonicalStaffName(filter).toLowerCase();
  return canonicalStaffNames(names).some(
    (name) => name.toLowerCase() === target,
  );
}
