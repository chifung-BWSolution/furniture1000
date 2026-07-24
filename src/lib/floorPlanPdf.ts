/**
 * PDF floor-plan helpers using lazy-loaded pdfjs-dist.
 * Renders pages to JPEG blobs for thumbnails / in-app viewing.
 */

let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfjsLoadPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  if (!pdfjsLoadPromise) {
    pdfjsLoadPromise = import('pdfjs-dist').then((mod) => {
      pdfjsLib = mod;
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
      return mod;
    });
  }
  return pdfjsLoadPromise;
}

async function toArrayBuffer(source: File | ArrayBuffer | string): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(new Uint8Array(source)).buffer;
  }
  if (source instanceof File) {
    return source.arrayBuffer();
  }
  const value = source.trim();
  if (value.startsWith('data:')) {
    const base64 = value.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  const response = await fetch(value);
  if (!response.ok) {
    throw new Error(`無法載入 PDF（${response.status}）`);
  }
  return response.arrayBuffer();
}

export async function getPdfPageCount(
  source: File | ArrayBuffer | string,
): Promise<number> {
  const pdfjs = await getPdfjs();
  const data = await toArrayBuffer(source);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const count = pdf.numPages;
  await pdf.destroy();
  return count;
}

/** Render one PDF page to a JPEG Blob for Storage / <img> display. */
export async function renderPdfPageToJpegBlob(
  source: File | ArrayBuffer | string,
  pageNumber = 1,
  options?: { scale?: number; quality?: number },
): Promise<{ blob: Blob; pageCount: number; width: number; height: number }> {
  const scale = options?.scale ?? 1.5;
  const quality = options?.quality ?? 0.86;
  const pdfjs = await getPdfjs();
  const data = await toArrayBuffer(source);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(`PDF 頁碼無效：${pageNumber}`);
    }
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法建立畫布');
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('PDF 轉圖失敗'))),
        'image/jpeg',
        quality,
      );
    });
    page.cleanup();
    return {
      blob,
      pageCount: pdf.numPages,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    await pdf.destroy();
  }
}

/** Render every page (capped) for the in-app floor-plan viewer. */
export async function renderPdfPagesToObjectUrls(
  source: File | ArrayBuffer | string,
  options?: { scale?: number; maxPages?: number },
): Promise<string[]> {
  const maxPages = options?.maxPages ?? 8;
  const pageCount = await getPdfPageCount(source);
  const urls: string[] = [];
  const limit = Math.min(pageCount, maxPages);
  for (let page = 1; page <= limit; page++) {
    const { blob } = await renderPdfPageToJpegBlob(source, page, {
      scale: options?.scale ?? 1.35,
    });
    urls.push(URL.createObjectURL(blob));
  }
  return urls;
}
