/**
 * Quote version-chain key = PMS pitching_code (BWF-…).
 * Legacy QYYYY-MMDD-NNN ids are no longer generated.
 */

const LEGACY_Q_QUOTE_ID_RE = /^Q\d{4}-\d{4}-\d{3}$/i;

export function isLegacyQFormatQuoteId(
  value: string | null | undefined,
): boolean {
  return LEGACY_Q_QUOTE_ID_RE.test((value || '').trim());
}

/** Chain id for bwf_quote.quote_id — pitching code only (never legacy Q-format). */
export function resolveQuoteChainId(options: {
  pitchingCode?: string | null;
  /** Ignored when legacy Q-format; otherwise used only if equal to pitching code. */
  existingQuoteId?: string | null;
}): string | null {
  const code = (options.pitchingCode || '').trim();
  if (code && !isLegacyQFormatQuoteId(code)) return code;

  const existing = (options.existingQuoteId || '').trim();
  if (existing && !isLegacyQFormatQuoteId(existing)) return existing;

  return null;
}
