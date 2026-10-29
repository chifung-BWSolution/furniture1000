/**
 * A4 報價單版面參數（單位：pt）。
 *
 * 所有尺寸集中在這裡：頁面、邊距、欄寬比例、字級、線粗、圖片上限。
 * 圖排版（quotationPdfImages）、分頁（quotationPdfPagination）與文件元件
 * （quotationPdfDocument）都只讀這一份參數，不在元件內寫死數字。
 *
 * 1pt = 1/72 inch；A4 = 210 × 297mm = 595.276 × 841.89pt。
 */

export const PT_PER_MM = 2.834645669;

export type PdfLocale = 'zh' | 'en';

export const A4_PAGE = { widthPt: 595.276, heightPt: 841.89 } as const;

/** 頁邊距：左右 10mm、上下 10mm／12mm（PRD 2.1：10–12mm）。 */
export const PDF_PAGE_MARGIN = {
  xPt: 10 * PT_PER_MM,
  topPt: 10 * PT_PER_MM,
  bottomPt: 12 * PT_PER_MM,
} as const;

/** 可排版內容寬／高（扣掉頁邊距）。 */
export const PDF_CONTENT_WIDTH_PT = A4_PAGE.widthPt - PDF_PAGE_MARGIN.xPt * 2;
export const PDF_CONTENT_HEIGHT_PT =
  A4_PAGE.heightPt - PDF_PAGE_MARGIN.topPt - PDF_PAGE_MARGIN.bottomPt;

/** 頁尾「Page X / Y」保留高度，正文不可侵入。 */
export const PDF_FOOTER_HEIGHT_PT = 14;

/**
 * 頁尾文字與頁面底邊的距離（pt，約 12.3mm）。
 *
 * 頁尾用絕對定位，基準是頁面外框，Page 的 paddingBottom 不會替它讓位；
 * 這個值必須大於 `PDF_PAGE_MARGIN.bottomPt`，否則節點會被 react-pdf 的
 * isOutside 規則判定在換行區外，整塊搬到下一頁（產生孤兒頁）。
 */
export const PDF_FOOTER_BOTTOM_PT = 35;

// ─── 欄寬 ───────────────────────────────────────────────────────────────────

export type PdfColumnKey =
  | 'no'
  | 'desc'
  | 'spec'
  | 'material'
  | 'image'
  | 'qty'
  | 'unit'
  | 'unitPrice'
  | 'total';

/**
 * Item 表格欄寬比例（總和 = 1），依參考報價單 BWF-SH26-114 R7 的 9 欄結構。
 *
 * 序號／產品及說明／規格(mm)／材質及明細／圖片／數量／單位／單價／總額。
 * 圖片欄 18%（內容寬 538pt → 約 97pt／34mm）；備註不另設欄，併入材質及明細。
 * 英文版把「產品及說明」加寬、材質收窄，讓 “Dimensions (mm)” 等標籤不折行。
 */
export const PDF_COLUMN_PCT: Record<PdfLocale, Record<PdfColumnKey, number>> = {
  zh: {
    no: 0.035,
    desc: 0.155,
    spec: 0.1,
    material: 0.27,
    image: 0.18,
    qty: 0.04,
    unit: 0.04,
    unitPrice: 0.08,
    total: 0.1,
  },
  en: {
    no: 0.035,
    desc: 0.18,
    spec: 0.1,
    material: 0.245,
    image: 0.18,
    qty: 0.04,
    unit: 0.04,
    unitPrice: 0.08,
    total: 0.1,
  },
};

/** 依語系算出每一欄的實際寬度（pt）。 */
export function pdfColumnWidths(locale: PdfLocale): Record<PdfColumnKey, number> {
  const pct = PDF_COLUMN_PCT[locale];
  const keys = Object.keys(pct) as PdfColumnKey[];
  return keys.reduce(
    (acc, key) => {
      acc[key] = pct[key] * PDF_CONTENT_WIDTH_PT;
      return acc;
    },
    {} as Record<PdfColumnKey, number>,
  );
}

/** Item 資料列使用八欄；圖片移到下方跨欄展示，其他區塊沿用原有欄寬。 */
export function pdfItemColumnWidths(locale: PdfLocale): Record<PdfColumnKey, number> {
  const columns = pdfColumnWidths(locale);
  return {
    ...columns,
    desc: columns.desc + columns.image * 0.25,
    spec: columns.spec + columns.image * 0.15,
    material: columns.material + columns.image * 0.6,
    image: 0,
  };
}

export const PDF_ITEM_PHOTOS = {
  maxRowHeightPt: 160,
  gapPt: 6,
  paddingPt: 6,
} as const;

// ─── 字級與行高 ─────────────────────────────────────────────────────────────

/**
 * 字級沿用既有報價單（7–8pt），未整體放大到 PRD 建議的 8.5–9.5pt：
 * 放大会吃光每頁容量，而實際 100% 列印 7pt 中文仍可辨識。
 * 逐項可在這裡調整，元件不寫死。
 */
export const PDF_TYPE = {
  title: { size: 16, line: 21 },
  info: { size: 8, line: 11.5 },
  sectionTitle: { size: 10, line: 14 },
  itemName: { size: 8.5, line: 11.6 },
  descLabel: { size: 7, line: 9.5 },
  descValue: { size: 7.5, line: 10 },
  dimLabel: { size: 6.5, line: 9.5 },
  material: { size: 8, line: 11.6 },
  remarks: { size: 7.5, line: 11 },
  cell: { size: 7.5, line: 10.2 },
  header: { size: 6.8, line: 9.2 },
  terms: { size: 8, line: 13.6 },
  termsHeading: { size: 9, line: 13 },
  footer: { size: 7, line: 9 },
} as const;

// ─── 表格 ───────────────────────────────────────────────────────────────────

export const PDF_TABLE = {
  /** 表頭高度（沿用到續頁），固定值讓跨頁對位一致。 */
  headerHeightPt: 24,
  borderWidthPt: 0.5,
  borderColor: '#9aa3ab',
  headerBg: '#f2f4f6',
  sectionBg: '#f5f7f9',
  rowPaddingPt: 5,
  /** 每列上下留白（不含內距）。 */
  minRowHeightPt: 26,
} as const;

export const PDF_COLORS = {
  text: '#1a1a1a',
  muted: '#5b6670',
  rule: '#9aa3ab',
  strongRule: '#333333',
  imageSlotBg: '#f7f8fa',
} as const;

// ─── 圖片排版限制（PRD 4.5）─────────────────────────────────────────────────

export const PDF_IMAGE_LIMITS = {
  /** 單張圖片最大高度：45mm。 */
  maxSingleImageHeightPt: 45 * PT_PER_MM,
  /** 圖片組（整個圖例欄）最大高度，避免一行 Item 被圖片拉得過高。 */
  maxGalleryHeightPt: 168,
  /** 圖片間距：1.8mm。 */
  gapPt: 1.8 * PT_PER_MM,
  /** 圖片欄左右內距。 */
  cellPaddingPt: 2,
  /**
   * 候選排版中，任何一張圖片的最窄可接受寬度（相對欄寬）。
   * 低於此值代表「圖太小、看不清」，該方案會被淘汰。
   */
  minImageWidthRatio: 0.42,
  /** 比例分類門檻（可調參數，不寫死於多處）。 */
  landscapeThreshold: 1.1,
  portraitThreshold: 0.9,
} as const;

/** Item 圖片欄可用寬度（扣內距）。 */
export function itemImageColumnWidthPt(locale: PdfLocale): number {
  return pdfColumnWidths(locale).image - PDF_IMAGE_LIMITS.cellPaddingPt * 2;
}

// ─── 內文寬度輔助 ───────────────────────────────────────────────────────────

/** 文字欄可用寬度（扣左右內距）。 */
export function textColumnContentWidthPt(
  locale: PdfLocale,
  key: 'desc' | 'spec' | 'material',
  paddingEachSidePt = 3,
): number {
  return pdfColumnWidths(locale)[key] - paddingEachSidePt * 2;
}
