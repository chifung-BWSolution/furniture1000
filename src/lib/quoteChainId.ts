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

/** True for placeholder / non-persistable draft keys. */
export function isPlaceholderQuoteId(
  value: string | null | undefined,
): boolean {
  const v = (value || '').trim();
  if (!v) return true;
  if (v === 'NEW' || v.endsWith('::NEW')) return true;
  return isLegacyQFormatQuoteId(v);
}

/**
 * First usable chain id from candidates (skips empty / NEW / legacy Q…).
 */
export function pickQuoteChainId(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const raw of candidates) {
    const v = (raw || '').trim();
    if (!v || isPlaceholderQuoteId(v)) continue;
    return v;
  }
  return null;
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
  /** Extra fallbacks (URL segment, quoteMeta.quoteNumber, locked ref, …). */
  fallbacks?: Array<string | null | undefined>;
}): string | null {
  return pickQuoteChainId(
    options.code,
    options.pitchingCode,
    options.existingQuoteId,
    ...(options.fallbacks || []),
  );
}
