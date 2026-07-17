/**
 * Isolates nested HTML5 DnD in the quote editor:
 * quote line items vs remarks blocks inside a line item.
 *
 * Prefer the active-kind registry during dragover (custom MIME types are not
 * always readable via getData until drop; types lists vary by browser).
 */

export type QuoteDnDKind = "quote-row" | "remarks-block";

export const QUOTE_DND_MIME = {
  quoteRow: "application/x-furniture-quote-row",
  remarksBlock: "application/x-furniture-remarks-block",
} as const;

let activeKind: QuoteDnDKind | null = null;

export function setActiveQuoteDnDKind(kind: QuoteDnDKind | null) {
  activeKind = kind;
}

export function getActiveQuoteDnDKind(): QuoteDnDKind | null {
  return activeKind;
}

export function isActiveQuoteDnDKind(kind: QuoteDnDKind): boolean {
  return activeKind === kind;
}

export function dataTransferHasQuoteDnDKind(
  dt: DataTransfer,
  kind: QuoteDnDKind,
): boolean {
  const mime =
    kind === "quote-row"
      ? QUOTE_DND_MIME.quoteRow
      : QUOTE_DND_MIME.remarksBlock;
  return Array.from(dt.types).some(
    (t) => t === mime || t.toLowerCase() === mime.toLowerCase(),
  );
}

/** True if this drag belongs to `kind` (registry first, then MIME types). */
export function isQuoteDnDDrag(
  dt: DataTransfer,
  kind: QuoteDnDKind,
): boolean {
  if (activeKind != null) return activeKind === kind;
  return dataTransferHasQuoteDnDKind(dt, kind);
}

export function beginQuoteDnDDrag(
  dataTransfer: DataTransfer,
  kind: QuoteDnDKind,
  id: string,
) {
  const dt = dataTransfer;
  activeKind = kind;
  dt.effectAllowed = "move";
  const mime =
    kind === "quote-row"
      ? QUOTE_DND_MIME.quoteRow
      : QUOTE_DND_MIME.remarksBlock;
  try {
    dt.setData(mime, id);
  } catch {
    // Some browsers reject custom MIME types; text/plain below still carries the id.
  }
  dt.setData("text/plain", id);
}

export function endQuoteDnDDrag() {
  activeKind = null;
}
