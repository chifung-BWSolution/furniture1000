/**
 * Isolates nested HTML5 DnD in the quote editor:
 * quote line items vs remarks blocks inside a line item.
 *
 * Use the active-kind registry to ignore the other system's dragover/drop.
 * Prefer React drag state / refs for actually performing the drop — custom
 * MIME `types` are unreliable across browsers at drop time.
 */

export type QuoteDnDKind = "quote-row" | "remarks-block";

export const QUOTE_DND_MIME = {
  quoteRow: "application/x-furniture-quote-row",
  remarksBlock: "application/x-furniture-remarks-block",
} as const;

let activeKind: QuoteDnDKind | null = null;

export function getActiveQuoteDnDKind(): QuoteDnDKind | null {
  return activeKind;
}

/** True when a drag of this kind is in progress (registry). */
export function isActiveQuoteDnDKind(kind: QuoteDnDKind): boolean {
  return activeKind === kind;
}

/** True when the other nested DnD system owns the current drag. */
export function isForeignQuoteDnDKind(kind: QuoteDnDKind): boolean {
  return activeKind != null && activeKind !== kind;
}

export function beginQuoteDnDDrag(
  dataTransfer: DataTransfer,
  kind: QuoteDnDKind,
  id: string,
) {
  activeKind = kind;
  dataTransfer.effectAllowed = "move";
  const mime =
    kind === "quote-row"
      ? QUOTE_DND_MIME.quoteRow
      : QUOTE_DND_MIME.remarksBlock;
  try {
    dataTransfer.setData(mime, id);
  } catch {
    // Some browsers reject custom MIME types; text/plain below still carries the id.
  }
  dataTransfer.setData("text/plain", id);
}

export function endQuoteDnDDrag() {
  activeKind = null;
}

export function readQuoteDnDId(
  dataTransfer: DataTransfer,
  kind: QuoteDnDKind,
): string {
  const mime =
    kind === "quote-row"
      ? QUOTE_DND_MIME.quoteRow
      : QUOTE_DND_MIME.remarksBlock;
  try {
    const typed = dataTransfer.getData(mime);
    if (typed) return typed;
  } catch {
    // ignore
  }
  try {
    return dataTransfer.getData("text/plain") || "";
  } catch {
    return "";
  }
}
