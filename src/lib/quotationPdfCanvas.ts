/**
 * Paints a quotation PDF into page images for the in-app preview modal.
 *
 * The browser's built-in PDF viewer is deliberately not used: inside the
 * preview modal the document used to be embedded in a blob iframe, where the
 * viewer shows an empty dark panel instead of the quotation (and collapses to
 * the iframe's default 300px width). pdfjs-dist — already used by the PDF
 * upload flow — paints every page onto a canvas, so the preview always shows
 * the real document in every browser.
 */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfjsLoadPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  if (!pdfjsLoadPromise) {
    pdfjsLoadPromise = import('pdfjs-dist')
      .then((mod) => {
        pdfjsLib = mod;
        // Self-hosted worker: the CN network often blocks cdnjs, so the local
        // copy has to be the default rather than a CDN fallback.
        mod.GlobalWorkerOptions.workerSrc = workerUrl;
        return mod;
      })
      .catch((err) => {
        // Allow a later retry to start from a clean state.
        pdfjsLoadPromise = null;
        throw err;
      });
  }
  return pdfjsLoadPromise;
}

export interface QuotePdfPreviewPage {
  /** 1-based page number. */
  pageNumber: number;
  /** JPEG data URL of the rendered page. */
  dataUrl: string;
  /** Rendered pixel size (before CSS scaling). */
  width: number;
  height: number;
}

/** A4 at scale 2 ≈ 1190 × 1684 px — sharp on retina, still cheap to encode. */
const PREVIEW_RENDER_SCALE = 2;
const PREVIEW_JPEG_QUALITY = 0.92;

/**
 * Render every page of a PDF into a JPEG data URL.
 * Throws when the PDF cannot be opened or a page cannot be painted.
 */
export async function renderQuotePdfPages(
  source: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<QuotePdfPreviewPage[]> {
  const pdfjs = await getPdfjs();
  // Copy the buffer: pdf.js may detach it while transferring to the worker.
  const data = new Uint8Array(new Uint8Array(source));
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: QuotePdfPreviewPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: PREVIEW_RENDER_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('無法建立 PDF 預覽畫布');

      // PDF pages have no background of their own — without this the dark
      // modal surface would show through the table lines.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // `intent: 'print'` makes pdf.js paint between chunks with setTimeout
      // instead of requestAnimationFrame. rAF is suspended in a background tab,
      // which would leave the preview stuck on「正在生成 PDF 預覽」forever.
      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;

      pages.push({
        pageNumber,
        dataUrl: canvas.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY),
        width: canvas.width,
        height: canvas.height,
      });

      // Release the bitmap as soon as it is encoded.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      onProgress?.(pageNumber, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }

  return pages;
}
