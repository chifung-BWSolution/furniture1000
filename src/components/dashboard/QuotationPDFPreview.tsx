import { useState, useEffect, useRef } from 'react';
import { X, Download, Loader2, AlertTriangle } from 'lucide-react';
import type { QuotationPDFData } from '@/types/quotation-pdf';

export type { QuotationPDFData } from '@/types/quotation-pdf';

// ─── Deferred @react-pdf/renderer loading ───────────────────────────────────
// We load @react-pdf/renderer lazily inside the component to avoid
// module-scope crashes (Font.register, StyleSheet.create) that break
// dynamic imports in Vite dev mode.

type ReactPdfModule = Awaited<typeof import('@react-pdf/renderer')>;

let cachedModule: ReactPdfModule | null = null;
let loadPromise: Promise<ReactPdfModule> | null = null;
let fontRegistered = false;

const NOTO_SANS_TC_REGULAR = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-400-normal.ttf';
const NOTO_SANS_TC_BOLD = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@latest/chinese-traditional-700-normal.ttf';

async function loadReactPdfModule(): Promise<ReactPdfModule> {
  if (cachedModule) return cachedModule;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const mod = await import('@react-pdf/renderer');
    cachedModule = mod;
    if (!fontRegistered) {
      try {
        mod.Font.register({
          family: 'NotoSansTC',
          fonts: [
            { src: NOTO_SANS_TC_REGULAR, fontWeight: 400 },
            { src: NOTO_SANS_TC_BOLD, fontWeight: 700 },
          ],
        });
        mod.Font.registerHyphenationCallback((word: string) => {
          // Break at every CJK character so Chinese text can wrap inside narrow cells.
          // Latin/numeric runs stay intact (rendered as single chunks).
          const cjk = /[\u3000-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
          if (!cjk.test(word)) return [word];
          const parts: string[] = [];
          let buf = '';
          for (const ch of word) {
            if (cjk.test(ch)) {
              if (buf) { parts.push(buf); buf = ''; }
              parts.push(ch);
            } else {
              buf += ch;
            }
          }
          if (buf) parts.push(buf);
          return parts;
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
  type: 'heading' | 'text';
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
        segments.push({ text, ...inherited });
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
      const text = node.textContent?.trim() || '';
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
        // Check if there's any actual visible content (text or underline blanks)
        const hasContent = segments.some(s => s.text.trim().length > 0 || s.underline || s.underlineBlank);
        if (hasContent) results.push({ type: 'text', segments });
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

// ─── Styles (plain object — StyleSheet.create is a pass-through) ─────────────

const styles: Record<string, any> = {
  page: { fontFamily: 'NotoSansTC', fontSize: 8, lineHeight: 1.4, paddingTop: 30, paddingBottom: 50, paddingHorizontal: 40, color: '#1a1a1a' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  logo: { width: 130, height: 36, objectFit: 'contain' },
  titleCenter: { fontSize: 16, fontWeight: 700, textAlign: 'center', lineHeight: 1.4, marginBottom: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  infoLeft: { width: '45%' },
  infoRight: { width: '50%' },
  infoLine: { fontSize: 8, marginBottom: 2, lineHeight: 1.6 },
  infoBold: { fontWeight: 700 },
  table: { width: '100%', borderWidth: 0.5, borderColor: '#333', marginTop: 8 },
  tableHeader: { display: 'flex', flexDirection: 'row', backgroundColor: '#f5f5f5', borderBottomWidth: 0.5, borderColor: '#333', minHeight: 24, alignItems: 'center' },
  tableRow: { display: 'flex', flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#ddd', minHeight: 60, alignItems: 'stretch' },
  colIndex: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colDesc: { width: '12%', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colMaterial: { width: '26%', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colRemarks: { width: '9%', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colImage: { width: '15%', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' },
  colQty: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colUnit: { width: '5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colUnitPrice: { width: '10.5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', borderRightWidth: 0.5, borderColor: '#ddd', paddingVertical: 4 },
  colSubtotal: { width: '12.5%', display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', paddingVertical: 4 },
  tableHeaderText: { fontSize: 6.5, fontWeight: 700, textAlign: 'center', lineHeight: 1.4 },
  tableCellText: { fontSize: 7, textAlign: 'center', lineHeight: 1.3 },
  tableCellTextLeft: { fontSize: 7, textAlign: 'left', lineHeight: 1.3, paddingLeft: 4 },
  productImage: { width: 50, height: 50, objectFit: 'cover', borderRadius: 2 },
  installRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#ddd', minHeight: 28 },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6, paddingRight: 4 },
  totalLabel: { fontSize: 10, fontWeight: 700, marginRight: 8, lineHeight: 1.4 },
  totalValue: { fontSize: 10, fontWeight: 700, lineHeight: 1.4 },
  sectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 16, marginBottom: 4, lineHeight: 1.4 },
  sectionText: { fontSize: 7.5, lineHeight: 1.8, marginBottom: 2 },
  boldText: { fontWeight: 700 },
  termsTitle: { fontSize: 9, fontWeight: 700, marginTop: 12, marginBottom: 6, textDecoration: 'underline', lineHeight: 1.4 },
  termItem: { fontSize: 7, lineHeight: 1.7, marginBottom: 1.5, textAlign: 'left' },
  termSubTitle: { fontSize: 8, fontWeight: 700, marginTop: 8, marginBottom: 3, lineHeight: 1.4 },
  signatureSection: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 30, paddingTop: 12 },
  signatureBlock: { width: '45%' },
  signatureTitle: { fontSize: 9, fontWeight: 700, marginBottom: 4, lineHeight: 1.4 },
  signatureLabel: { fontSize: 8, marginBottom: 30, lineHeight: 1.4 },
  signatureLine: { borderBottomWidth: 0.5, borderColor: '#333', marginBottom: 4 },
  signatureDate: { fontSize: 7, color: '#666', lineHeight: 1.4 },
  stamp: { width: 80, height: 80, objectFit: 'contain', position: 'absolute', bottom: 10, right: 0, opacity: 0.85 },
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
  const grandTotal = Math.max(0, (data.subtotal || 0) - discountValue);
  const isFreeInstallation = grandTotal >= 12000;
  const items = data.items || [];

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://26c0258f-253c-4e4e-9027-922d08aab63f.canvases.tempo.build';
  const logoUrl = `${baseUrl}/assets/bwf-logo.png`;
  const stampUrl = `${baseUrl}/assets/bwf-stamp.png`;

  const formatDimensions = (item: QuotationPDFData['items'][0]) => {
    if (!item) return '';
    const parts: string[] = [];
    if (item.dimensionLMm) parts.push(String(item.dimensionLMm));
    if (item.dimensionWMm) parts.push(String(item.dimensionWMm));
    if (item.dimensionHMm) parts.push(String(item.dimensionHMm));
    return parts.length > 0 ? parts.join('*') : '';
  };

  return (
    <Document>
      {/* Page 1 - Product Table */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Image src={logoUrl} style={styles.logo} />
        </View>
        <Text style={styles.titleCenter}>{'\u50A2\u4FF1\u5831\u50F9\u55AE'}</Text>
        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <Text style={styles.infoLine}>{'\u5BA2\u6236\u540D\u7A31'}: {data.clientInfo?.name || ''}</Text>
            <Text style={styles.infoLine}>{'\u5BA2\u6236\u96FB\u8A71'}: {data.clientInfo?.phone || ''}</Text>
            <Text style={styles.infoLine}>{'\u5831\u50F9\u55AE\u865F'}: {quoteNumber}</Text>
            <Text style={styles.infoLine}>{'\u65E5\u3000\u671F'}: {today}</Text>
            <Text style={styles.infoLine}>{'\u9805\u76EE\u8CA0\u8CAC\u4EBA'}: {data.quoteMeta?.pmName || ''}</Text>
          </View>
          <View style={styles.infoRight}>
            <Text style={styles.infoLine}>{'\u516C\u53F8'}: {data.companyInfo?.name || ''}</Text>
            <Text style={styles.infoLine}>{'\u5730\u5740'}: {data.companyInfo?.address || ''}</Text>
            <Text style={styles.infoLine}>{'\u96FB\u8A71'}: {data.companyInfo?.phone || ''}</Text>
            <Text style={styles.infoLine}>{'\u96FB\u90F5'}: {data.companyInfo?.email || ''}</Text>
            <Text style={styles.infoLine}>{'\u7DB2\u7AD9'}: {data.companyInfo?.website || ''}</Text>
          </View>
        </View>

        <View style={styles.table}>
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

          {items.map((item, idx) => {
            if (item?.isCustomTerm) {
              // Description spans 序號 → 圖例 (5 cols totalling 67%); 數量/單位/單價/總價 stay
              return (
                <View style={{ display: 'flex', flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#ddd', minHeight: 28, alignItems: 'stretch' }} key={idx} wrap={false}>
                  <View style={styles.colIndex}><Text style={styles.tableCellText}>{idx + 1}</Text></View>
                  <View style={{ width: '67%', paddingLeft: 6, paddingRight: 6, paddingTop: 6, paddingBottom: 6, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
                    <Text style={styles.tableCellTextLeft}>{item?.name || ''}</Text>
                  </View>
                  <View style={styles.colQty}><Text style={styles.tableCellText}>{item?.quantity || 0}</Text></View>
                  <View style={styles.colUnit}><Text style={styles.tableCellText}>{'\u5F35'}</Text></View>
                  <View style={styles.colUnitPrice}><Text style={styles.tableCellText}>HK${(item?.unitPrice || 0).toLocaleString()}</Text></View>
                  <View style={styles.colSubtotal}><Text style={styles.tableCellText}>HK${((item?.unitPrice || 0) * (item?.quantity || 0)).toLocaleString()}</Text></View>
                </View>
              );
            }
            return (
              <View style={styles.tableRow} key={idx} wrap={false}>
                <View style={styles.colIndex}><Text style={styles.tableCellText}>{idx + 1}</Text></View>
                <View style={styles.colDesc}>
                  <View style={{ width: '100%' }}>
                    <Text style={styles.tableCellTextLeft}>{item?.name || ''}</Text>
                  </View>
                </View>
                <View style={styles.colMaterial}>
                  <View style={{ width: '100%' }}>
                    <Text style={styles.tableCellTextLeft}>{item?.material || ''}</Text>
                    {formatDimensions(item) ? (
                      <Text style={{ fontSize: 6.5, color: '#555', marginTop: 2, textAlign: 'left', paddingLeft: 4, lineHeight: 1.3 }}>
                        {formatDimensions(item)}mm {item?.color ? `/ ${item.color}` : ''}
                      </Text>
                    ) : item?.color ? (
                      <Text style={{ fontSize: 6.5, color: '#555', marginTop: 2, textAlign: 'left', paddingLeft: 4, lineHeight: 1.3 }}>
                        {item.color}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.colRemarks}>
                  <View style={{ width: '100%' }}>
                    <Text style={styles.tableCellTextLeft}>{item?.remarks || ''}</Text>
                  </View>
                </View>
                <View style={styles.colImage}>
                  {item?.image ? (
                    <Image src={item.image} style={styles.productImage} />
                  ) : (
                    <Text style={{ fontSize: 6, color: '#999' }}>{'\u2014'}</Text>
                  )}
                </View>
                <View style={styles.colQty}><Text style={styles.tableCellText}>{item?.quantity || 0}</Text></View>
                <View style={styles.colUnit}><Text style={styles.tableCellText}>{'\u5F35'}</Text></View>
                <View style={styles.colUnitPrice}><Text style={styles.tableCellText}>HK${(item?.unitPrice || 0).toLocaleString()}</Text></View>
                <View style={styles.colSubtotal}><Text style={styles.tableCellText}>HK${((item?.unitPrice || 0) * (item?.quantity || 0)).toLocaleString()}</Text></View>
              </View>
            );
          })}

          {/* Installation Fee Row */}
          <View style={styles.installRow} wrap={false}>
            <View style={{ width: '60%', padding: 4, justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
              <Text style={{ fontSize: 7, fontWeight: 700, lineHeight: 1.4 }}>{data.installationFee?.title || '\u50A2\u4FF1\u5B89\u88DD\u8CBB\u7528'}</Text>
              <Text style={{ fontSize: 6.5, color: '#666', lineHeight: 1.4 }}>{data.installationFee?.subtitle || '\u5B89\u88DD\u6E05\u55AE\u4E2D\u50A2\u4FF1\u7522\u54C1\u4E26\u6E05\u7406\u5305\u88DD\u5783\u573E'}</Text>
            </View>
            <View style={{ width: '20%', padding: 4, justifyContent: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
              <Text style={{ fontSize: 6.5, textAlign: 'center', lineHeight: 1.4 }}>
                {data.installationFee?.conditionText || '\u8A02\u55AE\u7E3D\u91D1\u984D\u6EFF HK$12,000\n\u5C07\u4E0D\u6536\u53D6\u5B89\u88DD\u8CBB\u7528'}
              </Text>
            </View>
            <View style={{ width: '10%', padding: 4, justifyContent: 'center', alignItems: 'center', borderRightWidth: 0.5, borderColor: '#ddd' }}>
              <Text style={styles.tableCellText}>{isFreeInstallation ? 'FREE' : (data.installationFee?.freeLabel || '\u53E6\u8B70')}</Text>
            </View>
            <View style={{ width: '10%', padding: 4, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={styles.tableCellText}>{isFreeInstallation ? 'FREE' : (data.installationFee?.chargeLabel || '\u53E6\u8B70')}</Text>
            </View>
          </View>
        </View>

        {discountValue > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6, paddingRight: 4 }}>
            <Text style={{ fontSize: 8, marginRight: 8, lineHeight: 1.4, width: 60, textAlign: 'right' }}>Discount:</Text>
            <Text style={{ fontSize: 8, lineHeight: 1.4, width: 90, textAlign: 'right' }}>HK${discountValue.toLocaleString()}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2, paddingRight: 4 }}>
          <Text style={{ ...styles.totalLabel, width: 60, textAlign: 'right', marginRight: 8 }}>{'\u7E3D\u91D1\u984D'}:</Text>
          <Text style={{ ...styles.totalValue, width: 90, textAlign: 'right' }}>HK${grandTotal.toLocaleString()}</Text>
        </View>

        <Text style={styles.sectionTitle}>{'<\u8A02\u55AE\u78BA\u8A8D\u53CA\u4EA4\u4ED8\u7D30\u7BC0>'}</Text>
        <Text style={styles.sectionText}>{data.deliveryDetails || ''}</Text>

        <Text
          style={{ position: 'absolute', bottom: 30, right: 40, fontSize: 10, color: '#000', zIndex: 100 }}
          render={({ pageNumber }: { pageNumber: number }) => `\u7B2C ${pageNumber} \u9801`}
          fixed
        />
      </Page>

      {/* Page 2 - Terms & Conditions */}
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Image src={logoUrl} style={styles.logo} />
        </View>

        <Text style={styles.termsTitle}>{'\u689D\u6B3E\u53CA\u4ED8\u6B3E'}</Text>

        {data.termsContent?.fullHtml && (data.termsContent.fullHtml.replace(/<[^>]*>/g, '').replace(/\s/g, '').length > 0 || /<u[^>]*>/i.test(data.termsContent.fullHtml)) ? (
          parseHtmlForPdf(data.termsContent.fullHtml).map((item, i) => {
            // Check if any segment is an underlineBlank — needs View-based rendering
            const hasUnderlineBlank = item.segments.some(s => s.underlineBlank);
            const baseStyle = item.type === 'heading' ? styles.termSubTitle : styles.termItem;

            if (hasUnderlineBlank) {
              // Use flexDirection row View so we can render borderBottom for blank underlines
              const viewStyle: any = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: baseStyle.marginBottom || 0, marginTop: baseStyle.marginTop || 0 };
              const textBaseStyle: any = { fontSize: baseStyle.fontSize || 7, lineHeight: baseStyle.lineHeight || 1.7, fontWeight: baseStyle.fontWeight };
              return (
                <View key={i} style={viewStyle}>
                  {item.segments.map((seg, j) => {
                    if (seg.underlineBlank) {
                      // Render as a View with borderBottom to simulate underlined blank space
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
              {data.quoteMeta?.deliveryAddress || '\u5BA2\u6236\u9808\u63D0\u4F9B\u6E96\u78BA\u4EA4\u4ED8\u5730\u5740\u3002\u672C\u5831\u50F9\u9069\u7528\u65BC\u9999\u6E2F\u6A19\u6E96\u5730\u5340\u3002'}
            </Text>

            <Text style={styles.termSubTitle}>{'2\u3000\u4ed8\u6b3e\u689d\u6b3e'}</Text>
            {(data.termsContent?.payment || '').split('\n').map((line: string, i: number) => (
              line.trim() ? <Text key={i} style={styles.termItem}>{line}</Text> : null
            ))}

            <Text style={styles.termSubTitle}>{'3\u3000\u904b\u8f38\u53ca\u5b89\u88dd\u689d\u6b3e'}</Text>
            {(data.termsContent?.transport || '').split('\n').map((line: string, i: number) => (
              line.trim() ? <Text key={i} style={styles.termItem}>{line}</Text> : null
            ))}

            <Text style={styles.termSubTitle}>{'4\u3000\u984d\u5916\u8cbb\u7528'}</Text>
            {(data.termsContent?.extraFees || '').split('\n').map((line: string, i: number) => (
              line.trim() ? <Text key={i} style={styles.termItem}>{line}</Text> : null
            ))}

            <Text style={styles.termSubTitle}>{'5\u3000\u4fdd\u990a\u53ca\u7dad\u4fee'}</Text>
            {(data.termsContent?.warranty || '').split('\n').map((line: string, i: number) => (
              line.trim() ? <Text key={i} style={styles.termItem}>{line}</Text> : null
            ))}

            <Text style={styles.termSubTitle}>{'6\u3000\u5176\u4ed6'}</Text>
            {(data.termsContent?.other || '').split('\n').map((line: string, i: number) => (
              line.trim() ? <Text key={i} style={styles.termItem}>{line}</Text> : null
            ))}
          </>
        )}

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureTitle}>{'\u5BA2\u6236\u78BA\u8A8D'}</Text>
            <Text style={styles.signatureLabel}>{'\u5BA2\u6236\u6388\u6B0A\u4EBA\u59D3\u540D\u53CA\u7C3D\u540D'}</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureDate}>{'\u7C3D\u7F72\u65E5\u671F:'}</Text>
          </View>
          <View style={{ ...styles.signatureBlock, position: 'relative' }}>
            <Text style={styles.signatureTitle}>{'Branding Works \u4EE3\u8868'}</Text>
            <Image src={stampUrl} style={styles.stamp} />
            <View style={{ height: 30 }} />
            <View style={styles.signatureLine} />
            <Text style={styles.signatureDate}>{today}</Text>
          </View>
        </View>

        <Text
          style={{ position: 'absolute', bottom: 30, right: 40, fontSize: 10, color: '#000', zIndex: 100 }}
          render={({ pageNumber }: { pageNumber: number }) => `\u7B2C ${pageNumber} \u9801`}
          fixed
        />
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
      link.download = `BWF_\u5831\u50F9\u55AE_${data?.clientInfo?.name || 'Draft'}_${new Date().toISOString().slice(0, 10)}.pdf`;
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
