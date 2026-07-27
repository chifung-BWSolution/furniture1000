import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Download, Loader2, AlertTriangle } from 'lucide-react';
import type { QuotationDimensionMode, QuotationPDFData } from '@/types/quotation-pdf';
import { parseRemarksContent } from '@/lib/remarksContent';
import { multiColorToChineseDisplay } from '@/constants/color-map';
import { normalizeQuotationPdfGlyphs, pdfDisplayText } from '@/lib/quotationPdfGlyphs';
import { quoteItemLineSubtotal } from '@/lib/quoteItemTotals';
import { buildQuotationPdfFilename } from '@/lib/quotationPdfFilename';
import { quotePdf, type QuotePdfLabels } from '@/lib/quotationLocale';
import {
  formatSectionTitleLabel,
  productSerialAt,
  sectionTitleOrdinalAt,
} from '@/lib/quoteSectionTitle';

export type { QuotationPDFData } from '@/types/quotation-pdf';

// ─── Deferred @react-pdf/renderer loading ───────────────────────────────────
// We load @react-pdf/renderer lazily inside the component to avoid
// module-scope crashes (Font.register, StyleSheet.create) that break
// dynamic imports in Vite dev mode.

type ReactPdfModule = Awaited<typeof import('@react-pdf/renderer')>;

let cachedModule: ReactPdfModule | null = null;
let loadPromise: Promise<ReactPdfModule> | null = null;
let fontRegistered = false;

/**
 * Full Noto Sans TC/HK static TTFs (not language-subset builds).
 * Subsets miss HK glyphs such as 枱 (U+67B1).
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
    localPath: '/fonts/pdf/NotoSansTC-Regular.ttf',
    mirrors: [
      `${PDF_FONT_CDN_BASE}/NotoSansTC-Regular.ttf`,
      'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_Co.ttf',
    ],
  },
  {
    family: 'NotoSansTC',
    weight: 700,
    localPath: '/fonts/pdf/NotoSansTC-Bold.ttf',
    mirrors: [
      `${PDF_FONT_CDN_BASE}/NotoSansTC-Bold.ttf`,
      'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz70e1_Co.ttf',
    ],
  },
  {
    family: 'NotoSansHK',
    weight: 400,
    localPath: '/fonts/pdf/NotoSansHK-Regular.ttf',
    mirrors: [
      `${PDF_FONT_CDN_BASE}/NotoSansHK-Regular.ttf`,
      'https://fonts.gstatic.com/s/notosanshk/v35/nKKF-GM_FYFRJvXzVXaAPe97P1KHynJFP716qHB--oU.ttf',
    ],
  },
  {
    family: 'NotoSansHK',
    weight: 700,
    localPath: '/fonts/pdf/NotoSansHK-Bold.ttf',
    mirrors: [
      `${PDF_FONT_CDN_BASE}/NotoSansHK-Bold.ttf`,
      'https://fonts.gstatic.com/s/notosanshk/v35/nKKF-GM_FYFRJvXzVXaAPe97P1KHynJFP716qJd5-oU.ttf',
    ],
  },
];

/** Per-glyph fallback chain (react-pdf 4+): array form — comma strings are one family name. */
const PDF_FONT_FAMILY = ['NotoSansTC', 'NotoSansHK'] as const;

const FONT_FETCH_TIMEOUT_MS = 30_000;
const PDF_RENDER_TIMEOUT_MS = 90_000;

/** Cached blob: URLs for font files — avoids re-downloading on every preview. */
const fontBlobUrlCache = new Map<string, string>();

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

async function fetchFontBlobUrl(url: string): Promise<string> {
  const cached = fontBlobUrlCache.get(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FONT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Font HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error('Font file empty');
    const objectUrl = URL.createObjectURL(blob);
    fontBlobUrlCache.set(url, objectUrl);
    return objectUrl;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Try same-origin first, then mirrors (jsDelivr → gstatic). */
async function resolveFontBlobUrl(face: PdfFontFace): Promise<string> {
  const candidates = [face.localPath, ...face.mirrors];
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

async function registerPdfFonts(mod: ReactPdfModule): Promise<void> {
  const resolved = await Promise.all(
    PDF_FONT_FACES.map(async (face) => ({
      face,
      src: await resolveFontBlobUrl(face),
    })),
  );

  const byFamily = new Map<string, { src: string; fontWeight: number }[]>();
  for (const { face, src } of resolved) {
    const list = byFamily.get(face.family) ?? [];
    list.push({ src, fontWeight: face.weight });
    byFamily.set(face.family, list);
  }

  for (const [family, fonts] of byFamily) {
    mod.Font.register({ family, fonts });
  }

  // Soft-break CJK per code point (no visible "-"). Latin words stay whole so
  // EN text wraps on word boundaries (e.g. "medium", not "mediu"/"m").
  mod.Font.registerHyphenationCallback(pdfSoftBreakNoHyphen);
}

/** CJK / Hangul / Kana — need per-glyph soft wrap in narrow PDF cells. */
const PDF_CJK_OR_KANA =
  /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;

/**
 * Soft-wrap without inserting "-" between break segments.
 * - Latin / digit runs: keep the whole word (wrap only at spaces).
 * - CJK (and mixed tokens containing CJK): soft-break after each code point.
 */
function pdfSoftBreakNoHyphen(word: string): string[] {
  if (!word) return [''];
  if (!PDF_CJK_OR_KANA.test(word)) {
    return [word];
  }
  const chars = Array.from(word);
  return chars.flatMap((ch) => [ch, '']);
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
}

async function loadReactPdfModule(): Promise<ReactPdfModule> {
  if (cachedModule && fontRegistered) return cachedModule;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const mod = await import('@react-pdf/renderer');
      if (!fontRegistered) {
        await registerPdfFonts(mod);
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

// ─── HTML → PDF text helper ───────────────────────────────────────────────────

/** Inline segment with formatting info */
interface PdfInlineSegment {
  text: string;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  /** True when this segment is an underlined blank (fill-in-the-blank line) */
  underlineBlank?: boolean;
}

/** Parsed block element for PDF rendering */
interface PdfBlock {
  type: 'heading' | 'text' | 'spacer';
  segments: PdfInlineSegment[];
}

/** Parse a Tiptap HTML string into rich blocks with inline formatting for PDF rendering */
function parseHtmlForPdf(html: string): PdfBlock[] {
  if (!html || typeof html !== 'string') return [];
  
  // Pre-process: convert spaces inside <u> tags to \u00A0 BEFORE DOMParser
  // This prevents the browser's HTML parser from collapsing whitespace
  const preprocessed = html.replace(/<u([^>]*)>([\s\S]*?)<\/u>/gi, (_match, attrs: string, inner: string) => {
    // Convert &nbsp; to \u00A0
    let content = inner.replace(/&nbsp;/g, '\u00A0');
    // Convert regular spaces to \u00A0 to prevent DOM collapse
    content = content.replace(/ /g, '\u00A0');
    return `<u${attrs}>${content}</u>`;
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(preprocessed, 'text/html');
  const results: PdfBlock[] = [];

  /** Extract inline segments from an element, preserving bold/underline/italic */
  const extractInlineSegments = (node: Node, inherited: { bold?: boolean; underline?: boolean; italic?: boolean } = {}): PdfInlineSegment[] => {
    const segments: PdfInlineSegment[] = [];

    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || '';
      // Remove word-joiners (\u2060) used to prevent TipTap collapse
      // Convert em-spaces (\u2003) and nbsp (\u00A0) to regular spaces
      let text = raw.replace(/\u2060/g, '').replace(/[\u2003\u00A0]/g, ' ');
      // For underlined segments that are only whitespace, mark as underlineBlank
      // so the renderer can use borderBottom instead of textDecoration
      if (inherited.underline && text.trim().length === 0 && text.length > 0) {
        // Use non-breaking spaces (\u00A0) so PDF renderer doesn't collapse them
        text = '\u00A0'.repeat(Math.max(text.length, 30));
        segments.push({ text, ...inherited, underlineBlank: true });
        return segments;
      }
      if (text.length > 0) {
        segments.push({ text: normalizeQuotationPdfGlyphs(text), ...inherited });
      }
      return segments;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      // Determine formatting from this element
      const fmt = { ...inherited };
      if (tag === 'strong' || tag === 'b') fmt.bold = true;
      if (tag === 'u') fmt.underline = true;
      if (tag === 'em' || tag === 'i') fmt.italic = true;
      // Check for style attribute (TipTap sometimes uses inline styles)
      const style = el.getAttribute('style') || '';
      if (style.includes('text-decoration') && style.includes('underline')) fmt.underline = true;
      if (style.includes('font-weight') && (style.includes('bold') || style.includes('700'))) fmt.bold = true;
      if (style.includes('font-style') && style.includes('italic')) fmt.italic = true;

      if (tag === 'br') {
        segments.push({ text: '\n', ...inherited });
        return segments;
      }

      // Recurse into children
      el.childNodes.forEach(child => {
        segments.push(...extractInlineSegments(child, fmt));
      });
    }

    return segments;
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeQuotationPdfGlyphs(node.textContent?.trim() || '');
      if (text) results.push({ type: 'text', segments: [{ text }] });
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        const segments = extractInlineSegments(el);
        if (segments.length > 0) results.push({ type: 'heading', segments });
      } else if (tag === 'p') {
        const segments = extractInlineSegments(el);
        const hasContent = segments.some(
          (s) => s.text.trim().length > 0 || s.underline || s.underlineBlank,
        );
        if (hasContent) {
          results.push({ type: 'text', segments });
        } else {
          // TipTap uses empty <p> / <p><br></p> for intentional blank lines between sections
          results.push({ type: 'spacer', segments: [] });
        }
      } else if (tag === 'li') {
        const segments = extractInlineSegments(el);
        // Prepend bullet
        if (segments.length > 0) {
          results.push({ type: 'text', segments: [{ text: '• ' }, ...segments] });
        }
      } else if (tag === 'br') {
        // skip standalone line breaks
      } else {
        // For ul, ol, div, blockquote, etc. — recurse into children
        el.childNodes.forEach(walk);
      }
    }
  };

  doc.body.childNodes.forEach(walk);
  return results;
}

/** Render plain-text term lines, preserving intentional blank lines as vertical spacers */
function renderPlainTermLines(
  text: string | undefined,
  keyPrefix: string,
  Text: ReactPdfModule['Text'],
  View: ReactPdfModule['View'],
) {
  return (text || '').split('\n').map((line, i) =>
    line.trim()
      ? <Text key={`${keyPrefix}-${i}`} style={styles.termItem}>{normalizeQuotationPdfGlyphs(line)}</Text>
      : <View key={`${keyPrefix}-${i}`} style={styles.termSpacer} />,
  );
}

function dimensionPdfSubLabel(mode?: QuotationDimensionMode): string {
  return mode === 'dh' ? 'DIA * H' : 'W*D*H';
}

function formatItemDimensions(item: QuotationPDFData['items'][0] | undefined): string {
  if (!item) return '';
  const mode = item.dimensionMode ?? 'lwh';
  const parts: string[] = [];
  const push = (v: string | number | null | undefined) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s) parts.push(s);
  };
  if (mode === 'dh') {
    push(item.dimensionLMm);
    push(item.dimensionHMm);
  } else {
    push(item.dimensionLMm);
    push(item.dimensionWMm);
    push(item.dimensionHMm);
  }
  return parts.length > 0 ? parts.join('*') : '';
}

/**
 * Wrap L×W×H only when the string exceeds the column. Each dimension number stays intact;
 * breaks occur at * boundaries (e.g. 1800*750* / 750, or 1800*750 / *750).
 */
function wrapDimensionsForPdf(dimText: string, maxChars = DESC_DIM_MAX_CHARS): string[] {
  const trimmed = dimText.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const parts = trimmed.split('*').filter((part) => part.length > 0);
  if (parts.length <= 1) return [trimmed];

  const lines: string[] = [];
  let line = '';
  let idx = 0;

  while (idx < parts.length) {
    const num = parts[idx];
    const isLast = idx === parts.length - 1;
    const withStar = isLast ? num : `${num}*`;

    const appendIfFits = (suffix: string): string | null => {
      const next = line + suffix;
      return next.length <= maxChars ? next : null;
    };

    const withFull = appendIfFits(withStar);
    if (withFull !== null) {
      line = withFull;
      idx += 1;
      continue;
    }

    if (!isLast) {
      const withoutStar = appendIfFits(num);
      if (withoutStar !== null) {
        lines.push(withoutStar);
        const tailParts = parts.slice(idx + 1);
        const tailLines = wrapDimensionsForPdf(tailParts.join('*'), maxChars);
        if (tailLines.length > 0) {
          tailLines[0] = `*${tailLines[0]}`;
        }
        lines.push(...tailLines);
        return lines;
      }
    }

    if (line) {
      lines.push(line);
      line = '';
      continue;
    }

    lines.push(withStar);
    idx += 1;
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [trimmed];
}

function renderDescDimensionsValue(
  dimText: string,
  dimSubLabel: string,
  View: ReactPdfModule['View'],
  Text: ReactPdfModule['Text'],
  locale: 'zh' | 'en' = 'zh',
) {
  const valuePct = `${PDF_DESC_VALUE_PCT[locale] * 100}%`;
  const lines = wrapDimensionsForPdf(dimText, descDimMaxChars(locale));
  return (
    <View style={{ width: valuePct, minWidth: 0, paddingHorizontal: 2, paddingVertical: 2 }}>
      <Text style={styles.descDimLabelText}>{dimSubLabel}</Text>
      {lines.map((line, li) => (
        <Text
          key={`dim-line-${li}`}
          wrap={false}
          style={styles.descDimValueText}
          hyphenationCallback={pdfSoftBreakNoHyphen}
        >
          {pdfDisplayText(line)}
        </Text>
      ))}
    </View>
  );
}

type QuotationItem = QuotationPDFData['items'][0];

const TABLE_BORDER = '#333';
const MATERIAL_BLANK_LINE_HEIGHT = 7 * 1.45;
// A4 content width ≈ 555pt (595 − 20×2 horizontal padding)
const PDF_TABLE_WIDTH_PT = 555;
const REMARKS_COL_WIDTH_PT = PDF_TABLE_WIDTH_PT * 0.09;
const ILLUSTRATION_COL_WIDTH_PT = PDF_TABLE_WIDTH_PT * 0.114;

/**
 * EN needs a slightly wider Description column so category/dimension values fit.
 * Transfer just enough width from Materials & Details (sum stays 41.6%).
 * ZH: slightly wider 說明 (+0.8pp from 單價) so ~6 CJK chars fit in 類別 value.
 */
const PDF_COL_DESC_PCT = { zh: 0.132, en: 0.195 } as const;
const PDF_COL_MATERIAL_PCT = { zh: 0.292, en: 0.221 } as const;
/**
 * Label / value split inside Description (column width unchanged).
 * Labels are fixed short text (Category / Dimensions\\n(mm) / Color) — keep them
 * tight with small padding; give the rest to data. ZH ≈ 4:6; EN ≈ 32:68.
 */
const PDF_DESC_LABEL_PCT = { zh: 0.4, en: 0.32 } as const;
const PDF_DESC_VALUE_PCT = { zh: 0.6, en: 0.68 } as const;
/** 單價 column — ZH trimmed to fund wider 說明 (EN unchanged). */
const PDF_COL_UNIT_PRICE_PCT = { zh: 0.097, en: 0.105 } as const;

function pdfColWidthPct(locale: 'zh' | 'en', key: 'desc' | 'material' | 'unitPrice'): string {
  const pct =
    key === 'desc'
      ? PDF_COL_DESC_PCT[locale]
      : key === 'material'
        ? PDF_COL_MATERIAL_PCT[locale]
        : PDF_COL_UNIT_PRICE_PCT[locale];
  return `${(pct * 100).toFixed(1)}%`;
}

/** 說明欄規格值半寬 — 保守估算每行字元上限，避免 PDF 再二次折行 */
function descDimMaxChars(locale: 'zh' | 'en' = 'zh'): number {
  const valueWidthPt =
    PDF_TABLE_WIDTH_PT * PDF_COL_DESC_PCT[locale] * PDF_DESC_VALUE_PCT[locale];
  return Math.max(6, Math.floor(valueWidthPt / 3.8));
}

const DESC_DIM_MAX_CHARS = descDimMaxChars('zh');

/** Preserve user line breaks from the draft editor (single Enter = one line). */
function normalizeMaterialForPdf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function renderMaterialPdfContent(
  material: string | undefined,
  View: ReactPdfModule['View'],
  Text: ReactPdfModule['Text'],
) {
  const body = normalizeMaterialForPdf(material || '');
  if (!body.trim()) return null;

  const lines = body.split('\n');
  return (
    <View style={{ width: '100%' }}>
      {lines.map((line, i) => {
        if (line === '') {
          return (
            <View
              key={`material-blank-${i}`}
              style={{ width: '100%', height: MATERIAL_BLANK_LINE_HEIGHT }}
            />
          );
        }
        return (
          <Text
            key={`material-line-${i}`}
            style={styles.materialCellText}
            hyphenationCallback={pdfSoftBreakNoHyphen}
          >
            {pdfDisplayText(line)}
          </Text>
        );
      })}
    </View>
  );
}

/** Shared border for each table band — bottom line closes the row at page breaks. */
const tableBandBorder = {
  borderTopWidth: 0.5,
  borderLeftWidth: 0.5,
  borderRightWidth: 0.5,
  borderBottomWidth: 0.5,
  borderColor: TABLE_BORDER,
};

function pdfRemarksImageHeight(imageCount: number): number {
  if (imageCount <= 0) return 0;
  const ratio = imageCount === 1 ? 1.15 : 0.9;
  return Math.round(REMARKS_COL_WIDTH_PT * ratio);
}

function pdfIllustrationImageHeight(dual: boolean): number {
  return Math.round(ILLUSTRATION_COL_WIDTH_PT * (dual ? 0.72 : 0.85));
}

function renderSubtotalPdfCell(
  item: QuotationItem,
  View: ReactPdfModule['View'],
  Text: ReactPdfModule['Text'],
  labels: QuotePdfLabels,
) {
  if (item?.isOptional) {
    return (
      <View style={styles.colSubtotal}>
        <Text style={styles.tableCellText}>{labels.optionalProduct}</Text>
      </View>
    );
  }

  return (
    <View style={styles.colSubtotal}>
      <Text style={styles.tableCellText}>
        HK${quoteItemLineSubtotal(item).toLocaleString()}
      </Text>
    </View>
  );
}

function renderQuotationTableRow(
  item: QuotationItem,
  idx: number,
  items: QuotationItem[],
  View: ReactPdfModule['View'],
  Text: ReactPdfModule['Text'],
  Image: ReactPdfModule['Image'],
  labels: QuotePdfLabels,
  locale: 'zh' | 'en',
) {
  if (item?.isSectionTitle) {
    const label = formatSectionTitleLabel(
      sectionTitleOrdinalAt(items, idx),
      item?.name || '',
    );
    return (
      <View style={{ ...styles.tableRow, minHeight: 22, backgroundColor: '#f3f3f3' }} key={idx} wrap={false}>
        <View
          style={{
            width: '100%',
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 5,
            paddingBottom: 5,
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 9,
              fontWeight: 700,
              textAlign: 'left',
              lineHeight: 1.35,
            }}
          >
            {pdfDisplayText(label)}
          </Text>
        </View>
      </View>
    );
  }

  const serial = productSerialAt(items, idx);

  if (item?.isCustomTerm) {
    return (
      <View style={{ ...styles.tableRow, minHeight: 28 }} key={idx} wrap={false}>
        <View style={styles.colIndex}><Text style={styles.tableCellText}>{serial}</Text></View>
        <View style={{ width: '62%', paddingLeft: 6, paddingRight: 6, paddingTop: 6, paddingBottom: 6, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
          <Text style={styles.tableCellTextLeft}>{pdfDisplayText(item?.name || '')}</Text>
        </View>
        <View style={styles.colQty}><Text style={styles.tableCellText}>{item?.quantity || 0}</Text></View>
        <View style={styles.colUnit}><Text style={styles.tableCellText}>{pdfDisplayText(item?.unit || '')}</Text></View>
        <View style={{ ...styles.colUnitPrice, width: pdfColWidthPct(locale, 'unitPrice') }}>
          <Text style={styles.tableCellText}>HK${(item?.unitPrice || 0).toLocaleString()}</Text>
        </View>
        {renderSubtotalPdfCell(item, View, Text, labels)}
      </View>
    );
  }

  return (
    <View style={styles.tableRow} key={idx} wrap={false}>
      <View style={styles.colIndex}><Text style={styles.tableCellText}>{serial}</Text></View>
      <View style={{ ...styles.colDesc, width: pdfColWidthPct(locale, 'desc') }}>
        {renderDescriptionPdfContent(item, View, Text, labels, locale)}
      </View>
      <View style={{ ...styles.colMaterial, width: pdfColWidthPct(locale, 'material') }}>
        {renderMaterialPdfContent(item?.material, View, Text)}
      </View>
      <View style={styles.colRemarks}>
        <View style={{ width: '100%', flex: 1 }}>
          {renderRemarksPdfContent(item?.remarks, item?.remarksImage, View, Image, Text)}
        </View>
      </View>
      <View style={styles.colImage}>
        <View style={{ width: '100%', flex: 1 }}>
          {renderIllustrationPdfContent(item?.image, item?.referenceImage, View, Image, Text)}
        </View>
      </View>
      <View style={styles.colQty}><Text style={styles.tableCellText}>{item?.quantity || 0}</Text></View>
      <View style={styles.colUnit}><Text style={styles.tableCellText}>{pdfDisplayText(item?.unit || '')}</Text></View>
      <View style={{ ...styles.colUnitPrice, width: pdfColWidthPct(locale, 'unitPrice') }}>
        <Text style={styles.tableCellText}>HK${(item?.unitPrice || 0).toLocaleString()}</Text>
      </View>
      {renderSubtotalPdfCell(item, View, Text, labels)}
    </View>
  );
}

function renderRemarksPdfContent(
  remarks: string | undefined,
  legacyImage: string | undefined,
  View: ReactPdfModule['View'],
  Image: ReactPdfModule['Image'],
  Text: ReactPdfModule['Text'],
) {
  const blocks = parseRemarksContent(remarks, legacyImage).filter(
    (block) =>
      (block.type === 'text' && block.content.trim()) || block.type === 'image',
  );

  if (blocks.length === 0) return null;

  const imageCount = blocks.filter((b) => b.type === 'image').length;
  const remarkImgHeight = pdfRemarksImageHeight(imageCount);

  return (
    <View style={{ width: '100%', flex: 1, flexDirection: 'column' }}>
      {blocks.map((block, i) => (
        <View
          key={`remarks-block-${i}`}
          style={block.type === 'image' ? styles.cellImageSlot : styles.cellStackSlot}
        >
          {block.type === 'text' ? (
            <Text style={styles.remarksCellText}>{pdfDisplayText(block.content)}</Text>
          ) : (
            <Image
              src={block.src}
              style={{ width: '100%', height: remarkImgHeight, objectFit: 'contain' }}
            />
          )}
        </View>
      ))}
    </View>
  );
}

function renderIllustrationPdfContent(
  productImage: string | undefined,
  referenceImage: string | undefined,
  View: ReactPdfModule['View'],
  Image: ReactPdfModule['Image'],
  Text: ReactPdfModule['Text'],
) {
  const hasProduct = Boolean(productImage?.trim());
  const hasReference = Boolean(referenceImage?.trim());

  if (!hasProduct && !hasReference) {
    return null;
  }

  const dual = hasProduct && hasReference;
  const imgHeight = pdfIllustrationImageHeight(dual);
  const imgStyle = { width: '100%', height: imgHeight, objectFit: 'contain' as const };

  if (dual) {
    return (
      <View style={{ width: '100%', flex: 1, flexDirection: 'column', justifyContent: 'center' }}>
        <View style={styles.cellImageSlot}>
          <Image src={productImage!} style={imgStyle} />
        </View>
        <View style={styles.cellImageSlot}>
          <Image src={referenceImage!} style={imgStyle} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ width: '100%', flex: 1, flexDirection: 'column', justifyContent: 'center' }}>
      <View style={styles.cellImageSlot}>
        <Image src={(productImage || referenceImage)!} style={imgStyle} />
      </View>
    </View>
  );
}

function renderDescriptionPdfContent(
  item: QuotationPDFData['items'][0] | undefined,
  View: ReactPdfModule['View'],
  Text: ReactPdfModule['Text'],
  labels: QuotePdfLabels,
  locale: 'zh' | 'en',
) {
  const dimText = formatItemDimensions(item);
  const dimSubLabel = dimensionPdfSubLabel(item?.dimensionMode);
  const colorValue =
    locale === 'en'
      ? (item?.color || '')
      : multiColorToChineseDisplay(item?.color || '');
  const labelPct = `${PDF_DESC_LABEL_PCT[locale] * 100}%`;
  const valuePct = `${PDF_DESC_VALUE_PCT[locale] * 100}%`;
  const rows: Array<
    | { kind: 'category'; label: string; value: string }
    | { kind: 'simple'; label: string; value: string }
    | { kind: 'dimensions'; label: string; dimText: string; dimSubLabel: string }
  > = [
    { kind: 'category', label: labels.descCategory, value: item?.category || '' },
    { kind: 'dimensions', label: labels.descDimensions, dimText, dimSubLabel },
    { kind: 'simple', label: labels.descColor, value: colorValue },
  ];

  return (
    <View style={{ width: '100%', flexDirection: 'column' }}>
      {rows.map((row, i) => (
        <View
          key={row.label}
          style={{
            flexDirection: 'row',
            alignItems:
              row.kind === 'category' || row.kind === 'dimensions' ? 'flex-start' : 'center',
            flexGrow: 0,
            flexShrink: 0,
            minHeight: row.kind === 'simple' ? 18 : undefined,
            borderBottomWidth: i < rows.length - 1 ? 0.5 : 0,
            borderColor: '#ddd',
          }}
        >
          <View
            style={{
              width: labelPct,
              justifyContent:
                row.kind === 'category' || row.kind === 'dimensions' ? 'flex-start' : 'center',
              alignItems: 'center',
              paddingHorizontal: 2,
              paddingTop: row.kind === 'category' || row.kind === 'dimensions' ? 4 : 0,
              paddingBottom: row.kind === 'category' ? 4 : 0,
              borderRightWidth: 0.5,
              borderColor: '#ddd',
            }}
          >
            {row.kind === 'dimensions' ? (
              <View style={{ alignItems: 'center' }}>
                {row.label.split('\n').map((line, li) => (
                  <Text key={`dim-label-${li}`} style={styles.tableCellText} wrap={false}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={styles.tableCellText}>{row.label}</Text>
            )}
          </View>
          {row.kind === 'dimensions' ? (
            renderDescDimensionsValue(row.dimText, row.dimSubLabel, View, Text, locale)
          ) : row.kind === 'category' ? (
            <View style={{ width: valuePct, justifyContent: 'flex-start', paddingHorizontal: 2, paddingVertical: 2 }}>
              <Text
                style={styles.descCategoryValueText}
                hyphenationCallback={pdfSoftBreakNoHyphen}
              >
                {pdfDisplayText(row.value)}
              </Text>
            </View>
          ) : (
            <View style={{ width: valuePct, justifyContent: 'center', paddingHorizontal: 2 }}>
              <Text style={styles.descValueText} hyphenationCallback={pdfSoftBreakNoHyphen}>
                {pdfDisplayText(row.value)}
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Styles (plain object — StyleSheet.create is a pass-through) ─────────────

const styles: Record<string, any> = {
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 8, lineHeight: 1.4, paddingTop: 22, paddingBottom: 50, paddingHorizontal: 20, color: '#1a1a1a' },
  headerBlock: { marginBottom: 8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 130, height: 32, objectFit: 'contain', marginBottom: 4 },
  titleCenter: { fontSize: 16, fontWeight: 700, textAlign: 'center', lineHeight: 1.3, marginBottom: 0 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  infoLeft: { width: '45%' },
  infoRight: { width: '50%' },
  infoLine: { fontSize: 8, marginBottom: 1, lineHeight: 1.5 },
  infoBold: { fontWeight: 700 },
  table: { width: '100%', marginTop: 8 },
  tableHeader: { display: 'flex', flexDirection: 'row', backgroundColor: '#f5f5f5', minHeight: 24, alignItems: 'center', ...tableBandBorder },
  tableRow: { display: 'flex', flexDirection: 'row', minHeight: 60, alignItems: 'stretch', ...tableBandBorder },
  colIndex: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colDesc: { width: '13.2%', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'stretch', borderRightWidth: 0.5, borderColor: '#ddd' },
  colMaterial: { width: '29.2%', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignSelf: 'stretch', borderRightWidth: 0.5, borderColor: '#ddd' },
  colRemarks: { width: '9%', paddingLeft: 2, paddingRight: 2, paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'stretch', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colImage: { width: '11.4%', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'stretch', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colQty: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colUnit: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colUnitPrice: { width: '9.7%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colSubtotal: { width: '12.5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', paddingVertical: 4 },
  tableHeaderText: { fontSize: 6.5, fontWeight: 700, textAlign: 'center', lineHeight: 1.4 },
  tableCellText: { fontSize: 7, textAlign: 'center', lineHeight: 1.3 },
  tableCellTextLeft: { fontSize: 7, textAlign: 'left', lineHeight: 1.45, paddingLeft: 4 },
  materialCellText: { fontSize: 7, textAlign: 'left', lineHeight: 1.45, width: '100%' },
  descValueText: { fontSize: 6.5, textAlign: 'left', lineHeight: 1.3, paddingLeft: 2 },
  descMultilineValueText: { fontSize: 6.5, textAlign: 'left', lineHeight: 1.35, paddingLeft: 2, width: '100%' },
  /** 類別 — fixed column width, height grows with wrapped CJK text. */
  descCategoryValueText: { fontSize: 6.5, textAlign: 'left', lineHeight: 1.35, paddingLeft: 2, width: '100%' },
  descDimLabelText: { fontSize: 6, textAlign: 'left', lineHeight: 1.2, paddingLeft: 2, color: '#555' },
  descDimValueText: { fontSize: 6, lineHeight: 1.25, textAlign: 'left', paddingLeft: 2 },
  cellStackSlot: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', paddingVertical: 2, paddingHorizontal: 2 },
  cellImageSlot: { width: '100%', justifyContent: 'center', alignItems: 'center', paddingVertical: 2, paddingHorizontal: 2 },
  cellStackImage: { width: '100%', maxHeight: '100%', objectFit: 'contain' },
  remarksCellText: { fontSize: 7, textAlign: 'center', lineHeight: 1.3 },
  installRow: { flexDirection: 'row', minHeight: 28, ...tableBandBorder },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6, paddingRight: 4 },
  totalLabel: { fontSize: 10, fontWeight: 700, marginRight: 8, lineHeight: 1.4 },
  totalValue: { fontSize: 10, fontWeight: 700, lineHeight: 1.4 },
  sectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 16, marginBottom: 4, lineHeight: 1.4 },
  sectionText: { fontSize: 7.5, lineHeight: 1.8, marginBottom: 2 },
  boldText: { fontWeight: 700 },
  termsTitle: { fontSize: 9, fontWeight: 700, marginTop: 8, marginBottom: 6, textDecoration: 'underline', lineHeight: 1.4 },
  termItem: { fontSize: 7, lineHeight: 1.7, marginBottom: 1.5, textAlign: 'left' },
  termSpacer: { height: 10 },
  termSubTitle: { fontSize: 8, fontWeight: 700, marginTop: 8, marginBottom: 3, lineHeight: 1.4 },
  // Keep the signature block compact enough to stay on the same page as the
  // terms (with wrap={false}). The previous marginTop 36 + signatureMiddle 70
  // made the block ~130pt tall, which overflowed and got pushed to a new page.
  signatureSection: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, paddingTop: 8 },
  signatureBlock: { width: '45%' },
  signatureTitle: { fontSize: 9, fontWeight: 700, marginBottom: 6, lineHeight: 1.4 },
  signatureLabel: { fontSize: 8, lineHeight: 1.4 },
  // Gap between 客戶授權人姓名及簽名 and the signature underline (was 70).
  signatureMiddle: { height: 36, position: 'relative' },
  signatureLine: { borderBottomWidth: 0.5, borderColor: '#333', marginBottom: 4 },
  signatureDate: { fontSize: 7, color: '#666', lineHeight: 1.4 },
  stamp: { width: 64, height: 64, objectFit: 'contain', position: 'absolute', bottom: 0, right: 0, opacity: 0.85 },
};

// ─── QuotationDocument (uses PDF primitives from module) ─────────────────────

function QuotationDocument({ data, pdfMod }: { data: QuotationPDFData; pdfMod: ReactPdfModule }) {
  const { Document, Page, Text, View, Image } = pdfMod;

  if (!data) {
    return (
      <Document>
        <Page size="A4" style={styles.page}>
          <Text>Loading Data...</Text>
        </Page>
      </Document>
    );
  }

  const locale = data.locale === 'en' ? 'en' : 'zh';
  const labels = quotePdf(locale);

  const today =
    data.quoteMeta?.date ||
    new Date().toLocaleDateString(locale === 'en' ? 'en-GB' : 'zh-HK', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  const quoteNumber = data.quoteMeta?.quoteNumber || '';
  const discountValue = (() => {
    const raw = data.discountNote;
    if (raw == null) return 0;
    const n = parseFloat(String(raw));
    return isNaN(n) ? 0 : n;
  })();
  const isFreeInstallation = (data.subtotal || 0) >= 12000;
  const installationAmount = isFreeInstallation ? 0 : (data.installationFee?.amount ?? 0);
  const installFeeRaw = data.installationFee?.amount;
  const grandTotal = Math.max(0, (data.subtotal || 0) - discountValue + installationAmount);
  const items = data.items || [];

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://26c0258f-253c-4e4e-9027-922d08aab63f.canvases.tempo.build';
  const logoUrl = `${baseUrl}/assets/bwf-logo.png`;

  const fallbackTermsHeadings =
    locale === 'en'
      ? {
          deliveryAddress: '1　Delivery Address: ',
          deliveryAddressFallback:
            'Customer must provide an accurate delivery address. This quotation applies to standard areas in Hong Kong.',
          payment: '2　Payment Terms',
          transport: '3　Transport & Installation Terms',
          extraFees: '4　Additional Charges',
          warranty: '5　Warranty & Maintenance',
          other: '6　Others',
        }
      : {
          deliveryAddress: '1　交付地址: ',
          deliveryAddressFallback: '客戶須提供準確交付地址。本報價適用於香港標準地區。',
          payment: '2　付款條款',
          transport: '3　運輸及安裝條款',
          extraFees: '4　額外費用',
          warranty: '5　保養及維修',
          other: '6　其他',
        };

  const renderTableHeader = () => (
    <View style={styles.tableHeader}>
      <View style={styles.colIndex}><Text style={styles.tableHeaderText}>{labels.colNo}</Text></View>
      <View style={{ ...styles.colDesc, width: pdfColWidthPct(locale, 'desc') }}>
        <Text style={styles.tableHeaderText}>{labels.colDesc}</Text>
      </View>
      <View style={{ ...styles.colMaterial, width: pdfColWidthPct(locale, 'material') }}>
        <Text style={styles.tableHeaderText}>{labels.colMaterial}</Text>
      </View>
      <View style={styles.colRemarks}><Text style={styles.tableHeaderText}>{labels.colRemarks}</Text></View>
      <View style={styles.colImage}><Text style={styles.tableHeaderText}>{labels.colImage}</Text></View>
      <View style={styles.colQty}><Text style={styles.tableHeaderText}>{labels.colQty}</Text></View>
      <View style={styles.colUnit}><Text style={styles.tableHeaderText}>{labels.colUnit}</Text></View>
      <View style={{ ...styles.colUnitPrice, width: pdfColWidthPct(locale, 'unitPrice') }}>
        <Text style={styles.tableHeaderText}>{labels.colUnitPrice}</Text>
      </View>
      <View style={styles.colSubtotal}><Text style={styles.tableHeaderText}>{labels.colTotal}</Text></View>
    </View>
  );

  const renderInstallRow = () => (
    <View style={styles.installRow} wrap={false}>
      <View style={{ width: '57%', padding: 4, justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
        <Text style={{ fontSize: 7, fontWeight: 700, lineHeight: 1.4 }}>{pdfDisplayText(data.installationFee?.title || labels.installTitle)}</Text>
        <Text style={{ fontSize: 6.5, color: '#666', lineHeight: 1.4 }}>{pdfDisplayText(data.installationFee?.subtitle || labels.installSubtitle)}</Text>
      </View>
      <View style={{ width: '20%', padding: 4, justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
        <Text style={{ fontSize: 6.5, textAlign: 'center', lineHeight: 1.4 }}>
          {pdfDisplayText(data.installationFee?.conditionText || labels.installCondition)}
        </Text>
      </View>
      <View style={{ width: '10.5%', padding: 4, justifyContent: 'center', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
        <Text style={styles.tableCellText}>{isFreeInstallation ? 'FREE' : ''}</Text>
      </View>
      <View style={{ width: '12.5%', padding: 4, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={styles.tableCellText}>
          {isFreeInstallation
            ? 'FREE'
            : installFeeRaw === null || installFeeRaw === undefined
              ? ''
              : installFeeRaw === 0
                ? 'HK$0'
                : `HK$${Number(installFeeRaw).toLocaleString()}`}
        </Text>
      </View>
    </View>
  );

  return (
    <Document>
      {/* Page 1 - Product Table */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBlock}>
          <View style={styles.headerRow}>
            <Image src={logoUrl} style={styles.logo} />
          </View>
          <Text style={styles.titleCenter}>{labels.title}</Text>
        </View>
        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            {(
              [
                [labels.customerCompanyName, data.clientInfo?.name],
                [labels.customerName, data.clientInfo?.contactName],
                [labels.customerPhone, data.clientInfo?.phone],
                [labels.customerEmail, data.clientInfo?.email],
                [labels.quotationNo, quoteNumber],
                [labels.date, today],
                [labels.projectInCharge, data.quoteMeta?.pmName],
              ] as Array<[string, string | undefined | null]>
            )
              .filter(([, value]) => Boolean(String(value ?? '').trim()))
              .map(([label, value]) => (
                <Text key={label} style={styles.infoLine}>
                  {label}: {pdfDisplayText(String(value).trim())}
                </Text>
              ))}
          </View>
          <View style={styles.infoRight}>
            {(
              [
                [labels.company, data.companyInfo?.name],
                [labels.address, data.companyInfo?.address],
                [labels.tel, data.companyInfo?.phone],
                [labels.email, data.companyInfo?.email],
                [labels.website, data.companyInfo?.website],
              ] as Array<[string, string | undefined | null]>
            )
              .filter(([, value]) => Boolean(String(value ?? '').trim()))
              .map(([label, value]) => (
                <Text key={label} style={styles.infoLine}>
                  {label}: {pdfDisplayText(String(value).trim())}
                </Text>
              ))}
          </View>
        </View>

        <View style={styles.table}>
          {renderTableHeader()}
          {items.map((item, idx) =>
            renderQuotationTableRow(
              item,
              idx,
              items,
              View,
              Text,
              Image,
              labels,
              locale,
            ),
          )}
          {renderInstallRow()}
        </View>

        {discountValue > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4, paddingRight: 4 }}>
            <Text
              style={{
                fontSize: 8,
                marginRight: 8,
                lineHeight: 1.4,
                width: locale === 'en' ? 92 : 60,
                textAlign: 'right',
              }}
              wrap={false}
            >
              Discount:
            </Text>
            <Text style={{ fontSize: 8, lineHeight: 1.4, width: 90, textAlign: 'right' }}>HK${discountValue.toLocaleString()}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2, paddingRight: 4, alignItems: 'flex-end' }}>
          <Text
            style={{
              ...styles.totalLabel,
              width: locale === 'en' ? 92 : 60,
              textAlign: 'right',
              marginRight: 8,
            }}
            wrap={false}
          >
            {labels.grandTotal}:
          </Text>
          <View style={{ borderBottomWidth: 1, borderBottomColor: TABLE_BORDER, minWidth: 90, paddingBottom: 1 }}>
            <Text style={{ ...styles.totalValue, width: 90, textAlign: 'right' }}>HK${grandTotal.toLocaleString()}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{labels.deliveryTitle}</Text>
        <Text style={styles.sectionText}>{pdfDisplayText(data.deliveryDetails || '')}</Text>

        <Text style={styles.termsTitle}>{labels.termsTitle}</Text>

        {data.termsContent?.fullHtml && (data.termsContent.fullHtml.replace(/<[^>]*>/g, '').replace(/\s/g, '').length > 0 || /<u[^>]*>/i.test(data.termsContent.fullHtml)) ? (
          parseHtmlForPdf(data.termsContent.fullHtml).map((item, i) => {
            if (item.type === 'spacer') {
              return <View key={i} style={styles.termSpacer} />;
            }

            const hasUnderlineBlank = item.segments.some(s => s.underlineBlank);
            const baseStyle = item.type === 'heading' ? styles.termSubTitle : styles.termItem;

            if (hasUnderlineBlank) {
              const viewStyle: any = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: baseStyle.marginBottom || 0, marginTop: baseStyle.marginTop || 0 };
              const textBaseStyle: any = { fontSize: baseStyle.fontSize || 7, lineHeight: baseStyle.lineHeight || 1.7, fontWeight: baseStyle.fontWeight };
              return (
                <View key={i} style={viewStyle}>
                  {item.segments.map((seg, j) => {
                    if (seg.underlineBlank) {
                      return (
                        <View key={j} style={{ borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a', flexGrow: 1, minWidth: 120, height: (baseStyle.fontSize || 7) + 2, marginBottom: 0 }} />
                      );
                    }
                    const segStyle: any = { ...textBaseStyle };
                    if (seg.bold) segStyle.fontWeight = 700;
                    if (seg.underline) segStyle.textDecoration = 'underline';
                    if (seg.italic) segStyle.fontStyle = 'italic';
                    return <Text key={j} style={segStyle}>{seg.text}</Text>;
                  })}
                </View>
              );
            }

            return (
              <Text key={i} style={baseStyle}>
                {item.segments.map((seg, j) => {
                  const segStyle: any = {};
                  if (seg.bold) segStyle.fontWeight = 700;
                  if (seg.underline) segStyle.textDecoration = 'underline';
                  if (seg.italic) segStyle.fontStyle = 'italic';
                  return Object.keys(segStyle).length > 0
                    ? <Text key={j} style={segStyle}>{seg.text}</Text>
                    : seg.text;
                })}
              </Text>
            );
          })
        ) : (
          <>
            <Text style={styles.termItem}>
              <Text style={styles.boldText}>{fallbackTermsHeadings.deliveryAddress}</Text>
              {pdfDisplayText(data.quoteMeta?.deliveryAddress || fallbackTermsHeadings.deliveryAddressFallback)}
            </Text>

            <Text style={styles.termSubTitle}>{fallbackTermsHeadings.payment}</Text>
            {renderPlainTermLines(data.termsContent?.payment, 'payment', Text, View)}

            <Text style={styles.termSubTitle}>{fallbackTermsHeadings.transport}</Text>
            {renderPlainTermLines(data.termsContent?.transport, 'transport', Text, View)}

            <Text style={styles.termSubTitle}>{fallbackTermsHeadings.extraFees}</Text>
            {renderPlainTermLines(data.termsContent?.extraFees, 'extraFees', Text, View)}

            <Text style={styles.termSubTitle}>{fallbackTermsHeadings.warranty}</Text>
            {renderPlainTermLines(data.termsContent?.warranty, 'warranty', Text, View)}

            <Text style={styles.termSubTitle}>{fallbackTermsHeadings.other}</Text>
            {renderPlainTermLines(data.termsContent?.other, 'other', Text, View)}
          </>
        )}

        <View style={styles.signatureSection} wrap={false} minPresenceAhead={20}>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureTitle}>{labels.customerAcceptance}</Text>
            <Text style={styles.signatureLabel}>{labels.customerSignLabel}</Text>
            <View style={styles.signatureMiddle} />
            <View style={styles.signatureLine} />
            <Text style={styles.signatureDate}>{labels.dateOfSignature}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

// ─── Exported Modal Component ────────────────────────────────────────────────

interface QuotationPDFPreviewProps {
  open: boolean;
  onClose: () => void;
  data: QuotationPDFData;
}

export function QuotationPDFPreviewModal({ open, onClose, data }: QuotationPDFPreviewProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [fontReloadToken, setFontReloadToken] = useState(0);
  const previewUrlRef = useRef<string | null>(null);
  const { mod: pdfMod, loading, error: moduleError } = useReactPdf(fontReloadToken);
  const labels = quotePdf(data?.locale === 'en' ? 'en' : 'zh');

  const dataKey = useMemo(() => JSON.stringify(data), [data]);

  const handleRetryPreview = useCallback(() => {
    setRenderError(null);
    resetPdfLoaderState(cachedModule);
    setFontReloadToken((n) => n + 1);
    setRenderAttempt((n) => n + 1);
  }, []);

  const buildPreviewBlob = useCallback(async () => {
    if (!pdfMod || !data) return null;
    return Promise.race([
      pdfMod.pdf(<QuotationDocument data={data} pdfMod={pdfMod} />).toBlob(),
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error('PDF 生成逾時，請檢查網絡後重試。')),
          PDF_RENDER_TIMEOUT_MS,
        );
      }),
    ]);
  }, [pdfMod, data]);

  useEffect(() => {
    if (!open || !pdfMod || !data) return;

    let cancelled = false;
    setRendering(true);
    setRenderError(null);
    setPreviewUrl(null);

    (async () => {
      try {
        const blob = await buildPreviewBlob();
        if (cancelled || !blob) return;
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        const objectUrl = URL.createObjectURL(blob);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setRenderError(fontErrorMessage(err));
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
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewUrl(null);
      setRenderError(null);
      setRendering(false);
    };
  }, [open]);

  const handleDownload = async () => {
    if (!pdfMod) return;
    setIsDownloading(true);
    try {
      const blob = previewUrl
        ? await fetch(previewUrl).then((r) => r.blob())
        : await buildPreviewBlob();
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
  const downloadDisabled = isDownloading || loading || !!combinedError || !previewUrl;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[92vh] w-[90vw] max-w-[1100px] flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{labels.modalTitle}</h2>
            <p className="font-body text-xs text-muted-foreground">{labels.modalSubtitle}</p>
          </div>
          <div className="flex items-center gap-3">
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

        {/* PDF Viewer — blob iframe (more reliable than react-pdf PDFViewer) */}
        <div className="relative flex-1 overflow-hidden rounded-b-2xl bg-neutral-800 p-4" style={{ minHeight: '800px' }}>
          {loading && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-white">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
              <p className="text-sm">正在載入 PDF 字體與引擎…</p>
              <p className="max-w-sm text-center text-xs text-neutral-400">
                字體優先從本站載入，不依賴 Google；首次約需數秒至半分鐘
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
              <p className="text-xs text-neutral-400">字體已就緒，正在排版文件</p>
            </div>
          )}
          {previewUrl && !combinedError && (
            <iframe
              title={labels.modalTitle}
              src={`${previewUrl}#toolbar=0&navpanes=0`}
              className="h-full w-full rounded-lg border-0 bg-white"
            />
          )}
          {previewUrl && !combinedError && (
            <div className="absolute inset-x-4 bottom-4 z-20 flex justify-center">
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloadDisabled}
                className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-card/95 px-5 py-2.5 font-body text-sm font-semibold text-foreground shadow-lg backdrop-blur-sm transition-all hover:bg-card active:scale-[0.98] disabled:opacity-60"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {labels.downloadPdf}
              </button>
            </div>
          )}
          {pdfMod && !data && !loading && (
            <div className="flex h-full items-center justify-center text-white">
              <p>No data available for PDF preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
