import { useState, useEffect, useRef } from 'react';
import { X, Download, Loader2, AlertTriangle } from 'lucide-react';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import { parseRemarksContent } from '@/lib/remarksContent';
import { multiColorToChineseDisplay } from '@/constants/color-map';
import { normalizeQuotationPdfGlyphs, pdfDisplayText } from '@/lib/quotationPdfGlyphs';

export type { QuotationPDFData } from '@/types/quotation-pdf';

// ─── Deferred @react-pdf/renderer loading ───────────────────────────────────
// We load @react-pdf/renderer lazily inside the component to avoid
// module-scope crashes (Font.register, StyleSheet.create) that break
// dynamic imports in Vite dev mode.

type ReactPdfModule = Awaited<typeof import('@react-pdf/renderer')>;

let cachedModule: ReactPdfModule | null = null;
let loadPromise: Promise<ReactPdfModule> | null = null;
let fontRegistered = false;

// Primary: the FULL Google Noto Sans TC static TTF (~6.8MB each weight).
// IMPORTANT: do NOT use the fontsource "language subset" builds
// (…/noto-sans-tc@latest/chinese-traditional-400-normal.ttf or the HK subset) —
// those subsets are MISSING HK/Cantonese Han glyphs such as 枱 (U+67B1), which then
// render as a wrong glyph (e.g. ±) in the PDF. The full gstatic TTF below contains
// 枱 and the complete Traditional Chinese repertoire (verified by cmap inspection).
const NOTO_SANS_TC_REGULAR = 'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_Co.ttf';
const NOTO_SANS_TC_BOLD = 'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz70e1_Co.ttf';
// Full Noto Sans SC (not a language subset) — fallback when TC lacks a glyph entirely.
const NOTO_SANS_SC_REGULAR =
  'https://fonts.gstatic.com/ea/notosanssc/v1/NotoSansSC-Regular.otf';
const NOTO_SANS_SC_BOLD =
  'https://fonts.gstatic.com/ea/notosanssc/v1/NotoSansSC-Bold.otf';

async function loadReactPdfModule(): Promise<ReactPdfModule> {
  if (cachedModule) return cachedModule;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const mod = await import('@react-pdf/renderer');
    cachedModule = mod;
    if (!fontRegistered) {
      try {
        // Primary: full Noto Sans TC — covers the complete Traditional repertoire
        // including HK-specific Han glyphs like 枱.
        mod.Font.register({
          family: 'NotoSansTC',
          fonts: [
            { src: NOTO_SANS_TC_REGULAR, fontWeight: 400 },
            { src: NOTO_SANS_TC_BOLD, fontWeight: 700 },
          ],
        });
        // Fallback: full Noto Sans SC for glyphs absent from TC. Wrong-glyph cases
        // (e.g. 爲 → "2") are handled by normalizeQuotationPdfGlyphs() before render.
        // (cast: react-pdf's types omit the runtime-supported `fallback` flag.)
        mod.Font.register({
          family: 'NotoSansSC',
          fallback: true,
          fonts: [
            { src: NOTO_SANS_SC_REGULAR, fontWeight: 400 },
            { src: NOTO_SANS_SC_BOLD, fontWeight: 700 },
          ],
        } as Parameters<typeof mod.Font.register>[0]);
        mod.Font.registerHyphenationCallback((word: string) => {
          // Allow CJK line breaks in narrow cells without inserting "-" at wrap points.
          // Each char followed by '' gives break opportunities; empty segments are not rendered.
          const cjk = /[\u3000-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
          if (!cjk.test(word)) return [word];
          const parts: string[] = [];
          let latin = '';
          for (const ch of word) {
            if (cjk.test(ch)) {
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
        });
        fontRegistered = true;
        console.log('PDF fonts registered successfully');
      } catch (e) {
        console.warn('Failed to register PDF fonts:', e);
      }
    }
    return mod;
  })();

  return loadPromise;
}

function useReactPdf() {
  const [mod, setMod] = useState<ReactPdfModule | null>(cachedModule);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedModule) {
      setMod(cachedModule);
      return;
    }
    let cancelled = false;
    loadReactPdfModule()
      .then((m) => { if (!cancelled) setMod(m); })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, []);

  return { mod, loading: !mod && !error, error };
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

function wrapDimensionsAtStars(dimText: string, maxChars = 11): string[] {
  if (!dimText) return [];
  if (dimText.length <= maxChars) return [dimText];

  const parts = dimText.split('*').filter(Boolean);
  if (parts.length <= 1) return [dimText];

  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < parts.length; i++) {
    const withStar = i < parts.length - 1 ? `${parts[i]}*` : parts[i];
    const combined = current ? `${current}${withStar}` : withStar;
    if (combined.length > maxChars && current) {
      lines.push(current);
      current = withStar;
    } else {
      current = combined;
    }
  }
  if (current) lines.push(current);
  return lines;
}

type QuotationItem = QuotationPDFData['items'][0];

const TABLE_BORDER = '#333';
const MATERIAL_FONT_SIZE = 7;
const MATERIAL_LINE_HEIGHT = 1.35;
const MATERIAL_BLANK_LINE_HEIGHT = MATERIAL_FONT_SIZE * MATERIAL_LINE_HEIGHT;
// A4 content width ≈ 555pt (595 − 20×2 horizontal padding)
const PDF_TABLE_WIDTH_PT = 555;
const REMARKS_COL_WIDTH_PT = PDF_TABLE_WIDTH_PT * 0.09;
const ILLUSTRATION_COL_WIDTH_PT = PDF_TABLE_WIDTH_PT * 0.114;

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
        const display = pdfDisplayText(line);
        return (
          <View key={`material-line-${i}`} style={styles.materialLineRow}>
            {Array.from(display).map((ch, j) => (
              <Text key={j} style={styles.materialCellChar}>{ch}</Text>
            ))}
          </View>
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

function renderQuotationTableRow(
  item: QuotationItem,
  idx: number,
  formatDimensions: (item: QuotationItem | undefined) => string,
  View: ReactPdfModule['View'],
  Text: ReactPdfModule['Text'],
  Image: ReactPdfModule['Image'],
) {
  if (item?.isCustomTerm) {
    return (
      <View style={{ ...styles.tableRow, minHeight: 28 }} key={idx} wrap={false}>
        <View style={styles.colIndex}><Text style={styles.tableCellText}>{idx + 1}</Text></View>
        <View style={{ width: '62%', paddingLeft: 6, paddingRight: 6, paddingTop: 6, paddingBottom: 6, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
          <Text style={styles.tableCellTextLeft}>{pdfDisplayText(item?.name || '')}</Text>
        </View>
        <View style={styles.colQty}><Text style={styles.tableCellText}>{item?.quantity || 0}</Text></View>
        <View style={styles.colUnit}><Text style={styles.tableCellText}>{pdfDisplayText(item?.unit || '')}</Text></View>
        <View style={styles.colUnitPrice}><Text style={styles.tableCellText}>HK${(item?.unitPrice || 0).toLocaleString()}</Text></View>
        <View style={styles.colSubtotal}><Text style={styles.tableCellText}>HK${((item?.unitPrice || 0) * (item?.quantity || 0)).toLocaleString()}</Text></View>
      </View>
    );
  }

  return (
    <View style={styles.tableRow} key={idx} wrap={false}>
      <View style={styles.colIndex}><Text style={styles.tableCellText}>{idx + 1}</Text></View>
      <View style={styles.colDesc}>
        {renderDescriptionPdfContent(item, formatDimensions, View, Text)}
      </View>
      <View style={styles.colMaterial}>
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
      <View style={styles.colUnitPrice}><Text style={styles.tableCellText}>HK${(item?.unitPrice || 0).toLocaleString()}</Text></View>
      <View style={styles.colSubtotal}><Text style={styles.tableCellText}>HK${((item?.unitPrice || 0) * (item?.quantity || 0)).toLocaleString()}</Text></View>
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
  formatDimensions: (item: QuotationPDFData['items'][0] | undefined) => string,
  View: ReactPdfModule['View'],
  Text: ReactPdfModule['Text'],
) {
  const dimText = formatDimensions(item);
  const rows: Array<
    | { kind: 'category'; label: string; value: string }
    | { kind: 'simple'; label: string; value: string }
    | { kind: 'dimensions'; label: string; dimText: string }
  > = [
    { kind: 'category', label: '\u985E\u5225', value: item?.category || '' },
    { kind: 'dimensions', label: '\u898F\u683C(mm)', dimText },
    { kind: 'simple', label: '\u984F\u8272', value: multiColorToChineseDisplay(item?.color || '') },
  ];

  return (
    <View style={{ width: '100%', flexDirection: 'column' }}>
      {rows.map((row, i) => (
        <View
          key={row.label}
          style={{
            flexDirection: 'row',
            alignItems: row.kind === 'category' ? 'flex-start' : 'center',
            flexGrow: 0,
            flexShrink: 0,
            minHeight: row.kind === 'dimensions' ? 26 : row.kind === 'simple' ? 18 : undefined,
            borderBottomWidth: i < rows.length - 1 ? 0.5 : 0,
            borderColor: '#ddd',
          }}
        >
          <View
            style={{
              width: '50%',
              justifyContent: row.kind === 'category' ? 'flex-start' : 'center',
              alignItems: 'center',
              paddingHorizontal: 2,
              paddingTop: row.kind === 'category' ? 4 : 0,
              paddingBottom: row.kind === 'category' ? 4 : 0,
              borderRightWidth: 0.5,
              borderColor: '#ddd',
            }}
          >
            <Text style={styles.tableCellText}>{row.label}</Text>
          </View>
          {row.kind === 'dimensions' ? (
            <View style={{ width: '50%', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 1 }}>
              <Text style={styles.descDimLabelText}>W*D*H</Text>
              {row.dimText
                ? wrapDimensionsAtStars(row.dimText).map((line, li) => (
                    <Text key={`dim-line-${li}`} style={styles.descDimValueText}>
                      {pdfDisplayText(line)}
                    </Text>
                  ))
                : null}
            </View>
          ) : row.kind === 'category' ? (
            <View style={{ width: '50%', justifyContent: 'flex-start', paddingHorizontal: 2, paddingVertical: 2 }}>
              <Text
                style={styles.descCategoryValueText}
                hyphenationCallback={(word) => Array.from(word)}
              >
                {pdfDisplayText(row.value)}
              </Text>
            </View>
          ) : (
            <View style={{ width: '50%', justifyContent: 'center', paddingHorizontal: 2 }}>
              <Text style={styles.descValueText}>{pdfDisplayText(row.value)}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Styles (plain object — StyleSheet.create is a pass-through) ─────────────

const styles: Record<string, any> = {
  page: { fontFamily: 'NotoSansTC', fontSize: 8, lineHeight: 1.4, paddingTop: 22, paddingBottom: 50, paddingHorizontal: 20, color: '#1a1a1a' },
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
  colDesc: { width: '12.4%', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'stretch', borderRightWidth: 0.5, borderColor: '#ddd' },
  colMaterial: { width: '29.2%', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignSelf: 'stretch', borderRightWidth: 0.5, borderColor: '#ddd' },
  colRemarks: { width: '9%', paddingLeft: 2, paddingRight: 2, paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'stretch', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colImage: { width: '11.4%', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'stretch', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colQty: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colUnit: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colUnitPrice: { width: '10.5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colSubtotal: { width: '12.5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', paddingVertical: 4 },
  tableHeaderText: { fontSize: 6.5, fontWeight: 700, textAlign: 'center', lineHeight: 1.4 },
  tableCellText: { fontSize: 7, textAlign: 'center', lineHeight: 1.3 },
  tableCellTextLeft: { fontSize: 7, textAlign: 'left', lineHeight: 1.45, paddingLeft: 4 },
  materialCellText: { fontSize: 7, textAlign: 'left', lineHeight: 1.45, width: '100%' },
  materialLineRow: { flexDirection: 'row', flexWrap: 'wrap', width: '100%' },
  materialCellChar: { fontSize: MATERIAL_FONT_SIZE, lineHeight: MATERIAL_LINE_HEIGHT, textAlign: 'left' },
  descValueText: { fontSize: 6.5, textAlign: 'left', lineHeight: 1.3, paddingLeft: 2 },
  descMultilineValueText: { fontSize: 6.5, textAlign: 'left', lineHeight: 1.35, paddingLeft: 2, width: '100%' },
  /** 類別 — fixed column width, height grows with wrapped CJK text. */
  descCategoryValueText: { fontSize: 6.5, textAlign: 'left', lineHeight: 1.35, paddingLeft: 2, width: '100%' },
  descDimLabelText: { fontSize: 6, textAlign: 'left', lineHeight: 1.2, paddingLeft: 2, color: '#555' },
  descDimValueText: { fontSize: 6, textAlign: 'left', lineHeight: 1.2, paddingLeft: 2, width: '100%' },
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

  const today = data.quoteMeta?.date || new Date().toLocaleDateString('zh-HK', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const quoteNumber = data.quoteMeta?.quoteNumber || '';
  const discountValue = (() => {
    const raw = data.discountNote;
    if (raw == null) return 0;
    const n = parseFloat(String(raw));
    return isNaN(n) ? 0 : n;
  })();
  const isFreeInstallation = (data.subtotal || 0) >= 12000;
  const installationAmount = isFreeInstallation ? 0 : (data.installationFee?.amount ?? 0);
  const grandTotal = Math.max(0, (data.subtotal || 0) - discountValue + installationAmount);
  const items = data.items || [];

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://26c0258f-253c-4e4e-9027-922d08aab63f.canvases.tempo.build';
  const logoUrl = `${baseUrl}/assets/bwf-logo.png`;

  const formatDimensions = (item: QuotationPDFData['items'][0]) => {
    if (!item) return '';
    const parts: string[] = [];
    if (item.dimensionLMm) parts.push(String(item.dimensionLMm));
    if (item.dimensionWMm) parts.push(String(item.dimensionWMm));
    if (item.dimensionHMm) parts.push(String(item.dimensionHMm));
    return parts.length > 0 ? parts.join('*') : '';
  };

  const renderTableHeader = () => (
    <View style={styles.tableHeader}>
      <View style={styles.colIndex}><Text style={styles.tableHeaderText}>{'\u5E8F\u865F'}</Text></View>
      <View style={styles.colDesc}><Text style={styles.tableHeaderText}>{'\u8AAA\u660E'}</Text></View>
      <View style={styles.colMaterial}><Text style={styles.tableHeaderText}>{'\u6750\u8CEA\u53CA\u660E\u7D30'}</Text></View>
      <View style={styles.colRemarks}><Text style={styles.tableHeaderText}>{'\u5099\u6CE8'}</Text></View>
      <View style={styles.colImage}><Text style={styles.tableHeaderText}>{'\u5716\u4F8B'}</Text></View>
      <View style={styles.colQty}><Text style={styles.tableHeaderText}>{'\u6578\u91CF'}</Text></View>
      <View style={styles.colUnit}><Text style={styles.tableHeaderText}>{'\u55AE\u4F4D'}</Text></View>
      <View style={styles.colUnitPrice}><Text style={styles.tableHeaderText}>{'\u55AE\u50F9 (HKD)'}</Text></View>
      <View style={styles.colSubtotal}><Text style={styles.tableHeaderText}>{'\u7E3D\u50F9 (HKD)'}</Text></View>
    </View>
  );

  const renderInstallRow = () => (
    <View style={styles.installRow} wrap={false}>
      <View style={{ width: '57%', padding: 4, justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
        <Text style={{ fontSize: 7, fontWeight: 700, lineHeight: 1.4 }}>{pdfDisplayText(data.installationFee?.title || '\u50A2\u4FF1\u5B89\u88DD\u8CBB\u7528')}</Text>
        <Text style={{ fontSize: 6.5, color: '#666', lineHeight: 1.4 }}>{pdfDisplayText(data.installationFee?.subtitle || '\u5B89\u88DD\u6E05\u55AE\u4E2D\u50A2\u4FF1\u7522\u54C1\u4E26\u6E05\u7406\u5305\u88DD\u5783\u573E')}</Text>
      </View>
      <View style={{ width: '20%', padding: 4, justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
        <Text style={{ fontSize: 6.5, textAlign: 'center', lineHeight: 1.4 }}>
          {pdfDisplayText(data.installationFee?.conditionText || '\u8A02\u55AE\u7E3D\u91D1\u984D\u6EFF HK$12,000\n\u5C07\u4E0D\u6536\u53D6\u5B89\u88DD\u8CBB\u7528')}
        </Text>
      </View>
      <View style={{ width: '10.5%', padding: 4, justifyContent: 'center', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
        <Text style={styles.tableCellText}>{isFreeInstallation ? 'FREE' : pdfDisplayText(data.installationFee?.freeLabel || '\u53E6\u8B70')}</Text>
      </View>
      <View style={{ width: '12.5%', padding: 4, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={styles.tableCellText}>
          {isFreeInstallation
            ? 'FREE'
            : installationAmount > 0
              ? `HK$${installationAmount.toLocaleString()}`
              : pdfDisplayText(data.installationFee?.chargeLabel || '\u53E6\u8B70')}
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
          <Text style={styles.titleCenter}>{'\u50A2\u4FF1\u5831\u50F9\u55AE'}</Text>
        </View>
        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <Text style={styles.infoLine}>{'\u5BA2\u6236\u540D\u7A31'}: {pdfDisplayText(data.clientInfo?.name || '')}</Text>
            <Text style={styles.infoLine}>{'\u5BA2\u6236\u96FB\u8A71'}: {pdfDisplayText(data.clientInfo?.phone || '')}</Text>
            <Text style={styles.infoLine}>{'\u5831\u50F9\u55AE\u865F'}: {quoteNumber}</Text>
            <Text style={styles.infoLine}>{'\u65E5\u3000\u671F'}: {today}</Text>
            <Text style={styles.infoLine}>{'\u9805\u76EE\u8CA0\u8CAC\u4EBA'}: {pdfDisplayText(data.quoteMeta?.pmName || '')}</Text>
          </View>
          <View style={styles.infoRight}>
            <Text style={styles.infoLine}>{'\u516C\u53F8'}: {pdfDisplayText(data.companyInfo?.name || '')}</Text>
            <Text style={styles.infoLine}>{'\u5730\u5740'}: {pdfDisplayText(data.companyInfo?.address || '')}</Text>
            <Text style={styles.infoLine}>{'\u96FB\u8A71'}: {pdfDisplayText(data.companyInfo?.phone || '')}</Text>
            <Text style={styles.infoLine}>{'\u96FB\u90F5'}: {pdfDisplayText(data.companyInfo?.email || '')}</Text>
            <Text style={styles.infoLine}>{'\u7DB2\u7AD9'}: {pdfDisplayText(data.companyInfo?.website || '')}</Text>
          </View>
        </View>

        <View style={styles.table}>
          {renderTableHeader()}
          {items.map((item, idx) =>
            renderQuotationTableRow(
              item,
              idx,
              formatDimensions,
              View,
              Text,
              Image,
            ),
          )}
          {renderInstallRow()}
        </View>

        {discountValue > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4, paddingRight: 4 }}>
            <Text style={{ fontSize: 8, marginRight: 8, lineHeight: 1.4, width: 60, textAlign: 'right' }}>Discount:</Text>
            <Text style={{ fontSize: 8, lineHeight: 1.4, width: 90, textAlign: 'right' }}>HK${discountValue.toLocaleString()}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2, paddingRight: 4, alignItems: 'flex-end' }}>
          <Text style={{ ...styles.totalLabel, width: 60, textAlign: 'right', marginRight: 8 }}>{'\u7E3D\u91D1\u984D'}:</Text>
          <View style={{ borderBottomWidth: 1, borderBottomColor: TABLE_BORDER, minWidth: 90, paddingBottom: 1 }}>
            <Text style={{ ...styles.totalValue, width: 90, textAlign: 'right' }}>HK${grandTotal.toLocaleString()}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{'<\u8A02\u55AE\u78BA\u8A8D\u53CA\u4EA4\u4ED8\u7D30\u7BC0>'}</Text>
        <Text style={styles.sectionText}>{pdfDisplayText(data.deliveryDetails || '')}</Text>

        <Text style={styles.termsTitle}>{'\u689D\u6B3E\u53CA\u4ED8\u6B3E'}</Text>

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
              <Text style={styles.boldText}>{'1\u3000\u4EA4\u4ED8\u5730\u5740: '}</Text>
              {pdfDisplayText(data.quoteMeta?.deliveryAddress || '\u5BA2\u6236\u9808\u63D0\u4F9B\u6E96\u78BA\u4EA4\u4ED8\u5730\u5740\u3002\u672C\u5831\u50F9\u9069\u7528\u65BC\u9999\u6E2F\u6A19\u6E96\u5730\u5340\u3002')}
            </Text>

            <Text style={styles.termSubTitle}>{'2\u3000\u4ed8\u6b3e\u689d\u6b3e'}</Text>
            {renderPlainTermLines(data.termsContent?.payment, 'payment', Text, View)}

            <Text style={styles.termSubTitle}>{'3\u3000\u904b\u8f38\u53ca\u5b89\u88dd\u689d\u6b3e'}</Text>
            {renderPlainTermLines(data.termsContent?.transport, 'transport', Text, View)}

            <Text style={styles.termSubTitle}>{'4\u3000\u984d\u5916\u8cbb\u7528'}</Text>
            {renderPlainTermLines(data.termsContent?.extraFees, 'extraFees', Text, View)}

            <Text style={styles.termSubTitle}>{'5\u3000\u4fdd\u990a\u53ca\u7dad\u4fee'}</Text>
            {renderPlainTermLines(data.termsContent?.warranty, 'warranty', Text, View)}

            <Text style={styles.termSubTitle}>{'6\u3000\u5176\u4ed6'}</Text>
            {renderPlainTermLines(data.termsContent?.other, 'other', Text, View)}
          </>
        )}

        <View style={styles.signatureSection} wrap={false} minPresenceAhead={20}>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureTitle}>{'\u5BA2\u6236\u78BA\u8A8D'}</Text>
            <Text style={styles.signatureLabel}>{'\u5BA2\u6236\u6388\u6B0A\u4EBA\u59D3\u540D\u53CA\u7C3D\u540D'}</Text>
            <View style={styles.signatureMiddle} />
            <View style={styles.signatureLine} />
            <Text style={styles.signatureDate}>{'\u7C3D\u7F72\u65E5\u671F:'}</Text>
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
  const [pdfRendering, setPdfRendering] = useState(true);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const { mod: pdfMod, loading, error } = useReactPdf();

  useEffect(() => {
    if (!pdfMod || !data) return;

    setPdfRendering(true);

    // Smart loading detection: observe the PDFViewer's iframe load event
    // with a maximum timeout as fallback
    let cancelled = false;
    const maxTimeout = setTimeout(() => {
      if (!cancelled) setPdfRendering(false);
    }, 8000); // fallback max 8s

    // Use MutationObserver to detect when the iframe is inserted, then listen for its load
    const container = pdfContainerRef.current;
    if (!container) {
      clearTimeout(maxTimeout);
      setPdfRendering(false);
      return;
    }

    const checkIframe = () => {
      const iframe = container.querySelector('iframe');
      if (iframe) {
        // If already loaded (contentDocument ready)
        try {
          if (iframe.contentDocument?.readyState === 'complete') {
            if (!cancelled) setPdfRendering(false);
            clearTimeout(maxTimeout);
            return true;
          }
        } catch { /* cross-origin, fall through to load event */ }

        iframe.addEventListener('load', () => {
          if (!cancelled) setPdfRendering(false);
          clearTimeout(maxTimeout);
        }, { once: true });
        return true;
      }
      return false;
    };

    // Try immediately
    if (!checkIframe()) {
      // Observe for iframe insertion
      const observer = new MutationObserver(() => {
        if (checkIframe()) observer.disconnect();
      });
      observer.observe(container, { childList: true, subtree: true });

      // Cleanup observer
      return () => {
        cancelled = true;
        clearTimeout(maxTimeout);
        observer.disconnect();
      };
    }

    return () => {
      cancelled = true;
      clearTimeout(maxTimeout);
    };
  }, [pdfMod, data]);

  const handleDownload = async () => {
    if (!pdfMod) return;
    setIsDownloading(true);
    try {
      const blob = await pdfMod.pdf(<QuotationDocument data={data} pdfMod={pdfMod} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const quoteNumber = (data?.quoteMeta?.quoteNumber || 'Draft').trim();
      link.download = `BWF_報價單_${quoteNumber}.pdf`;
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[92vh] w-[90vw] max-w-[1100px] flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{'\u5831\u50F9\u55AE\u9810\u89BD'}</h2>
            <p className="font-body text-xs text-muted-foreground">PDF Preview — A4 Format</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownload}
              disabled={isDownloading || loading || !!error}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {'\u4E0B\u8F09 PDF'}
            </button>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* PDF Viewer */}
        <div className="flex-1 overflow-hidden rounded-b-2xl bg-neutral-800 p-4" style={{ minHeight: '800px' }}>
          {loading && (
            <div className="flex h-full items-center justify-center text-white">
              <Loader2 className="mr-3 h-6 w-6 animate-spin" />
              <p>Loading PDF renderer...</p>
            </div>
          )}
          {error && (
            <div className="flex h-full flex-col items-center justify-center text-white gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
              <p className="text-sm">Failed to load PDF module</p>
              <p className="text-xs text-neutral-400 max-w-md text-center">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Reload Page
              </button>
            </div>
          )}
          {pdfMod && data && (
            <div ref={pdfContainerRef} className="relative h-full w-full">
              {pdfRendering && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-neutral-800/90 text-white gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                  <p className="text-sm font-medium">正在生成 PDF 預覽...</p>
                  <p className="text-xs text-neutral-400">Loading document preview</p>
                </div>
              )}
              <pdfMod.PDFViewer width="100%" height="100%" style={{ borderRadius: 8 }}>
                <QuotationDocument data={data} pdfMod={pdfMod} />
              </pdfMod.PDFViewer>
            </div>
          )}
          {pdfMod && !data && (
            <div className="flex h-full items-center justify-center text-white">
              <p>No data available for PDF preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
