/**
 * Simplified Chinese → Traditional Chinese (Hong Kong) Converter
 * Uses OpenCC with selective character detection so existing Traditional
 * text (e.g. 溫、檯) is not incorrectly converted.
 */
import * as OpenCC from "npm:opencc-js";

const SIMPLIFIED_TO_HK = OpenCC.Converter({ from: "cn", to: "hk" });
const SIMPLIFIED_TO_TW = OpenCC.Converter({ from: "cn", to: "tw" });
const TRADITIONAL_TO_SIMPLIFIED = OpenCC.Converter({ from: "tw", to: "cn" });

function isSimplifiedChar(char: string): boolean {
  const toTraditional = SIMPLIFIED_TO_TW(char);
  if (toTraditional === char) return false;
  return TRADITIONAL_TO_SIMPLIFIED(toTraditional) === char;
}

export function simplifiedToTraditional(text: string): string {
  if (!text) return text;
  let result = "";
  for (const char of text) {
    result += isSimplifiedChar(char) ? SIMPLIFIED_TO_HK(char) : char;
  }
  return result;
}

export function containsSimplifiedChinese(text: string): boolean {
  if (!text) return false;
  for (const char of text) {
    if (isSimplifiedChar(char)) return true;
  }
  return false;
}

export function convertRowToTraditional(cells: (string | number | null)[]): (string | number | null)[] {
  return cells.map((cell) => {
    if (cell === null || typeof cell === "number") return cell;
    return simplifiedToTraditional(cell);
  });
}
