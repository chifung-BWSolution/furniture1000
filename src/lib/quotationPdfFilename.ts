import { quoteVersionSequence } from '@/lib/quoteVersions';

/**
 * Download filename for quotation PDFs:
 * BWF_{pitching code}_R{n}.pdf  (v1 → R1, v10 → R10)
 */
export function buildQuotationPdfFilename(
  quoteNumber: string,
  version?: string | null,
): string {
  const code = (quoteNumber || 'Draft').trim().replace(/\s+/g, '_') || 'Draft';
  const seq = quoteVersionSequence(version);
  const rev = `R${seq > 0 ? seq : 1}`;
  return `BWF_${code}_${rev}.pdf`;
}
