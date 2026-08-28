/**
 * Quote version strings: v1, v2, v3 …
 * Legacy rows may still store v1.1, v1.7 (minor digit = sequence number).
 */

export type ParsedQuoteVersion = { major: number; minor: number };

/** Numeric sequence for compare / bump (v1 → 1, legacy v1.7 → 7). */
export function quoteVersionSequence(version: string | null | undefined): number {
  const s = (version || '').trim();
  const simple = s.match(/^v(\d+)$/i);
  if (simple) return parseInt(simple[1], 10);
  const legacy = s.match(/^v(\d+)\.(\d+)$/i);
  if (legacy) return parseInt(legacy[2], 10);
  return 0;
}

export function formatQuoteVersion(n: number): string {
  return `v${n}`;
}

/** @deprecated Prefer quoteVersionSequence — kept for call sites using ParsedQuoteVersion. */
export function parseQuoteVersion(version: string | null | undefined): ParsedQuoteVersion {
  const seq = quoteVersionSequence(version);
  return { major: 1, minor: seq };
}

export function compareQuoteVersion(a: string, b: string): number {
  return quoteVersionSequence(a) - quoteVersionSequence(b);
}

export function bumpQuoteVersion(version: string | null | undefined): string {
  return formatQuoteVersion(quoteVersionSequence(version) + 1);
}

export function maxQuoteVersion(versions: string[]): string {
  if (versions.length === 0) return formatQuoteVersion(0);
  const maxSeq = versions.reduce(
    (best, v) => Math.max(best, quoteVersionSequence(v)),
    0,
  );
  return formatQuoteVersion(maxSeq);
}

export function nextQuoteVersionFromChain(versions: string[]): string {
  return bumpQuoteVersion(maxQuoteVersion(versions));
}

/** Normalize stored version for UI / filenames (legacy v1.7 → v7). */
export function displayQuoteVersion(version: string | null | undefined): string {
  const seq = quoteVersionSequence(version);
  if (seq <= 0) return (version || '').trim() || '—';
  return formatQuoteVersion(seq);
}

/** PDF / preview 報價單號 with current version, e.g. BWF-OB26-137 v3. */
export function formatQuoteNumberWithVersion(
  quoteNumber: string | null | undefined,
  version?: string | null,
): string {
  const number = (quoteNumber || '').trim();
  const ver = displayQuoteVersion(version);
  const hasVersion = Boolean(ver) && ver !== '—';
  if (!number) return hasVersion ? ver : '';
  if (!hasVersion) return number;
  const escaped = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|[\\s_\\-])${escaped}$`, 'i').test(number)) return number;
  return `${number} ${ver}`;
}
