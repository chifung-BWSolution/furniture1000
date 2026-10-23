/**
 * Zone (分區) grouping for quotation line items — mirrors QMS's
 * QuoteSectionsItemsEditor: `isSectionTitle` rows delimit zones and each
 * furniture/service row inside a zone carries a `zoneOrdinal.position`
 * prefix (e.g. 1.1, 1.2, 2.1) in front of its name.
 *
 * The quote stays a flat ordered list (bwf_quote_item rows) — zones are
 * derived, never persisted separately, so PMS/DB contracts are untouched.
 */
import { productSerialAt, type SectionTitleLike } from './quoteSectionTitle';

export type QuoteZoneSpan = {
  /** 1-based ordinal among section-title rows. */
  ordinal: number;
  /** Index of the section-title row. */
  titleIndex: number;
  /** Index of the first row after the title (== items.length for a trailing empty zone). */
  startIndex: number;
  /** Index one past the zone's last row (next title index or items.length). */
  endIndex: number;
};

/** Zones delimited by section-title rows. Rows before the first title are unzoned. */
export function quoteZoneSpans(items: SectionTitleLike[]): QuoteZoneSpan[] {
  const spans: QuoteZoneSpan[] = [];
  let current: QuoteZoneSpan | null = null;
  items.forEach((item, index) => {
    if (item.isSectionTitle) {
      if (current) {
        current.endIndex = index;
        spans.push(current);
      }
      current = {
        ordinal: spans.length + 1,
        titleIndex: index,
        startIndex: index + 1,
        endIndex: items.length,
      };
    }
  });
  if (current) spans.push(current);
  return spans;
}

/** Zone membership for the row at `index`; null when it sits before the first zone. */
export function zoneContextAt(
  items: SectionTitleLike[],
  index: number,
): { ordinal: number; position: number } | null {
  let ordinal = 0;
  let position = 0;
  let inZone = false;
  for (let i = 0; i <= index && i < items.length; i += 1) {
    if (items[i]?.isSectionTitle) {
      ordinal += 1;
      position = 0;
      inZone = true;
    } else if (inZone) {
      position += 1;
    }
  }
  return inZone ? { ordinal, position } : null;
}

/** QMS-style item prefix, e.g. 「1.2」; null when the row is not inside a zone. */
export function zoneItemPrefixAt(
  items: SectionTitleLike[],
  index: number,
): string | null {
  const ctx = zoneContextAt(items, index);
  return ctx ? `${ctx.ordinal}.${ctx.position}` : null;
}

/** Count of furniture/service rows inside the zone whose title sits at `titleIndex`. */
export function zoneItemCountAt(items: SectionTitleLike[], titleIndex: number): number {
  let count = 0;
  for (let i = titleIndex + 1; i < items.length && !items[i]?.isSectionTitle; i += 1) {
    count += 1;
  }
  return count;
}

/** Insert index for appending a row at the end of the zone titled at `titleIndex`. */
export function zoneEndInsertAt(items: SectionTitleLike[], titleIndex: number): number {
  let i = titleIndex + 1;
  while (i < items.length && !items[i]?.isSectionTitle) i += 1;
  return i;
}

/**
 * Display serial for a furniture/service row: 「1.2」 inside a zone
 * (QMS section.item numbering), the plain global serial otherwise.
 */
export function quoteItemSerialLabel(items: SectionTitleLike[], index: number): string {
  return zoneItemPrefixAt(items, index) ?? String(productSerialAt(items, index));
}
