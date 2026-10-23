/**
 * 報價單圖片的印刷幾何（跟 QMS 的 3 欄網格一致）。
 *
 * 選中的圖片按順序排成 3 欄，每列固定高度，排在總價之後、訂單確認及交付細節之前。
 * 這裡只負責「切列 + 尺寸」，實際繪製在 QuotationPDFPreview 用 react-pdf 做。
 */

const MM_TO_PT = 2.834645669;

/** 要印出來的一張圖：名稱只作 alt / 無障礙用。 */
export type QuotePhotoPrintSource = {
  id: string;
  title: string;
  url: string;
  caption?: string;
};

/** A4 扣掉左右各 20pt 內距後的可用寬度。 */
export const QUOTE_PHOTO_CONTENT_WIDTH_PT = 595.28 - 40;
export const QUOTE_PHOTO_COLUMNS = 3;
export const QUOTE_PHOTO_GAP_PT = 3 * MM_TO_PT;
/** 每格（含圖與說明）高度：45mm，跟 QMS 的 GRID_ROW_HEIGHT_MM 一樣。 */
export const QUOTE_PHOTO_ROW_HEIGHT_PT = 45 * MM_TO_PT;
/** 圖片下方的說明頻帶：兩行。 */
export const QUOTE_PHOTO_CAPTION_PT = 8 * MM_TO_PT;

export function quotePhotoCellWidthPt(columns = QUOTE_PHOTO_COLUMNS): number {
  const gaps = QUOTE_PHOTO_GAP_PT * Math.max(0, columns - 1);
  return (QUOTE_PHOTO_CONTENT_WIDTH_PT - gaps) / columns;
}

export type QuotePhotoPrintRow = {
  key: string;
  cells: QuotePhotoPrintSource[];
  /** 這一列有沒有任何圖片帶說明，決定要不要留說明頻帶。 */
  captions: boolean;
};

/** 3 張一列；不足 3 張的最後一列照樣佔滿格寬，靠左排。 */
export function quotePhotoPrintRows(refs: QuotePhotoPrintSource[]): QuotePhotoPrintRow[] {
  const rows: QuotePhotoPrintRow[] = [];
  for (let start = 0; start < refs.length; start += QUOTE_PHOTO_COLUMNS) {
    const cells = refs.slice(start, start + QUOTE_PHOTO_COLUMNS);
    if (!cells.length) continue;
    rows.push({
      key: `quote-photo-row-${start}`,
      cells,
      captions: cells.some((cell) => Boolean(cell.caption?.trim())),
    });
  }
  return rows;
}
