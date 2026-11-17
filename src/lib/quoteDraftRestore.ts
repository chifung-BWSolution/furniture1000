/**
 * Merge an IndexedDB quotation draft over the quote already loaded from the server.
 *
 * Drafts saved before the server quote finished loading stored empty defaults.
 * Those blanks must not wipe saved fields. A draft with `blankFieldsAreIntentional`
 * was written after load, so an empty value is the user clearing that field.
 */

export function mergeTextField(
  draft: unknown,
  saved: string,
  blankFieldsAreIntentional: boolean,
): string {
  if (typeof draft !== "string") return saved;
  if (blankFieldsAreIntentional) return draft;
  return draft.trim() ? draft : saved;
}

/** Keep a custom saved sentence when a legacy draft only captured the factory default. */
export function mergeDefaultableText(
  draft: unknown,
  saved: string,
  factoryDefault: string,
  blankFieldsAreIntentional: boolean,
): string {
  const text = typeof draft === "string" ? draft : "";
  if (blankFieldsAreIntentional) return text;
  const trimmed = text.trim();
  if (!trimmed) return saved;
  if (
    trimmed === factoryDefault.trim() &&
    saved.trim() &&
    saved.trim() !== factoryDefault.trim()
  ) {
    return saved;
  }
  return text;
}

export function mergeStringList(
  draft: unknown,
  saved: string[],
  blankFieldsAreIntentional: boolean,
): string[] {
  if (!Array.isArray(draft)) return saved;
  const list = draft.filter((item): item is string => typeof item === "string");
  if (!blankFieldsAreIntentional && list.length === 0 && saved.length > 0) return saved;
  return list;
}

export function mergeInstallationAmount(
  draftAmount: unknown,
  savedAmount: number | null,
  explicitlyEdited: boolean,
): number | null {
  if (typeof draftAmount === "number" && Number.isFinite(draftAmount)) return draftAmount;
  return explicitlyEdited ? null : savedAmount;
}

export function mergeDeliveryAddress(input: {
  draftMetaAddress: unknown;
  draftTermsAddress: string;
  draftTermsEnAddress: string;
  savedAddress: string;
  blankFieldsAreIntentional: boolean;
}): string {
  const fromDraft = [
    input.draftMetaAddress,
    input.draftTermsAddress,
    input.draftTermsEnAddress,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.length > 0) ?? "";
  if (fromDraft) return fromDraft;
  if (input.blankFieldsAreIntentional) return "";
  return input.savedAddress.trim();
}

export type QuoteClientFields = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
};

export function mergeClientFields(
  draft: Partial<QuoteClientFields> | null | undefined,
  saved: QuoteClientFields,
  blankFieldsAreIntentional: boolean,
): QuoteClientFields {
  return {
    name: mergeTextField(draft?.name, saved.name, blankFieldsAreIntentional),
    contactName: mergeTextField(draft?.contactName, saved.contactName, blankFieldsAreIntentional),
    phone: mergeTextField(draft?.phone, saved.phone, blankFieldsAreIntentional),
    email: mergeTextField(draft?.email, saved.email, blankFieldsAreIntentional),
  };
}

export function mergeGpSummary(
  draft: { ship?: unknown; installation?: unknown } | null | undefined,
  saved: { ship: number; installation: number },
  blankFieldsAreIntentional: boolean,
): { ship: number; installation: number } {
  const ship = typeof draft?.ship === "number" && Number.isFinite(draft.ship) ? draft.ship : 0;
  const installation =
    typeof draft?.installation === "number" && Number.isFinite(draft.installation)
      ? draft.installation
      : 0;
  if (
    !blankFieldsAreIntentional &&
    ship === 0 &&
    installation === 0 &&
    (saved.ship > 0 || saved.installation > 0)
  ) {
    return saved;
  }
  return { ship, installation };
}

/** Multiplier defaults to 1. A legacy draft of 1 must not replace a saved multiplier. */
export function mergePriceMultiplier(
  draft: unknown,
  saved: string,
  blankFieldsAreIntentional: boolean,
): string | null {
  if (draft == null || draft === "") return null;
  const text = String(draft).trim();
  if (!text) return null;
  const savedText = saved.trim();
  if (
    !blankFieldsAreIntentional &&
    (text === "1" || text === "1.0") &&
    savedText &&
    savedText !== "1" &&
    savedText !== "1.0"
  ) {
    return null;
  }
  return text;
}

export function preferSavedIfDraftEmpty<T>(
  draft: T,
  saved: T,
  isEmpty: (value: T) => boolean,
  blankFieldsAreIntentional: boolean,
): T {
  if (!blankFieldsAreIntentional && isEmpty(draft) && !isEmpty(saved)) return saved;
  return draft;
}

/** Ignore the delivery-address underline so a factory terms template can be recognised. */
export function termsMatchIgnoringAddress(draftHtml: string, factoryHtml: string): boolean {
  const norm = (html: string) =>
    html
      .replace(/<u\b[^>]*>[\s\S]*?<\/u>/gi, "")
      .replace(/&nbsp;|&#160;/gi, "")
      .replace(/\s+/g, "")
      .trim();
  const left = norm(draftHtml);
  return left.length > 0 && left === norm(factoryHtml);
}
