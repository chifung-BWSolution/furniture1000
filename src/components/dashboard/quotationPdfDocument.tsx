/**
 * A4 報價單 PDF 文件（PRD｜報價單 PDF 排版優化 V1.0）。
 *
 * 與舊版的差別：
 * 1. 由「一個 Page 交給 react-pdf 自動分頁」改為「先量測、再分頁、逐頁輸出」。
 *    每個區塊（Item 列、總金額、圖片組、條款段落…）都有量測好的高度，
 *    所以首頁／續頁的表頭、頁碼、金額不被拆頁都可以精確控制。
 * 2. Item 的圖例不再是固定高度的窄圖框，而是依 1–3 張圖片的原始比例
 *    自適應排版（不裁切、不變形）。
 * 3. 續頁重複表頭、頁尾 Page X / Y、長文字按行分頁。
 *
 * 資料來源完全不變：Item、金額、條款仍沿用既有欄位；圖片只多了「合併」步驟
 * （產品圖＋參考圖＋備註圖 → 同一組自適應圖例）。
 */

import { Fragment } from 'react';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import { quotePdf, type QuotePdfLabels } from '@/lib/quotationLocale';
import { pdfDisplayText } from '@/lib/quotationPdfGlyphs';
import { quoteCnyTotalFromHkd, quoteItemLineSubtotal } from '@/lib/quoteItemTotals';
import {
  formatSectionTitleLabel,
  sectionTitleOrdinalAt,
} from '@/lib/quoteSectionTitle';
import { quoteItemSerialLabel } from '@/lib/quoteZone';
import { UNZONED_QUOTE_IMAGE_KEY } from '@/lib/quoteFloorPlan';
import { parseRemarksContent } from '@/lib/remarksContent';
import { getChineseColorLabel, getColorHex } from '@/constants/color-map';
import { looksLikeMaterialHtml } from '@/lib/quotationMaterialHtml';
import { quoteZoneTotals } from '@/lib/quoteFormatSettings';
import { parseHtmlForPdf, type PdfHtmlBlock } from '@/lib/quotationPdfHtml';
import {
  layoutItemImages,
  type PdfImageGallery,
  type PdfImageSource,
} from '@/lib/quotationPdfImages';
import {
  PDF_COLORS,
  PDF_CONTENT_HEIGHT_PT,
  PDF_CONTENT_WIDTH_PT,
  PDF_FOOTER_BOTTOM_PT,
  PDF_FOOTER_HEIGHT_PT,
  PDF_PAGE_MARGIN,
  PDF_TABLE,
  PDF_TYPE,
  itemImageColumnWidthPt,
  pdfColumnWidths,
  type PdfColumnKey,
  type PdfLocale,
} from '@/lib/quotationPdfMetrics';
import { paginatePdfBlocks } from '@/lib/quotationPdfPagination';
import {
  peekImageSize,
  pdfTextWidth,
  wrapPdfSegments,
  wrapPdfText,
  type PdfInlineSegment,
  type PdfTextLine,
} from '@/lib/quotationPdfText';
import {
  AI_REFERENCE_LABEL,
  frameInSlot,
  imageRect,
  PDF_CONTENT_WIDTH_MM,
  printBlocks,
  type PhotoLayoutGroup,
  type PhotoPrintBlock,
} from '@/lib/quotePhotoLayouts';
import {
  QUOTE_PHOTO_CAPTION_PT,
  QUOTE_PHOTO_ROW_HEIGHT_PT,
  quotePhotoPrintRows,
} from '@/lib/quotePhotoPrint';
import { formatQuoteNumberWithVersion } from '@/lib/quoteVersions';

type ReactPdfModule = Awaited<typeof import('@react-pdf/renderer')>;
type PdfRenderer = { Text: any; View: any; Image: any };

export const PDF_FONT_FAMILY = ['NotoSansTC', 'NotoSansHK'] as const;

const PT_PER_MM = 2.834645669;
const RULE = PDF_TABLE.borderColor;
const BORDER = PDF_TABLE.borderWidthPt;
const ROW_PAD = PDF_TABLE.rowPaddingPt;
/**
 * 列高安全餘裕（pt）。
 * react-pdf 的 layout 引擎在「固定高度祖先鏈完全無餘裕」時會直接丟棄文字
 * （材質及明細、總金額曾因此整段消失，文字層也沒有）。
 * 每列多保留這幾 pt，讓文字行盒不必貼齊容器。
 */
const ROW_SLACK_PT = 3;

type QuotePdfItem = QuotationPDFData['items'][number];

type PdfBlock = {
  key: string;
  heightPt: number;
  keepWithNext?: boolean;
  /** 屬於 Item 表格（續頁印表頭／補表格外框）。 */
  table?: boolean;
  node: JSX.Element;
};

type Strip = { heightPt: number; node: JSX.Element | null };

type Ctx = {
  data: QuotationPDFData;
  labels: QuotePdfLabels;
  locale: PdfLocale;
  columns: Record<PdfColumnKey, number>;
  showCnyTotal: boolean;
  logoUrl: string;
  quoteNumber: string;
  today: string;
  totalAmount: number;
  discountValue: number;
  isFreeInstallation: boolean;
  installationAmount: number;
  installFeeRaw: number | null | undefined;
  P: PdfRenderer;
};

// ─── 小工具 ─────────────────────────────────────────────────────────────────

function lineHeightRatio(sizePt: number, linePt: number) {
  return linePt / Math.max(1, sizePt);
}

function spacer(heightPt: number): Strip {
  return { heightPt, node: null };
}

/** 單行文字：固定行高盒子 + wrap=false，確保排版高度＝量測高度。 */
function textStrip(
  textLine: PdfTextLine,
  options: {
    size: number;
    linePt: number;
    bold?: boolean;
    color?: string;
    align?: 'left' | 'center' | 'right';
    width?: number | string;
  },
  P: { Text: any; View: any },
): Strip {
  const { size, linePt, bold, color, align = 'left', width = '100%' } = options;
  return {
    heightPt: linePt,
    node: (
      <P.View style={{ height: linePt, width, justifyContent: 'center' }}>
        <P.Text
          wrap={false}
          style={{
            fontSize: size,
            lineHeight: lineHeightRatio(size, linePt),
            fontWeight: bold ? 700 : 400,
            color: color || PDF_COLORS.text,
            textAlign: align,
            width: '100%',
          }}
        >
          {renderInline(textLine.segments, bold, P)}
        </P.Text>
      </P.View>
    ),
  };
}

function renderInline(segments: PdfInlineSegment[], forceBold: boolean | undefined, P: { Text: any }) {
  if (segments.length === 1 && !segments[0].bold && !segments[0].underline && !segments[0].italic && !segments[0].color && !forceBold) {
    return segments[0].text;
  }
  return segments.map((segment, index) => {
    const style: Record<string, unknown> = {};
    if (segment.bold || forceBold) style.fontWeight = 700;
    if (segment.underline || segment.underlineBlank) style.textDecoration = 'underline';
    if (segment.italic) style.fontStyle = 'italic';
    if (segment.color) style.color = segment.color;
    return (
      <P.Text key={index} style={style}>
        {segment.text}
      </P.Text>
    );
  });
}

function plainLines(text: string, widthPt: number, size: number, bold = false): PdfTextLine[] {
  const normalized = pdfDisplayText(text || '');
  if (!normalized) return [];
  return normalized
    .split('\n')
    .flatMap((raw) => {
      if (!raw.trim()) return [{ segments: [{ text: '' }], text: '' }];
      return wrapPdfSegments([{ text: raw }], widthPt, size).map((line) => ({
        ...line,
        segments: line.segments.map((segment) => ({ ...segment, bold: bold || segment.bold })),
      }));
    });
}

function sumHeight(strips: Strip[]): number {
  return strips.reduce((total, strip) => total + strip.heightPt, 0);
}

/** 從 strips 取出塞得進 maxHeight 的前段（至少一行）。 */
function takeStrips(strips: Strip[], maxHeight: number): { taken: Strip[]; rest: Strip[] } {
  const taken: Strip[] = [];
  let used = 0;
  let index = 0;
  while (index < strips.length) {
    const height = strips[index].heightPt;
    if (used + height > maxHeight && taken.length > 0) break;
    taken.push(strips[index]);
    used += height;
    index += 1;
  }
  return { taken, rest: strips.slice(index) };
}

function stackNode(strips: Strip[], P: { View: any }, extraStyle: Record<string, unknown> = {}) {
  return (
    <P.View style={{ width: '100%', flexDirection: 'column', ...extraStyle }}>
      {strips.map((strip, index) => (
        <P.View key={index} style={{ height: strip.heightPt, width: '100%' }}>
          {strip.node}
        </P.View>
      ))}
    </P.View>
  );
}

/** 單行金額：先縮字級，仍放不下才換行；保證數字完整。 */
function moneyLine(text: string, widthPt: number, maxSize = 7.5, bold = false) {
  let size = maxSize;
  while (size > 6 && pdfTextWidth(text, size, bold) > widthPt) size -= 0.25;
  return { text, size };
}

function cellStyle(
  widthPt: number,
  options: { center?: boolean; borderRight?: boolean; paddingV?: number } = {},
): Record<string, any> {
  const { center = false, borderRight = true, paddingV = ROW_PAD } = options;
  return {
    width: widthPt,
    paddingVertical: paddingV,
    paddingHorizontal: 2,
    justifyContent: center ? 'center' : 'flex-start',
    alignItems: center ? 'center' : 'stretch',
    borderRightWidth: borderRight ? BORDER : 0,
    borderColor: RULE,
  };
}

// ─── 圖片 ───────────────────────────────────────────────────────────────────

function itemImageSources(item: QuotePdfItem): PdfImageSource[] {
  const explicit = (item.images || []).filter((image) => Boolean(image?.url?.trim()));
  if (explicit.length) {
    return explicit.map((image) => {
      const measured = peekImageSize(image.url);
      return {
        url: image.url,
        kind: image.kind,
        width: image.width ?? measured?.width,
        height: image.height ?? measured?.height,
      };
    });
  }
  const sources: PdfImageSource[] = [];
  const push = (url: string | undefined, kind: PdfImageSource['kind']) => {
    const trimmed = (url || '').trim();
    if (!trimmed || sources.some((source) => source.url === trimmed)) return;
    sources.push({ url: trimmed, kind, ...(peekImageSize(trimmed) || {}) });
  };
  push(item.image, 'product');
  push(item.referenceImage, 'reference');
  for (const block of parseRemarksContent(item.remarks, item.remarksImage)) {
    if (block.type === 'image') push(block.src, 'remarks');
  }
  return sources;
}

function renderGalleryRow(
  images: PdfImageGallery['images'],
  heightPt: number,
  widthPt: number,
  P: PdfRenderer,
) {
  return (
    <P.View style={{ width: widthPt, height: heightPt, position: 'relative' }}>
      {images.map((image, index) => (
        <P.View
          key={`${image.url}-${index}`}
          style={{
            position: 'absolute',
            left: image.leftPt,
            top: image.topPt,
            width: image.widthPt,
            height: image.heightPt,
          }}
        >
          <P.Image
            src={image.url}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </P.View>
      ))}
    </P.View>
  );
}

// ─── 頁首 ───────────────────────────────────────────────────────────────────

type HeaderField = { label: string; lines: PdfTextLine[] };

function buildHeader(ctx: Ctx, P: PdfRenderer): { heightPt: number; node: JSX.Element } {
  const { labels, data, locale } = ctx;
  const labelWidth = locale === 'en' ? 84 : 52;
  const columnGap = 12;
  const columnWidth = (PDF_CONTENT_WIDTH_PT - columnGap) / 2;
  const valueWidth = columnWidth - labelWidth;
  const infoSize = PDF_TYPE.info.size;
  const infoLine = PDF_TYPE.info.line;

  const build = (pairs: Array<[string, string | undefined | null]>): HeaderField[] =>
    pairs
      .map(([label, value]) => ({ label, value: String(value ?? '').trim() }))
      .filter((entry) => entry.value.length > 0)
      .map((entry) => ({ label: entry.label, lines: plainLines(entry.value, valueWidth, infoSize) }));

  const leftFields = build([
    [labels.customerCompanyName, data.clientInfo?.name],
    [labels.customerName, data.clientInfo?.contactName],
    [labels.customerPhone, data.clientInfo?.phone],
    [labels.customerEmail, data.clientInfo?.email],
    [labels.quotationNo, ctx.quoteNumber],
    [labels.date, ctx.today],
    [labels.projectInCharge, data.quoteMeta?.pmName],
  ]);

  const rightFields = build([
    [labels.company, data.companyInfo?.name],
    [labels.address, data.companyInfo?.address],
    [labels.tel, data.companyInfo?.phone],
    [labels.email, data.companyInfo?.email],
    [labels.website, data.companyInfo?.website],
  ]);

  const fieldsHeight = (fields: HeaderField[]) =>
    fields.reduce((total, field) => total + Math.max(1, field.lines.length) * infoLine + 1.5, 0);

  const leftHeight = fieldsHeight(leftFields);
  const rightHeight = fieldsHeight(rightFields);
  const infoHeight = Math.max(leftHeight, rightHeight, 20);

  const logoHeight = 32;
  const titleHeight = PDF_TYPE.title.line;
  const heightPt = 4 + logoHeight + 4 + titleHeight + 6 + infoHeight + 8;

  const fieldNode = (field: HeaderField) => (
    <P.View key={field.label} style={{ flexDirection: 'row', marginBottom: 1.5 }}>
      <P.Text
        style={{
          width: labelWidth,
          fontSize: infoSize,
          lineHeight: lineHeightRatio(infoSize, infoLine),
          color: PDF_COLORS.muted,
        }}
      >
        {field.label}
      </P.Text>
      <P.View style={{ width: valueWidth }}>
        {field.lines.map((line, index) => (
          <P.View key={index} style={{ height: infoLine, justifyContent: 'center' }}>
            <P.Text
              wrap={false}
              style={{ fontSize: infoSize, lineHeight: lineHeightRatio(infoSize, infoLine) }}
            >
              {renderInline(line.segments, undefined, P)}
            </P.Text>
          </P.View>
        ))}
      </P.View>
    </P.View>
  );

  const node = (
    <P.View>
      <P.Image src={ctx.logoUrl} style={{ width: 130, height: logoHeight, objectFit: 'contain' }} />
      <P.Text
        style={{
          fontSize: PDF_TYPE.title.size,
          lineHeight: lineHeightRatio(PDF_TYPE.title.size, PDF_TYPE.title.line),
          fontWeight: 700,
          textAlign: 'center',
          marginTop: 4,
        }}
      >
        {labels.title}
      </P.Text>
      <P.View style={{ flexDirection: 'row', marginTop: 6 }}>
        <P.View style={{ width: columnWidth, marginRight: columnGap }}>
          {leftFields.map(fieldNode)}

        </P.View>
        <P.View style={{ width: columnWidth }}>{rightFields.map(fieldNode)}</P.View>
      </P.View>
    </P.View>
  );

  return { heightPt, node };
}

/** 續頁簡化頁首：Logo + 文件名稱 + 報價單號。 */
function buildCompactHeader(ctx: Ctx, P: PdfRenderer): { heightPt: number; node: JSX.Element } {
  const heightPt = 26;
  return {
    heightPt,
    node: (
      <P.View
        style={{
          height: heightPt,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: BORDER,
          borderColor: RULE,
        }}
      >
        <P.Image src={ctx.logoUrl} style={{ width: 78, height: 20, objectFit: 'contain' }} />
        <P.Text style={{ fontSize: 8, color: PDF_COLORS.muted }}>
          {`${ctx.labels.title}　${ctx.quoteNumber}`}
        </P.Text>
      </P.View>
    ),
  };
}

function buildTableHeader(ctx: Ctx, P: PdfRenderer): { heightPt: number; node: JSX.Element } {
  const { labels } = ctx;
  const columns = pdfColumnWidths(ctx.locale);
  const cells: Array<{ key: PdfColumnKey; label: string }> = [
    { key: 'no', label: labels.colNo },
    { key: 'desc', label: labels.colDesc },
    { key: 'spec', label: labels.descDimensions },
    { key: 'material', label: labels.colMaterial },
    { key: 'image', label: labels.colImage },
    { key: 'qty', label: labels.colQty },
    { key: 'unit', label: labels.colUnit },
    { key: 'unitPrice', label: labels.colUnitPrice },
    { key: 'total', label: labels.colTotal },
  ];

  const wrapped = cells.map((cell) => ({
    ...cell,
    lines: cell.label.split('\n').flatMap((part) =>
      wrapPdfText(part, columns[cell.key] - 4, PDF_TYPE.header.size, true),
    ),
  }));
  const maxLines = Math.max(1, ...wrapped.map((cell) => cell.lines.length));
  const heightPt = Math.max(PDF_TABLE.headerHeightPt, maxLines * PDF_TYPE.header.line + 8);

  return {
    heightPt,
    node: (
      <P.View
        style={{
          height: heightPt,
          flexDirection: 'row',
          backgroundColor: PDF_TABLE.headerBg,
          borderTopWidth: BORDER,
          borderLeftWidth: BORDER,
          borderRightWidth: BORDER,
          borderBottomWidth: BORDER,
          borderColor: RULE,
        }}
      >
        {wrapped.map((cell, index) => (
          <P.View
            key={cell.key}
            style={{
              ...cellStyle(columns[cell.key], { center: true, borderRight: index < wrapped.length - 1, paddingV: 4 }),
              borderColor: RULE,
            }}
          >
            {cell.lines.map((line, lineIndex) => (
              <P.Text
                key={lineIndex}
                wrap={false}
                style={{
                  fontSize: PDF_TYPE.header.size,
                  lineHeight: lineHeightRatio(PDF_TYPE.header.size, PDF_TYPE.header.line),
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                {line}
              </P.Text>
            ))}
          </P.View>
        ))}
      </P.View>
    ),
  };
}

// ─── Item 內容 ──────────────────────────────────────────────────────────────

function buildDescStrips(ctx: Ctx, item: QuotePdfItem, widthPt: number, P: PdfRenderer): Strip[] {
  const strips: Strip[] = [];

  const displayName = item.name?.trim() || item.category?.trim() || '';
  const nameLines = plainLines(displayName, widthPt, PDF_TYPE.itemName.size, true);
  nameLines.forEach((line) =>
    strips.push(textStrip(line, { size: PDF_TYPE.itemName.size, linePt: PDF_TYPE.itemName.line, bold: true }, P)),
  );

  const category = item.category?.trim() || '';
  const categoryLines = plainLines(category === displayName ? '' : category, widthPt, PDF_TYPE.descValue.size);
  if (categoryLines.length) {
    if (nameLines.length) strips.push(spacer(2));
    categoryLines.forEach((line) =>
      strips.push(
        textStrip(line, { size: PDF_TYPE.descValue.size, linePt: PDF_TYPE.descValue.line, color: PDF_COLORS.muted }, P),
      ),
    );
  }

  return strips;
}

/** 顏色 → 色點 + 名稱（參考圖的規格欄樣式）。 */
function colorEntries(color: string | undefined, locale: PdfLocale) {
  return (color || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({
      hex: getColorHex(value),
      label: locale === 'en' ? value : getChineseColorLabel(value) || value,
    }));
}

/** 規格欄：尺寸別 + 尺寸數值 + 顏色。 */
function buildSpecStrips(ctx: Ctx, item: QuotePdfItem, widthPt: number, P: PdfRenderer): Strip[] {
  const values = item.dimensionMode === 'dh'
    ? [['DIA', item.dimensionLMm], ['H', item.dimensionHMm]]
    : [['W', item.dimensionLMm], ['D', item.dimensionWMm], ['H', item.dimensionHMm]];
  const dimensions = values.filter(([, value]) => value != null && String(value).trim());
  const text = dimensions.map(([label, value], index) =>
    `${label} ${value}${index < dimensions.length - 1 ? ' \u00d7' : ''}`).join('\n');
  return plainLines(text, widthPt, PDF_TYPE.descValue.size).map((line) =>
    textStrip(line, { size: PDF_TYPE.descValue.size, linePt: PDF_TYPE.descValue.line }, P));
}

function buildColorStrips(ctx: Ctx, item: QuotePdfItem, widthPt: number, P: PdfRenderer): Strip[] {
  const strips: Strip[] = [];
  const colors = colorEntries(item.color, ctx.locale);
  if (colors.length) {
    const dotSize = 7;
    const dotGap = 2.5;
    const perRow = Math.max(1, Math.floor((widthPt + dotGap) / (dotSize + dotGap)));
    const dotRows = Math.ceil(colors.length / perRow);
    const labelLines = plainLines(colors.map((entry) => entry.label).join('、'), widthPt, 6.5);
    const heightPt = 4 + dotRows * (dotSize + 1) + labelLines.length * 8.6 + 1;

    strips.push({
      heightPt,
      node: (
        <P.View style={{ width: '100%', height: heightPt, paddingTop: 4 }}>
          {Array.from({ length: dotRows }, (_, rowIndex) => (
            <P.View
              key={`dots-${rowIndex}`}
              style={{ height: dotSize + 1, flexDirection: 'row', alignItems: 'center' }}
            >
              {colors.slice(rowIndex * perRow, rowIndex * perRow + perRow).map((entry, index) => (
                <P.View
                  key={`${entry.label}-${index}`}
                  style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: entry.hex,
                    borderWidth: 0.5,
                    borderColor: '#8a93a0',
                    marginRight: dotGap,
                  }}
                />
              ))}
            </P.View>
          ))}
          {labelLines.map((line, index) => (
            <P.View key={`color-${index}`} style={{ height: 8.6, justifyContent: 'center' }}>
              <P.Text
                wrap={false}
                style={{ fontSize: 6.5, lineHeight: 1.25, color: PDF_COLORS.muted }}
              >
                {line.text}
              </P.Text>
            </P.View>
          ))}
        </P.View>
      ),
    });
  }

  return strips;
}

function materialSegments(raw: string): PdfHtmlBlock[] {
  if (!raw) return [];
  if (looksLikeMaterialHtml(raw)) {
    const blocks = parseHtmlForPdf(raw);
    if (blocks.length) return blocks;
  }
  return pdfDisplayText(raw)
    .split('\n')
    .map((line) => ({ type: 'text' as const, segments: [{ text: line }] }));
}

/** 材質及明細欄：逐行量測，含備註（備註併入此欄，PRD 3.1）。 */
function buildMaterialStrips(ctx: Ctx, item: QuotePdfItem, widthPt: number, P: PdfRenderer): Strip[] {
  const strips: Strip[] = [];
  const size = PDF_TYPE.material.size;
  const line = PDF_TYPE.material.line;

  for (const block of materialSegments(item.material || '')) {
    if (block.type === 'spacer') {
      strips.push(spacer(line * 0.6));
      continue;
    }
    const segments = block.segments.some((segment) => segment.text.trim())
      ? block.segments
      : [{ text: '' }];
    const wrapped = wrapPdfSegments(segments, widthPt, size);
    if (!wrapped.length) {
      strips.push(spacer(line * 0.6));
      continue;
    }
    wrapped.forEach((textLine) => strips.push(textStrip(textLine, { size, linePt: line }, P)));
    strips.push(spacer(2));
  }

  const remarksBlocks = parseRemarksContent(item.remarks, undefined).filter(
    (block): block is { type: 'text'; content: string; id: string } =>
      block.type === 'text' && Boolean(block.content.trim()),
  );
  if (remarksBlocks.length) {
    strips.push({
      heightPt: 8,
      node: (
        <P.View style={{ height: 8, justifyContent: 'flex-end', borderTopWidth: 0.4, borderColor: '#d8dde2' }} />
      ),
    });
    strips.push(
      textStrip(
        { segments: [{ text: ctx.labels.colRemarks }], text: ctx.labels.colRemarks },
        { size: PDF_TYPE.descLabel.size, linePt: PDF_TYPE.descLabel.line, bold: true, color: PDF_COLORS.muted },
        P,
      ),
    );
    for (const block of remarksBlocks) {
      const wrapped = wrapPdfSegments([{ text: pdfDisplayText(block.content) }], widthPt, PDF_TYPE.remarks.size);
      wrapped.forEach((textLine) =>
        strips.push(textStrip(textLine, { size: PDF_TYPE.remarks.size, linePt: PDF_TYPE.remarks.line }, P)),
      );
    }
  }

  return strips;
}

/** 把一個 Item 排成一列（或超長時多段）。圖例按原樣式放在列內圖片欄。 */
function buildItemBlocks(ctx: Ctx, item: QuotePdfItem, serial: string): PdfBlock[] {
  const { labels, P } = ctx;
  const columns = pdfColumnWidths(ctx.locale);
  const customWidth = columns.desc + columns.spec + columns.material + columns.image;
  let desc = item.isCustomTerm
    ? plainLines(item.name || '', customWidth - 8, PDF_TYPE.material.size).map((line) =>
      textStrip(line, { size: PDF_TYPE.material.size, linePt: PDF_TYPE.material.line }, P))
    : [...buildDescStrips(ctx, item, columns.desc - 4, P),
      ...buildColorStrips(ctx, item, columns.desc - 4, P)];
  let spec = item.isCustomTerm ? [] : buildSpecStrips(ctx, item, columns.spec - 4, P);
  let material = item.isCustomTerm ? [] : buildMaterialStrips(ctx, item, columns.material - 6, P);

  // 圖例欄：產品圖／參考圖／備註圖自適應排版（原樣式：圖片在列內圖片欄）。
  const galleryWidth = itemImageColumnWidthPt(ctx.locale);
  const gallery = item.isCustomTerm
    ? null
    : layoutItemImages(itemImageSources(item), { widthPt: galleryWidth });

  const priceValues: Array<{ key: PdfColumnKey; text: string; bold?: boolean; align: 'center' | 'right' }> = [
    { key: 'qty', text: String(item.quantity ?? 0), align: 'center' },
    { key: 'unit', text: pdfDisplayText(item.unit || ''), align: 'center' },
    { key: 'unitPrice', text: `HK$${(item.unitPrice || 0).toLocaleString()}`, align: 'right' },
    { key: 'total', text: item.isOptional ? labels.optionalProduct : `HK$${quoteItemLineSubtotal(item).toLocaleString()}`,
      bold: !item.isOptional, align: 'right' },
  ];
  const prices = priceValues.map((cell) => ({ ...cell,
    lines: plainLines(cell.text, columns[cell.key] - 5, PDF_TYPE.cell.size, cell.bold),
  }));
  const priceHeight = Math.max(...prices.map((cell) => cell.lines.length * PDF_TYPE.cell.line));
  // A segment must fit even under the full first-page header. No content is discarded.
  const tableHeight = buildTableHeader(ctx, P).heightPt;
  const capacity = PDF_CONTENT_HEIGHT_PT - Math.max(buildHeader(ctx, P).heightPt,
    buildCompactHeader(ctx, P).heightPt) - tableHeight - PDF_FOOTER_HEIGHT_PT - 5;
  const rowStyle = { flexDirection: 'row' as const, borderTopWidth: BORDER,
    borderLeftWidth: BORDER, borderRightWidth: BORDER, borderColor: RULE };
  const blocks: PdfBlock[] = [];
  let first = true;
  do {
    const continuationHeight = first ? 0 : PDF_TYPE.descLabel.line;
    const available = Math.max(40, capacity - ROW_PAD * 2 - ROW_SLACK_PT - continuationHeight);
    const d = takeStrips(desc, available);
    const sp = takeStrips(spec, available);
    const m = takeStrips(material, available);
    desc = d.rest; spec = sp.rest; material = m.rest;
    const heightPt = Math.max(sumHeight(d.taken) + continuationHeight, sumHeight(sp.taken),
      sumHeight(m.taken), first ? priceHeight : 0,
      first && gallery ? gallery.heightPt : 0, PDF_TABLE.minRowHeightPt - ROW_PAD * 2)
      + ROW_PAD * 2 + ROW_SLACK_PT;
    const showPrices = first;
    const continued = !first;
    blocks.push({
      key: `item-${serial}-text-${blocks.length}`, heightPt, table: true,
      node: <P.View style={{ ...rowStyle, height: heightPt }}>
        <P.View style={cellStyle(columns.no, { center: true })}>
          <P.Text style={{ fontSize: PDF_TYPE.cell.size }}>{serial}</P.Text>
        </P.View>
        <P.View style={{ ...cellStyle(item.isCustomTerm ? customWidth : columns.desc), paddingHorizontal: item.isCustomTerm ? 4 : 2 }}>
          {continued ? <P.View style={{ height: continuationHeight }}>
            <P.Text style={{ fontSize: PDF_TYPE.descLabel.size, color: PDF_COLORS.muted }}>{labels.itemContinued}</P.Text>
          </P.View> : null}
          {stackNode(d.taken, P)}
        </P.View>
        {!item.isCustomTerm ? <>
          <P.View style={cellStyle(columns.spec)}>{stackNode(sp.taken, P)}</P.View>
          <P.View style={{ ...cellStyle(columns.material), paddingHorizontal: 3 }}>{stackNode(m.taken, P)}</P.View>
          <P.View style={cellStyle(columns.image, { center: true })}>
            {gallery && first ? renderGalleryRow(gallery.images, gallery.heightPt, galleryWidth, P) : null}
          </P.View>
        </> : null}
        {prices.map((cell, index) => <P.View key={cell.key}
          style={cellStyle(columns[cell.key], { center: true, borderRight: index < prices.length - 1 })}>
          {showPrices ? <P.Text style={{
            width: columns[cell.key] - 5,
            fontSize: PDF_TYPE.cell.size,
            lineHeight: lineHeightRatio(PDF_TYPE.cell.size, PDF_TYPE.cell.line),
            textAlign: cell.align,
            fontWeight: cell.bold ? 700 : 400,
          }}>{cell.lines.map((line) => line.text).join('\n')}</P.Text> : null}
        </P.View>)}
      </P.View>,
    });
    first = false;
  } while (desc.length || spec.length || material.length);

  // Keep the description and its photos together whenever the full item fits a page.
  const heightPt = blocks.reduce((sum, block) => sum + block.heightPt, 0);
  if (heightPt <= capacity) {
    return [{ key: `item-${serial}`, heightPt, table: true,
      node: <P.View>{blocks.map((block) => <P.View key={block.key} style={{ height: block.heightPt }}>{block.node}</P.View>)}</P.View> }];
  }
  return blocks;
}

// ─── 其他區塊 ───────────────────────────────────────────────────────────────

/** react-pdf ignores objectFit, so both axes on an Image stretch it. Fit from the real ratio instead. */
function fittedImageBox(
  frameW: number,
  frameH: number,
  imageRatio: number,
  fit: 'contain' | 'cover',
  offsetX: number,
  offsetY: number,
  scale: number,
) {
  const frameRatio = frameW / Math.max(frameH, 0.01);
  const imageWider = imageRatio >= frameRatio;
  let width = fit === 'cover'
    ? (imageWider ? frameH * imageRatio : frameW)
    : (imageWider ? frameW : frameH * imageRatio);
  let height = width / imageRatio;
  if (fit === 'cover') {
    const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
    width *= zoom;
    height *= zoom;
  }
  const ox = fit === 'cover' ? offsetX : 0.5;
  const oy = fit === 'cover' ? offsetY : 0.5;
  return {
    position: 'absolute' as const,
    left: (frameW - width) * ox,
    top: (frameH - height) * oy,
    width,
    height,
  };
}

function buildLeadImageBlock(ctx: Ctx, imageUrls: string[] | undefined, key: string): PdfBlock | null {
  const P = ctx.P;
  const images = (imageUrls ?? []).filter((url) => url.startsWith('http')).slice(0, 6);
  if (!images.length) return null;
  const heightPt = 78;
  return {
    key,
    heightPt,
    table: true,
    node: (
      <P.View
        style={{
          height: heightPt,
          backgroundColor: '#ffffff',
          borderTopWidth: BORDER,
          borderLeftWidth: BORDER,
          borderRightWidth: BORDER,
          borderColor: RULE,
        }}
      >
        <P.View style={{ height: heightPt, flexDirection: 'row', paddingHorizontal: 6, paddingVertical: 6 }}>
          {images.map((url) => {
            const size = peekImageSize(url);
            const ratio = size && size.width > 0 && size.height > 0 ? size.width / size.height : 4 / 3;
            const box = fittedImageBox(90, 66, ratio, 'contain', 0.5, 0.5, 1);
            return (
              <P.View key={url} style={{ width: 90, height: 66, marginRight: 6, position: 'relative' }}>
                <P.Image src={url} style={box} />
              </P.View>
            );
          })}
        </P.View>
      </P.View>
    ),
  };
}

function buildSectionBlock(ctx: Ctx, text: string, index: number): PdfBlock {
  const P = ctx.P;
  const heightPt = 22;
  return {
    key: `section-${index}-${text}`,
    heightPt,
    table: true,
    node: (
      <P.View
        style={{
          height: heightPt,
          backgroundColor: PDF_TABLE.sectionBg,
          borderTopWidth: BORDER,
          borderLeftWidth: BORDER,
          borderRightWidth: BORDER,
          borderColor: RULE,
        }}
      >
        <P.View style={{ height: 22, justifyContent: 'center', paddingHorizontal: 6 }}>
          <P.Text style={{ fontSize: 9, fontWeight: 700 }}>{text}</P.Text>
        </P.View>
      </P.View>
    ),
  };
}

function buildZoneBlock(ctx: Ctx, name: string, amount: number): PdfBlock {
  const P = ctx.P;
  const heightPt = 20;
  return {
    key: `zone-${name}`,
    heightPt,
    table: true,
    node: (
      <P.View
        style={{
          height: heightPt,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 8,
          borderTopWidth: BORDER,
          borderLeftWidth: BORDER,
          borderRightWidth: BORDER,
          borderColor: RULE,
          backgroundColor: '#fbfcfd',
        }}
      >
        <P.Text style={{ fontSize: 8, fontWeight: 700 }}>
          {pdfDisplayText(`${name} ${ctx.labels.zoneSubtotal}`)}
        </P.Text>
        <P.Text style={{ fontSize: 8, fontWeight: 700 }}>{`HK$${amount.toLocaleString()}`}</P.Text>
      </P.View>
    ),
  };
}

function buildInstallBlock(ctx: Ctx): PdfBlock {
  const { columns, data, labels, locale } = ctx;
  const P = ctx.P;
  const leadWidth = columns.no + columns.desc + columns.spec + columns.material;
  const conditionWidth = columns.image + columns.qty + columns.unit;
  const title = pdfDisplayText(data.installationFee?.title || labels.installTitle);
  const subtitle = pdfDisplayText(data.installationFee?.subtitle || labels.installSubtitle);
  const condition = pdfDisplayText(data.installationFee?.conditionText || labels.installCondition);
  const leadLines = wrapPdfText(`${title}`, leadWidth - 12, 7.5, true).length +
    wrapPdfText(subtitle, leadWidth - 12, 6.8).length;
  const conditionLines = wrapPdfText(condition, conditionWidth - 8, 6.8).length;
  const heightPt = Math.max(28, Math.max(leadLines, conditionLines) * 9.6 + 10);

  const amountText = ctx.isFreeInstallation
    ? 'FREE'
    : ctx.installFeeRaw === null || ctx.installFeeRaw === undefined
      ? ''
      : ctx.installFeeRaw === 0
        ? 'HK$0'
        : `HK$${Number(ctx.installFeeRaw).toLocaleString()}`;

  return {
    key: 'install',
    heightPt,
    table: true,
    node: (
      <P.View
        style={{
          height: heightPt,
          flexDirection: 'row',
          borderTopWidth: BORDER,
          borderLeftWidth: BORDER,
          borderRightWidth: BORDER,
          borderBottomWidth: BORDER,
          borderColor: RULE,
        }}
      >
        <P.View style={{ ...cellStyle(leadWidth), paddingVertical: 4, paddingLeft: 6 }}>
          {wrapPdfText(title, leadWidth - 12, 7.5, true).map((line, index) => (
            <P.Text key={`t-${index}`} style={{ fontSize: 7.5, fontWeight: 700, lineHeight: 1.35 }}>
              {line}
            </P.Text>
          ))}
          {wrapPdfText(subtitle, leadWidth - 12, 6.8).map((line, index) => (
            <P.Text key={`s-${index}`} style={{ fontSize: 6.8, lineHeight: 1.35, color: PDF_COLORS.muted }}>
              {line}
            </P.Text>
          ))}
        </P.View>
        <P.View style={{ ...cellStyle(conditionWidth), paddingVertical: 4 }}>
          {wrapPdfText(condition, conditionWidth - 8, 6.8).map((line, index) => (
            <P.Text key={`c-${index}`} style={{ fontSize: 6.8, lineHeight: 1.35, textAlign: 'center' }}>
              {line}
            </P.Text>
          ))}
        </P.View>
        <P.View style={cellStyle(columns.unitPrice, { center: true })}>
          <P.Text style={{ fontSize: 7.5, textAlign: 'center' }}>
            {ctx.isFreeInstallation ? 'FREE' : ''}
          </P.Text>
        </P.View>
        <P.View style={cellStyle(columns.total, { center: true, borderRight: false })}>
          <P.Text style={{ fontSize: 7.5, textAlign: 'center' }}>{amountText}</P.Text>
        </P.View>
      </P.View>
    ),
  };
}

function buildTotalsBlock(ctx: Ctx): PdfBlock {
  const { labels, locale, columns } = ctx;
  const P = ctx.P;
  const rows: Array<{ label: string; value: string; bold?: boolean }> = [];

  if (ctx.discountValue > 0) {
    rows.push({ label: 'Discount', value: `HK$${ctx.discountValue.toLocaleString()}` });
  }

  const zonePlacement = ctx.data.format?.zoneSubtotalPlacement ?? 'section_and_summary';
  const zoneTotals = zonePlacement === 'hidden' ? [] : quoteZoneTotals(ctx.data.items || []);
  if (zonePlacement === 'summary_only' && zoneTotals.length) {
    zoneTotals.forEach((zone) => rows.push({ label: zone.name, value: `HK$${zone.amount.toLocaleString()}` }));
  }

  rows.push({ label: `${labels.grandTotal}:`, value: `HK$${ctx.totalAmount.toLocaleString()}`, bold: true });
  if (ctx.showCnyTotal) {
    rows.push({
      label: `${labels.grandTotal}:`,
      value: `CNY$${quoteCnyTotalFromHkd(ctx.totalAmount).toLocaleString()}`,
      bold: true,
    });
  }

  // 列高至少要容納 10pt 粗體的行高：固定高祖先若小於文字行高，
  // react-pdf 會直接丟棄該文字（總金額曾因此不顯示）。
  const rowHeight = 18;
  const heightPt = rows.length * rowHeight + 10;
  const labelWidth = locale === 'en' ? 104 : 76;
  const valueWidth = 96;

  return {
    key: 'totals',
    heightPt,
    node: (
      <P.View style={{ height: heightPt, justifyContent: 'flex-end', paddingTop: 4 }}>
        {rows.map((row, index) => (
          <P.View
            key={`${row.label}-${index}`}
            style={{ height: rowHeight, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}
          >
            <P.Text
              style={{
                width: labelWidth,
                fontSize: row.bold ? 9 : 8,
                fontWeight: row.bold ? 700 : 400,
                textAlign: 'right',
                marginRight: 8,
              }}
            >
              {row.label}
            </P.Text>
            <P.View style={{ width: valueWidth, borderBottomWidth: row.bold ? 1 : 0, borderColor: PDF_COLORS.strongRule }}>
              <P.Text
                style={{
                  fontSize: moneyLine(row.value, valueWidth - 2, row.bold ? 10 : 8, row.bold).size,
                  fontWeight: row.bold ? 700 : 400,
                  textAlign: 'right',
                }}
              >
                {row.value}
              </P.Text>
            </P.View>
          </P.View>
        ))}
      </P.View>
    ),
  };
}

/** Bounding box of the slots that actually have a photo, as fractions of the layout. */
function occupiedLayoutBox(geometry: PhotoPrintBlock['geometry'], placements: PhotoPrintBlock['placements']) {
  const used = geometry.slots.filter((slot) => placements.some((entry) => entry.slotId === slot.id));
  if (!used.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...used.map((slot) => slot.x));
  const y = Math.min(...used.map((slot) => slot.y));
  const right = Math.max(...used.map((slot) => slot.x + slot.w));
  const bottom = Math.max(...used.map((slot) => slot.y + slot.h));
  return { x, y, w: Math.max(0.01, right - x), h: Math.max(0.01, bottom - y) };
}

function buildPhotoBlocks(ctx: Ctx, options?: { frame?: boolean }): PdfBlock[] {
  const { data } = ctx;
  const P = ctx.P;
  const blocks: PdfBlock[] = [];
  const frameLayout = options?.frame === true;

  const layoutBlocks = (data.quotePhotoLayouts?.groups ?? []).flatMap((group) => printBlocks(group));
  if (layoutBlocks.length) {
    const assets = new Map((data.quotePhotoLayouts?.assets ?? []).map((asset) => [asset.id, asset.url]));
    layoutBlocks.forEach((block: PhotoPrintBlock, index: number) => {
      const crop = frameLayout
        ? occupiedLayoutBox(block.geometry, block.placements)
        : { x: 0, y: 0, w: 1, h: 1 };
      const pad = frameLayout ? 6 : 0;
      const baseWidthPt = PDF_CONTENT_WIDTH_MM * PT_PER_MM * crop.w;
      const baseHeightPt = block.geometry.heightMm * PT_PER_MM * crop.h;
      const maxHeightPt = PDF_CONTENT_HEIGHT_PT - 90;
      const scale = Math.min(PDF_CONTENT_WIDTH_PT / (baseWidthPt + pad * 2), maxHeightPt / (baseHeightPt + pad * 2));
      const innerW = baseWidthPt * scale;
      const innerH = baseHeightPt * scale;
      const widthPt = innerW + pad * 2;
      const heightPt = innerH + pad * 2;
      const textArea = block.geometry.text;
      const first = block.placements[0];
      const marginTop = frameLayout ? (index === 0 ? 0 : 4) : (index === 0 ? 12 : 8);

      blocks.push({
        key: `photo-layout-${block.key}`,
        heightPt: heightPt + marginTop,
        node: (
          <P.View
            style={{
              width: widthPt,
              height: heightPt,
              position: 'relative',
              marginTop,
              marginLeft: Math.max(0, (PDF_CONTENT_WIDTH_PT - widthPt) / 2),
              borderWidth: frameLayout ? 0.8 : 0,
              borderColor: '#cbd5e1',
              backgroundColor: '#ffffff',
            }}
          >
            {block.geometry.slots.map((slot) => {
              const placement = block.placements.find((entry) => entry.slotId === slot.id);
              const url = placement ? assets.get(placement.assetId) : undefined;
              const area = imageRect(slot, block.geometry);
              const imageShare = area.h / slot.h;
              const frame = placement && url ? frameInSlot(area, block.geometry.heightMm, placement) : null;
              return (
                <P.View
                  key={slot.id}
                  style={{
                    position: 'absolute',
                    left: pad + ((slot.x - crop.x) / crop.w) * innerW,
                    top: pad + ((slot.y - crop.y) / crop.h) * innerH,
                    width: (slot.w / crop.w) * innerW,
                    height: (slot.h / crop.h) * innerH,
                    overflow: 'hidden',
                  }}
                >
                  {placement && url && frame ? (
                    <>
                      <P.View
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: '100%',
                          height: `${imageShare * 100}%`,
                          overflow: 'hidden',
                        }}
                      >
                        <P.View
                          style={{
                            position: 'absolute',
                            left: `${frame.left * 100}%`,
                            top: `${frame.top * 100}%`,
                            width: `${frame.width * 100}%`,
                            height: `${frame.height * 100}%`,
                            overflow: 'hidden',
                          }}
                        >
                          <P.Image
                            src={url}
                            style={(() => {
                              const slotWpt = (slot.w / crop.w) * innerW;
                              const slotHpt = (slot.h / crop.h) * innerH;
                              const frameWpt = frame.width * slotWpt;
                              const frameHpt = frame.height * slotHpt * imageShare;
                              const size = peekImageSize(url);
                              const ratio = size && size.width > 0 && size.height > 0 ? size.width / size.height : 0;
                              if (!ratio || frameWpt <= 0 || frameHpt <= 0) return { width: '100%' };
                              return fittedImageBox(
                                frameWpt,
                                frameHpt,
                                ratio,
                                placement.fitMode === 'cover' ? 'cover' : 'contain',
                                placement.offsetX,
                                placement.offsetY,
                                placement.scale,
                              );
                            })()}
                          />
                        </P.View>
                      </P.View>
                      {block.geometry.captionMm ? (
                        <P.Text
                          style={{
                            position: 'absolute',
                            left: 0,
                            bottom: 0,
                            width: '100%',
                            height: `${(1 - imageShare) * 100}%`,
                            paddingTop: 2,
                            fontSize: 6.5,
                            lineHeight: 1.25,
                            textAlign: 'center',
                            color: '#334155',
                          }}
                        >
                          {pdfDisplayText(placement.caption || '')}
                        </P.Text>
                      ) : null}
                    </>
                  ) : null}
                </P.View>
              );
            })}
            {textArea ? (
              <P.View
                style={{
                  position: 'absolute',
                  left: pad + ((textArea.x - crop.x) / crop.w) * innerW,
                  top: pad + ((textArea.y - crop.y) / crop.h) * innerH,
                  width: (textArea.w / crop.w) * innerW,
                  height: (textArea.h / crop.h) * innerH,
                  justifyContent: 'center',
                  paddingHorizontal: 4,
                }}
              >
                {first?.title ? (
                  <P.Text style={{ fontSize: 9, fontWeight: 700 }}>{pdfDisplayText(first.title)}</P.Text>
                ) : null}
                {first?.caption ? (
                  <P.Text style={{ fontSize: 8, color: '#475569', marginTop: 3 }}>
                    {pdfDisplayText(first.caption)}
                  </P.Text>
                ) : null}
              </P.View>
            ) : null}
          </P.View>
        ),
      });
    });
    return blocks;
  }

  // AI 參考圖要標示「僅供設計參考」：整個圖片區塊只印一次，不逐張加註以免擠爆版式。
  const generatedIds = new Set(
    (data.quotePhotoLayouts?.assets ?? []).filter((asset) => asset.isGenerated).map((asset) => asset.id),
  );
  const usesGenerated =
    generatedIds.size > 0 &&
    (data.quotePhotoLayouts?.groups ?? []).some((group) =>
      group.placements.some((placement) => generatedIds.has(placement.assetId)),
    );
  if (usesGenerated) {
    blocks.push({
      key: 'photo-ai-note',
      heightPt: 16,
      node: (
        <P.Text style={{ fontSize: 6.5, color: PDF_COLORS.muted, marginTop: 4 }}>
          {pdfDisplayText(AI_REFERENCE_LABEL)}
        </P.Text>
      ),
    });
  }

  // 舊資料：報價單圖片（3 張一列）
  const photoRows = quotePhotoPrintRows(data.quotePhotos ?? []);
  const cellWidth = (PDF_CONTENT_WIDTH_PT - 6 * PT_PER_MM) / 3;
  photoRows.forEach((row, index) => {
    const captionHeight = row.captions ? QUOTE_PHOTO_CAPTION_PT : 0;
    blocks.push({
      key: row.key,
      heightPt: QUOTE_PHOTO_ROW_HEIGHT_PT + captionHeight + (index === 0 ? 12 : 6),
      node: (
        <P.View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            marginTop: index === 0 ? 12 : 6,
          }}
        >
          {row.cells.map((photo, cellIndex) => (
            <P.View
              key={photo.id}
              style={{
                width: cellWidth,
                height: QUOTE_PHOTO_ROW_HEIGHT_PT + captionHeight,
                marginRight: cellIndex === row.cells.length - 1 ? 0 : 6 * PT_PER_MM,
              }}
            >
              <P.View style={{ width: '100%', height: QUOTE_PHOTO_ROW_HEIGHT_PT, position: 'relative' }}>
                <P.Image
                  src={photo.url}
                  style={(() => {
                    const size = peekImageSize(photo.url);
                    const ratio = size && size.width > 0 && size.height > 0 ? size.width / size.height : 0;
                    if (!ratio) return { width: '100%' };
                    return fittedImageBox(cellWidth, QUOTE_PHOTO_ROW_HEIGHT_PT, ratio, 'contain', 0.5, 0.5, 1);
                  })()}
                />
              </P.View>
              {row.captions ? (
                <P.Text style={{ fontSize: 6.5, color: PDF_COLORS.muted, marginTop: 2 }}>
                  {pdfDisplayText(photo.caption || '')}
                </P.Text>
              ) : null}
            </P.View>
          ))}
        </P.View>
      ),
    });
  });
  return blocks;
}

function buildZoneLayoutBlocks(
  ctx: Ctx,
  groups: PhotoLayoutGroup[] | undefined,
  keyPrefix: string,
): PdfBlock[] {
  if (!groups?.some((group) => group.placements.length > 0)) return [];
  return buildPhotoBlocks({
    ...ctx,
    data: {
      ...ctx.data,
      quotePhotos: [],
      quotePhotoLayouts: {
        groups,
        assets: ctx.data.quotePhotoLayouts?.assets ?? [],
      },
    },
  }, { frame: true }).map((block, index) => ({ ...block, key: `${keyPrefix}-${block.key}-${index}` }));
}

function buildDeliveryBlock(ctx: Ctx): PdfBlock {
  const P = ctx.P;
  const titleHeight = PDF_TYPE.sectionTitle.line;
  const textLines = plainLines(ctx.data.deliveryDetails || '', PDF_CONTENT_WIDTH_PT, 8.5);
  const linePt = 13;
  const heightPt = titleHeight + 4 + textLines.length * linePt + 12;
  return {
    key: 'delivery',
    heightPt,
    node: (
      <P.View style={{ height: heightPt, paddingTop: 0 }}>
        <P.Text style={{ fontSize: PDF_TYPE.sectionTitle.size, fontWeight: 700, lineHeight: 1.4 }}>
          {pdfDisplayText(ctx.labels.deliveryTitle)}
        </P.Text>
        <P.View style={{ height: 4 }} />
        {textLines.map((line, index) => (
          <P.View key={index} style={{ height: linePt, justifyContent: 'center' }}>
            <P.Text style={{ fontSize: 8.5, lineHeight: lineHeightRatio(8.5, linePt) }}>
              {renderInline(line.segments, undefined, P)}
            </P.Text>
          </P.View>
        ))}
      </P.View>
    ),
  };
}

function buildTermsBlocks(ctx: Ctx): PdfBlock[] {
  const P = ctx.P;
  const { data, labels, locale } = ctx;
  const blocks: PdfBlock[] = [];
  const qrUrl = data.format?.qrDataUrl;
  const qrSize = 80;
  const qrColumnWidth = 96;
  const columnGap = 14;
  const termsWidth = qrUrl ? PDF_CONTENT_WIDTH_PT - qrColumnWidth - columnGap : PDF_CONTENT_WIDTH_PT;
  const finish = (): PdfBlock[] => {
    if (!qrUrl) return blocks;
    const caption = plainLines(data.format?.qrCaption || '', qrColumnWidth, PDF_TYPE.descValue.size);
    const qrHeight = 4 + qrSize + (caption.length ? 4 + caption.length * 9.5 : 0);
    let leftHeight = 0;
    let count = 0;
    // Keep the QR and the opening terms together as one measured page block.
    while (count < blocks.length && leftHeight < qrHeight) {
      leftHeight += blocks[count].heightPt;
      count += 1;
    }
    const opening = blocks.slice(0, count);
    const heightPt = Math.max(leftHeight, qrHeight);
    return [{
      key: 'terms-with-qr',
      heightPt,
      keepWithNext: opening[opening.length - 1]?.keepWithNext,
      node: (
        <P.View style={{ height: heightPt, flexDirection: 'row' }}>
          <P.View style={{ width: termsWidth, marginRight: columnGap }}>
            {opening.map((block) => <P.View key={block.key}>{block.node}</P.View>)}
          </P.View>
          <P.View style={{ width: qrColumnWidth, alignItems: 'center', paddingTop: 4 }}>
            <P.Image src={qrUrl} style={{ width: qrSize, height: qrSize }} />
            {caption.map((line, index) => (
              <P.Text key={index} style={{ width: qrColumnWidth, fontSize: PDF_TYPE.descValue.size, lineHeight: lineHeightRatio(PDF_TYPE.descValue.size, 9.5), textAlign: 'center', marginTop: index === 0 ? 4 : 0 }}>{line.text}</P.Text>
            ))}
          </P.View>
        </P.View>
      ),
    }, ...blocks.slice(count)];
  };

  blocks.push({
    key: 'terms-title',
    heightPt: PDF_TYPE.sectionTitle.line + 8,
    keepWithNext: true,
    node: (
      <P.View style={{ height: PDF_TYPE.sectionTitle.line + 8, justifyContent: 'flex-end', paddingBottom: 4 }}>
        <P.Text style={{ fontSize: PDF_TYPE.sectionTitle.size, fontWeight: 700, textDecoration: 'underline' }}>
          {pdfDisplayText(labels.termsTitle)}
        </P.Text>
      </P.View>
    ),
  });

  const html = data.termsContent?.fullHtml || '';
  const hasHtml = /<p|<div|<br|<strong|<u/i.test(html) && html.replace(/<[^>]*>/g, '').replace(/\s/g, '').length > 0;

  const pushLines = (key: string, lines: PdfTextLine[], size: number, linePt: number, extra: { marginTopPt?: number; keepWithNext?: boolean; bold?: boolean } = {}) => {
    const marginTop = extra.marginTopPt ?? 0;
    const heightPt = lines.length * linePt + marginTop + 1.5;
    blocks.push({
      key,
      heightPt,
      keepWithNext: extra.keepWithNext,
      node: (
        <P.View style={{ width: termsWidth, height: heightPt, paddingTop: marginTop }}>
          {lines.map((line, index) => (
            <P.View key={index} style={{ height: linePt, justifyContent: 'center' }}>
              <P.Text
                style={{
                  fontSize: size,
                  lineHeight: lineHeightRatio(size, linePt),
                  fontWeight: extra.bold ? 700 : 400,
                }}
              >
                {renderInline(line.segments, extra.bold, P)}
              </P.Text>
            </P.View>
          ))}
        </P.View>
      ),
    });
  };

  if (hasHtml) {
    parseHtmlForPdf(html).forEach((block, index) => {
      if (block.type === 'spacer') {
        blocks.push({ key: `term-sp-${index}`, heightPt: 6, node: <P.View style={{ height: 6 }} /> });
        return;
      }
      const isHeading = block.type === 'heading';
      const size = isHeading ? PDF_TYPE.termsHeading.size : PDF_TYPE.terms.size;
      const linePt = isHeading ? PDF_TYPE.termsHeading.line : PDF_TYPE.terms.line;
      const lines = wrapPdfSegments(block.segments, termsWidth, size);
      if (!lines.length) return;
      pushLines(`term-${index}`, lines, size, linePt, {
        marginTopPt: isHeading ? 6 : 0,
        keepWithNext: isHeading,
        bold: isHeading,
      });
    });
    return finish();
  }

  // 沒有富文本：用結構化條款（交付地址／付款／運輸／額外費用／保養／其他）。
  const heading = locale === 'en'
    ? {
        deliveryAddress: '1　Delivery Address: ',
        deliveryAddressFallback: 'Customer must provide an accurate delivery address. This quotation applies to standard areas in Hong Kong.',
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

  const addressLine = `${heading.deliveryAddress}${data.quoteMeta?.deliveryAddress || heading.deliveryAddressFallback}`;
  pushLines(
    'term-address',
    plainLines(addressLine, termsWidth, PDF_TYPE.terms.size),
    PDF_TYPE.terms.size,
    PDF_TYPE.terms.line,
  );

  const sections: Array<[string, string | undefined]> = [
    [heading.payment, data.termsContent?.payment],
    [heading.transport, data.termsContent?.transport],
    [heading.extraFees, data.termsContent?.extraFees],
    [heading.warranty, data.termsContent?.warranty],
    [heading.other, data.termsContent?.other],
  ];

  sections.forEach(([title, body], index) => {
    pushLines(
      `term-h-${index}`,
      plainLines(title, termsWidth, PDF_TYPE.termsHeading.size, true),
      PDF_TYPE.termsHeading.size,
      PDF_TYPE.termsHeading.line,
      { marginTopPt: 7, keepWithNext: true, bold: true },
    );
    const text = (body || '').trim();
    if (!text) return;
    const lines = text
      .split('\n')
      .flatMap((line) => plainLines(line, termsWidth, PDF_TYPE.terms.size));
    pushLines(`term-b-${index}`, lines, PDF_TYPE.terms.size, PDF_TYPE.terms.line);
  });

  return finish();
}

function buildSignatureBlock(ctx: Ctx): PdfBlock {
  const { labels } = ctx;
  const P = ctx.P;
  const heightPt = 92;
  return {
    key: 'signature',
    heightPt,
    node: (
      <P.View style={{ height: heightPt, paddingTop: 14, flexDirection: 'row' }}>
        <P.View style={{ width: '52%' }}>
          <P.Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 8 }}>
            {pdfDisplayText(labels.customerAcceptance)}
          </P.Text>
          <P.Text style={{ fontSize: 8 }}>{pdfDisplayText(labels.customerSignLabel)}</P.Text>
          <P.View style={{ height: 30 }} />
          <P.View style={{ borderBottomWidth: 0.5, borderColor: PDF_COLORS.strongRule, width: '92%' }} />
          <P.Text style={{ fontSize: 7, color: PDF_COLORS.muted, marginTop: 4 }}>
            {pdfDisplayText(labels.dateOfSignature)}
          </P.Text>
        </P.View>
      </P.View>
    ),
  };
}

// ─── 文件 ───────────────────────────────────────────────────────────────────

export type QuotationPdfDocumentProps = {
  data: QuotationPDFData;
  pdfMod: ReactPdfModule;
  showCnyTotal?: boolean;
  /** Logo（預設同源 /assets/bwf-logo.png）。 */
  logoUrl?: string;
};

/**
 * 這份 PDF 會用到的全部圖片 URL。預先載入取得原始寬高，
 * 圖例排版才能在生成 PDF 前決定橫向／直向版式（PRD 4.3、6.2）。
 */
export function collectQuotationPdfImageUrls(data: QuotationPDFData): string[] {
  const urls = new Set<string>();
  const push = (url: string | undefined) => {
    const trimmed = (url || '').trim();
    if (trimmed) urls.add(trimmed);
  };
  for (const item of data.items || []) {
    push(item.image);
    push(item.referenceImage);
    (item.images || []).forEach((image) => push(image.url));
    for (const block of parseRemarksContent(item.remarks, item.remarksImage)) {
      if (block.type === 'image') push(block.src);
    }
  }
  (data.quotePhotos || []).forEach((photo) => push(photo.url));
  (data.quotePhotoLayouts?.assets || []).forEach((asset) => push(asset.url));
  (data.quoteCoverPages || []).forEach((page) => push(page.url));
  (data.quoteContentPages || []).forEach((page) => push(page.url));
  if (data.format?.qrDataUrl) push(data.format.qrDataUrl);
  return Array.from(urls);
}

export function QuotationDocument({
  data,
  pdfMod,
  showCnyTotal = false,
  logoUrl,
}: QuotationPdfDocumentProps) {
  const { Document, Page, Text, View, Image } = pdfMod;

  if (!data) {
    return (
      <Document>
        <Page size="A4" style={{ padding: PDF_PAGE_MARGIN.topPt }}>
          <Text>Loading Data...</Text>
        </Page>
      </Document>
    );
  }

  const locale: PdfLocale = data.locale === 'en' ? 'en' : 'zh';
  const labels = quotePdf(locale);
  const columns = pdfColumnWidths(locale);

  const today =
    data.quoteMeta?.date ||
    new Date().toLocaleDateString(locale === 'en' ? 'en-GB' : 'zh-HK', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  const quoteNumber = formatQuoteNumberWithVersion(
    data.quoteMeta?.quoteNumber || '',
    data.quoteMeta?.version,
  );
  const discountValue = (() => {
    const raw = data.discountNote;
    if (raw == null) return 0;
    const parsed = parseFloat(String(raw));
    return Number.isNaN(parsed) ? 0 : parsed;
  })();
  const isFreeInstallation = (data.subtotal || 0) >= 12000;
  const installationAmount = isFreeInstallation ? 0 : data.installationFee?.amount ?? 0;
  const totalAmount = Math.max(0, (data.subtotal || 0) - discountValue + installationAmount);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const ctx: Ctx = {
    data,
    labels,
    locale,
    columns,
    showCnyTotal,
    logoUrl: logoUrl || `${baseUrl}/assets/bwf-logo.png`,
    quoteNumber,
    today,
    totalAmount,
    discountValue,
    isFreeInstallation,
    installationAmount,
    installFeeRaw: data.installationFee?.amount,
    P: { Text, View, Image } as any,
  };

  const blocks: PdfBlock[] = [];
  const items = data.items || [];
  const zonePlacement = data.format?.zoneSubtotalPlacement ?? 'section_and_summary';
  const zoneTotals = quoteZoneTotals(items);
  const zoneEndAt = new Map(zoneTotals.map((zone) => [zone.endIndex, zone]));
  const showZoneSubtotal = zonePlacement === 'section_and_summary';

  const tableBlocks: PdfBlock[] = [];
  let pushedUnzoned = false;
  const pushUnzoned = () => {
    if (pushedUnzoned) return;
    pushedUnzoned = true;
    const lead = buildLeadImageBlock(ctx, data.leadImages, 'lead-images');
    if (lead) tableBlocks.push(lead);
    tableBlocks.push(
      ...buildZoneLayoutBlocks(ctx, data.zonePhotoLayouts?.[UNZONED_QUOTE_IMAGE_KEY], 'unzoned-layout'),
    );
  };
  const pushZoneMedia = (titleIndex: number) => {
    const title = items[titleIndex];
    if (!title?.isSectionTitle) return;
    const images = buildLeadImageBlock(ctx, title.zoneImages, `zone-images-${titleIndex}`);
    if (images) tableBlocks.push(images);
    if (title.id) {
      tableBlocks.push(
        ...buildZoneLayoutBlocks(ctx, data.zonePhotoLayouts?.[title.id], `zone-layout-${title.id}`),
      );
    }
  };
  items.forEach((item, index) => {
    if (item.isSectionTitle) {
      pushUnzoned();
      tableBlocks.push(
        buildSectionBlock(
          ctx,
          pdfDisplayText(
            formatSectionTitleLabel(
              sectionTitleOrdinalAt(items, index),
              item.name || '',
            ),
          ),
          index,
        ),
      );
      const zone = zoneEndAt.get(index);
      if (zone && showZoneSubtotal) tableBlocks.push(buildZoneBlock(ctx, zone.name, zone.amount));
      if (zone) pushZoneMedia(index);
      return;
    }
    tableBlocks.push(...buildItemBlocks(ctx, item, quoteItemSerialLabel(items, index)));
    const zone = zoneEndAt.get(index);
    if (zone && showZoneSubtotal) tableBlocks.push(buildZoneBlock(ctx, zone.name, zone.amount));
    if (zone) {
      let titleIndex = index;
      while (titleIndex >= 0 && !items[titleIndex]?.isSectionTitle) titleIndex -= 1;
      if (titleIndex >= 0) pushZoneMedia(titleIndex);
    }
  });
  if (!pushedUnzoned) pushUnzoned();

  if (items.length) tableBlocks.push(buildInstallBlock(ctx));

  blocks.push(...tableBlocks);
  blocks.push(buildTotalsBlock(ctx));
  blocks.push(...buildPhotoBlocks(ctx));
  blocks.push(buildDeliveryBlock(ctx));
  blocks.push(...buildTermsBlocks(ctx));
  blocks.push(buildSignatureBlock(ctx));

  const header = buildHeader(ctx, { Text, View, Image });
  const compactHeader = buildCompactHeader(ctx, { Text, View, Image });
  const tableHeader = buildTableHeader(ctx, { Text, View, Image });
  const hasTable = tableBlocks.length > 0;

  const footerReserve = PDF_FOOTER_HEIGHT_PT + 4;
  const capacityForPage = (pageIndex: number) => {
    const head = pageIndex === 0 ? header.heightPt : compactHeader.heightPt;
    return PDF_CONTENT_HEIGHT_PT - head - (hasTable ? tableHeader.heightPt : 0) - footerReserve;
  };

  const pages = paginatePdfBlocks(blocks, { capacityForPage });

  const pageStyle: Record<string, any> = {
    fontFamily: PDF_FONT_FAMILY as unknown as string[],
    fontSize: 8,
    color: PDF_COLORS.text,
    paddingTop: PDF_PAGE_MARGIN.topPt,
    paddingBottom: PDF_PAGE_MARGIN.bottomPt,
    paddingHorizontal: PDF_PAGE_MARGIN.xPt,
    backgroundColor: '#ffffff',
  };

  const coverPages = (data.quoteCoverPages ?? []).filter((page) => page.placement === 'cover');
  const backPages = (data.quoteCoverPages ?? []).filter((page) => page.placement === 'back');
  // 內頁獨立整頁：插在正文第 pageNumber 頁之後；超出正文頁數時排在正文最後一頁之後。
  const contentPages = (data.quoteContentPages ?? [])
    .slice()
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const contentPagesAfter = (bodyPageIndex: number) =>
    contentPages.filter((page) => page.pageNumber === bodyPageIndex + 1);
  const trailingContentPages = contentPages.filter(
    (page) => page.pageNumber > pages.length || page.pageNumber < 1,
  );
  const renderFullPageImage = (page: { id: string; url: string }, keyPrefix: string) => (
    <Page key={`${keyPrefix}-${page.id}`} size="A4" style={{ padding: 0 }}>
      <Image src={page.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </Page>
  );

  const footerNode = () => (
    <View
      style={{
        position: 'absolute',
        // 絕對定位的基準是「頁面外框」，Page 的 paddingHorizontal 不會替它讓位：
        // left/right 給 0 會讓報價單號與頁碼直接貼在裁切邊上（左右 0mm）。
        // 所以這裡自己讓出左右頁邊距，頁尾才會跟表格左右邊對齊。
        left: PDF_PAGE_MARGIN.xPt,
        right: PDF_PAGE_MARGIN.xPt,
        // bottom: 0 會把 footer 放到換行區（wrapArea = 頁高 − paddingBottom）之外，
        // react-pdf 分頁引擎的 isOutside 規則會把它整個搬到下一頁（產生孤兒頁）。
        // 抬到底邊距之上，使其 nodeTop + height 落在 wrapArea 內。
        bottom: PDF_FOOTER_BOTTOM_PT,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
      }}
    >
      <Text style={{ fontSize: PDF_TYPE.footer.size, color: PDF_COLORS.muted }}>
        {quoteNumber}
      </Text>
      <Text
        style={{ fontSize: PDF_TYPE.footer.size, color: PDF_COLORS.muted }}
        render={(props: { pageNumber: number; totalPages: number }) =>
          `Page ${props.pageNumber} / ${props.totalPages}` as unknown as React.ReactNode}
      />
    </View>
  );

  return (
    <Document
      title={`${labels.title} ${quoteNumber}`}
      author={pdfDisplayText(data.companyInfo?.name || '')}
      subject={pdfDisplayText(data.quoteMeta?.projectName || '')}
    >
      {coverPages.map((page) => renderFullPageImage(page, 'cover'))}

      {pages.map((page, pageIndex) => {
        const showTableHeader = hasTable && page.blocks.some((block) => block.table);
        const tableTail = (() => {
          let last = -1;
          page.blocks.forEach((block, index) => {
            if (block.table) last = index;
          });
          return last;
        })();
        return (
          <Fragment key={`page-${pageIndex}`}>
            <Page size="A4" style={pageStyle}>
              {pageIndex === 0 ? <View style={{ height: header.heightPt }}>{header.node}</View> : (
                <View style={{ height: compactHeader.heightPt }}>{compactHeader.node}</View>
              )}
              {showTableHeader ? <View style={{ height: tableHeader.heightPt }}>{tableHeader.node}</View> : null}
              {page.blocks.map((block, index) => (
                <View
                  key={block.key}
                  wrap={false}
                  style={{
                    height: block.heightPt,
                    borderBottomWidth: index === tableTail ? BORDER : 0,
                    borderColor: RULE,
                  }}
                >
                  {block.node}
                </View>
              ))}
              {footerNode()}
            </Page>
            {contentPagesAfter(pageIndex).map((contentPage) =>
              renderFullPageImage(contentPage, 'content'),
            )}
          </Fragment>
        );
      })}

      {trailingContentPages.map((page) => renderFullPageImage(page, 'content'))}

      {backPages.map((page) => renderFullPageImage(page, 'back'))}
    </Document>
  );
}
