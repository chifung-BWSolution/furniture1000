/**
 * Plan structure-phase units from segments and page stats (pure, testable without Deno).
 *
 * A segment with enough text becomes text units of up to maxPages pages.
 * A segment where most pages are image-only is planned as vision even if a few
 * pages carry short OCR text.
 * A segment without text but with embedded images (scanned / photo-only catalogue
 * pages where OCR returned NO_TEXT) becomes vision units of up to visionMaxPages pages,
 * so the page images themselves go to the vision model. Small vision units keep
 * Edge memory and the inline image payload bounded.
 *
 * @param {{ id: string, start_page: number, end_page: number, kind: string }[]} segments
 * @param {{ page_no: number, char_count: number, image_count: number }[]} pages
 * @param {{ kinds: string[], minTextChars: number, maxPages: number, visionMaxPages: number }} opts
 * @returns {{ segment_id: string, start: number, end: number, vision?: boolean }[]}
 */
export function planStructureUnits(segments, pages, opts) {
  const stats = new Map(pages.map((p) => [Number(p.page_no), p]));
  const units = [];
  for (const s of segments) {
    if (!opts.kinds.includes(s.kind)) continue;
    let chars = 0;
    let images = 0;
    let imageOnlyPages = 0;
    const pageCount = s.end_page - s.start_page + 1;
    for (let p = s.start_page; p <= s.end_page; p++) {
      const pc = Number(stats.get(p)?.char_count ?? 0);
      const pi = Number(stats.get(p)?.image_count ?? 0);
      chars += pc;
      images += pi;
      if (pc < opts.minTextChars && pi > 0) imageOnlyPages++;
    }
    // Vision when the segment as a whole has little text, OR when most of its pages
    // are image-only: a few OCR'd headings ("THE LIGHTS") spread over 8 photo/spec
    // pages must not turn the segment into a text unit that sends no images.
    const vision = chars < opts.minTextChars || imageOnlyPages * 2 > pageCount;
    if (vision && images === 0) continue;
    const step = Math.max(1, vision ? opts.visionMaxPages : opts.maxPages);
    for (let start = s.start_page; start <= s.end_page; start += step) {
      const unit = { segment_id: s.id, start, end: Math.min(s.end_page, start + step - 1) };
      units.push(vision ? { ...unit, vision: true } : unit);
    }
  }
  return units;
}

/** Pages whose embedded images should be sent with a unit. */
export function unitImagePages(unit, pages) {
  return pages
    .filter((p) => p.page_no >= unit.start && p.page_no <= unit.end)
    .filter((p) => unit.vision || p.text_source === 'text')
    .map((p) => p.page_no);
}

/**
 * Copy the given 1-based pages of a loaded pdf-lib document into a new small PDF.
 * The vision model renders it itself, so captions drawn as vector outlines (no text
 * layer, no fonts) are read along with the photos. Returns null when it would exceed maxBytes.
 *
 * @param {{ create: () => Promise<any> }} PDFDocumentCls pdf-lib PDFDocument class (injected for Deno/Node)
 * @param {any} src loaded pdf-lib PDFDocument
 * @param {number[]} pageNos 1-based page numbers
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array | null>}
 */
export async function extractPagesPdf(PDFDocumentCls, src, pageNos, maxBytes) {
  const total = src.getPageCount();
  const indexes = [...new Set(pageNos)].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b).map((p) => p - 1);
  if (indexes.length === 0) return null;
  const out = await PDFDocumentCls.create();
  for (const page of await out.copyPages(src, indexes)) out.addPage(page);
  const bytes = await out.save();
  return bytes.byteLength <= maxBytes ? bytes : null;
}
