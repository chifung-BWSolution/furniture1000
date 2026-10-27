import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Download, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalContent, ModalRoot } from '@/components/ui/modal';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import { quotePdf } from '@/lib/quotationLocale';
import { buildQuotationPdfFilename } from '@/lib/quotationPdfFilename';
import { renderQuotePdfPages, type QuotePdfPreviewPage } from '@/lib/quotationPdfCanvas';
import { createCanvasTextMeasure, preloadImageSizes, setPdfTextMeasure } from '@/lib/quotationPdfText';
import { QuotationDocument, collectQuotationPdfImageUrls } from './quotationPdfDocument';
import { appendQuoteCatalogPages } from '@/lib/quoteCatalogPages';

export type { QuotationPDFData } from '@/types/quotation-pdf';

/**
 * 共用載入器：回傳已完成字體註冊的 @react-pdf/renderer 模組。
 * 供成功案例導出（caseExportPdf）等其他 PDF 功能復用，避免各自重複註冊字體。
 */
export function ensureQuotationPdfModule(): Promise<ReactPdfModule> {
  return loadReactPdfModule();
}

// ─── Deferred @react-pdf/renderer loading ───────────────────────────────────
// We load @react-pdf/renderer lazily inside the component to avoid
// module-scope crashes (Font.register, StyleSheet.create) that break
// dynamic imports in Vite dev mode.

type ReactPdfModule = Awaited<typeof import('@react-pdf/renderer')>;

let cachedModule: ReactPdfModule | null = null;
let loadPromise: Promise<ReactPdfModule> | null = null;
let fontRegistered = false;

/**
 * Gzip-compressed full TC TTFs plus HK fallback TTFs for code points absent from TC.
 * Native browser decompression restores the original TTF before font registration.
 * The combined Unicode coverage is checked against the original full TTFs.
 *
 * Load order (China / non-Chrome friendly):
 * 1) Same-origin self-hosted files under /fonts/pdf/ (works if the app itself loads)
 * 2) jsDelivr npm mirror (often reachable when fonts.gstatic.com is blocked)
 * 3) Google Fonts gstatic (last resort)
 */
type PdfFontFace = {
  family: 'NotoSansTC' | 'NotoSansHK';
  weight: 400 | 700;
  localPath: string;
  mirrors: string[];
};

/** jsDelivr serves the same self-hosted TTFs from GitHub when gstatic is blocked (e.g. CN). */
const PDF_FONT_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/chifung-BWSolution/furniture1000@main/public/fonts/pdf';

const PDF_FONT_FACES: PdfFontFace[] = [
  {
    family: 'NotoSansTC',
    weight: 400,
    localPath: '/fonts/pdf/NotoSansTC-Regular-v1.ttf.gz',
    mirrors: [
      '/fonts/pdf/NotoSansTC-Regular.ttf',
      `${PDF_FONT_CDN_BASE}/NotoSansTC-Regular.ttf`,
      'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_Co.ttf',
    ],
  },
  {
    family: 'NotoSansTC',
    weight: 700,
    localPath: '/fonts/pdf/NotoSansTC-Bold-v1.ttf.gz',
    mirrors: [
      '/fonts/pdf/NotoSansTC-Bold.ttf',
      `${PDF_FONT_CDN_BASE}/NotoSansTC-Bold.ttf`,
      'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz70e1_Co.ttf',
    ],
  },
  {
    family: 'NotoSansHK',
    weight: 400,
    localPath: '/fonts/pdf/NotoSansHK-Fallback-Regular-v1.ttf',
    mirrors: [
      '/fonts/pdf/NotoSansHK-Regular.ttf',
      `${PDF_FONT_CDN_BASE}/NotoSansHK-Regular.ttf`,
      'https://fonts.gstatic.com/s/notosanshk/v35/nKKF-GM_FYFRJvXzVXaAPe97P1KHynJFP716qHB--oU.ttf',
    ],
  },
  {
    family: 'NotoSansHK',
    weight: 700,
    localPath: '/fonts/pdf/NotoSansHK-Fallback-Bold-v1.ttf',
    mirrors: [
      '/fonts/pdf/NotoSansHK-Bold.ttf',
      `${PDF_FONT_CDN_BASE}/NotoSansHK-Bold.ttf`,
      'https://fonts.gstatic.com/s/notosanshk/v35/nKKF-GM_FYFRJvXzVXaAPe97P1KHynJFP716qJd5-oU.ttf',
    ],
  },
];

/** Per-glyph fallback chain (react-pdf 4+): array form — comma strings are one family name. */
const PDF_FONT_FAMILY = ['NotoSansTC', 'NotoSansHK'] as const;

/** 量測用 CSS 字體家族（只用作 canvas measureText，不會出現在 PDF）。 */
const MEASURE_FONT_FAMILY = 'FdsPdfMeasure';

const FONT_FETCH_TIMEOUT_MS = 30_000;
const PDF_RENDER_TIMEOUT_MS = 90_000;

/** Cached blob: URLs for font files — avoids re-downloading on every preview. */
const fontBlobUrlCache = new Map<string, string>();
const fontBlobUrlPromises = new Map<string, Promise<string>>();

function fontErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/abort|timeout|timed out/i.test(raw)) {
    return 'PDF 字體下載逾時。請檢查網絡後重試（字體已改為優先從本站載入，不依賴 Google）。';
  }
  if (/Failed to fetch|NetworkError|load failed|Font HTTP/i.test(raw)) {
    return '無法載入 PDF 中文字體。請確認可連上本站，或稍後重試。';
  }
  if (/Font family not registered/i.test(raw)) {
    return 'PDF 字體尚未註冊完成，請按「重試」重新載入字體。';
  }
  return raw || 'PDF 字體載入失敗';
}

/** Preview rendering (canvas) failures are not font problems — keep them verbatim. */
function renderFailureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw || 'PDF 預覽頁面繪製失敗';
}

async function fetchFontBlobUrl(url: string): Promise<string> {
  const cached = fontBlobUrlCache.get(url);
  if (cached) return cached;
  const pending = fontBlobUrlPromises.get(url);
  if (pending) return pending;

  const request = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), FONT_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Font HTTP ${res.status}`);
      let blob = await res.blob();
      if (!blob.size) throw new Error('Font file empty');
      // Inspect the bytes: some hosts transparently decode gzip via HTTP headers.
      const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      if (magic[0] === 0x1f && magic[1] === 0x8b) {
        if (typeof DecompressionStream === 'undefined') throw new Error('Native font decompression unavailable');
        blob = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
      }
      const objectUrl = URL.createObjectURL(blob);
      fontBlobUrlCache.set(url, objectUrl);
      return objectUrl;
    } finally {
      window.clearTimeout(timer);
      fontBlobUrlPromises.delete(url);
    }
  })();
  fontBlobUrlPromises.set(url, request);
  return request;
}

/** Try same-origin first, then mirrors (jsDelivr → gstatic). */
async function resolveFontBlobUrl(face: PdfFontFace): Promise<string> {
  const candidates = [face.localPath, ...face.mirrors].filter((url) =>
    typeof DecompressionStream !== 'undefined' || !url.endsWith('.gz'));
  let lastError: unknown;
  for (const url of candidates) {
    try {
      return await fetchFontBlobUrl(url);
    } catch (err) {
      lastError = err;
      console.warn(`[PDF font] failed ${url}:`, err);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`無法載入字型 ${face.family} (${face.weight})`);
}

/**
 * 量測用的字體：把同一批 TTF 註冊到 document.fonts（CSS），
 * 這樣 canvas measureText 得到的字寬與 react-pdf 內嵌字體一致，
 * 逐行高度估算才可靠（PRD 6.2）。
 */
let measureFontPromise: Promise<void> | null = null;

async function ensureMeasureFont(): Promise<void> {
  if (measureFontPromise) return measureFontPromise;
  measureFontPromise = (async () => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
    const faces = await Promise.all(
      PDF_FONT_FACES.filter((face) => face.family === 'NotoSansTC').map(async (face) => ({
        face,
        src: await resolveFontBlobUrl(face),
      })),
    );
    const added = await Promise.all(faces.map(async ({ face, src }) => {
      try {
        const cssFace = new FontFace(MEASURE_FONT_FAMILY, `url(${src})`, {
          weight: String(face.weight),
        });
        await cssFace.load();
        document.fonts.add(cssFace);
        return true;
      } catch (err) {
        console.warn('[PDF measure font] failed:', err);
        return false;
      }
    }));
    if (added.some(Boolean)) {
      const measure = createCanvasTextMeasure(MEASURE_FONT_FAMILY);
      if (measure) setPdfTextMeasure(measure);
    }
  })().catch((err) => {
    console.warn('[PDF measure font] unavailable, falling back to heuristic widths:', err);
  });
  return measureFontPromise;
}

function resolvePdfFonts() {
  return Promise.all(
    PDF_FONT_FACES.map(async (face) => ({
      face,
      src: await resolveFontBlobUrl(face),
    })),
  );
}

async function registerPdfFonts(mod: ReactPdfModule, resolved: Awaited<ReturnType<typeof resolvePdfFonts>>): Promise<void> {
  const byFamily = new Map<string, { src: string; fontWeight: number }[]>();
  for (const { face, src } of resolved) {
    const list = byFamily.get(face.family) ?? [];
    list.push({ src, fontWeight: face.weight });
    byFamily.set(face.family, list);
  }

  for (const [family, fonts] of byFamily) {
    mod.Font.register({ family, fonts });
  }

  // Soft-break CJK per code point (no visible "-"). Latin words stay whole.
  mod.Font.registerHyphenationCallback(pdfSoftBreakNoHyphen);

  // 同一批字體給 canvas 量測用（失敗不影響 PDF 生成）。
  await ensureMeasureFont();
}

/** CJK / Hangul / Kana — need per-glyph soft wrap in narrow PDF cells. */
const PDF_CJK_OR_KANA =
  /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;

/**
 * Soft-wrap without inserting "-" between break segments.
 * Latin / digit runs stay whole (e.g. Limited); CJK soft-breaks per glyph.
 */
function pdfSoftBreakNoHyphen(word: string): string[] {
  if (!word) return [''];
  if (!PDF_CJK_OR_KANA.test(word)) {
    return [word];
  }
  const parts: string[] = [];
  let latin = '';
  for (const ch of Array.from(word)) {
    if (PDF_CJK_OR_KANA.test(ch)) {
      if (latin) {
        parts.push(latin);
        latin = '';
      }
      parts.push(ch, '');
    } else {
      latin += ch;
    }
  }
  if (latin) parts.push(latin);
  return parts.length ? parts : [word];
}

/** Clear failed/partial state so Retry can re-download and re-register fonts. */
function resetPdfLoaderState(mod?: ReactPdfModule | null) {
  try {
    mod?.Font?.clear?.();
  } catch {
    /* ignore */
  }
  fontRegistered = false;
  cachedModule = null;
  loadPromise = null;
  measureFontPromise = null;
  setPdfTextMeasure(null);
}

async function loadReactPdfModule(): Promise<ReactPdfModule> {
  if (cachedModule && fontRegistered) return cachedModule;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      // Fetch fonts while the renderer chunk downloads/evaluates, not afterwards.
      const [mod, resolved] = await Promise.all([
        import('@react-pdf/renderer'),
        resolvePdfFonts(),
      ]);
      if (!fontRegistered) {
        await registerPdfFonts(mod, resolved);
        fontRegistered = true;
        console.log('PDF fonts registered successfully');
      }
      cachedModule = mod;
      return mod;
    } catch (e) {
      // Do not keep a half-ready module cached — Retry must start clean.
      resetPdfLoaderState(cachedModule);
      console.warn('Failed to load PDF renderer/fonts:', e);
      throw new Error(fontErrorMessage(e));
    }
  })();

  try {
    return await loadPromise;
  } finally {
    // If this attempt failed, allow the next call to create a new promise.
    if (!fontRegistered) loadPromise = null;
  }
}

function useReactPdf(reloadToken = 0) {
  const [mod, setMod] = useState<ReactPdfModule | null>(
    cachedModule && fontRegistered ? cachedModule : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!(cachedModule && fontRegistered));

  useEffect(() => {
    let cancelled = false;

    if (cachedModule && fontRegistered) {
      setMod(cachedModule);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setMod(null);

    loadReactPdfModule()
      .then((m) => {
        if (cancelled) return;
        setMod(m);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setMod(null);
        setError(fontErrorMessage(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { mod, loading, error };
}

// ─── Exported Modal Component ────────────────────────────────────────────────

interface QuotationPDFPreviewProps {
  open: boolean;
  onClose: () => void;
  data: QuotationPDFData;
}

export function QuotationPDFPreviewModal({ open, onClose, data }: QuotationPDFPreviewProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [showCnyTotal, setShowCnyTotal] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewPages, setPreviewPages] = useState<QuotePdfPreviewPage[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [pageProgress, setPageProgress] = useState<{ done: number; total: number } | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [fontReloadToken, setFontReloadToken] = useState(0);
  /**
   * Latest quote data. The preview effect must not depend on `data` identity:
   * the parent re-creates the object on every render (autosave ticks), and a
   * new identity rebuilt the whole PDF on every tick.
   */
  const dataRef = useRef(data);
  const { mod: pdfMod, loading, error: moduleError } = useReactPdf(fontReloadToken);
  const labels = quotePdf(data?.locale === 'en' ? 'en' : 'zh');

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (open) setShowCnyTotal(false);
  }, [open]);

  const dataKey = useMemo(() => JSON.stringify(data), [data]);

  const handleRetryPreview = useCallback(() => {
    setRenderError(null);
    resetPdfLoaderState(cachedModule);
    setFontReloadToken((n) => n + 1);
    setRenderAttempt((n) => n + 1);
  }, []);

  const buildPreviewBlob = useCallback(async () => {
    const pdfData = dataRef.current;
    if (!pdfMod || !pdfData) return null;
    let timer: number | undefined;
    try {
      // 先把圖片原始比例與字體量測準備好 —— 分頁與圖例排版都依賴它們。
      await ensureMeasureFont();
      await preloadImageSizes(collectQuotationPdfImageUrls(pdfData), { timeoutMs: 8000, concurrency: 4 });
      const blob = await Promise.race([
        pdfMod
          .pdf(<QuotationDocument data={pdfData} pdfMod={pdfMod} showCnyTotal={showCnyTotal} />)
          .toBlob(),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error('PDF 生成逾時，請檢查網絡後重試。')),
            PDF_RENDER_TIMEOUT_MS,
          );
        }),
      ]);
      const pages = pdfData.catalogPages ?? [];
      if (pages.length === 0) return blob;
      const merged = await appendQuoteCatalogPages(
        await blob.arrayBuffer(),
        pages,
        pdfData.showCatalogSource !== false,
      );
      const bytes = new Uint8Array(merged);
      return new Blob([bytes.buffer], { type: 'application/pdf' });
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }, [pdfMod, showCnyTotal]);

  useEffect(() => {
    if (!open || !pdfMod || !dataKey) return;

    let cancelled = false;
    setRendering(true);
    setRenderError(null);
    setPreviewPages([]);
    setPreviewBlob(null);
    setPageProgress(null);

    (async () => {
      try {
        const blob = await buildPreviewBlob();
        if (cancelled || !blob) return;
        setPreviewBlob(blob);
        // Paint the pages ourselves — the browser PDF plugin shows an empty
        // dark panel when the document is embedded in the modal.
        let timer: number | undefined;
        const pages = await Promise.race([
          renderQuotePdfPages(await blob.arrayBuffer(), (done, total) => {
            if (!cancelled) setPageProgress({ done, total });
          }),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error('PDF 預覽頁面繪製逾時，請按「重試」重新產生。')),
              PDF_RENDER_TIMEOUT_MS,
            );
          }),
        ]).finally(() => {
          if (timer !== undefined) window.clearTimeout(timer);
        });
        if (cancelled) return;
        setPreviewPages(pages);
      } catch (err) {
        if (!cancelled) {
          setRenderError(renderFailureMessage(err));
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, pdfMod, dataKey, renderAttempt, buildPreviewBlob]);

  useEffect(() => {
    if (!open) return;
    return () => {
      setPreviewPages([]);
      setPreviewBlob(null);
      setPageProgress(null);
      setRenderError(null);
      setRendering(false);
    };
  }, [open]);

  const handleDownload = async () => {
    if (!pdfMod) return;
    setIsDownloading(true);
    try {
      const blob = previewBlob ?? (await buildPreviewBlob());
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildQuotationPdfFilename(
        data?.quoteMeta?.quoteNumber || 'Draft',
        data?.quoteMeta?.version,
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const combinedError = moduleError || renderError;
  const downloadDisabled = isDownloading || loading || !previewBlob;

  if (!open) return null;

  return (
    <ModalRoot open onOpenChange={(next) => { if (!next) onClose(); }}>
      <ModalContent
        hideClose
        variant="bleed"
        size="full"
        className="max-w-[1100px]"
        /* `bleed` centres its body; the PDF surface has to fill the whole
           modal, otherwise the viewer collapses to the 300px intrinsic width
           of a canvas/iframe and the A4 page cannot be read. */
        bodyClassName="flex flex-col items-stretch justify-start overflow-hidden p-0 sm:p-0"
        style={{ height: '92vh', width: '90vw' }}
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{labels.modalTitle}</h2>
            <p className="font-body text-xs text-muted-foreground">{labels.modalSubtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowCnyTotal((prev) => !prev)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-body text-sm font-semibold transition-all active:scale-[0.98]",
                showCnyTotal
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:bg-accent",
              )}
            >
              {labels.addCnyTotal}
            </button>
            <button
              onClick={handleDownload}
              disabled={downloadDisabled}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {labels.downloadPdf}
            </button>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* PDF Viewer — pages painted with pdf.js into <img> elements.
            The browser PDF plugin cannot be used here: embedded in this modal
            it renders an empty dark panel instead of the document. */}
        <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-b-2xl bg-neutral-800 p-4">
          {loading && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-white">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
              <p className="text-sm">正在載入 PDF 字體與引擎…</p>
              <p className="max-w-sm text-center text-xs text-neutral-400">
                首次需下載中文字體，之後會重用快取
              </p>
            </div>
          )}
          {combinedError && !loading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
              <p className="text-sm">PDF 預覽失敗</p>
              <p className="max-w-md text-center text-xs text-neutral-400">{combinedError}</p>
              <button
                type="button"
                onClick={handleRetryPreview}
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                重試
              </button>
            </div>
          )}
          {rendering && !loading && !combinedError && (
            <div className="absolute inset-4 z-10 flex flex-col items-center justify-center rounded-lg bg-neutral-800/95 text-white gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
              <p className="text-sm font-medium">正在生成 PDF 預覽...</p>
              <p className="text-xs text-neutral-400">
                {pageProgress
                  ? `正在繪製預覽頁面 ${pageProgress.done} / ${pageProgress.total}`
                  : '字體與圖片已就緒，正在排版文件'}
              </p>
            </div>
          )}
          {previewPages.length > 0 && !combinedError && (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <div className="mx-auto flex w-full max-w-[980px] flex-col items-center gap-4 pb-4">
                {previewPages.map((page) => (
                  <img
                    key={page.pageNumber}
                    src={page.dataUrl}
                    alt={`${labels.modalTitle} — ${page.pageNumber}`}
                    className="h-auto w-full rounded-lg bg-white shadow-xl"
                    style={{ aspectRatio: `${page.width} / ${page.height}` }}
                  />
                ))}
              </div>
            </div>
          )}
          {pdfMod && !data && !loading && (
            <div className="flex h-full items-center justify-center text-white">
              <p>No data available for PDF preview</p>
            </div>
          )}
        </div>
      </ModalContent>
    </ModalRoot>
  );
}
