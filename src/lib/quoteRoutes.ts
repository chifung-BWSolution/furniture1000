import { displayQuoteVersion, quoteVersionSequence } from '@/lib/quoteVersions';

export const QUOTE_LIST_PATH = '/quote';
export const QUOTE_QUICK_PATH = '/quote/quick';

/** Business quote id: Q{YYYY}-{MMDD}-{100-999} */
export function generateQuoteId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 900) + 100);
  return `Q${year}-${month}${day}-${random}`;
}

export type ParsedQuotePath =
  | { kind: 'list' }
  | { kind: 'quick' }
  | { kind: 'quote'; quoteId: string; version?: string; versionNum?: number };

/** Parse `/quote/:segment` path segment (not including `/quote/` prefix). */
export function parseQuotePathSegment(segment: string): ParsedQuotePath {
  const decoded = decodeURIComponent(segment || '').trim();
  if (!decoded) return { kind: 'list' };
  if (decoded.toLowerCase() === 'quick') return { kind: 'quick' };

  // Version suffix: /quote/BWF-FD26-001V5 or /quote/Q2026-0717-263V2
  const versionMatch = decoded.match(/^(.+)V(\d+)$/i);
  if (versionMatch) {
    const versionNum = parseInt(versionMatch[2], 10);
    return {
      kind: 'quote',
      quoteId: versionMatch[1],
      versionNum,
      version: Number.isFinite(versionNum) ? `v${versionNum}` : undefined,
    };
  }

  return { kind: 'quote', quoteId: decoded };
}

/** Build editor URL. Version accepts `v2`, `2`, or numeric sequence. */
export function buildQuoteEditorPath(
  quoteId: string,
  version?: string | number | null,
): string {
  const base = `${QUOTE_LIST_PATH}/${encodeURIComponent(quoteId)}`;
  if (version == null || version === '') return base;
  const seq =
    typeof version === 'number'
      ? version
      : quoteVersionSequence(String(version));
  if (!Number.isFinite(seq) || seq <= 0) return base;
  return `${base}V${seq}`;
}

/** Normalize pathname to a quote route kind. */
export function parseQuotePathname(pathname: string): ParsedQuotePath {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === QUOTE_LIST_PATH) return { kind: 'list' };
  const match = normalized.match(/^\/quote\/([^/]+)$/);
  if (!match) return { kind: 'list' };
  return parseQuotePathSegment(match[1]);
}

export function quoteEditorLabel(quoteId: string, version?: string | null): string {
  if (!version) return quoteId;
  return `${quoteId} · ${displayQuoteVersion(version)}`;
}
