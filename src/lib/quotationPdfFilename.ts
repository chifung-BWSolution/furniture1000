import { quoteVersionSequence } from '@/lib/quoteVersions';

/**
 * Download filename for quotation PDFs:
 * BWF-{pitching code without leading BWF}-R{n}.pdf
 * e.g. BWF-SH26-050-AO1 v10 → BWF-SH26-050-AO1-R10.pdf
 * (avoids BWF-BWF-… when the code already starts with BWF-)
 */
export function buildQuotationPdfFilename(
  quoteNumber: string,
  version?: string | null,
): string {
  const raw = (quoteNumber || 'Draft').trim().replace(/\s+/g, '-') || 'Draft';
  // Pitching codes are typically BWF-…; strip that brand prefix before adding BWF-.
  const code = raw.replace(/^BWF[-_]+/i, '') || raw;
  const seq = quoteVersionSequence(version);
  const rev = `R${seq > 0 ? seq : 1}`;
  return `BWF-${code}-${rev}.pdf`;
}
