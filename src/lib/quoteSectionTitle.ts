/** Chinese section ordinals for quotation titles: 一、二、三… */

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** Convert 1-based index to Chinese numeral (supports 1–99). */
export function toChineseSectionOrdinal(n: number): string {
  const num = Math.floor(n);
  if (!Number.isFinite(num) || num < 1) return '';
  if (num <= 10) {
    return num === 10 ? '十' : CN_DIGITS[num];
  }
  if (num < 20) return `十${CN_DIGITS[num - 10]}`;
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return `${CN_DIGITS[tens]}十${ones === 0 ? '' : CN_DIGITS[ones]}`;
  }
  return String(num);
}

/** Display prefix matching Excel template, e.g. 「一、」. */
export function sectionTitlePrefix(ordinal1Based: number): string {
  const cn = toChineseSectionOrdinal(ordinal1Based);
  return cn ? `${cn}、` : '';
}

/** Full PDF/editor label: 「一、開放區」. */
export function formatSectionTitleLabel(
  ordinal1Based: number,
  titleText: string,
): string {
  const body = titleText.trim();
  const prefix = sectionTitlePrefix(ordinal1Based);
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
