/** Parse / compare / bump bwf_quote version strings (v{major}.{minor}). */

export type ParsedQuoteVersion = { major: number; minor: number };

export function parseQuoteVersion(version: string | null | undefined): ParsedQuoteVersion {
  const m = (version || '').trim().match(/^v(\d+)\.(\d+)$/i);
  if (!m) return { major: 0, minor: 0 };
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
  };
}

export function compareQuoteVersion(a: string, b: string): number {
  const va = parseQuoteVersion(a);
  const vb = parseQuoteVersion(b);
  if (va.major !== vb.major) return va.major - vb.major;
  return va.minor - vb.minor;
}

export function formatQuoteVersion(major: number, minor: number): string {
  return `v${major}.${minor}`;
}

export function bumpQuoteVersion(version: string | null | undefined): string {
  const { major, minor } = parseQuoteVersion(version);
  if (major === 0 && minor === 0) return 'v1.1';
  return formatQuoteVersion(major, minor + 1);
}

export function maxQuoteVersion(versions: string[]): string {
  if (versions.length === 0) return 'v1.0';
  return versions.reduce((best, v) =>
    compareQuoteVersion(v, best) > 0 ? v : best,
  );
}

export function nextQuoteVersionFromChain(versions: string[]): string {
  return bumpQuoteVersion(maxQuoteVersion(versions));
}
