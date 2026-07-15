import { displayQuoteVersion } from '@/lib/quoteVersions';

/** Download filename for quotation PDFs — includes pitching code and version when available. */
export function buildQuotationPdfFilename(
  quoteNumber: string,
  version?: string | null,
): string {
  const code = (quoteNumber || 'Draft').trim().replace(/\s+/g, '_');
  const ver = version?.trim()
    ? `_${displayQuoteVersion(version)}`
    : '';
  return `BWF_報價單_${code}${ver}.pdf`;
}
