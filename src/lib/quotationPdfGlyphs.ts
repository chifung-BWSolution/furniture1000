import { simplifiedToTraditional } from "@/lib/chineseConverter";

/**
 * Old / variant Han forms that Noto Sans TC includes but react-pdf may render
 * as wrong glyphs (e.g. U+7232 爲 → "2"). Map to HK-standard codepoints that
 * the full Noto Sans TC TTF draws correctly.
 */
const PDF_VARIANT_TO_HK: ReadonlyArray<readonly [string, string]> = [
  ["\u7232", "\u70BA"], // 爲 → 為
  ["\u88CF", "\u88E1"], // 裏 → 裡
  ["\u53F0", "\u81FA"], // 台 → 臺 (HK)
  ["\u7740", "\u8457"], // 着 → 著
  ["\u60A6", "\u6085"], // 悦 → 悅
  ["\u4E91", "\u96F2"], // 云 → 雲
  ["\u4F59", "\u9918"], // 余 → 餘
  ["\u8303", "\u7BC4"], // 范 → 範
  ["\u6CE8", "\u8A3B"], // 注 → 註
  ["\u7FA3", "\u7FA4"], // 羣 → 群
  ["\u9EAA", "\u9EB5"], // 麪 → 麵
];

/** Apply variant → HK-standard replacements (longest-first not needed — all single chars). */
function applyPdfVariantMap(text: string): string {
  let out = text;
  for (const [from, to] of PDF_VARIANT_TO_HK) {
    if (from !== to) out = out.split(from).join(to);
  }
  return out;
}

/**
 * Normalize text for react-pdf output:
 * 1. Unicode NFKC (compatibility decomposition)
 * 2. Old/variant Han → HK forms Noto Sans TC renders correctly
 * 3. Simplified → Traditional (HK) for any remaining 简/体 etc.
 */
export function normalizeQuotationPdfGlyphs(text: string): string {
  if (!text) return text;
  let out = text.normalize("NFKC");
  out = applyPdfVariantMap(out);
  out = simplifiedToTraditional(out);
  return out;
}

/** Shorthand for PDF Text nodes — always run glyph normalization. */
export function pdfDisplayText(text: string | number | null | undefined): string {
  if (text == null) return "";
  return normalizeQuotationPdfGlyphs(String(text));
}
