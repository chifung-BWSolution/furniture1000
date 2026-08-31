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

/** Customer-facing revision on PDF / preview, e.g. v32 → R32. */
export function formatQuoteRevisionLabel(version: string | null | undefined): string {
  const seq = quoteVersionSequence(version);
  if (seq > 0) return `R${seq}`;
  const raw = (version || '').trim();
  if (!raw || raw === '—') return '';
  const rev = raw.match(/^r(\d+)$/i);
  if (rev) return `R${rev[1]}`;
  return raw.replace(/^v/i, 'R');
}

/** PDF / preview 報價單號 with current revision, e.g. BWF-OB26-109 R32. */
export function formatQuoteNumberWithVersion(
  quoteNumber: string | null | undefined,
  version?: string | null,
): string {
  const number = (quoteNumber || '').trim();
  const rev = formatQuoteRevisionLabel(version);
  if (!number) return rev;
  if (!rev) return number;
  const stripped = number.replace(/[\s_\-]*[vVrR]\d+$/, '').trim() || number;
  return `${stripped} ${rev}`;
}
