/** Section title ordinals for quotation headings: 1. 2. 3. … */

/** Display prefix, e.g. 「1.」. */
export function sectionTitlePrefix(ordinal1Based: number): string {
  const num = Math.floor(ordinal1Based);
  if (!Number.isFinite(num) || num < 1) return '';
  return `${num}.`;
}

/** Full PDF/editor label: 「1.開放區」. */
export function formatSectionTitleLabel(
  ordinal1Based: number,
  titleText: string,
): string {
  const body = titleText.trim();
  const prefix = sectionTitlePrefix(ordinal1Based);
  if (!prefix) return body;
  return body ? `${prefix}${body}` : prefix;
}

export type SectionTitleLike = { isSectionTitle?: boolean };

/** 1-based ordinal among section-title rows only (at `index`). */
export function sectionTitleOrdinalAt(
  items: SectionTitleLike[],
  index: number,
): number {
  let n = 0;
  for (let i = 0; i <= index && i < items.length; i++) {
    if (items[i]?.isSectionTitle) n += 1;
  }
  return n;
}

/** 1-based product/service serial skipping section titles (at `index`). */
export function productSerialAt(
  items: SectionTitleLike[],
  index: number,
): number {
  let n = 0;
  for (let i = 0; i <= index && i < items.length; i++) {
    if (!items[i]?.isSectionTitle) n += 1;
  }
  return n;
}
