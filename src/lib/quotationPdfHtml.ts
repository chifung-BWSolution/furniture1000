/**
 * 將 TipTap HTML（材質及明細、條款）解析成 PDF 可用的區塊／行內片段。
 * 只在瀏覽器使用（DOMParser）；node 端測試改用純文字路徑。
 */

import { normalizeQuotationPdfGlyphs } from './quotationPdfGlyphs';
import type { PdfInlineSegment } from './quotationPdfText';

export type PdfHtmlBlock = {
  type: 'heading' | 'text' | 'spacer';
  segments: PdfInlineSegment[];
};

/** 行內樣式（粗體／底線／斜體／顏色）沿用父層。 */
type InheritedFormat = {
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  color?: string;
};

function normalizeCssColor(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return raw.toLowerCase();
  const rgb = raw.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i,
  );
  if (!rgb) return raw;
  const toHex = (value: string) =>
    Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, '0');
  return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function parseHtmlForPdf(html: string): PdfHtmlBlock[] {
  if (!html || typeof html !== 'string') return [];
  if (typeof DOMParser === 'undefined') return [];

  // 先把 <u> 內的空格換成不斷行空格，避免 HTML 解析時被壓縮掉。
  const preprocessed = html.replace(/<u([^>]*)>([\s\S]*?)<\/u>/gi, (_match, attrs: string, inner: string) => {
    const content = inner.replace(/&nbsp;/g, '\u00A0').replace(/ /g, '\u00A0');
    return `<u${attrs}>${content}</u>`;
  });

  const doc = new DOMParser().parseFromString(preprocessed, 'text/html');
  const results: PdfHtmlBlock[] = [];

  const extract = (node: Node, inherited: InheritedFormat = {}): PdfInlineSegment[] => {
    const segments: PdfInlineSegment[] = [];

    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || '';
      let text = raw.replace(/\u2060/g, '').replace(/[\u2003\u00A0]/g, ' ');
      if (inherited.underline && text.trim().length === 0 && text.length > 0) {
        text = '\u00A0'.repeat(Math.max(text.length, 30));
        segments.push({ text, ...inherited, underlineBlank: true });
        return segments;
      }
      if (text.length > 0) segments.push({ text: normalizeQuotationPdfGlyphs(text), ...inherited });
      return segments;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const format: InheritedFormat = { ...inherited };
      if (tag === 'strong' || tag === 'b') format.bold = true;
      if (tag === 'u') format.underline = true;
      if (tag === 'em' || tag === 'i') format.italic = true;

      const style = el.getAttribute('style') || '';
      if (!style) {
        // 無 inline style
      } else {
        if (style.includes('text-decoration') && style.includes('underline')) format.underline = true;
        if (style.includes('font-weight') && (style.includes('bold') || style.includes('700'))) {
          format.bold = true;
        }
        if (style.includes('font-style') && style.includes('italic')) format.italic = true;
        const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
        if (colorMatch) {
          const normalized = normalizeCssColor(colorMatch[1]);
          if (normalized) format.color = normalized;
        }
      }

      if (tag === 'br') {
        segments.push({ text: '\n', ...inherited });
        return segments;
      }

      el.childNodes.forEach((child) => {
        segments.push(...extract(child, format));
      });
    }

    return segments;
  };

  const pushBlock = (type: PdfHtmlBlock['type'], segments: PdfInlineSegment[]) => {
    if (!segments.length) return;
    const hasText = segments.some((segment) => segment.text.trim().length > 0);
    if (!hasText && type !== 'spacer') return;
    results.push({ type, segments });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushBlock('text', extract(node));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      pushBlock('spacer', [{ text: '' }]);
      return;
    }
    if (tag === 'p' || tag === 'div' || HEADING_TAGS.has(tag)) {
      const segments = extract(el);
      if (!segments.length) {
        pushBlock('spacer', [{ text: '' }]);
        return;
      }
      pushBlock(HEADING_TAGS.has(tag) ? 'heading' : 'text', segments);
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      Array.from(el.children).forEach((child) => {
        const segments = extract(child);
        if (!segments.length) return;
        pushBlock('text', [{ text: '• ' }, ...segments]);
      });
      return;
    }
    el.childNodes.forEach(walk);
  };

  doc.body.childNodes.forEach(walk);
  return results;
}

