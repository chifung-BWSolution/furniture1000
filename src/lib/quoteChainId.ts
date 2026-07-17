/**
 * Quote version-chain key = bwf_quote.quote_id (= PMS pitching code, e.g. BWF-…).
 * Legacy QYYYY-MMDD-NNN ids are no longer generated.
 */

const LEGACY_Q_QUOTE_ID_RE = /^Q\d{4}-\d{4}-\d{3}$/i;

export function isLegacyQFormatQuoteId(
  value: string | null | undefined,
): boolean {
  return LEGACY_Q_QUOTE_ID_RE.test((value || '').trim());
}

/**
 * Resolve the chain id written to bwf_quote.quote_id.
 * Accepts PMS/wizard code or an existing non-legacy quote_id.
 */
export function resolveQuoteChainId(options: {
  /** PMS / wizard 報價單號 (BWF-…). */
  code?: string | null;
  /** @deprecated alias of code */
  pitchingCode?: string | null;
  existingQuoteId?: string | null;
}): string | null {
  const code = (options.code || options.pitchingCode || '').trim();
  if (code && !isLegacyQFormatQuoteId(code)) return code;

  const existing = (options.existingQuoteId || '').trim();
  if (existing && !isLegacyQFormatQuoteId(existing)) return existing;

  return null;
}
