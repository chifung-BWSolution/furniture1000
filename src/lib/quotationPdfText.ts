/**
 * PDF 文字度量與換行（PRD 5、6.2 的「內容測量」）。
 *
 * react-pdf 的排版是黑盒，無法在生成前取得每列文字的真實高度。做法是：
 * 1. 在瀏覽器用 canvas + 同一套 Noto Sans TC 字體量測字寬；
 * 2. 自己先換行成「行」，每行都是固定行高的盒子；
 * 3. 分頁時用行數算高度，渲染時直接把行印出（不再依賴 react-pdf 的自動換行）。
 *
 * 量測器未安裝時（例如 node 測試環境）退回等寬近似表，誤差由保守留白吸收。
 */

export type PdfInlineSegment = {
  text: string;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  /** 來自 TipTap Color mark（#rrggbb）。 */
  color?: string;
  /** 下劃線填空（條款用）。 */
  underlineBlank?: boolean;
};

export type PdfTextLine = {
  segments: PdfInlineSegment[];
  text: string;
};

export type PdfTextMeasure = (text: string, sizePt: number, bold: boolean) => number;

let measureFn: PdfTextMeasure | null = null;

export function setPdfTextMeasure(fn: PdfTextMeasure | null): void {
  measureFn = fn;
}

export function hasPdfTextMeasure(): boolean {
  return Boolean(measureFn);
}

const CJK_OR_KANA = /[\u2E80-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF\uFF00-\uFF60]/;

/**
 * 無量測器時的字寬估算（pt）。
 * 刻意「寧可高估」：低估會讓預折行的文字在真實字體下溢出容器，
 * 觸發 react-pdf 的折行＋刪節號（文字被截斷）。
 */
function fallbackCharWidth(ch: string, sizePt: number): number {
  if (CJK_OR_KANA.test(ch)) return sizePt;
  if (ch === ' ') return sizePt * 0.32;
  if (ch === '\t') return sizePt * 0.9;
  if (/[0-9]/.test(ch)) return sizePt * 0.62;
  if (/[A-Z]/.test(ch)) return sizePt * 0.74;
  if (/[a-z]/.test(ch)) return sizePt * 0.6;
  if (/[.,:;'’"”!|/\\()[\]-]/.test(ch)) return sizePt * 0.36;
  if (/[%&@#*+=<>?$~^`{}]/.test(ch)) return sizePt * 0.62;
  if (ch === '\u00A0') return sizePt * 0.32;
  return sizePt * 0.62;
}

const charWidthCache = new Map<string, number>();

/** 單一字元寬度（pt）。有量測器時走 canvas，並以字元為單位快取。 */
export function pdfCharWidth(ch: string, sizePt: number, bold = false): number {
  const key = `${bold ? 'b' : 'r'}|${sizePt}|${ch}`;
  const cached = charWidthCache.get(key);
  if (cached !== undefined) return cached;
  const width = measureFn ? measureFn(ch, sizePt, bold) : fallbackCharWidth(ch, sizePt);
  if (charWidthCache.size > 40_000) charWidthCache.clear();
  charWidthCache.set(key, width);
  return width;
}

export function pdfTextWidth(text: string, sizePt: number, bold = false): number {
  if (!text) return 0;
  let width = 0;
  for (const ch of Array.from(text)) width += pdfCharWidth(ch, sizePt, bold);
  return width;
}

export function pdfSegmentsWidth(segments: PdfInlineSegment[], sizePt: number): number {
  return segments.reduce(
    (sum, segment) => sum + pdfTextWidth(segment.text, sizePt, segment.bold),
    0,
  );
}

const NO_LINE_START = /^[、。，．,;；:：)）\]】」』!?！？%]/;

type StyledChar = {
  ch: string;
  bold: boolean;
  underline: boolean;
  italic: boolean;
  color?: string;
  underlineBlank?: boolean;
};

function flattenSegments(segments: PdfInlineSegment[]): StyledChar[] {
  const chars: StyledChar[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    for (const ch of Array.from(segment.text)) {
      chars.push({
        ch,
        bold: Boolean(segment.bold),
        underline: Boolean(segment.underline),
        italic: Boolean(segment.italic),
        color: segment.color,
        underlineBlank: segment.underlineBlank,
      });
    }
  }
  return chars;
}

function charsToLines(chars: StyledChar[], sizePt: number, maxWidthPt: number): PdfTextLine[] {
  const limit = Math.max(8, maxWidthPt);
  const lines: PdfTextLine[] = [];
  let current: StyledChar[] = [];
  let width = 0;

  const pushLine = () => {
    // 行尾空白不計入（避免右側多出空白造成視覺偏移）
    const trimmed = [...current];
    while (trimmed.length && trimmed[trimmed.length - 1].ch === ' ') trimmed.pop();
    lines.push(styledCharsToLine(trimmed));
    current = [];
    width = 0;
  };

  const append = (char: StyledChar) => {
    current.push(char);
    width += pdfCharWidth(char.ch, sizePt, char.bold);
  };

  const wordBuffer: StyledChar[] = [];
  const flushWord = () => {
    if (!wordBuffer.length) return;
    const wordWidth = wordBuffer.reduce(
      (sum, char) => sum + pdfCharWidth(char.ch, sizePt, char.bold),
      0,
    );
    if (width + wordWidth > limit && current.length) pushLine();
    if (wordWidth > limit) {
      // 超長英文字串：按字元硬切，避免突破欄位（PRD 3.3 第 7 點）。
      for (const char of wordBuffer) {
        const charWidth = pdfCharWidth(char.ch, sizePt, char.bold);
        if (width + charWidth > limit && current.length) pushLine();
        append(char);
      }
    } else {
      for (const char of wordBuffer) append(char);
    }
    wordBuffer.length = 0;
  };

  for (const char of chars) {
    if (char.ch === '\n') {
      flushWord();
      pushLine();
      continue;
    }
    if (char.ch === ' ') {
      flushWord();
      if (width + pdfCharWidth(' ', sizePt, char.bold) > limit && current.length) {
        pushLine();
      } else {
        append(char);
      }
      continue;
    }
    if (CJK_OR_KANA.test(char.ch)) {
      flushWord();
      const charWidth = pdfCharWidth(char.ch, sizePt, char.bold);
      if (width + charWidth > limit && current.length) {
        // 避頭點：收尾符號不另起一行，改為把前一個字一起帶下去。
        if (NO_LINE_START.test(char.ch) && current.length > 1) {
          const carried = current.pop()!;
          pushLine();
          append(carried);
        } else {
          pushLine();
        }
      }
      append(char);
      continue;
    }
    wordBuffer.push(char);
  }
  flushWord();
  if (current.length) pushLine();
  if (lines.length === 0) lines.push({ segments: [], text: '' });
  return lines;
}

function styledCharsToLine(chars: StyledChar[]): PdfTextLine {
  const segments: PdfInlineSegment[] = [];
  for (const char of chars) {
    const last = segments[segments.length - 1];
    if (
      last &&
      Boolean(last.bold) === char.bold &&
      Boolean(last.underline) === char.underline &&
      Boolean(last.italic) === char.italic &&
      last.color === char.color &&
      Boolean(last.underlineBlank) === Boolean(char.underlineBlank)
    ) {
      last.text += char.ch;
      continue;
    }
    segments.push({
      text: char.ch,
      bold: char.bold || undefined,
      underline: char.underline || undefined,
      italic: char.italic || undefined,
      color: char.color,
      underlineBlank: char.underlineBlank || undefined,
    });
  }
  return { segments, text: chars.map((char) => char.ch).join('') };
}

/** 純文字換行（保留手動換行）。 */
export function wrapPdfText(
  text: string,
  maxWidthPt: number,
  sizePt: number,
  bold = false,
): string[] {
  if (!text) return [];
  return wrapPdfSegments([{ text, bold }], maxWidthPt, sizePt).map((line) => line.text);
}

/** 富文字換行，回傳「行」，每行保留原本的粗體／顏色／底線。 */
export function wrapPdfSegments(
  segments: PdfInlineSegment[],
  maxWidthPt: number,
  sizePt: number,
): PdfTextLine[] {
  const chars = flattenSegments(segments);
  if (!chars.length) return [];
  return charsToLines(chars, sizePt, maxWidthPt);
}

/** 產生瀏覽器量測器（canvas + 已註冊的 PDF 字體）。 */
export function createCanvasTextMeasure(fontFamily: string): PdfTextMeasure | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const cache = new Map<string, number>();
  return (text: string, sizePt: number, bold: boolean) => {
    const key = `${bold ? 700 : 400}|${sizePt}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    ctx.font = `${bold ? 700 : 400} ${sizePt}px "${fontFamily}", "Noto Sans TC", sans-serif`;
    const width = ctx.measureText(text).width;
    if (cache.size > 20_000) cache.clear();
    cache.set(key, width);
    return width;
  };
}

/** 圖片原始比例快取（同一個 URL 只載入一次）。 */
const imageSizeCache = new Map<string, { width: number; height: number }>();

export function peekImageSize(url: string): { width: number; height: number } | undefined {
  return imageSizeCache.get(url);
}

/**
 * 預載圖片，取得原始寬高（PRD 4.3 / 6.2）。單張逾時或失敗時略過，
 * 由排版邏輯退回正方形假設，不讓整個 PDF 卡死。
 */
export async function preloadImageSizes(
  urls: string[],
  options: { timeoutMs?: number; concurrency?: number } = {},
): Promise<Map<string, { width: number; height: number }>> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const unique = Array.from(new Set(urls.filter((url) => Boolean(url?.trim()))));
  const result = new Map<string, { width: number; height: number }>();

  for (const url of unique) {
    const cached = imageSizeCache.get(url);
    if (cached) result.set(url, cached);
  }

  const pending = unique.filter((url) => !imageSizeCache.has(url));
  if (typeof Image === 'undefined' || pending.length === 0) return result;

  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const url = pending[cursor];
      cursor += 1;
      const size = await loadOneImage(url, timeoutMs);
      if (size) {
        imageSizeCache.set(url, size);
        result.set(url, size);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return result;
}

function loadOneImage(url: string, timeoutMs: number): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const image = new Image();
    const timer = setTimeout(() => finish(null), timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      finish(width > 0 && height > 0 ? { width, height } : null);
    };
    image.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    image.decoding = 'async';
    image.src = url;
  });
}
