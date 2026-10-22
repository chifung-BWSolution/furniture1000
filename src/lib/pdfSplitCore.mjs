import { PDFDocument } from 'pdf-lib';

/** Edge refuses anything larger than this. Parts must land strictly under it. */
export const PDF_EDGE_MAX_BYTES = 60 * 1024 * 1024;
/**
 * Per-part size target. Edge parse_pdf holds the part several times over (download buffer,
 * pdf.js copy, pdf-lib object graph, base64 of embedded images) inside a ~256MB isolate,
 * so a 37MB part ran out of memory. Keep parts around 10MB.
 */
export const PDF_SPLIT_TARGET_BYTES = 10 * 1024 * 1024;
/** Per-part page cap, applied together with the byte target (whichever yields more parts). */
export const PDF_SPLIT_MAX_PAGES = 15;

/**
 * @param {string} parentPath storage path of the original PDF
 * @param {number} partIndex 1-based
 * @param {string} partHash sha256 hex of the part bytes
 */
export function partStoragePath(parentPath, partIndex, partHash) {
  const slash = parentPath.lastIndexOf('/');
  const dir = slash >= 0 ? parentPath.slice(0, slash) : 'unassigned';
  const base = parentPath.slice(slash + 1).replace(/\.pdf$/i, '') || 'document';
  const n = String(partIndex).padStart(3, '0');
  return `${dir}/${base}/part-${n}-${partHash}.pdf`;
}

async function slicePdf(src, start, end) {
  const out = await PDFDocument.create();
  const indexes = [];
  for (let i = start; i < end; i += 1) indexes.push(i);
  const pages = await out.copyPages(src, indexes);
  for (const page of pages) out.addPage(page);
  return out.save();
}

/**
 * Split a PDF into page ranges of at most maxPages pages whose rewritten bytes stay near
 * targetBytes and always under the Edge cap.
 * A single page that is itself between the target and the Edge cap is kept as its own part.
 * pageOffset is the number of original pages before this part (original page = local page + pageOffset).
 *
 * @param {Uint8Array} input
 * @param {number} [targetBytes]
 * @param {number} [maxPages]
 * @returns {Promise<{ partIndex: number, pageOffset: number, pageCount: number, bytes: Uint8Array }[]>}
 */
export async function splitPdfUnderTarget(input, targetBytes = PDF_SPLIT_TARGET_BYTES, maxPages = PDF_SPLIT_MAX_PAGES) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let src;
  try {
    src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`無法拆分 PDF：${detail}`);
  }
  const total = src.getPageCount();
  if (total < 1) throw new Error('PDF 沒有頁面');

  const target = Math.max(1, targetBytes);
  const pageCap = Math.max(1, Math.floor(maxPages) || 1);
  /** @type {{ partIndex: number, pageOffset: number, pageCount: number, bytes: Uint8Array }[]} */
  const parts = [];
  let start = 0;
  while (start < total) {
    let lo = start + 1;
    let hi = Math.min(total, start + pageCap);
    let bestEnd = 0;
    /** @type {Uint8Array | null} */
    let bestBytes = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const sliced = await slicePdf(src, start, mid);
      const underTarget = sliced.byteLength <= target;
      const single = mid === start + 1;
      if (underTarget || (single && sliced.byteLength <= PDF_EDGE_MAX_BYTES)) {
        bestEnd = mid;
        bestBytes = sliced;
        if (!underTarget) break;
        lo = mid + 1;
      } else if (single) {
        const mb = (sliced.byteLength / 1024 / 1024).toFixed(1);
        throw new Error(`第 ${start + 1} 頁約 ${mb}MB，超過 Edge 上限 60MB，無法再拆`);
      } else {
        hi = mid - 1;
      }
    }
    if (!bestBytes || bestEnd <= start) throw new Error('無法拆分 PDF');
    parts.push({
      partIndex: parts.length + 1,
      pageOffset: start,
      pageCount: bestEnd - start,
      bytes: bestBytes,
    });
    start = bestEnd;
  }
  return parts;
}
