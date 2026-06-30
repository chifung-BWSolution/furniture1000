/** Legacy / duplicate factory display names → canonical name used in filters & UI. */
export const FACTORY_NAME_ALIASES: Record<string, string> = {
  '魅格': '魅格家具 PMG',
};

export function normalizeFactoryDisplayName(name: string | null | undefined): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return FACTORY_NAME_ALIASES[trimmed] ?? trimmed;
}

/** Distinct canonical factory names for dropdowns (merges aliases). */
export function dedupeFactoryNames(names: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const canonical = normalizeFactoryDisplayName(raw);
    if (canonical) out.add(canonical);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh'));
}

/** Values to match in DB filters — canonical name plus any known legacy aliases. */
export function expandFactoryFilterValues(canonicalOrRaw: string): string[] {
  const canonical = normalizeFactoryDisplayName(canonicalOrRaw);
  if (!canonical) return [];
  const values = new Set<string>([canonical]);
  for (const [alias, target] of Object.entries(FACTORY_NAME_ALIASES)) {
    if (target === canonical) values.add(alias);
  }
  return Array.from(values);
}

export function expandFactoryFilterSelection(selected: string[]): string[] {
  return Array.from(new Set(selected.flatMap(expandFactoryFilterValues)));
}
