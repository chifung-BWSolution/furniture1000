/**
 * Excel Parser with Factory-Specific Rules
 * ─────────────────────────────────────────
 * Parses .xlsx/.xls files, iterates all sheets, extracts product specs,
 * and applies factory-specific dimension/unit conversion logic.
 */

import * as XLSX from 'xlsx';
import { simplifiedToTraditional } from './chineseConverter';

// ─── Debug Logging Flag ──────────────────────────────────────────
// Set to true to enable verbose per-row debug output (ROW_TRACE, DEBUG, SYNC CHECK, ROW CHECK, etc.)
// For production use, keep this FALSE. Enable temporarily when diagnosing parsing issues.
const DEBUG_LOGGING = false;

// ─── Types ───────────────────────────────────────────────────────

export interface ExcelProduct {
  id: string;
  title: string;
  titleEn: string; // AI-generated English title (may be empty before AI enrichment)
  titleZh: string; // AI-generated Chinese title (may be empty before AI enrichment)
  modelNumber: string;
  description: string;
  dimensions: string; // raw dimension string
  dimensionLMm: number | null;
  dimensionWMm: number | null;
  dimensionHMm: number | null;
  costPrice: number | null;
  material: string;
  tags: string[];
  collection: string;
  price: number;
  color: string | null;
  sheetName: string;
  rowIndex: number;
  selected: boolean;
  expanded: boolean;
  imageData?: string | null;         // Primary product image (白底產品圖 / Column C 產品圖片)
  lifestyleImageData?: string | null; // Lifestyle/effect image (效果圖 / Column B)
  nearbyImages?: string[];            // All candidate images near this row (for manual "Switch Image" UI)
  cropped_image_url?: string;
  /** Column index the primary imageData came from (0-based). Column C = 2. */
  imageFromCol?: number;
  /** Whether the primary image is validated (came from correct product image column, NOT Column B) */
  imageColumnValidated?: boolean;
  /** Delivery term ID (parsed from 參考貨期 column) */
  deliveryTermId?: string | null;
  /** Delivery term display name (parsed from 參考貨期 column) */
  deliveryTermName?: string | null;
}

export interface ExcelParseResult {
  products: ExcelProduct[];
  sheetNames: string[];
  totalRows: number;
  errors: string[];
  images: ExcelImage[];
}

export interface ExcelImage {
  sheetName: string;
  imageIndex: number;
  base64: string;
  mimeType: string;
  fromRow?: number;
  toRow?: number;
  fromCol?: number; // 0-based column anchor (B=1, D=3 in PJS sheet)
  toCol?: number;
  /** EMU offset from the top of fromRow (0 = top of cell) */
  fromRowOff?: number;
  /** EMU offset from the top of toRow */
  toRowOff?: number;
  /** EMU offset from the left of fromCol */
  fromColOff?: number;
  /** EMU offset from the left of toCol */
  toColOff?: number;
  imageRole?: 'product' | 'lifestyle' | 'unknown'; // Derived from column anchor
  /** Number of columns this image spans (toCol - fromCol). Used for aspect-ratio filter. */
  colSpan?: number;
}

// ─── Factory Rules Configuration ─────────────────────────────────

interface FactoryParsingRule {
  factoryCode: string;
  factoryNames: string[]; // possible names/aliases
  parseDimensions: (raw: string) => { l: number | null; w: number | null; h: number | null };
  unitMultiplier: number; // multiply by this after parsing (e.g., 10 for CM→MM)
  description: string;
  /**
   * Number of extra rows to skip AFTER the detected header row before data begins.
   * Use this when a factory sheet has a sub-header row (e.g. units row, merged cell label row)
   * immediately below the column headers that should not be parsed as products.
   * Default: 0 (data starts at headerRowIndex + 1).
   * PJS example: header at row 5 (0-based), sub-header row at row 6, data starts at row 7 → offset=1
   */
  firstDataRowOffset?: number;
  /**
   * HARDCODED column index for product image (0-based).
   * If set, overrides any header-based detection for imageCol.
   * Use when the header row text is unreliable/merged but the column position is always fixed.
   */
  forceImageCol?: number;
  /**
   * HARDCODED column index for lifestyle image (0-based).
   * If set, overrides any header-based detection for lifestyleImageCol.
   */
  forceLifestyleImageCol?: number;
  /**
   * HARDCODED column index for product dimensions (0-based).
   * If set, overrides header-based detection for the dimensions column.
   * Useful when the dimensions column header is non-standard or when header detection picks a wrong column.
   */
  forceDimensionsCol?: number;
  /**
   * HARDCODED column index for cost price (0-based).
   * If set, overrides header-based detection for the costPrice column.
   */
  forceCostPriceCol?: number;
  /**
   * HARDCODED column index for product model (0-based). Overrides detection.
   */
  forceModelCol?: number;
  /**
   * HARDCODED column index for product title / 品名 (0-based). Overrides detection.
   */
  forceTitleCol?: number;
  /**
   * HARDCODED 0-based index of the header row. If set, overrides header detection.
   * Data rows start at headerRowIndex + 1 + (firstDataRowOffset ?? 0).
   */
  forceHeaderRowIndex?: number;
  /**
   * Optional row filter function. When provided, called for EACH data row.
   * Return `true` to include the row as a valid product, `false` to skip it.
   * 
   * ⚠️ FACTORY-SPECIFIC: Each factory has unique row-validity rules.
   * - PJS/JUESHANG: ONLY rows with a numeric index in Column A are valid products.
   *   Rows with category titles (e.g. "7字沙发", "茶几") are section headers and must be skipped.
   * - CYZ/優卓: Does NOT use numeric indices — do NOT apply this filter.
   * - DEFAULT/GENERIC: No row filter — all non-empty rows are candidates.
   * 
   * @param row - The raw row data array (all cells for this row)
   * @param rowIdx - 0-based row index in the sheet
   */
  rowFilter?: (row: any[], rowIdx: number) => boolean;
  /**
   * Optional sheet matcher function. When provided, used to auto-detect if this factory's
   * rules should be applied to a given sheet based on sheet name patterns.
   * 
   * ⚠️ FACTORY-SPECIFIC: Each factory has unique sheet naming conventions.
   * - PJS/JUESHANG: Sheets matching pattern "(2024|2025).*配套" or "配套.*(2024|2025)".
   * - Other factories: may have entirely different naming conventions.
   * 
   * @param sheetName - The name of the current sheet
   * @returns true if this factory's rules should apply to the sheet
   */
  sheetMatcher?: (sheetName: string) => boolean;
  /**
   * Whether to use strict "no fallback" image matching.
   * When true, images from non-matching columns are DISCARDED entirely —
   * never stolen from one column to fill another.
   * Default: false (generic factories allow heuristic fallback).
   */
  strictImageColumns?: boolean;
  /**
   * Override the default ROW_TOLERANCE for image matching.
   * PJS files have irregular row heights and merged cells that can offset
   * image anchors by more than the default 2 rows.
   * Setting this higher allows proximity-based matching to find the correct image.
   * Default: ROW_TOLERANCE (2)
   */
  imageRowTolerance?: number;
  /**
   * Whether to propagate merged cell values to all rows within each merge range.
   * When true, after sheet_to_json (which only puts the value in the first row of a merge),
   * all subsequent rows in the merge range will inherit the first row's value for that column.
   * This is essential for factories like CYZ where merged cells group shared attributes
   * (e.g. collection name, delivery term) across multiple product rows.
   * Default: false
   */
  propagateMergedCells?: boolean;
}

/**
 * CYZ / 優卓家具 delivery term parsing:
 * Maps the 參考貨期 (delivery term reference) column value to a delivery term ID and name.
 * Rules:
 * - Contains "現貨" or "现货" → 現貨 (stock)
 * - Extract numeric values (min, max):
 *   - max ≤ 7 → 7天內
 *   - min > 7 && max ≤ 15 → 8-15天
 *   - min > 15 && max ≤ 30 → 16-30天
 *   - min > 30 → 30天以上
 */
export function parseDeliveryTerm(raw: string): { id: string | null; name: string | null } {
  if (!raw || typeof raw !== 'string') return { id: null, name: null };
  
  const trimmed = raw.trim();
  if (!trimmed) return { id: null, name: null };
  
  // Check for 現貨/现货 (in stock)
  if (/現貨|现货/.test(trimmed)) {
    return { id: '5776a065-7dff-4c6e-b69e-977195666c41', name: '現貨' };
  }
  
  // Extract all numbers from the string
  const numbers = trimmed.match(/\d+/g);
  if (!numbers || numbers.length === 0) return { id: null, name: null };
  
  const numericValues = numbers.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
  if (numericValues.length === 0) return { id: null, name: null };
  
  const minVal = Math.min(...numericValues);
  const maxVal = Math.max(...numericValues);
  
  // Map to delivery term based on range
  if (maxVal <= 7) {
    return { id: 'ca581beb-40d5-4f28-a51f-c378be533936', name: '7天內' };
  } else if (minVal > 7 && maxVal <= 15) {
    return { id: 'db739e42-73f7-4aa7-a0b7-1103c103bd9c', name: '8-15天' };
  } else if (minVal > 15 && maxVal <= 30) {
    return { id: '29b94b09-0d70-4811-ab68-45dfd4b6653c', name: '16-30天' };
  } else if (minVal > 30) {
    return { id: '0733dad8-b7d4-4014-8fa5-672ed574ecc4', name: '30天以上' };
  }
  
  // Edge cases: if min <= 7 but max > 7, use the max-based rule
  if (maxVal <= 15) {
    return { id: 'db739e42-73f7-4aa7-a0b7-1103c103bd9c', name: '8-15天' };
  } else if (maxVal <= 30) {
    return { id: '29b94b09-0d70-4811-ab68-45dfd4b6653c', name: '16-30天' };
  } else {
    return { id: '0733dad8-b7d4-4014-8fa5-672ed574ecc4', name: '30天以上' };
  }
}

/**
 * CYZ / 優卓家具 parsing rule:
 * - Dimensions format: "218*80*43/78" (W*D*H, with slashes meaning take max)
 * - Unit: CM → multiply by 10 to get MM
 */
function parseCYZDimensions(raw: string): { l: number | null; w: number | null; h: number | null } {
  if (!raw || typeof raw !== 'string') return { l: null, w: null, h: null };
  
  // Clean the string: remove spaces, Chinese characters, units, and images
  const cleaned = raw
    .replace(/[cm|CM|Cm|公分|厘米|毫米|mm|MM]/gi, '')
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, '') // remove ALL Chinese characters (ignore text in dimensions)
    .replace(/\s+/g, '')
    .trim();
  
  // Split by * or × or x
  const parts = cleaned.split(/[*×xX]/);
  
  if (parts.length < 2) return { l: null, w: null, h: null };
  
  // For each part, if it contains a slash, take the MAX value
  const resolvedParts = parts.map(part => {
    if (part.includes('/')) {
      const subValues = part.split('/').map(v => parseFloat(v)).filter(v => !isNaN(v));
      return subValues.length > 0 ? Math.max(...subValues) : null;
    }
    const val = parseFloat(part);
    return isNaN(val) ? null : val;
  });
  
  return {
    l: resolvedParts[0] ?? null, // Length/Width
    w: resolvedParts[1] ?? null, // Depth
    h: resolvedParts[2] ?? null, // Height
  };
}

/**
 * Detect unit multiplier from a dimension column header.
 * ─────────────────────────────────────────────────────
 * Per-Sheet Scan Rules:
 * - Header contains "MM" → already in MM, multiplier = 1
 * - Header contains "CM" → CM→MM, multiplier = 10
 * - Header contains "M" (meters, but NOT "MM" or "CM") → M→MM, multiplier = 1000
 * - No unit found → default assume CM, multiplier = 10
 * 
 * Returns 1, 10, or 1000.
 */
export function detectUnitMultiplierFromHeader(header: string): number {
  if (!header) return 10; // default: assume CM
  const h = header.toUpperCase();
  // Explicit MM marker → no conversion needed (check BEFORE CM since "CM" contains "M")
  if (h.includes('(MM)') || /\bMM\b/.test(h)) return 1;
  // Explicit CM marker → CM→MM conversion
  if (h.includes('(CM)') || /\bCM\b/.test(h)) return 10;
  // Explicit M (meters) marker → M→MM conversion (must NOT match MM or CM)
  // Matches standalone "M", "(M)", or "米" (Chinese for meter)
  if (h.includes('(M)') || /\bM\b/.test(h) || h.includes('米')) return 1000;
  // 长宽高 or 尺寸 without explicit unit → default CM
  return 10;
}

/**
 * Scan the first N rows of a sheet (including headers) for unit indicators.
 * ──────────────────────────────────────────────────────────────────────────
 * This implements the Global Unit & Scaling Engine requirement:
 * Scan rows 0–9 (first 10 rows) for any cell containing unit keywords.
 * 
 * Priority (first match wins):
 * 1. "(MM)" or standalone "MM" → multiplier = 1
 * 2. "(CM)" or standalone "CM" → multiplier = 10
 * 3. "(M)" or standalone "M" or "米" → multiplier = 1000
 * 4. No unit found → default = 10 (assumes CM)
 * 
 * @param sheetData - The full 2D array of the sheet (from XLSX.utils.sheet_to_json)
 * @param maxRows - Max rows to scan (default 10)
 * @returns Multiplier: 1 (MM), 10 (CM), or 1000 (M)
 */
export function scanSheetForUnitMultiplier(sheetData: any[][], maxRows: number = 10): number {
  const rowsToScan = Math.min(maxRows, sheetData.length);
  
  // Track detected unit — most specific wins (MM < CM < M in specificity order)
  // We scan ALL cells in rows 0-9 and use first strong match
  for (let rowIdx = 0; rowIdx < rowsToScan; rowIdx++) {
    const row = sheetData[rowIdx];
    if (!row) continue;
    
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cellValue = row[colIdx];
      if (cellValue === null || cellValue === undefined) continue;
      const cellStr = String(cellValue).toUpperCase().trim();
      if (!cellStr) continue;
      
      // Check for MM first (most specific — contains "MM")
      if (cellStr.includes('(MM)') || /\bMM\b/.test(cellStr) || cellStr.includes('毫米')) {
        if (DEBUG_LOGGING) console.log(`[ScanUnit] Found MM indicator in row ${rowIdx}, col ${colIdx}: "${String(cellValue).trim()}" → multiplier=1`);
        return 1;
      }
      // Check for CM
      if (cellStr.includes('(CM)') || /\bCM\b/.test(cellStr) || cellStr.includes('厘米') || cellStr.includes('公分')) {
        if (DEBUG_LOGGING) console.log(`[ScanUnit] Found CM indicator in row ${rowIdx}, col ${colIdx}: "${String(cellValue).trim()}" → multiplier=10`);
        return 10;
      }
      // Check for M (meters) — but NOT when part of "MM" or "CM" (already handled)
      if (cellStr.includes('(M)') || /(?<![CM])\bM\b(?!M)/.test(cellStr) || cellStr.includes('米')) {
        // Avoid false positives: "MM" and "CM" already returned above
        // "米" alone (not 毫米/厘米) means meters
        if (!cellStr.includes('毫米') && !cellStr.includes('厘米')) {
          if (DEBUG_LOGGING) console.log(`[ScanUnit] Found M (meter) indicator in row ${rowIdx}, col ${colIdx}: "${String(cellValue).trim()}" → multiplier=1000`);
          return 1000;
        }
      }
    }
  }
  
  // No unit found → default assumes CM (Global Rule: default multiplier = 10)
  if (DEBUG_LOGGING) console.log(`[ScanUnit] No unit indicator found in first ${rowsToScan} rows → default multiplier=10 (assumes CM)`);
  return 10;
}

/**
 * PJS / 爵尚家具 parsing rule:
 * - Column: "尺寸【长宽高CM】"
 * - Format: "74*79*45/89" (W*D*H, slash = take max value)
 * - Unit: CM → multiply by 10 to get MM (unless header says MM)
 */
function parsePJSDimensions(raw: string): { l: number | null; w: number | null; h: number | null } {
  if (!raw || typeof raw !== 'string') return { l: null, w: null, h: null };

  // Clean: remove units, spaces, Chinese chars
  const cleaned = raw
    .replace(/[cm|CM|Cm|公分|厘米|毫米|mm|MM]/gi, '')
    .replace(/【[^】]*】/g, '') // remove 【...】 bracket annotations
    .replace(/\s+/g, '')
    .trim();

  // Split by * or × or x
  const parts = cleaned.split(/[*×xX]/);

  if (parts.length < 2) return { l: null, w: null, h: null };

  // For each part, if it contains a slash, take the MAX value
  const resolvedParts = parts.map(part => {
    if (part.includes('/')) {
      const subValues = part.split('/').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      return subValues.length > 0 ? Math.max(...subValues) : null;
    }
    const val = parseFloat(part.trim());
    return isNaN(val) ? null : val;
  });

  return {
    l: resolvedParts[0] ?? null, // Width
    w: resolvedParts[1] ?? null, // Depth
    h: resolvedParts[2] ?? null, // Height
  };
}

/**
 * Advanced PJS/爵尚 Dimension Parser (V2 — Enhanced)
 * ──────────────────────────────────────────────────────
 * Handles complex dimension formats found in 爵尚 catalogs:
 * 
 * Step A: Unit detection from header — if CM, multiply by 10 → MM
 * Step B: Multi-spec cells — e.g., "大：800*430H 小：500*500H" → take LARGEST set
 * Step C: Range/slash values — e.g., "43/82" → take MAX (82)
 * Step D: 2-number format with H suffix — e.g., "800*430H" → L=800, W=null, H=430
 *         3-number format — L*W*H standard mapping
 * 
 * Cleanup: Extract only digits; ignore H/L/W letters and symbols in final storage.
 */
export function parseAdvancedDimensions(raw: string): { l: number | null; w: number | null; h: number | null } {
  if (!raw || typeof raw !== 'string') return { l: null, w: null, h: null };

  // ── Step A: Handle Multi-line Cells (CRITICAL: must run BEFORE any cleaning) ──
  // Split by newlines first to prevent concatenation bug (e.g., "700*400H\n500*500H" → "400500")
  const lines = raw.split(/[\n\r\f]+/).map(l => l.trim()).filter(l => l.length > 0);
  
  // ── Step B: Handle Multi-spec Cells ──────────────────────────────────
  // Pattern: "大：800*430H 小：500*500H" or "大:800*430*750 小:500*500*600"
  // Also handles multi-line without labels: pick the line with the largest individual number
  const multiSpecPattern = /[大小中][\s：:]*(\d[\d*×xX/.\sHhLlWw]*)/g;
  const specMatches = [...raw.matchAll(multiSpecPattern)];
  
  let dimensionStr = raw;
  
  if (specMatches.length > 1) {
    // Multiple labeled specs found — pick the one with the LARGEST individual number
    // Business rule: "大: 700*400H 小: 500*500H" → pick 700*400H because 700 is the largest value
    let bestSpec = '';
    let bestMaxNum = -Infinity;
    
    for (const match of specMatches) {
      const specStr = match[1].trim();
      const numbers = extractDimensionNumbers(specStr);
      const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
      if (maxNum > bestMaxNum) {
        bestMaxNum = maxNum;
        bestSpec = specStr;
      }
    }
    dimensionStr = bestSpec;
  } else if (specMatches.length === 1) {
    // Single labeled spec — use it directly (e.g., "大:700*400H" on one line with other text)
    dimensionStr = specMatches[0][1].trim();
  } else if (lines.length > 1) {
    // ── Multi-line WITHOUT labels (e.g., "700*400H\n500*500H") ──
    // Selection rule: pick the line with the largest individual number (取最大的一組)
    let bestLine = lines[0];
    let bestMaxNum = -Infinity;
    
    for (const line of lines) {
      // Skip lines that are purely text/labels with no dimension-like content
      const hasNumbers = /\d+\s*[*×xX]\s*\d+/.test(line) || /\d+\s*[HhLlWw]/.test(line) || /^\d+([*×xX/]\d+)+$/.test(line.replace(/[HhLlWw\s]/g, ''));
      if (!hasNumbers) continue;
      
      const numbers = extractDimensionNumbers(line);
      const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
      if (maxNum > bestMaxNum) {
        bestMaxNum = maxNum;
        bestLine = line;
      }
    }
    dimensionStr = bestLine;
  }
  
  // Clean: remove units, Chinese characters, brackets, symbols
  // CRITICAL: Remove newlines/carriage returns FIRST to prevent concatenation bugs
  const cleaned = dimensionStr
    .replace(/[\n\r\f]+/g, ' ') // replace newlines with space (prevent concat like "400500")
    .replace(/[cm|CM|Cm|公分|厘米|毫米|mm|MM]/gi, '')
    .replace(/【[^】]*】/g, '') // remove 【...】 bracket annotations
    .replace(/[大小中：:]/g, '') // remove size labels (大/小/中)
    .replace(/[øØφΦ∅]/g, '') // remove diameter symbols (ø, Ø, φ, Φ, ∅)
    .replace(/[（）\(\)]/g, '') // remove parentheses
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, '') // remove ALL Chinese characters (ignore text in dimensions)
    .replace(/\s+/g, '')
    .trim();

  // ── Step D: Parse dimension numbers ──────────────────────────────────
  // Split by * or × or x (case-insensitive)
  const parts = cleaned.split(/[*×xX]/);

  if (parts.length < 2) {
    // Try single number with H suffix (e.g., "430H")
    const singleH = cleaned.match(/^(\d+(?:\.\d+)?)\s*[Hh]$/);
    if (singleH) {
      return { l: null, w: null, h: parseFloat(singleH[1]) };
    }
    return { l: null, w: null, h: null };
  }

  // For each part: handle slash (take max) and H/L/W suffix
  const resolvedParts: { value: number | null; suffix: string }[] = parts.map(part => {
    // Extract trailing letter (H, L, W) if present
    const suffixMatch = part.match(/([HhLlWw])\s*$/);
    const suffix = suffixMatch ? suffixMatch[1].toUpperCase() : '';
    const numericPart = part.replace(/[HhLlWw\s]/g, '');
    
    // ── Step C: Handle Range/Slash values ──
    if (numericPart.includes('/')) {
      const subValues = numericPart.split('/').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      const maxVal = subValues.length > 0 ? Math.max(...subValues) : null;
      return { value: maxVal, suffix };
    }
    
    const val = parseFloat(numericPart.trim());
    return { value: isNaN(val) ? null : val, suffix };
  });

  // ── Step D: Mapping Logic ──────────────────────────────────────────
  // Check if any part has explicit H/L/W suffix
  const hasExplicitSuffix = resolvedParts.some(p => p.suffix !== '');
  
  if (hasExplicitSuffix) {
    // Use suffix-based assignment
    let l: number | null = null;
    let w: number | null = null;
    let h: number | null = null;
    const unassigned: number[] = [];
    
    for (const part of resolvedParts) {
      if (part.value === null) continue;
      switch (part.suffix) {
        case 'H': h = part.value; break;
        case 'L': l = part.value; break;
        case 'W': w = part.value; break;
        default: unassigned.push(part.value); break;
      }
    }
    
    // Assign unassigned values to empty slots
    // Priority order: L first, then H, then W (furniture convention: 2 values = L×H, W is optional)
    if (l === null && unassigned.length > 0) l = unassigned.shift()!;
    if (h === null && unassigned.length > 0) h = unassigned.shift()!;
    if (w === null && unassigned.length > 0) w = unassigned.shift()!;
    
    return { l, w, h };
  }
  
  // No suffix — standard positional mapping
  if (resolvedParts.length === 2) {
    // 2 Numbers: first = L, second = could be H (common in furniture: length*height)
    return {
      l: resolvedParts[0].value,
      w: null,
      h: resolvedParts[1].value,
    };
  }
  
  // 3+ Numbers: L*W*H
  return {
    l: resolvedParts[0]?.value ?? null,
    w: resolvedParts[1]?.value ?? null,
    h: resolvedParts[2]?.value ?? null,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * parseSmartDimensions — GLOBAL Smart Dimension Parser (System Standard)
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Combines per-sheet unit detection with advanced parsing logic.
 * THIS IS THE SYSTEM-WIDE STANDARD entry point for ALL dimension parsing.
 * 
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ 1. GLOBAL UNIT & SCALING ENGINE (Per-Sheet Detection)               │
 * │    Scan header for keywords:                                        │
 * │    • "MM" in header → multiplier = 1 (already millimeters)          │
 * │    • "CM" in header → multiplier = 10 (centimeters → mm)            │
 * │    • "M" in header (not MM/CM) → multiplier = 1000 (meters → mm)   │
 * │    • No header / no unit found → multiplier = 10 (DEFAULT: CM)      │
 * │                                                                     │
 * │ 2. UNIVERSAL DIMENSION PARSING RULES (applied in order):            │
 * │    Rule 1 (Maximum Extraction):                                     │
 * │           Clean string (remove 大/小, ø, symbols).                  │
 * │           If slashes (60/70/80), pick MAX (80).                     │
 * │           If multi-spec (大...小...), pick set with largest 1st num.│
 * │                                                                     │
 * │    Rule 2 (3-Value Standard):                                       │
 * │           If 3 numbers found → map to L, W, H respectively.         │
 * │                                                                     │
 * │    Rule 3 (2-Value Smart Mapping — Priority Order):                 │
 * │           Label Check:                                              │
 * │             • 'H' suffix → 高 (H)                                   │
 * │             • 'L' suffix → 長 (L)                                   │
 * │           Positional Default (No Labels):                           │
 * │             • 1st number → 長 (L)                                   │
 * │             • 2nd number → 高 (H)                                   │
 * │           Width (W) → defaults to null (0) unless 3rd number        │
 * │                                                                     │
 * │    Rule 4 (Final Calculation):                                      │
 * │           Multiply ALL values by the detected multiplier.           │
 * └─────────────────────────────────────────────────────────────────────┘
 * 
 * Test Case Validation (CM header, multiplier = 10):
 *   "60/70/80*75"    → L: 800, W: null(0), H: 750  (80 & 75, order-based)
 *   "75h*60/70/80"   → L: 800, W: null(0), H: 750  (75=H, 80=L)
 *   "80L*60/70/80"   → L: 800, W: null(0), H: 800  (80=L, 80=H)
 * 
 * @param raw - The raw dimension cell value (e.g., "60/70/80*75", "800*430H")
 * @param headerText - The header text of the dimension column for unit detection.
 *                     Pass the sheet's dimension column header (e.g., "尺寸【长宽高CM】").
 *                     If omitted, defaults to multiplier=10 (assumes CM, Global Rule).
 * @returns Object with l, w, h in millimeters (after multiplier applied)
 */
export function parseSmartDimensions(
  raw: string,
  headerText?: string,
  unitOverride?: 'mm' | 'cm' | 'm'
): { l: number | null; w: number | null; h: number | null } {
  if (!raw || typeof raw !== 'string') return { l: null, w: null, h: null };

  // ── Step 1: Determine unit multiplier ───────────────────────────────
  // Priority: explicit unitOverride > header detection > default (CM, ×10).
  // The override exists so the UI can let users say "this column is already MM"
  // even when the header text has no unit keyword.
  let multiplier: number;
  if (unitOverride === 'mm') multiplier = 1;
  else if (unitOverride === 'cm') multiplier = 10;
  else if (unitOverride === 'm') multiplier = 1000;
  else multiplier = headerText ? detectUnitMultiplierFromHeader(headerText) : 10;

  // ── Step 2: Try the labeled-Chinese format first ────────────────────
  //   e.g. "座高：46\n座宽：48\n座深：42\n总高：79"
  // Per CYJ casual-chair rule:
  //   宽 → length (L), 深 → width (W), max of all 高 → height (H).
  // Falls back to advanced positional parsing when no labels are found.
  const labeled = parseLabeledChineseDimensions(raw);
  const parsed = (labeled.l !== null || labeled.w !== null || labeled.h !== null)
    ? labeled
    : parseAdvancedDimensions(raw);

  // ── Step D: Apply multiplier ────────────────────────────────────────
  return {
    l: parsed.l !== null ? Math.round(parsed.l * multiplier) : null,
    w: parsed.w !== null ? Math.round(parsed.w * multiplier) : null,
    h: parsed.h !== null ? Math.round(parsed.h * multiplier) : null,
  };
}

/**
 * parseLabeledChineseDimensions
 * ─────────────────────────────────────────────────────────────────────
 * Parses dimension strings whose values are labeled with Chinese keywords,
 * e.g. "座高：46\n座宽：48\n座深：42\n总高：79".
 *
 * CYJ casual-chair convention:
 *   宽 (any 宽: 座宽, 椅宽, 总宽, 宽度) → product LENGTH
 *   深 (any 深: 座深, 总深, 深度)     → product WIDTH
 *   高 (any 高: 座高, 总高, 高度)     → product HEIGHT
 *     When multiple 高 values coexist (e.g. 座高 + 总高), take the MAX
 *     (i.e. 总高 wins). Same for 宽 (e.g. 座宽 + 椅宽).
 *
 * Returns all-null when no labeled keyword matches (caller should fall
 * back to positional parsing).
 */
export function parseLabeledChineseDimensions(
  raw: string,
): { l: number | null; w: number | null; h: number | null } {
  if (!raw || typeof raw !== 'string') return { l: null, w: null, h: null };

  // Match any "<prefix>宽/深/高<separator><number>" segment.
  // Separator can be ：: =  whitespace.
  // Be tolerant of full-width and half-width punctuation.
  const widthRe = /[\u4e00-\u9fa5]*?(宽|寬|宽度|寬度)\s*[：:=\s]\s*(\d+(?:\.\d+)?)/g;
  const depthRe = /[\u4e00-\u9fa5]*?(深|深度)\s*[：:=\s]\s*(\d+(?:\.\d+)?)/g;
  const heightRe = /[\u4e00-\u9fa5]*?(高|高度)\s*[：:=\s]\s*(\d+(?:\.\d+)?)/g;

  const collect = (re: RegExp): number[] => {
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const n = parseFloat(m[2]);
      if (!isNaN(n)) out.push(n);
    }
    return out;
  };

  const widths = collect(widthRe);
  const depths = collect(depthRe);
  const heights = collect(heightRe);

  if (widths.length === 0 && depths.length === 0 && heights.length === 0) {
    return { l: null, w: null, h: null };
  }

  // Multiple 宽/高 values → take the maximum (covers 座高/总高 and 座宽/椅宽).
  const l = widths.length ? Math.max(...widths) : null;
  const w = depths.length ? Math.max(...depths) : null;
  const h = heights.length ? Math.max(...heights) : null;
  return { l, w, h };
}

/**
 * Helper: Extract all numeric values from a dimension string
 * (used for volume comparison in multi-spec cells)
 */
function extractDimensionNumbers(str: string): number[] {
  const cleaned = str.replace(/[HhLlWw]/g, '');
  const parts = cleaned.split(/[*×xX]/);
  return parts.map(p => {
    if (p.includes('/')) {
      const subs = p.split('/').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      return subs.length > 0 ? Math.max(...subs) : 0;
    }
    const v = parseFloat(p.trim());
    return isNaN(v) ? 0 : v;
  });
}

/**
 * Clean Price Value (價格取大值)
 * ─────────────────────────────────
 * For cells containing multiple prices separated by slashes (e.g., "680/750/820"),
 * extract the LARGEST number.
 * 
 * Also handles:
 * - Currency symbols: ¥, ￥, $, €
 * - Commas in numbers: "1,280"
 * - Mixed text: "680元/750元/820元"
 * 
 * @returns Clean numeric value (the maximum) or null if no valid number found
 */
export function cleanPrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    // Guard: if a number looks like concatenated prices (e.g., 730880 from "730/880")
    // This can happen when XLSX interprets slash-separated values as a single number.
    // Heuristic: if the number has 6+ digits and is evenly splittable into plausible prices, take max.
    const numStr = String(raw);
    if (raw > 99999 && numStr.length >= 6) {
      // Try splitting into 3-digit pairs (e.g., 730880 → [730, 880])
      const midpoint = Math.floor(numStr.length / 2);
      const leftHalf = parseInt(numStr.substring(0, midpoint), 10);
      const rightHalf = parseInt(numStr.substring(midpoint), 10);
      // Only split if both halves are plausible prices (> 0 and < 100000)
      if (leftHalf > 0 && leftHalf < 100000 && rightHalf > 0 && rightHalf < 100000) {
        console.warn(`[cleanPrice] Detected possible concatenated price: ${raw} → split as [${leftHalf}, ${rightHalf}] → max: ${Math.max(leftHalf, rightHalf)}`);
        return Math.max(leftHalf, rightHalf);
      }
    }
    return raw;
  }
  
  const str = String(raw).trim();
  if (!str) return null;
  
  // Remove currency symbols and ALL Chinese characters (ignore text in price cells)
  const cleaned = str
    .replace(/[$¥￥€元块塊RMB]/gi, '')
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, '') // remove ALL Chinese characters
    .trim();
  
  // ── MANDATORY MULTI-LINE HANDLING ──
  // Step 1: Explicitly split by newlines, slashes (full-width and half-width),
  //          spaces between numbers, commas, and Chinese enumeration commas (、)
  // This prevents "730\n880" from becoming "730880"
  const splitPattern = /[\n\r\f／\/、,;|]+|\s+/;
  const parts = cleaned.split(splitPattern).filter(p => p.trim() !== '');
  
  // Step 2: Use regex to extract ALL numeric values from the parts
  const allNumbers: number[] = [];
  for (const part of parts) {
    const matches = part.match(/\d+(\.\d+)?/g);
    if (matches) {
      for (const m of matches) {
        const n = parseFloat(m);
        if (!isNaN(n) && n > 0) {
          allNumbers.push(n);
        }
      }
    }
  }
  
  // Step 3: Pick the MAXIMUM value
  if (allNumbers.length === 0) return null;
  const maxVal = Math.max(...allNumbers);
  
  if (allNumbers.length > 1) {
    console.warn(`[cleanPrice] Multi-value detected: "${str}" → extracted [${allNumbers.join(', ')}] → max: ${maxVal}`);
  }
  
  return maxVal;
}

/**
 * Generic/Standard parsing rule:
 * - Dimensions format: "W*D*H" basic format
 * - Assumes input is already in MM (no multiplier)
 */
function parseGenericDimensions(raw: string): { l: number | null; w: number | null; h: number | null } {
  if (!raw || typeof raw !== 'string') return { l: null, w: null, h: null };
  
  const cleaned = raw
    .replace(/[cm|CM|Cm|mm|MM|公分|厘米|毫米]/gi, '')
    .replace(/\s+/g, '')
    .trim();
  
  // Split by * or × or x
  const parts = cleaned.split(/[*×xX]/);
  
  if (parts.length < 2) return { l: null, w: null, h: null };
  
  const resolvedParts = parts.map(part => {
    const val = parseFloat(part.trim());
    return isNaN(val) ? null : val;
  });
  
  return {
    l: resolvedParts[0] ?? null,
    w: resolvedParts[1] ?? null,
    h: resolvedParts[2] ?? null,
  };
}

// ─── Factory-Specific Column Overrides ───────────────────────────

// Forward-declared here so FactoryColumnOverride can reference it
// (full definition is in the Column Detection section below)
interface ColumnMapping {
  model: number | null;
  title: number | null;
  dimensions: number | null;
  costPrice: number | null;
  material: number | null;
  color: number | null;
  description: number | null;
  collection: number | null;
  imageCol: number | null;           // Primary product image column (白底產品圖 / 產品圖片)
  lifestyleImageCol: number | null;  // Lifestyle/effect image column (效果圖)
  deliveryTermRef: number | null;    // Delivery term reference (參考貨期)
  /** Raw dimension header text — used to derive unit multiplier (CM vs MM) */
  dimensionHeader?: string;
  /** Index of the detected header row within the sheet's 2D data */
  headerRowIndex: number;
}

/**
 * Some factories use non-standard column names.
 * This map provides explicit column header → field overrides keyed by factory code.
 * Keys are the exact (or partial) column header strings; values are the ColumnMapping field.
 */
export interface FactoryColumnOverride {
  // Map from column header substring (lowercase) → ColumnMapping field
  headers: Record<string, keyof ColumnMapping>;
}

const FACTORY_COLUMN_OVERRIDES: Record<string, FactoryColumnOverride> = {
  CYZ: {
    headers: {
      '型号': 'model',              // Product model number
      '品名': 'title',              // Product name
      '尺寸': 'dimensions',         // Dimensions (CM, may contain Chinese chars like "长" — stripped in parsing)
      '单价': 'costPrice',          // Unit price / Cost price (also check for 停產)
      '單價': 'costPrice',          // Traditional Chinese variant
      '材质': 'material',           // Material description
      '材質': 'material',           // Traditional Chinese variant
      '颜色': 'color',             // Color
      '顏色': 'color',             // Traditional Chinese variant
      '产品图': 'imageCol',         // Product image
      '產品圖': 'imageCol',         // Traditional Chinese variant
      '单图': 'imageCol',           // Single product image (單圖)
      '單圖': 'imageCol',           // Traditional Chinese variant
      '效果图': 'lifestyleImageCol', // Lifestyle/scene image
      '效果圖': 'lifestyleImageCol', // Traditional Chinese variant
      '场景图': 'lifestyleImageCol', // Scene image (場景圖)
      '場景圖': 'lifestyleImageCol', // Traditional Chinese variant
      '参考货期': 'deliveryTermRef', // Delivery term reference
      '參考貨期': 'deliveryTermRef', // Traditional Chinese variant
      '货期': 'deliveryTermRef',     // Short form
      '貨期': 'deliveryTermRef',     // Traditional Chinese short form
      '生产周期': 'deliveryTermRef', // Production lead time (生產周期)
      '生產周期': 'deliveryTermRef', // Traditional Chinese variant
    },
  },
  PJS: {
    headers: {
      '产品型号': 'model',         // Product Code column — may be Column D or E depending on year
      '尺寸': 'dimensions',         // Matches both "尺寸【长宽高CM】" and "尺寸(MM)" etc.
      '出厂价': 'costPrice',        // Factory cost price
      '材质描述': 'material',       // Material description (also used for AI description)
      '产品图片': 'imageCol',       // PRIMARY product image column (白底, may be D or E)
      '單圖': 'imageCol',           // Single product image (單圖)
      '单图': 'imageCol',           // Simplified Chinese variant
      '产品图': 'imageCol',         // Product image short form
      '產品圖': 'imageCol',         // Traditional Chinese variant
      '效果图': 'lifestyleImageCol', // Lifestyle/effect image column (may be B or C)
      '效果圖': 'lifestyleImageCol', // Traditional Chinese variant
      '场景图': 'lifestyleImageCol', // Scene image (場景圖)
      '場景圖': 'lifestyleImageCol', // Traditional Chinese variant
      '参考货期': 'deliveryTermRef', // Delivery term reference
      '參考貨期': 'deliveryTermRef', // Traditional Chinese variant
      '货期': 'deliveryTermRef',     // Short form
      '貨期': 'deliveryTermRef',     // Traditional Chinese short form
      '生产周期': 'deliveryTermRef', // Production lead time (生產周期)
      '生產周期': 'deliveryTermRef', // Traditional Chinese variant
    },
  },
};

// ─── Factory Rules Registry ──────────────────────────────────────
// 
// ╔══════════════════════════════════════════════════════════════════╗
// ║           FACTORY RULE MEMORY SYSTEM                             ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║ Each factory has UNIQUE Excel parsing habits. Rules are stored   ║
// ║ per-factory and MUST NOT cross-contaminate.                      ║
// ║                                                                  ║
// ║ REGISTERED FACTORIES:                                            ║
// ║ ─────────────────────                                            ║
// ║ 1. PJS / JUESHANG (爵尚) — JUESHANG_v1 rules                    ║
// ║    • Sheet ID: name contains "2024/2025" AND "配套"              ║
// ║    • Row Filter: ONLY numeric index in Col A = valid product     ║
// ║    • Image Cols: Product=C(2), Lifestyle=B(1), STRICT            ║
// ║    • No fallback: never steal B→C or C→B                         ║
// ║    • Data offset: 3 rows after header before first product       ║
// ║                                                                  ║
// ║ 2. CYZ / 優卓家具 — standard rules                               ║
// ║    • No row filter (all non-empty rows are products)             ║
// ║    • Header-based image detection (no forced columns)            ║
// ║    • Dimensions: slash→max, CM→MM                                ║
// ║                                                                  ║
// ║ 3. GENERIC (default) — minimal assumptions                       ║
// ║    • No row filter, no forced columns, MM assumed                ║
// ║    • Header-based detection for everything                       ║
// ║                                                                  ║
// ║ ⚠️ WHEN ADDING A NEW FACTORY:                                    ║
// ║    - ASK the user for its specific layout                        ║
// ║    - Do NOT assume it follows JUESHANG template                  ║
// ║    - Create a new entry with its own rules                       ║
// ╚══════════════════════════════════════════════════════════════════╝

const FACTORY_RULES: FactoryParsingRule[] = [
  {
    factoryCode: 'CYZ',
    factoryNames: ['CYZ', '優卓家具', '优卓家具', '優卓', '优卓'],
    parseDimensions: parseCYZDimensions,
    unitMultiplier: 10, // CM → MM
    description: 'CYZ/優卓家具: slash→max, CM×10→MM, 停產filter, merged-cell propagation',
    propagateMergedCells: true, // CYZ uses merged cells for shared attributes (collection, delivery term, etc.)
    /**
     * CYZ Row Filter:
     * - Skip rows where the price/cost column contains "停產" or "停产" (discontinued).
     * - All other non-empty rows are valid products (no numeric index requirement like PJS).
     */
    rowFilter: (row: any[], _rowIdx: number): boolean => {
      // Check ALL cells in the row for "停產"/"停产" keywords
      for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        const str = String(cell).trim();
        if (/停[產产]/.test(str)) {
          console.log(`[CYZ rowFilter] Row ${_rowIdx} SKIPPED — contains "停產/停产" (discontinued): "${str}"`);
          return false;
        }
      }
      return true;
    },
  },
  {
    factoryCode: 'PJS',
    factoryNames: ['PJS', '爵尚家具', '爵尚', 'Jueshang', 'jueshang'],
    parseDimensions: parseAdvancedDimensions,
    unitMultiplier: 10, // CM → MM
    description: 'PJS/爵尚家具 (JUESHANG_v1): 尺寸【长宽高CM】, multi-spec→largest, slash→max, H-suffix aware, CM×10→MM, numeric-index rows only, merged-cell propagation',
    propagateMergedCells: true, // PJS uses merged cells for shared attributes (scene images, delivery term, etc.)
    // ─── JUESHANG FACTORY RULE MEMORY (JUESHANG_v1) ────────────────────────
    // This rule set is EXCLUSIVELY for the factory "JUESHANG (爵尚)".
    // DO NOT apply these rules to other factories without explicit confirmation.
    //
    // Verified Layout (2024/2025 catalogs):
    //   findHeaderRow detects headerRowIndex=3 (the row with the most non-empty cells)
    //   Rows 4, 5, and 6 are sub-headers / units / merged label rows (NOT products)
    //   Row 7 (0-based) = first real product (S999)
    //   Previously firstDataRowOffset=3 skipped the first product when header detection was off by 1.
    //   Now we rely on rowFilter (Column A must be numeric) to skip non-product rows.
    //   This ensures NO product row is ever accidentally skipped regardless of header detection.
    firstDataRowOffset: 0,
    // HARDCODED column indices for PJS (verified from Excel structure):
    //   Column B (index 1) = "效果图" (Lifestyle Image) — merged cells spanning multiple rows
    //   Column C (index 2) = "产品图片" (Product Image) — individual per-product images
    // These override header detection which can be unreliable due to merged cells
    forceImageCol: 2,           // Column C = Product Image (产品图片)
    forceLifestyleImageCol: 1,  // Column B = Lifestyle Image (效果图)
    // STRICT: Never steal images from Column B to fill Column C or vice versa
    strictImageColumns: true,
    // PJS row height calibration: irregular row heights & merged cells can offset anchors by up to 3 rows
    imageRowTolerance: 3,
    // ROW FILTER: ONLY rows with a numeric index in Column A are valid products.
    // Category title rows (e.g. "7字沙发", "茶几", "电视柜") are section headers and MUST be skipped.
    // ⚠️ This filter is SPECIFIC to JUESHANG. Other factories may NOT use numeric indices in Col A.
    rowFilter: (row: any[], _rowIdx: number): boolean => {
      const colA = row[0];
      // ── Case 1: Column A has a value ──
      if (colA !== '' && colA !== null && colA !== undefined) {
        // Numeric value (Excel may store as number or string)
        if (typeof colA === 'number' && !isNaN(colA)) return true;
        if (typeof colA === 'string') {
          const trimmed = colA.trim();
          if (trimmed.length === 0) {
            // Fall through to merged-cell check below
          } else {
            // Accept any string that is purely digits (allows "01", "001" etc)
            if (/^\d+$/.test(trimmed)) return true;
            // Accept standard numeric strings ("1", "23", "1.5")
            if (!isNaN(Number(trimmed))) return true;
            // Accept sub-numbering formats like "3-1", "3/2"
            if (/^\d+[-\/]\d+$/.test(trimmed)) return true;
            // Not a valid product index — likely a category header (e.g. "7字沙发")
            return false;
          }
        }
      }
      // ── Case 2: Column A is empty (merged cell continuation row) ──
      // In PJS, products within the same series (e.g. S999) share a single
      // merged Column A cell. Only the first row has the number; subsequent
      // variant rows have empty Column A. These ARE valid product rows if
      // they have meaningful data in other columns (model, dimensions, title, material, price).
      // Check columns C onward (indices 2+) for any non-empty value
      // BUT exclude sub-header/unit rows that contain only labels
      const SUB_HEADER_KEYWORDS = /^(序号|单位|尺寸|材料|产品图片|效果图|型号|配套|品名|规格|颜色|备注|单价|价格|数量|图片|CM|MM|cm|mm|米|厘米)$/;
      const hasProductData = row.slice(2).some((cell: any) => {
        if (cell === null || cell === undefined) return false;
        const str = String(cell).trim();
        if (str.length === 0) return false;
        // Exclude known sub-header keywords
        if (SUB_HEADER_KEYWORDS.test(str)) return false;
        return true;
      });
      if (hasProductData) {
        if (DEBUG_LOGGING) console.log(`[rowFilter] Row ${_rowIdx}: Column A empty but has product data in other columns → INCLUDED (merged cell continuation)`);
        return true;
      }
      return false;
    },
    // SHEET MATCHER: Auto-detect JUESHANG sheets by naming pattern.
    // Identifier: Sheet name contains a year (2024/2025) AND contains "配套".
    // Examples: "2024配套", "爵尚2025配套", "2024 配套系列"
    sheetMatcher: (sheetName: string): boolean => {
      const hasYear = /20(24|25)/.test(sheetName);
      const hasPeitao = /配套/.test(sheetName);
      return hasYear && hasPeitao;
    },
  },
  {
    factoryCode: 'CYJ',
    factoryNames: ['CYJ', '優健家具', '优健家具', '優健', '优健', 'Youjian', 'youjian'],
    parseDimensions: parseAdvancedDimensions,
    unitMultiplier: 1, // already in MM
    description: 'CYJ/優健家具: auto-detect image cols, dimensions in mm, all product data exported',
    propagateMergedCells: true,
    // Do NOT force header row — let auto-detection find it per file (different 優健 files have different layouts)
    // Do NOT force image col — multiple image columns may exist; let generic detection handle all of them
    strictImageColumns: false,
  },
  // Add more factory rules here as needed
];

const DEFAULT_RULE: FactoryParsingRule = {
  factoryCode: 'GENERIC',
  factoryNames: [],
  parseDimensions: parseAdvancedDimensions, // Global standard: uses advanced parsing (slash→max, multi-spec→largest, H/L/W suffix detection, 2-value→L/H)
  unitMultiplier: 10, // Default assume CM → MM (global rule: if no unit marker found, assume CM)
  description: 'Generic (Global Standard): advanced parsing, slash→max, labels→assign, 2-value=L+H, default CM×10→MM',
  propagateMergedCells: true, // Enable merged cell propagation for all factories (delivery terms, collections, etc.)
};

/**
 * Get the appropriate parsing rule for a factory
 */
export function getFactoryRule(factoryName: string, factoryId?: string): FactoryParsingRule {
  // Check by factoryId first (most precise)
  if (factoryId) {
    const byId = FACTORY_RULES.find(r => 
      r.factoryCode.toLowerCase() === factoryId.toLowerCase()
    );
    if (byId) return byId;
  }
  
  // Check by factory name (fuzzy match)
  if (factoryName) {
    const normalized = factoryName.toLowerCase().trim();
    const byName = FACTORY_RULES.find(r => 
      r.factoryNames.some(name => 
        normalized.includes(name.toLowerCase()) || name.toLowerCase().includes(normalized)
      )
    );
    if (byName) return byName;
  }
  
  return DEFAULT_RULE;
}

/**
 * Auto-detect the factory rule for a given sheet based on sheet name patterns.
 * Uses the `sheetMatcher` function defined in each factory's rule.
 * Falls back to `getFactoryRule(factoryName, factoryId)` if no sheet-level match.
 * 
 * This allows auto-detection of JUESHANG sheets (e.g. "2024配套") even when the
 * factory context isn't explicitly provided — useful for multi-factory workbooks.
 */
export function getFactoryRuleForSheet(sheetName: string, factoryName: string, factoryId?: string): FactoryParsingRule {
  // First, check if any factory rule has a sheetMatcher that matches this sheet name
  const bySheet = FACTORY_RULES.find(r => r.sheetMatcher && r.sheetMatcher(sheetName));
  if (bySheet) {
    if (DEBUG_LOGGING) console.log(`[ExcelParser] Sheet "${sheetName}" auto-matched to factory rule: ${bySheet.factoryCode} via sheetMatcher`);
    return bySheet;
  }
  // Fall back to standard factory detection
  return getFactoryRule(factoryName, factoryId);
}

// ─── Column Detection ────────────────────────────────────────────

const COLUMN_PATTERNS: Record<keyof Omit<ColumnMapping, 'dimensionHeader'>, RegExp[]> = {
  model: [/model|型號|型号|貨號|货号|item\s*no|product\s*code|sku|产品型号/i],
  title: [/name|品名|產品名|产品名|product\s*name|item\s*name/i],        // Removed 'description' to avoid mismatching
  dimensions: [/dimension|尺寸|size|規格|规格|長寬高|长宽高|L\*W\*H|W\*D\*H/i],
  costPrice: [/price|單價|单价|unit\s*price|cost|報價|报价|FOB|出廠價|出厂价/i],
  material: [/material|材質|材质|用料|fabric|面料|材质描述/i],
  color: [/color|colour|顏色|颜色|色/i],
  description: [/desc|說明|说明|備註|备注|note|remark/i],
  collection: [/series|系列|collection|category|類別|类别/i],
  imageCol: [/产品图片|產品圖片|product\s*image|photo|单图|單圖|产品图|產品圖/i],                 // Product image ONLY (not 效果圖)
  lifestyleImageCol: [/效果图|效果圖|lifestyle|scene\s*image|场景图|場景圖/i],           // Lifestyle images
  deliveryTermRef: [/貨期|货期|交期|lead\s*time|delivery\s*term|參考貨期|参考货期|生產周期|生产周期|production\s*lead/i],   // Delivery term reference
};

/**
 * Find the best header row from a sheet's 2D data array.
 * Scans rows 0–7 and picks the one with the most non-empty, unique string cells.
 * Returns { headers, rowIndex }.
 */
function findHeaderRow(jsonData: any[][]): { headers: string[]; rowIndex: number } {
  let bestRowIdx = 0;
  let bestScore = 0;

  const maxScan = Math.min(8, jsonData.length);
  for (let i = 0; i < maxScan; i++) {
    const row = jsonData[i];
    if (!row) continue;
    const nonEmpty = row.filter((c: any) => c !== null && c !== undefined && String(c).trim() !== '');
    // Score: number of non-empty cells + bonus for cells that look like column headers (contain Chinese or common keywords)
    const score = nonEmpty.length;
    if (score > bestScore) {
      bestScore = score;
      bestRowIdx = i;
    }
  }

  const headers = (jsonData[bestRowIdx] || []).map((h: any) => String(h ?? '').trim());
  return { headers, rowIndex: bestRowIdx };
}

function detectColumnMapping(jsonData: any[][], factoryCode?: string): ColumnMapping {
  const { headers, rowIndex } = findHeaderRow(jsonData);

  const mapping: ColumnMapping = {
    model: null,
    title: null,
    dimensions: null,
    costPrice: null,
    material: null,
    color: null,
    description: null,
    collection: null,
    imageCol: null,
    lifestyleImageCol: null,
    deliveryTermRef: null,
    dimensionHeader: undefined,
    headerRowIndex: rowIndex,
  };

  // Apply factory-specific column overrides first (highest priority)
  const overrides = factoryCode ? FACTORY_COLUMN_OVERRIDES[factoryCode] : null;

  for (let i = 0; i < headers.length; i++) {
    const header = (headers[i] || '').toString().trim();
    if (!header) continue;
    const headerLower = header.toLowerCase();

    // Check factory-specific overrides first
    if (overrides) {
      let matched = false;
      for (const [pattern, field] of Object.entries(overrides.headers)) {
        if (field === 'imageCol' || field === 'lifestyleImageCol') {
          // For image column markers, just record the column index
          if (headerLower.includes(pattern.toLowerCase()) || header.includes(pattern)) {
            if (mapping[field as 'imageCol' | 'lifestyleImageCol'] === null) {
              mapping[field as 'imageCol' | 'lifestyleImageCol'] = i;
              matched = true;
              break;
            }
          }
        } else if (headerLower.includes(pattern.toLowerCase()) || header.includes(pattern)) {
          const fieldKey = field as keyof ColumnMapping;
          if (mapping[fieldKey] === null || mapping[fieldKey] === undefined) {
            (mapping as any)[fieldKey] = i;
            // Capture dimension header text for unit detection
            if (field === 'dimensions') {
              mapping.dimensionHeader = header;
            }
            matched = true;
            break;
          }
        }
      }
      if (matched) continue; // Override took priority
    }

    // Fall back to generic pattern matching
    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      const fKey = field as keyof Omit<ColumnMapping, 'dimensionHeader'>;
      if (mapping[fKey] !== null && mapping[fKey] !== undefined) continue; // Already mapped
      if ((patterns as RegExp[]).some(p => p.test(header))) {
        mapping[fKey] = i;
        // Capture dimension header text for unit detection
        if (field === 'dimensions') {
          mapping.dimensionHeader = header;
        }
        break;
      }
    }
  }

  if (DEBUG_LOGGING) console.log(`[ExcelParser] Header row ${rowIndex}: [${headers.slice(0, 12).join(' | ')}]`);
  if (DEBUG_LOGGING) console.log(`[ExcelParser] Column mapping — imageCol: ${mapping.imageCol} (产品图片), lifestyleCol: ${mapping.lifestyleImageCol} (效果图), dimHeader: "${mapping.dimensionHeader || 'none'}", modelCol: ${mapping.model}, priceCol: ${mapping.costPrice}`);

  return mapping;
}

// ─── Main Parser ─────────────────────────────────────────────────

export async function parseExcelFile(
  fileBuffer: ArrayBuffer,
  factoryName: string,
  factoryId?: string,
): Promise<ExcelParseResult> {
  const errors: string[] = [];
  const products: ExcelProduct[] = [];
  
  // Reset debug counter and claimed-image state for this parse session
  resetImageMatchState();
  
  // Get the factory-specific parsing rule
  const rule = getFactoryRule(factoryName, factoryId);
  if (DEBUG_LOGGING) console.log(`[ExcelParser] Using factory rule: ${rule.description} (code: ${rule.factoryCode})`);
  
  // Extract images via JSZip (async, with row anchor positions)
  const allExtractedImages = await extractImagesFromWorkbook(fileBuffer);
  if (DEBUG_LOGGING) console.log(`[ExcelParser] Extracted ${allExtractedImages.length} images (with position data)`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // THE "WALL" RULE — ABSOLUTE PRE-FILTER (STRICT MODE ONLY — e.g. PJS/爵尚)
  // ═══════════════════════════════════════════════════════════════════════════════
  // In STRICT mode: ANY image with fromCol < 2 (Column A=0, Column B=1) is BANNED
  // from the product image candidate pool and kept only in the lifestyle pool.
  // In NON-STRICT mode (CYZ/優卓, GENERIC): ALL images remain in the product pool.
  // The header-based column detection will classify them correctly at match time.
  // ═══════════════════════════════════════════════════════════════════════════════
  const bannedImages: ExcelImage[] = []; // Lifestyle-only images (fromCol < 2, strict mode only)
  const images: ExcelImage[] = [];       // Product-eligible images
  
  for (const img of allExtractedImages) {
    if (rule.strictImageColumns && img.fromCol !== undefined && img.fromCol < 2) {
      // ❌ BANNED (strict mode): Image anchored in Column B (1) or Column A (0) — lifestyle only
      bannedImages.push(img);
      if (DEBUG_LOGGING) console.log(
        `[WALL RULE] ❌ BANNED: Image[${img.imageIndex}] fromCol=${img.fromCol} (Column ${String.fromCharCode(65 + img.fromCol)}) ` +
        `— leftmost boundary is before Column C. DELETED from product candidate pool.`
      );
    } else {
      // ✅ ALLOWED: Image from Column C (2) or later, or unknown column, or non-strict mode
      images.push(img);
    }
  }
  if (DEBUG_LOGGING) console.log(
    `[WALL RULE] ═══ PRE-FILTER COMPLETE ═══\n` +
    `  Total extracted: ${allExtractedImages.length}\n` +
    `  BANNED (fromCol < 2): ${bannedImages.length} — these are lifestyle/scene images, permanently removed from product matching\n` +
    `  ALLOWED (fromCol >= 2 or unknown): ${images.length} — these enter the product matching pipeline`
  );
  // Dump ALL image anchors so we can verify fromRow correctness
  if (DEBUG_LOGGING) images.forEach((img, i) => {
    console.log(
      `[IMAGE ANCHOR] img[${i}] sheet=${img.sheetName} col=${img.fromCol} ` +
      `fromRow=${img.fromRow ?? 'N/A'} toRow=${img.toRow ?? 'N/A'} ` +
      `fromRowOff=${img.fromRowOff ?? 0} toRowOff=${img.toRowOff ?? 0}`
    );
    // ── USER-REQUESTED FORMAT ──
    console.log(
      `[IMAGE FOUND] ID: img[${i}] (sheet=${img.sheetName}) | fromRow: ${img.fromRow ?? 'N/A'} | fromCol: ${img.fromCol ?? 'N/A'}`
    );
  });
  
  // Read workbook for data parsing
  const workbook = XLSX.read(fileBuffer, { 
    type: 'array',
    cellStyles: true,
    cellDates: true,
    bookImages: false, // Images already extracted via JSZip
  });
  
  const sheetNames = workbook.SheetNames;
  console.log(`[ExcelParser] Found ${sheetNames.length} sheets: ${sheetNames.join(', ')}`);
  
  let totalRows = 0;
  
  // Iterate through all sheets
  for (let sheetIdx = 0; sheetIdx < sheetNames.length; sheetIdx++) {
    const sheetName = sheetNames[sheetIdx];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    
    // Convert to JSON array — KEEP blank rows (blankrows: true) so that
    // jsonData[rowIdx] maps 1-to-1 onto the Excel row at index rowIdx.
    // Drawing XML fromRow/toRow are 0-based Excel row numbers; if we strip
    // blank rows the indices diverge and images get assigned to wrong products.
    const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, { 
      header: 1,
      defval: '',
      blankrows: true,
    });

    // ── Merged Cell Propagation (main parser) ─────────────────────────────────
    // Same logic as in extractRawExcelTable: when factory rule has propagateMergedCells=true,
    // fill empty cells in merged ranges with the value from the top-left cell.
    if (rule.propagateMergedCells && sheet['!merges']) {
      const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = sheet['!merges'];
      let propagatedCount = 0;
      for (const merge of merges) {
        const startRow = merge.s.r;
        const endRow = merge.e.r;
        const startCol = merge.s.c;
        const endCol = merge.e.c;
        const sourceRow = jsonData[startRow];
        if (!sourceRow) continue;
        const sourceValue = sourceRow[startCol];
        if (sourceValue === '' || sourceValue === null || sourceValue === undefined) continue;
        for (let r = startRow; r <= endRow; r++) {
          if (!jsonData[r]) jsonData[r] = [];
          for (let c = startCol; c <= endCol; c++) {
            if (r === startRow && c === startCol) continue;
            const currentVal = jsonData[r][c];
            if (currentVal === '' || currentVal === null || currentVal === undefined) {
              jsonData[r][c] = sourceValue;
              propagatedCount++;
            }
          }
        }
      }
      if (propagatedCount > 0) {
        console.log(`[ExcelParser] Sheet "${sheetName}" merged cell propagation: ${propagatedCount} cells filled from ${merges.length} merge ranges`);
      }
    }
    
    if (jsonData.length < 2) {
      errors.push(`Sheet "${sheetName}": Less than 2 rows, skipping.`);
      continue;
    }
    
    // Per-sheet header discovery — scans rows 0-7 to find the best header row
    const columnMapping = detectColumnMapping(jsonData, rule.factoryCode);

    // FORCE column overrides from factory rule (highest priority — overrides header detection)
    // This ensures PJS always uses col=2 for product images and col=1 for lifestyle,
    // regardless of what the header detection finds (which can be unreliable with merged cells).
    if (rule.forceImageCol !== undefined) {
      const detectedImageCol = columnMapping.imageCol;
      columnMapping.imageCol = rule.forceImageCol;
      if (detectedImageCol !== rule.forceImageCol) {
        if (DEBUG_LOGGING) console.log(
          `[ExcelParser] FORCE OVERRIDE: imageCol ${detectedImageCol} → ${rule.forceImageCol} (from factory rule "${rule.factoryCode}")`
        );
      }
    }
    if (rule.forceLifestyleImageCol !== undefined) {
      const detectedLifestyleCol = columnMapping.lifestyleImageCol;
      columnMapping.lifestyleImageCol = rule.forceLifestyleImageCol;
      if (detectedLifestyleCol !== rule.forceLifestyleImageCol) {
        if (DEBUG_LOGGING) console.log(
          `[ExcelParser] FORCE OVERRIDE: lifestyleImageCol ${detectedLifestyleCol} → ${rule.forceLifestyleImageCol} (from factory rule "${rule.factoryCode}")`
        );
      }
    }
    if (rule.forceDimensionsCol !== undefined) {
      columnMapping.dimensions = rule.forceDimensionsCol;
    }
    if (rule.forceCostPriceCol !== undefined) {
      columnMapping.costPrice = rule.forceCostPriceCol;
    }
    if (rule.forceModelCol !== undefined) {
      columnMapping.model = rule.forceModelCol;
    }
    if (rule.forceTitleCol !== undefined) {
      columnMapping.title = rule.forceTitleCol;
    }
    if (rule.forceHeaderRowIndex !== undefined) {
      columnMapping.headerRowIndex = rule.forceHeaderRowIndex;
    }

    // CYJ: only one image column (Column B = product image). Clear lifestyle to prevent
    // 效果圖 column being detected from headers and duplicating the product image.
    if (rule.factoryCode === 'CYJ') {
      columnMapping.lifestyleImageCol = null;
    }

    // ── CYZ/優卓 Single Image Column Rule ─────────────────────────────────────
    // When only one image column is found in the sheet, it should ALWAYS be treated
    // as the product image column (產品圖), not lifestyle. This handles the case where
    // the sheet has only "單圖" (or equivalent) — it defaults to product image.
    // If imageCol is null but lifestyleImageCol is detected, swap it to imageCol.
    if (rule.factoryCode === 'CYZ' || rule.factoryCode === 'GENERIC') {
      if (columnMapping.imageCol === null && columnMapping.lifestyleImageCol !== null) {
        console.log(
          `[ExcelParser] Sheet "${sheetName}": Only one image column detected (col ${columnMapping.lifestyleImageCol}), ` +
          `promoting lifestyleImageCol → imageCol (single image column defaults to product image)`
        );
        columnMapping.imageCol = columnMapping.lifestyleImageCol;
        columnMapping.lifestyleImageCol = null;
      }
    }

    // Determine unit multiplier per-sheet using the Global Unit & Scaling Engine:
    // Priority:
    // 1. Dimension column header text (most specific — e.g., "尺寸【长宽高CM】")
    // 2. Sheet-wide scan of first 10 rows for unit keywords (broader detection)
    // 3. Factory default multiplier (fallback)
    let sheetUnitMultiplier: number;
    if (columnMapping.dimensionHeader) {
      sheetUnitMultiplier = detectUnitMultiplierFromHeader(columnMapping.dimensionHeader);
      if (DEBUG_LOGGING) console.log(`[UnitEngine] Sheet "${sheetName}": multiplier=${sheetUnitMultiplier} (from dimension header: "${columnMapping.dimensionHeader}")`);
    } else {
      // Global scan: check first 10 rows for any unit indicator
      sheetUnitMultiplier = scanSheetForUnitMultiplier(jsonData, 10);
      if (DEBUG_LOGGING) console.log(`[UnitEngine] Sheet "${sheetName}": multiplier=${sheetUnitMultiplier} (from sheet-wide scan, no dimension header found)`);
    }

    if (DEBUG_LOGGING) console.log(`[ExcelParser] Sheet "${sheetName}": unitMultiplier=${sheetUnitMultiplier} (from header: "${columnMapping.dimensionHeader || 'none'}", factory default: ${rule.unitMultiplier}), columns:`, columnMapping);
    
    // If we can't find any useful columns, try the collection/series name from sheet name
    const sheetCollection = sheetName.replace(/series|系列/gi, '').trim();
    
    // CALIBRATION LOG: confirm the header row index and where data starts
    // This rowIdx must match the fromRow values in [IMAGE ANCHOR] logs above
    const dataStartRowIdx = columnMapping.headerRowIndex + 1 + (rule.firstDataRowOffset ?? 0);
    if (DEBUG_LOGGING) console.log(
      `[CALIBRATION] Sheet="${sheetName}": headerRowIndex=${columnMapping.headerRowIndex}, ` +
      `firstDataRowOffset=${rule.firstDataRowOffset ?? 0}, ` +
      `data starts at rowIdx=${dataStartRowIdx}, ` +
      `imageCol=${columnMapping.imageCol} (0-based). ` +
      `First product image should have fromRow=${dataStartRowIdx}.`
    );

    // ── [ROW CHECK] Debug: log row decisions for first 30 rows ──────────────
    if (DEBUG_LOGGING) {
    const rowCheckLimit = Math.min(30, jsonData.length);
    for (let rci = 0; rci < rowCheckLimit; rci++) {
      const rcRow = jsonData[rci];
      const colAValue = rcRow ? String(rcRow[0] ?? '') : '';
      const isNumericColA = colAValue !== '' && !isNaN(Number(colAValue));
      let decision = 'N/A';
      if (rci < dataStartRowIdx) {
        decision = 'HEADER/PRE-DATA';
      } else if (!rcRow || rcRow.every((cell: any) => !cell && cell !== 0)) {
        decision = 'SKIP (empty row)';
      } else if (rule.rowFilter && !rule.rowFilter(rcRow, rci)) {
        decision = 'SKIP (rowFilter)';
      } else {
        decision = 'PROCESS';
      }
      console.log(
        `[ROW CHECK] Row Index: ${rci} | Column A Value: '${colAValue}' | IsNumeric: ${isNumericColA} | Decision: ${decision}`
      );
    }
    }

    // Process data rows (starting after the detected header row + any factory-specific sub-header offset)
    // Track last delivery term for merged cell fallback (when split cells don't have explicit values)
    let lastDeliveryTermId: string | null = null;
    let lastDeliveryTermName: string | null = null;
    for (let rowIdx = dataStartRowIdx; rowIdx < jsonData.length; rowIdx++) {
      const row = jsonData[rowIdx];
      if (!row || row.every((cell: any) => !cell && cell !== 0)) continue; // Skip empty rows
      
      // ── Factory-specific row filter ─────────────────────────────────────────
      // Apply ONLY when the factory rule defines a rowFilter function.
      // PJS/JUESHANG: skips rows where Column A is NOT numeric (category headers like "7字沙发").
      // GENERIC/CYZ/others: no rowFilter defined → all non-empty rows are candidates.
      if (rule.rowFilter && !rule.rowFilter(row, rowIdx)) {
        console.log(
          `[ExcelParser] Row ${rowIdx} SKIPPED by factory rowFilter (${rule.factoryCode}): ` +
          `ColA="${row[0]}" — likely a category header, not a product`
        );
        continue;
      }
      
      totalRows++;
      
      const getCellValue = (colIdx: number | null): string => {
        if (colIdx === null || colIdx >= row.length) return '';
        return String(row[colIdx] || '').trim();
      };
      
      const getCellNumber = (colIdx: number | null): number | null => {
        if (colIdx === null || colIdx >= row.length) return null;
        const val = row[colIdx];
        if (val === '' || val === null || val === undefined) return null;
        const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[,$¥￥]/g, ''));
        return isNaN(num) ? null : num;
      };
      
      const modelNumber = getCellValue(columnMapping.model);
      // Apply Simplified → Traditional Chinese conversion for product title (產品名稱)
      const rawTitleFromCell = getCellValue(columnMapping.title);
      const titleFromCell = rawTitleFromCell ? simplifiedToTraditional(rawTitleFromCell) : '';
      const rawDimensions = getCellValue(columnMapping.dimensions);
      // Apply price cleaning (取大值): handles slash-separated prices like "680/750/820"
      // CRITICAL: Always use cleanPrice to handle concatenation bugs and separators
      const rawCostPriceRaw = columnMapping.costPrice !== null ? row[columnMapping.costPrice] : null;
      const costPrice = cleanPrice(rawCostPriceRaw);
      // Apply Simplified → Traditional Chinese conversion for material description
      const rawMaterial = getCellValue(columnMapping.material);
      const material = rawMaterial ? simplifiedToTraditional(rawMaterial) : '';
      const color = getCellValue(columnMapping.color) || null;
      const description = getCellValue(columnMapping.description);
      const collection = getCellValue(columnMapping.collection) || sheetCollection;
      
      // ── Delivery Term Parsing ─────────────────────────────────────────
      // Extract delivery term from the 參考貨期/生產周期 column and map to ID/name
      // Works for all factories that have a deliveryTermRef column detected
      // CYZ/優卓: Store raw text directly as deliveryTermName (the raw content IS the delivery term)
      // MERGED CELL FALLBACK: If current cell is empty, use the previous row's delivery term
      // (handles split merged cells where only the first row has the value)
      const rawDeliveryTermRef = getCellValue(columnMapping.deliveryTermRef);
      let deliveryTermId: string | null = null;
      let deliveryTermName: string | null = null;
      if (rawDeliveryTermRef) {
        // Store the raw text directly as deliveryTermName (the raw content IS the delivery term)
        deliveryTermName = rawDeliveryTermRef.trim();
        // Try to parse an ID for database linkage
        const parsed = parseDeliveryTerm(rawDeliveryTermRef);
        deliveryTermId = parsed.id;
        if (DEBUG_LOGGING) console.log(`[DeliveryTerm] Row ${rowIdx}: raw="${rawDeliveryTermRef}" → name="${deliveryTermName}", id=${deliveryTermId}`);
        // Update tracker for merged cell fallback
        lastDeliveryTermId = deliveryTermId;
        lastDeliveryTermName = deliveryTermName;
      } else if (columnMapping.deliveryTermRef !== null) {
        // Cell is empty but column exists — use previous row's value (merged cell fallback)
        deliveryTermId = lastDeliveryTermId;
        deliveryTermName = lastDeliveryTermName;
        if (DEBUG_LOGGING && deliveryTermName) console.log(`[DeliveryTerm] Row ${rowIdx}: MERGED CELL FALLBACK → name="${deliveryTermName}", id=${deliveryTermId}`);
      }
      
      // [ROW_TRACE] — Log every row decision for debugging S999 data loss
      if (DEBUG_LOGGING) console.log(`[ROW_TRACE] Processing Row: ${rowIdx} | Model: "${modelNumber}" | Title: "${titleFromCell}" | Dims: "${rawDimensions}" | Cost: ${costPrice}`);
      
      // Skip if no meaningful data (no model AND no title AND no dimensions)
      if (!modelNumber && !titleFromCell && !rawDimensions && costPrice === null) {
        if (DEBUG_LOGGING) console.log(`[ROW_TRACE] ❌ SKIPPED Row ${rowIdx} — no model, no title, no dims, no cost`);
        continue;
      }
      
      // ── CYZ/優卓 Special Rule: Skip "1+1+3" dimension rows ──────────────────
      // When dimensions are "1+1+3" (or similar patterns like "1+1+3座"), this indicates
      // a sofa set configuration (e.g. 1-seater + 1-seater + 3-seater) — NOT actual dimensions.
      // These rows should NOT be recorded as products.
      if (rule.factoryCode === 'CYZ' && rawDimensions) {
        const dimTrimmed = rawDimensions.trim().replace(/\s+/g, '');
        // Match patterns like "1+1+3", "1+2+3", "1+1+3座", "2+3" etc (sofa set configs)
        if (/^\d\+\d(\+\d)?(座|位)?$/.test(dimTrimmed)) {
          console.log(`[CYZ] ❌ SKIPPED Row ${rowIdx} — dimensions "${rawDimensions}" is a sofa set configuration, not actual dimensions`);
          continue;
        }
      }
      
      // Apply factory-specific dimension parsing
      const parsedDims = rule.parseDimensions(rawDimensions);
      // Use per-sheet multiplier (derived from header unit, overrides factory default)
      const multiplier = sheetUnitMultiplier;
      
      const dimensionLMm = parsedDims.l !== null ? Math.round(parsedDims.l * multiplier) : null;
      const dimensionWMm = parsedDims.w !== null ? Math.round(parsedDims.w * multiplier) : null;
      const dimensionHMm = parsedDims.h !== null ? Math.round(parsedDims.h * multiplier) : null;

      // Factory-specific title construction:
      // PJS: MUST start with model number — format: "[Model] - [Material]"
      //   Never use "Sheet - Row X" as a title.
      // Others: use detected title column, fallback to model.
      let productTitle: string;
      if (rule.factoryCode === 'PJS') {
        if (modelNumber) {
          // Format: "095 - 材質描述" (will be replaced by AI with bilingual name)
          productTitle = material
            ? `${modelNumber} - ${material}`
            : `${modelNumber} - Product`;
        } else if (titleFromCell) {
          productTitle = titleFromCell;
        } else {
          // Skip rows where we can't determine any identifier
          console.warn(`[ExcelParser] PJS row ${rowIdx}: no model number found, skipping title fallback`);
          productTitle = `PJS-Row${rowIdx}`;
        }
      } else {
        productTitle = titleFromCell || modelNumber || `${sheetCollection}-Row${rowIdx}`;
        if (modelNumber && titleFromCell && titleFromCell !== modelNumber) {
          productTitle = `${titleFromCell} (${modelNumber})`;
        }
      }

      // For PJS, the material description IS the description field
      const productDescription = rule.factoryCode === 'PJS'
        ? [material, description].filter(Boolean).join('\n')
        : description || `${collection} - ${material || ''}`.trim();
      
      // ── Role-aware image matching ─────────────────────────────────────────
      // matchImagesForRow returns { productImage (產品圖片/col D), lifestyleImage (效果圖/col B) }
      // Pass columnMapping so it uses header-detected column positions (not hardcoded indices)
      
      // ── [MATCHING] Debug: log the search parameters for this product row ──
      const _matchModel = modelNumber || titleFromCell || `Row${rowIdx}`;
      console.log(
        `[MATCHING] Product ${_matchModel} on Row ${rowIdx} - Searching for image with fromRow: ${rowIdx} and fromCol: ${columnMapping.imageCol ?? 'null'} (lifestyle fromCol: ${columnMapping.lifestyleImageCol ?? 'null'})`
      );
      
      const { productImage, lifestyleImage, nearbyImages, productImageFromCol } = matchImagesForRow(images, sheetIdx, rowIdx, columnMapping, { imageRowTolerance: rule.imageRowTolerance, lifestyleOnlyImages: bannedImages, strictImageColumns: rule.strictImageColumns });
      
      // ══════════════════════════════════════════════════════════════════════════
      // STRICT PHYSICAL GRID FILTERING (Final Product Assignment):
      // ONLY applies to factories with strictImageColumns=true (e.g. PJS/爵尚).
      // For other factories (CYZ/優卓, GENERIC), product images can be in ANY column
      // that was detected as the product image column by header detection.
      // ══════════════════════════════════════════════════════════════════════════
      let validatedProductImage = productImage;
      let imageColumnValidated = false;
      
      if (rule.strictImageColumns) {
        // STRICT mode (PJS): Column B (index 1) = LIFESTYLE. NEVER product. BLOCK.
        if (productImage && productImageFromCol !== undefined) {
          if (productImageFromCol === 1) {
            console.error(
              `[STRICT GRID] ❌ ERROR: LIFESTYLE IMAGE DETECTED! Row ${rowIdx}: ` +
              `Image from Column B (fromCol=1). This is a room/scene shot. BLOCKING product image.`
            );
            validatedProductImage = null;
            imageColumnValidated = false;
          } else if (productImageFromCol >= 2) {
            imageColumnValidated = true;
          }
        } else if (productImage && productImageFromCol === undefined) {
          imageColumnValidated = false;
        }

        // VERIFICATION FAIL-SAFE (STRICT mode only)
        if (validatedProductImage && productImageFromCol !== undefined) {
          console.log(
            `[VERIFY] Row ${rowIdx} Image Source: Column ${productImageFromCol} ` +
            `(${String.fromCharCode(65 + productImageFromCol)})`
          );
          if (productImageFromCol < 2) {
            console.error(
              `[VERIFY] ❌ FAIL-SAFE TRIGGERED! Row ${rowIdx} Image Source: Column ${productImageFromCol} ` +
              `— THIS IS NOT COLUMN C OR LATER! Image is from a BANNED column. ` +
              `SKIPPING this image. Product will have NO image.`
            );
            validatedProductImage = null;
            imageColumnValidated = false;
          }
        }
      } else {
        // NON-STRICT mode (CYZ/優卓, GENERIC): accept product image from any detected column
        if (productImage) {
          imageColumnValidated = true;
          if (productImageFromCol !== undefined) {
            console.log(
              `[IMAGE] Row ${rowIdx} Image Source: Column ${productImageFromCol} ` +
              `(${String.fromCharCode(65 + productImageFromCol)}) — accepted (non-strict mode)`
            );
          }
        }
      }
      
      // Debug log for first 20 products — shows absolute Excel row vs found image
      if (products.length < 20) {
        const colLetter = columnMapping?.imageCol !== null && columnMapping?.imageCol !== undefined
          ? String.fromCharCode(65 + (columnMapping.imageCol ?? 0))
          : '?';
        const imgStatus = validatedProductImage ? `✅ FOUND (col=${productImageFromCol}, validated=${imageColumnValidated})` : (productImage ? `⚠️ BLOCKED (col=${productImageFromCol})` : `❌ MISSING`);
        console.log(
          `[SYNC CHECK] P${products.length + 1} → Excel rowIdx=${rowIdx} (0-based), ` +
          `Model="${modelNumber || '(none)'}", ImageCol=${colLetter}(idx=${columnMapping?.imageCol}), ` +
          `Image: ${imgStatus}`
        );
      }
      
      // [DEBUG] Output for every product push — Model | ExcelRow | Image status
      console.log(
        `[DEBUG] Model: ${modelNumber || titleFromCell || 'unknown'} | ExcelRow: ${rowIdx} | ` +
        `ImageIndex: ${validatedProductImage ? `Column ${productImageFromCol}, MATCHED` : 'NO IMAGE'} | ` +
        `Lifestyle: ${lifestyleImage ? 'YES' : 'NO'}`
      );
      
      products.push({
        // UNIQUE IDENTIFIER: [rowIdx]-[modelNumber] ensures every row is treated as a
        // UNIQUE PRODUCT even if model numbers are identical (e.g. multiple S999 rows).
        // Never merge or de-duplicate rows — each Excel row = one product.
        id: `excel-${sheetName}-${rowIdx}-${modelNumber || 'nomodel'}-${Math.random().toString(36).substring(7)}`,
        title: productTitle,
        titleEn: '', // Populated by AI enrichment later
        titleZh: '', // Populated by AI enrichment later
        modelNumber,
        description: productDescription,
        dimensions: rawDimensions,
        dimensionLMm,
        dimensionWMm,
        dimensionHMm,
        costPrice,
        material,
        tags: collection ? [collection] : [],
        collection,
        price: costPrice || 0,
        color,
        sheetName,
        rowIndex: rowIdx,
        selected: true,
        expanded: false,
        imageData: validatedProductImage,             // 產品圖片 (white-bg product shot, col C ONLY)
        lifestyleImageData: lifestyleImage,  // 效果圖 (lifestyle/scene shot, col B)
        nearbyImages: nearbyImages.length > 1 ? nearbyImages : undefined, // Only include if multiple candidates found
        imageFromCol: productImageFromCol,
        imageColumnValidated,
        deliveryTermId,
        deliveryTermName,
      });
    }
  }
  
  
  // Log how many products got direct image matches from row anchors
  const withProductImages = products.filter(p => p.imageData).length;
  const withLifestyleImages = products.filter(p => p.lifestyleImageData).length;
  console.log(`[ExcelParser] Parsing complete: ${products.length} products, ${withProductImages} with product images (產品圖片), ${withLifestyleImages} with lifestyle images (效果圖), ${images.length} total embedded images`);
  
  return {
    products,
    sheetNames,
    totalRows,
    errors,
    images,
  };
}

/**
 * Match images from the images array to a specific sheet row.
 *
 * ABSOLUTE fromRow MATCHING (primary strategy):
 * ──────────────────────────────────────────────
 * Excel Drawing XML <xdr:from><xdr:row>N</xdr:row> is the ABSOLUTE 0-based
 * row index where the image's top-left corner is anchored. This number maps
 * directly to the jsonData array index when blankrows:true is used.
 *
 * THE RULE: image belongs to row X if img.fromRow === X (strict equality).
 *
 * TOLERANCE FALLBACK (for merged cells / varying row heights):
 * ────────────────────────────────────────────────────────────
 * When strict matching fails (e.g., PJS sheets with merged cells causing
 * image anchors to be offset by 1-2 rows), we apply a ±2 row tolerance
 * ONLY for images that haven't been claimed by another product.
 * The tolerance fallback picks the NEAREST unclaimed image.
 *
 * STRICT COLUMN LOCKING:
 * - productImage   → ONLY from columnMapping.imageCol
 * - lifestyleImage → ONLY from columnMapping.lifestyleImageCol
 */

/** Running counter for debug output — capped at 20 products per parse session */
let _debugProductCount = 0;

/** Track which images have been "claimed" by a product row (prevents double assignment) */
const _claimedImageIndices: Set<number> = new Set();

/** Reset claimed images between parse sessions */
export function resetImageMatchState() {
  _debugProductCount = 0;
  _claimedImageIndices.clear();
}

/** Tolerance (in rows) for fallback matching when strict fromRow === rowIdx fails */
const ROW_TOLERANCE = 2;

/** Maximum column span for a "product" image. Images wider than this are likely scene/effect photos. */
const MAX_PRODUCT_COL_SPAN = 2;

/**
 * HARD COLUMN GUARD: Columns that are NEVER allowed to be product images.
 * Column B (index 1) is ALWAYS lifestyle/效果图 in PJS and similar factories.
 * This is a zero-tolerance rule that cannot be overridden by proximity or tolerance matching.
 */
const FORBIDDEN_PRODUCT_COLUMNS: Set<number> = new Set([0, 1]); // Column A = index 0, Column B = index 1 — WALL RULE: fromCol < 2 = BANNED

/**
 * Compute column span for an image. If toCol is undefined, assume single-col (span=1).
 * Scene/effect images typically span 3+ columns (e.g. from col 0 to col 4).
 * Product (white-background) images are typically contained within 1-2 columns.
 * 
 * ENHANCED: Also checks EMU offsets — if fromColOff + toColOff suggest the image
 * is significantly wider than its column span implies, bump up the effective span.
 */
function getColSpan(img: ExcelImage): number {
  if (img.colSpan !== undefined) return img.colSpan;
  if (img.fromCol !== undefined && img.toCol !== undefined) {
    const span = img.toCol - img.fromCol;
    return span;
  }
  // Heuristic: if the image has large EMU offsets suggesting it extends far beyond its anchor column,
  // treat it as a wide (effect/lifestyle) image. One standard column ≈ 600,000 EMU.
  // If toColOff > 1,200,000 EMU (2 columns worth), it's likely spanning multiple columns visually.
  if (img.toColOff !== undefined && img.toColOff > 1200000) {
    return 3; // Treat as wide/effect image
  }
  return 1; // Assume single-column if no data
}

/**
 * Proximity score: lower = better (closer to the target row).
 * Uses fromRow distance + EMU offset normalized to fractional rows.
 * One EMU row ≈ 200_000 EMU for a standard Excel row; we normalize offsets.
 */
function proximityScore(img: ExcelImage, targetRow: number): number {
  const rowDist = Math.abs((img.fromRow ?? 0) - targetRow);
  // Normalize EMU offset (typical row ≈ 200,000 EMU → 0.0 to 1.0 fractional row)
  const emuFraction = (img.fromRowOff ?? 0) / 200000;
  return rowDist + emuFraction;
}

function matchImagesForRow(
  images: ExcelImage[],
  sheetIdx: number,
  rowIdx: number,
  columnMapping?: ColumnMapping,
  options?: { imageRowTolerance?: number; lifestyleOnlyImages?: ExcelImage[]; strictImageColumns?: boolean },
): { productImage: string | null; lifestyleImage: string | null; nearbyImages: string[]; productImageFromCol: number | undefined } {
  if (!images || images.length === 0) return { productImage: null, lifestyleImage: null, nearbyImages: [], productImageFromCol: undefined };

  // Use factory-specific tolerance if provided, otherwise default
  const rowTolerance = options?.imageRowTolerance ?? ROW_TOLERANCE;

  // Lifestyle-only images (banned from product pool by the Wall Rule, fromCol < 2)
  const lifestyleOnlyImages = options?.lifestyleOnlyImages ?? [];

  const sheetKey = `sheet${sheetIdx}`;
  const hasColumnInfo = !!(
    columnMapping &&
    (columnMapping.imageCol !== null || columnMapping.lifestyleImageCol !== null)
  );

  const productColIdx = columnMapping?.imageCol ?? null;
  const lifestyleColIdx = columnMapping?.lifestyleImageCol ?? null;

  // Debug: log the column indices being used for matching (first product only)
  if (_debugProductCount === 0) {
    console.log(
      `[STRICT GRID] ═══ STRICT PHYSICAL GRID FILTERING ACTIVE ═══\n` +
      `  productColIdx=${productColIdx}, lifestyleColIdx=${lifestyleColIdx}, ` +
      `hasColumnInfo=${hasColumnInfo}, rowTolerance=${rowTolerance}\n` +
      `  RULE: Column B (index 1) = ALWAYS lifestyle. Column C (index 2) = ALWAYS product.\n` +
      `  MATCHING: Geometric Center used for merged cells. No heuristic fallback.\n` +
      `  FORBIDDEN product columns: [${[...FORBIDDEN_PRODUCT_COLUMNS].join(',')}]`
    );
  }

  let productImage: string | null = null;
  let lifestyleImage: string | null = null;
  /** Track which column the product image came from (for validation) */
  let productImageFromCol: number | undefined = undefined;
  /** Collect all nearby candidate images (for Switch Image UI) — up to ±3 rows */
  const nearbyImageUris: string[] = [];

  // Collect all product-col candidates for this row (for debug & tolerance fallback)
  // HARD GUARD: Exclude images from FORBIDDEN columns ONLY in strict mode (PJS/爵尚).
  // For non-strict factories (CYZ/優卓, GENERIC), allow product images from any column.
  const useStrictColumns = options?.strictImageColumns ?? false;
  const candidatesForRow: ExcelImage[] = [];
  if (productColIdx !== null) {
    for (const img of images) {
      if (img.fromRow !== undefined && img.fromCol === productColIdx) {
        // ZERO-TOLERANCE COLUMN GUARD: Only apply in strict mode
        if (useStrictColumns && FORBIDDEN_PRODUCT_COLUMNS.has(img.fromCol)) {
          console.error(
            `[COLUMN GUARD] ❌ BLOCKED: Image[${img.imageIndex}] fromCol=${img.fromCol} is in FORBIDDEN_PRODUCT_COLUMNS! ` +
            `This image CANNOT be a product image. productColIdx=${productColIdx} is misconfigured!`
          );
          continue;
        }
        candidatesForRow.push(img);
      }
    }
  }

  // Also collect ALL images near this row (±3 rows, any column) for the "Switch Image" gallery
  const NEARBY_RADIUS = 3;
  for (const img of images) {
    const isThisSheet = img.sheetName === `sheet${sheetIdx}`;
    const isOnlyOneSheet = !images.some(i => i.sheetName !== img.sheetName && i.sheetName.startsWith('sheet'));
    if (!isThisSheet && !isOnlyOneSheet) continue;
    if (img.fromRow === undefined) continue;
    if (Math.abs(img.fromRow - rowIdx) <= NEARBY_RADIUS) {
      const dataUri = `data:${img.mimeType};base64,${img.base64}`;
      nearbyImageUris.push(dataUri);
    }
  }
  // Also include lifestyle-only images (banned from product pool) in nearby gallery
  for (const img of lifestyleOnlyImages) {
    const isThisSheet = img.sheetName === `sheet${sheetIdx}`;
    const isOnlyOneSheet = !lifestyleOnlyImages.some(i => i.sheetName !== img.sheetName && i.sheetName.startsWith('sheet'));
    if (!isThisSheet && !isOnlyOneSheet) continue;
    if (img.fromRow === undefined) continue;
    if (Math.abs(img.fromRow - rowIdx) <= NEARBY_RADIUS) {
      const dataUri = `data:${img.mimeType};base64,${img.base64}`;
      nearbyImageUris.push(dataUri);
    }
  }

  for (const img of images) {
    // ── Sheet filter ──────────────────────────────────────────────────────
    const isThisSheet = img.sheetName === sheetKey;
    const isOnlyOneSheet = !images.some(i => i.sheetName !== img.sheetName && i.sheetName.startsWith('sheet'));
    if (!isThisSheet && !isOnlyOneSheet) continue;

    if (img.fromRow === undefined) continue;

    const imgFromRow = img.fromRow;
    const imgToRow = img.toRow ?? imgFromRow;

    // ── Column-strict matching ─────────────────────────────────────────────
    // When we have column info, ONLY match images that have a known column anchor.
    // This prevents lifestyle images (col=1) from ever being matched as product images (col=2).
    if (hasColumnInfo) {
      // If image has no column info, skip it entirely when we have column mapping
      if (img.fromCol === undefined) continue;

      // ═══════════════════════════════════════════════════════════════════════
      // STRICT PHYSICAL GRID GUARD (only in strict mode — e.g. PJS/爵尚):
      // Column B (index 1) = LIFESTYLE. PERIOD. No exceptions.
      // In non-strict mode (CYZ/優卓), column classification is purely based
      // on header detection — column B can be product if header says so.
      // ═══════════════════════════════════════════════════════════════════════
      if (useStrictColumns && img.fromCol === 1) {
        // Column B = ALWAYS lifestyle image in strict mode. Assign to lifestyle slot if it spans this row.
        if (rowIdx >= imgFromRow && rowIdx <= imgToRow) {
          const dataUri = `data:${img.mimeType};base64,${img.base64}`;
          if (!lifestyleImage) lifestyleImage = dataUri;
        }
        continue; // NEVER proceed to product matching for Column B in strict mode
      }

      if (useStrictColumns && FORBIDDEN_PRODUCT_COLUMNS.has(img.fromCol) && img.fromCol !== productColIdx) {
        // This is a forbidden column image — force to lifestyle only (strict mode)
        if (lifestyleColIdx !== null && img.fromCol === lifestyleColIdx) {
          if (rowIdx >= imgFromRow && rowIdx <= imgToRow) {
            const dataUri = `data:${img.mimeType};base64,${img.base64}`;
            if (!lifestyleImage) lifestyleImage = dataUri;
          }
        }
        continue;
      }

      // DOUBLE-CHECK: Even if productColIdx === img.fromCol, if it's a FORBIDDEN column, BLOCK IT (strict only)
      if (useStrictColumns && FORBIDDEN_PRODUCT_COLUMNS.has(img.fromCol) && productColIdx === img.fromCol) {
        console.error(
          `[COLUMN GUARD] ❌ CRITICAL: productColIdx=${productColIdx} is in FORBIDDEN_PRODUCT_COLUMNS! ` +
          `Image[${img.imageIndex}] fromCol=${img.fromCol} row=${imgFromRow} BLOCKED from product assignment. ` +
          `Factory rule forceImageCol is likely misconfigured!`
        );
        continue;
      }

      // PRODUCT IMAGE: strict col===productColIdx
      // STRICT ANCHOR MATCHING (PJS): img.fromRow MUST === rowIdx. NO geometric center. NO tolerance.
      // NON-STRICT MERGED CELL (CYZ/優卓): When image spans multiple rows (merged cells),
      // all rows within the span inherit the same product image.
      if (productColIdx !== null && img.fromCol === productColIdx) {
        // Exact row match (works for both strict and non-strict)
        if (img.fromRow === rowIdx && !_claimedImageIndices.has(img.imageIndex)) {
          // ── Aspect Ratio Filter: skip images that span too many columns (scene/effect photos) ──
          const colSpan = getColSpan(img);
          if (colSpan > MAX_PRODUCT_COL_SPAN) {
            console.log(
              `[ASPECT FILTER] Image[${img.imageIndex}] row=${imgFromRow} col=${img.fromCol} → colSpan=${colSpan} > MAX(${MAX_PRODUCT_COL_SPAN}) → SKIPPED`
            );
            continue; // Skip wide images — they're scene/effect photos
          }
          const dataUri = `data:${img.mimeType};base64,${img.base64}`;
          if (!productImage) {
            productImage = dataUri;
            productImageFromCol = img.fromCol;
            _claimedImageIndices.add(img.imageIndex);
            console.log(
              `[DEBUG] ExcelRow: ${rowIdx} | ImageIndex: ${img.imageIndex}, Column ${img.fromCol}, Row ${img.fromRow} | MATCHED`
            );
          }
        }
        // NON-STRICT: Merged cell image inheritance — row is within image's span range
        // This handles the case where images have merged cells: subsequent rows use the same image
        else if (!useStrictColumns && !productImage && rowIdx >= imgFromRow && rowIdx <= imgToRow) {
          const colSpan = getColSpan(img);
          if (colSpan <= MAX_PRODUCT_COL_SPAN) {
            const dataUri = `data:${img.mimeType};base64,${img.base64}`;
            productImage = dataUri;
            productImageFromCol = img.fromCol;
            // Do NOT claim — allow other rows in the merge range to also use this image
            console.log(
              `[DEBUG] ExcelRow: ${rowIdx} | ImageIndex: ${img.imageIndex}, Column ${img.fromCol}, Row ${img.fromRow}-${imgToRow} | MERGED CELL INHERIT`
            );
          }
        }
        continue; // Never let product-col image become lifestyle
      }

      // LIFESTYLE IMAGE: span-cover (lifestyle images can span many rows via merged cells)
      if (lifestyleColIdx !== null && img.fromCol === lifestyleColIdx) {
        if (rowIdx >= imgFromRow && rowIdx <= imgToRow) {
          const dataUri = `data:${img.mimeType};base64,${img.base64}`;
          if (!lifestyleImage) lifestyleImage = dataUri;
        }
        continue;
      }

      // Image is from an unrecognised column — DISCARD
      continue;
    }

    // ── Fallback (no column mapping at all) ──────────────────────────────────────
    // When no column headers were detected for image assignment:
    // - STRICT mode (PJS): Column B (index 1) = ALWAYS lifestyle. Column C (index 2+) = ALWAYS product.
    // - NON-STRICT mode (CYZ/GENERIC): All images default to product (user's requirement).
    // STRICT ANCHOR: img.fromRow === rowIdx ONLY. NO geometric center.
    if (!hasColumnInfo) {
      const isExactRow = imgFromRow === rowIdx;
      const isSpanRow = rowIdx >= imgFromRow && rowIdx <= imgToRow;

      if (useStrictColumns) {
        // HARD GUARD (strict mode only): Column B (index 1) = ALWAYS lifestyle. No exceptions.
        if (img.fromCol === 1) {
          const dataUri = `data:${img.mimeType};base64,${img.base64}`;
          if (isSpanRow && !lifestyleImage) lifestyleImage = dataUri;
          continue;
        }

        // HARD GUARD (strict mode only): Any image with known fromCol in FORBIDDEN set → lifestyle only
        if (img.fromCol !== undefined && FORBIDDEN_PRODUCT_COLUMNS.has(img.fromCol)) {
          const dataUri = `data:${img.mimeType};base64,${img.base64}`;
          if (isSpanRow && !lifestyleImage) lifestyleImage = dataUri;
          continue;
        }
      }

      const dataUri = `data:${img.mimeType};base64,${img.base64}`;
      
      if (useStrictColumns) {
        // Strict Grid: Only images from Column C (index 2+) or unknown column can be product
        // STRICT: isExactRow ONLY — no geometric center
        if (img.fromCol !== undefined && img.fromCol >= 2) {
          // Confirmed Column C+ → product image (STRICT fromRow === rowIdx only)
          if (isExactRow && !productImage && !_claimedImageIndices.has(img.imageIndex)) {
            productImage = dataUri;
            productImageFromCol = img.fromCol;
            _claimedImageIndices.add(img.imageIndex);
          }
        } else if (img.fromCol === undefined) {
          // Unknown column — use imageRole hint from extraction
          if (img.imageRole === 'product') {
            if (isExactRow && !productImage && !_claimedImageIndices.has(img.imageIndex)) {
              productImage = dataUri;
              productImageFromCol = img.fromCol;
              _claimedImageIndices.add(img.imageIndex);
            }
          } else if (img.imageRole === 'lifestyle') {
            if (isSpanRow && !lifestyleImage) lifestyleImage = dataUri;
          } else {
            // Unknown role + unknown column → conservative: try product first (strict row only)
            if (isExactRow && !productImage && !_claimedImageIndices.has(img.imageIndex)) {
              productImage = dataUri;
              productImageFromCol = img.fromCol;
              _claimedImageIndices.add(img.imageIndex);
            } else if (isSpanRow && !lifestyleImage) {
              lifestyleImage = dataUri;
            }
          }
        }
      } else {
        // NON-STRICT mode (CYZ/優卓, GENERIC): any image can be product
        // Default: all images are product images unless explicitly in a lifestyle column
        // MERGED CELL RULE: When an image spans multiple rows (merged cells), ALL rows
        // within that span should inherit the same image. Do NOT check _claimedImageIndices
        // for span-row matches — only claim on exact-row match to track the primary owner.
        if (img.fromCol !== undefined) {
          // Any column is valid for product in non-strict mode
          if (isExactRow && !productImage && !_claimedImageIndices.has(img.imageIndex)) {
            productImage = dataUri;
            productImageFromCol = img.fromCol;
            _claimedImageIndices.add(img.imageIndex);
          } else if (isSpanRow && !productImage) {
            // Merged cell image inheritance: share across all rows in the span
            // Do NOT check _claimedImageIndices — merged images are shared by design
            productImage = dataUri;
            productImageFromCol = img.fromCol;
            // Do NOT claim — allow other rows in the merge range to also use this image
          }
        } else {
          // Unknown column — default to product image
          if (img.imageRole === 'lifestyle') {
            if (isSpanRow && !lifestyleImage) lifestyleImage = dataUri;
          } else {
            if (isExactRow && !productImage && !_claimedImageIndices.has(img.imageIndex)) {
              productImage = dataUri;
              productImageFromCol = img.fromCol;
              _claimedImageIndices.add(img.imageIndex);
            } else if (isSpanRow && !productImage) {
              // Merged cell inheritance for unknown-column images too
              productImage = dataUri;
              productImageFromCol = img.fromCol;
            }
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOLERANCE FALLBACK: If strict fromRow === rowIdx didn't match, try nearby
  // images within ±rowTolerance rows, but ONLY from the correct product column.
  // This handles irregular row heights and merged cells that offset image anchors.
  // STRICT COLUMN GUARD (strict mode only): Never pick from FORBIDDEN columns.
  // ENHANCED: Prefer downward matches (images below the row) over upward matches
  // to avoid stealing effect photos from previous product sections.
  // ═══════════════════════════════════════════════════════════════════════════
  if (!productImage && productColIdx !== null && hasColumnInfo) {
    // Find unclaimed images in the product column within tolerance range
    const toleranceCandidates = candidatesForRow.filter(img => {
      if (img.fromRow === undefined) return false;
      if (_claimedImageIndices.has(img.imageIndex)) return false;
      // Must be from the product column
      if (img.fromCol !== productColIdx) return false;
      // STRICT: Never from FORBIDDEN columns (only in strict mode)
      if (useStrictColumns && FORBIDDEN_PRODUCT_COLUMNS.has(img.fromCol)) return false;
      // Must be within tolerance range
      const distance = Math.abs(img.fromRow - rowIdx);
      return distance > 0 && distance <= rowTolerance;
    });

    if (toleranceCandidates.length > 0) {
      // Sort by: 1) prefer downward (img.fromRow > rowIdx) over upward,
      //          2) distance (closest first), 3) imageIndex (deterministic)
      toleranceCandidates.sort((a, b) => {
        const aIsBelow = a.fromRow! >= rowIdx ? 0 : 1; // 0 = below/same, 1 = above
        const bIsBelow = b.fromRow! >= rowIdx ? 0 : 1;
        if (aIsBelow !== bIsBelow) return aIsBelow - bIsBelow; // Prefer below
        const distA = Math.abs(a.fromRow! - rowIdx);
        const distB = Math.abs(b.fromRow! - rowIdx);
        if (distA !== distB) return distA - distB;
        return a.imageIndex - b.imageIndex;
      });

      // Try candidates in order, applying aspect ratio filter
      for (const candidate of toleranceCandidates) {
        const colSpan = getColSpan(candidate);
        if (colSpan > MAX_PRODUCT_COL_SPAN) {
          console.log(
            `[TOLERANCE SKIP] Image[${candidate.imageIndex}] row=${candidate.fromRow} col=${candidate.fromCol} → ` +
            `colSpan=${colSpan} > MAX(${MAX_PRODUCT_COL_SPAN}) → SKIPPED (likely effect photo)`
          );
          continue; // Skip wide images — they're scene/effect photos
        }
        const dataUri = `data:${candidate.mimeType};base64,${candidate.base64}`;
        productImage = dataUri;
        productImageFromCol = candidate.fromCol;
        _claimedImageIndices.add(candidate.imageIndex);
        console.log(
          `[TOLERANCE MATCH] Row ${rowIdx}: Matched Image[${candidate.imageIndex}] fromRow=${candidate.fromRow} ` +
          `(distance=${Math.abs(candidate.fromRow! - rowIdx)}, col=${candidate.fromCol}, direction=${candidate.fromRow! >= rowIdx ? 'below' : 'above'}) via ±${rowTolerance} tolerance`
        );
        break; // Use the first valid candidate
      }
    }
  }

  // SYNC CHECK: log what we found (or didn't find) for first 20 products
  if (_debugProductCount < 20 && productColIdx !== null && !productImage) {
    const nearbyImages = candidatesForRow.filter(
      img => img.fromRow !== undefined && Math.abs(img.fromRow! - rowIdx) <= 5
    );
    if (nearbyImages.length > 0) {
      const nearby = nearbyImages.map(img => `Image[${img.imageIndex}] fromRow=${img.fromRow} col=${img.fromCol} ${_claimedImageIndices.has(img.imageIndex) ? '(CLAIMED)' : '(unclaimed)'}`).join(', ');
      console.log(
        `[SYNC CHECK] Row ${rowIdx}: NO image found at fromRow=${rowIdx} (±${rowTolerance}). ` +
        `Nearby product-col images: ${nearby}`
      );
    } else {
      console.log(`[SYNC CHECK] Row ${rowIdx}: NO product image in col=${productColIdx} anywhere near this row.`);
    }
    _debugProductCount++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL SAFETY NET: STRICT PHYSICAL GRID post-match validation (STRICT mode only)
  // If productImage was somehow assigned from Column B, NULL it out.
  // This is the ABSOLUTE LAST LINE OF DEFENSE — only for PJS/strict factories.
  // ═══════════════════════════════════════════════════════════════════════════
  if (useStrictColumns && productImage && productImageFromCol === 1) {
    console.error(
      `[STRICT GRID] ❌ FINAL SAFETY NET: Product image for row ${rowIdx} came from ` +
      `Column B (fromCol=1)! This should be IMPOSSIBLE with strict grid filtering. Nullifying.`
    );
    productImage = null;
    productImageFromCol = undefined;
  }
  
  if (useStrictColumns && productImage && hasColumnInfo && lifestyleColIdx !== null) {
    // Check: is the matched product image actually the same as the lifestyle image?
    // This happens when Column B images leak into product slot (strict mode only)
    if (productImage === lifestyleImage) {
      console.error(
        `[STRICT GRID] ❌ POST-MATCH: Product image for row ${rowIdx} is IDENTICAL to lifestyle image! ` +
        `This means a Column B image leaked into product slot. Nullifying product image.`
      );
      productImage = null;
      productImageFromCol = undefined;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFESTYLE MATCHING FROM BANNED POOL (Wall Rule images with fromCol < 2)
  // These images were pre-filtered out of the product pool but are valid for
  // lifestyle/效果圖 assignment. Match by row span overlap.
  // ═══════════════════════════════════════════════════════════════════════════
  if (!lifestyleImage && lifestyleOnlyImages.length > 0) {
    for (const img of lifestyleOnlyImages) {
      const isThisSheet = img.sheetName === sheetKey;
      const isOnlyOneSheet = !lifestyleOnlyImages.some(i => i.sheetName !== img.sheetName && i.sheetName.startsWith('sheet'));
      if (!isThisSheet && !isOnlyOneSheet) continue;
      if (img.fromRow === undefined) continue;
      const imgFromRow = img.fromRow;
      const imgToRow = img.toRow ?? imgFromRow;
      if (rowIdx >= imgFromRow && rowIdx <= imgToRow) {
        lifestyleImage = `data:${img.mimeType};base64,${img.base64}`;
        break;
      }
    }
  }

  return { productImage, lifestyleImage, nearbyImages: nearbyImageUris, productImageFromCol };
}

/** Legacy single-image helper for backward compatibility */
function matchImageToRow(images: ExcelImage[], sheetIdx: number, rowIdx: number): string | null {
  return matchImagesForRow(images, sheetIdx, rowIdx, undefined).productImage;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAW TABLE EXTRACTION — "Human-in-the-loop" Table-First Workflow
// ═══════════════════════════════════════════════════════════════════════════════
// This function does NOT assemble products. It extracts raw row data from the
// Excel sheet and returns it as a flat table suitable for the Preview UI.
// The user then maps columns manually before the final "Generate Catalog" step.
// ═══════════════════════════════════════════════════════════════════════════════

export interface RawTableRow {
  /** 0-based Excel row index */
  rowIndex: number;
  /** All cell values for this row */
  cells: (string | number | null)[];
  /** Product image (data URI) — inherited from merged cells */
  productImageData?: string | null;
  /** Second product image (data URI) — when multiple images exist in the same image column range, ordered by column position */
  productImageData2?: string | null;
  /** Third product image (data URI) — when multiple images exist in the same image column range, ordered by column position */
  productImageData3?: string | null;
  /** Lifestyle image (data URI) — inherited from merged cells */
  lifestyleImageData?: string | null;
  /** Whether this row appears to be a valid product row (has model/dims/price) */
  isProductRow: boolean;
  /** Whether this row has at least 2 filled cells beyond the header */
  hasMinimalData: boolean;
  /** Source sheet name for this row */
  sourceSheet?: string;
}

/** Per-sheet extraction result — each sheet is fully independent */
export interface SheetTableData {
  /** Sheet name */
  sheetName: string;
  /** Detected header labels (from the best header row in this sheet) */
  headerLabels: string[];
  /** Index of the header row in this sheet */
  headerRowIndex: number;
  /** All data rows (after header) in this sheet */
  rows: RawTableRow[];
  /** Total column count for this sheet */
  columnCount: number;
  /** Images ONLY belonging to this sheet */
  images: ExcelImage[];
}

export interface RawTableExtraction {
  /** Detected header labels (from the best header row) — FIRST sheet for backward compatibility */
  headerLabels: string[];
  /** Index of the header row */
  headerRowIndex: number;
  /** All data rows (after header) — merged from ALL sheets for backward compat */
  rows: RawTableRow[];
  /** Total column count */
  columnCount: number;
  /** Sheet names in the workbook */
  sheetNames: string[];
  /** All extracted images (for reference) */
  images: ExcelImage[];
  /** Factory code used */
  factoryCode: string;
  /** Per-sheet independent data — THE PRIMARY DATA SOURCE for multi-tab UI */
  sheets: SheetTableData[];
}

/**
 * Extract raw table data from an Excel file for the preview/mapping UI.
 * 
 * KEY FEATURES:
 * 1. **PER-SHEET ISOLATION** — Each sheet is processed independently with its OWN image map.
 *    Images from Sheet A are NEVER associated with rows in Sheet B.
 * 2. Smart Header Identification — scans first 10 rows per sheet for the header row
 * 3. Merged Cell Image Handling — images spanning multiple rows are inherited
 *    by ALL individual rows within the merge range, but ONLY within the same sheet.
 * 4. Returns per-sheet data in `sheets[]` array for multi-tab UI.
 */
export async function extractRawExcelTable(
  fileBuffer: ArrayBuffer,
  factoryName: string,
  factoryId?: string,
): Promise<RawTableExtraction> {
  const rule = getFactoryRule(factoryName, factoryId);
  console.log(`[RawTable] Using factory rule: ${rule.factoryCode}`);
  
  // Extract ALL images with sheet correlation
  const allExtractedImages = await extractImagesFromWorkbook(fileBuffer);
  console.log(`[RawTable] Extracted ${allExtractedImages.length} total images across all sheets`);

  // Read workbook to get actual sheet names
  const workbook = XLSX.read(fileBuffer, {
    type: 'array',
    cellStyles: true,
    cellDates: true,
    bookImages: false,
  });

  const sheetNames = workbook.SheetNames;
  console.log(`[RawTable] Workbook has ${sheetNames.length} sheets: [${sheetNames.join(', ')}]`);

  // ═══ BUILD SHEET-TO-DRAWING MAP ═══════════════════════════════════════════
  // The image extractor uses "sheet0", "sheet1" etc. as sheetName (derived from drawing number).
  // We map these to actual sheet names using their index order.
  // drawing1.xml → sheet index 0 → sheetNames[0], drawing2.xml → sheetNames[1], etc.
  const normalizedImages: ExcelImage[] = allExtractedImages.map(img => {
    const sheetRef = img.sheetName; // e.g., "sheet0", "sheet1"
    const sheetMatch = sheetRef.match(/^sheet(\d+)$/);
    let actualSheetName = sheetRef;
    if (sheetMatch) {
      const idx = parseInt(sheetMatch[1]);
      if (idx < sheetNames.length) {
        actualSheetName = sheetNames[idx];
      }
    }
    return { ...img, sheetName: actualSheetName };
  });

  // ═══ GROUP IMAGES BY SHEET NAME ═══════════════════════════════════════════
  const imagesBySheet = new Map<string, ExcelImage[]>();
  for (const sn of sheetNames) {
    imagesBySheet.set(sn, []);
  }
  for (const img of normalizedImages) {
    const arr = imagesBySheet.get(img.sheetName);
    if (arr) {
      arr.push(img);
    } else {
      // ═══ STRICT SHEET ISOLATION ═══════════════════════════════════════
      // Unknown/unresolved sheet images are DISCARDED — NOT dumped into another sheet.
      // This prevents cross-sheet image bleeding when drawing→sheet mapping fails.
      // Only assign to first sheet if workbook has EXACTLY ONE sheet (no ambiguity).
      // ══════════════════════════════════════════════════════════════════
      if (sheetNames.length === 1) {
        const fallback = imagesBySheet.get(sheetNames[0]);
        if (fallback) fallback.push(img);
      } else {
        console.warn(`[RawTable] ⚠️ Image discarded — unresolved sheet "${img.sheetName}" (not in: [${sheetNames.join(', ')}]). Row=${img.fromRow}, Col=${img.fromCol}`);
      }
    }
  }

  // ═══ SHEET IMAGE ISOLATION VERIFICATION ═════════════════════════════════════
  for (const [sn, imgs] of imagesBySheet.entries()) {
    console.log(`[RawTable] 🔒 Sheet "${sn}" isolated images: ${imgs.length} (rows: ${imgs.filter(i => i.fromRow !== undefined).map(i => i.fromRow).join(', ') || 'none'})`);
  }

  // ═══ PROCESS EACH SHEET INDEPENDENTLY ═════════════════════════════════════
  const sheets: SheetTableData[] = [];
  const allRows: RawTableRow[] = [];

  for (let sheetIdx = 0; sheetIdx < sheetNames.length; sheetIdx++) {
    const sheetName = sheetNames[sheetIdx];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: true,
    });

    // ── 0. Merged Cell Propagation ────────────────────────────────────────────
    // When `propagateMergedCells` is enabled on the factory rule, fill in empty cells
    // that are part of a merged range with the value from the first (top-left) cell.
    // XLSX.utils.sheet_to_json only places the value in the first row of a merge,
    // leaving subsequent rows empty. This step ensures all rows within a merge range
    // inherit the shared value (e.g. collection name, delivery term, series name).
    if (rule.propagateMergedCells && sheet['!merges']) {
      const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = sheet['!merges'];
      let propagatedCount = 0;
      for (const merge of merges) {
        const startRow = merge.s.r; // 0-based start row
        const endRow = merge.e.r;   // 0-based end row
        const startCol = merge.s.c; // 0-based start column
        const endCol = merge.e.c;   // 0-based end column (for multi-column merges)

        // Get the value from the top-left cell of the merge range
        const sourceRow = jsonData[startRow];
        if (!sourceRow) continue;
        const sourceValue = sourceRow[startCol];
        
        // Skip if the source value is empty/undefined
        if (sourceValue === '' || sourceValue === null || sourceValue === undefined) continue;

        // Propagate to all rows within the merge range
        for (let r = startRow; r <= endRow; r++) {
          if (!jsonData[r]) jsonData[r] = [];
          for (let c = startCol; c <= endCol; c++) {
            const currentVal = jsonData[r][c];
            // Only fill if the cell is empty (don't overwrite existing values)
            if (r === startRow && c === startCol) continue; // Skip the source cell itself
            if (currentVal === '' || currentVal === null || currentVal === undefined) {
              jsonData[r][c] = sourceValue;
              propagatedCount++;
            }
          }
        }
      }
      if (propagatedCount > 0) {
        console.log(`[RawTable] Sheet "${sheetName}" merged cell propagation: ${propagatedCount} cells filled from ${merges.length} merge ranges`);
      }
    }

    if (jsonData.length < 2) {
      console.log(`[RawTable] Sheet "${sheetName}" has < 2 rows, skipping`);
      continue;
    }

    // ── 1. Smart Header Identification (per sheet) ────────────────────────────
    const maxScan = Math.min(10, jsonData.length);
    let bestRowIdx = 0;
    let bestScore = 0;

    for (let i = 0; i < maxScan; i++) {
      const row = jsonData[i];
      if (!row) continue;
      const nonEmpty = row.filter((c: any) => c !== null && c !== undefined && String(c).trim() !== '');
      let textScore = 0;
      for (const cell of nonEmpty) {
        const str = String(cell).trim();
        if (/[a-zA-Z\u4e00-\u9fff]/.test(str) && str.length < 20) {
          textScore += 2;
        } else {
          textScore += 1;
        }
      }
      if (textScore > bestScore) {
        bestScore = textScore;
        bestRowIdx = i;
      }
    }

    // Honor factory rule's forceHeaderRowIndex (e.g. CYJ has header at row 4 but
    // smart detection may pick row 0 because the title row "佛山市优健家具報價單"
    // has more text). Without this override, downstream logic uses the wrong
    // header labels and misclassifies columns.
    const sheetHeaderRowIndex = rule.forceHeaderRowIndex !== undefined ? rule.forceHeaderRowIndex : bestRowIdx;
    const sheetHeaderLabels = (jsonData[sheetHeaderRowIndex] || []).map((h: any) => String(h ?? '').trim());
    const sheetColumnCount = Math.max(...jsonData.slice(0, 20).map(r => (r || []).length), sheetHeaderLabels.length);

    console.log(`[RawTable] Sheet "${sheetName}" header at row ${sheetHeaderRowIndex}: [${sheetHeaderLabels.slice(0, 8).join(' | ')}]`);

    // ── 2. Build image-to-row map ONLY from THIS sheet's images ──────────────
    const sheetImages = imagesBySheet.get(sheetName) || [];
    console.log(`[RawTable] Sheet "${sheetName}" has ${sheetImages.length} images`);

    // ── 2a. SMART Image Column Detection from Headers ────────────────────────
    // Scan header labels to determine which column index is "product image" and which is "lifestyle".
    // This replaces the old hardcoded `fromCol < 2` logic that only worked for PJS format.
    const productImageRegex = /产品图片|產品圖片|product\s*image|photo|白底|单图|單圖|产品图|產品圖/i;
    const lifestyleImageRegex = /效果图|效果圖|lifestyle|scene\s*image|场景图|場景圖/i;
    
    let detectedProductImageCol: number | null = null;
    let detectedLifestyleImageCol: number | null = null;
    
    // Also check factory rule overrides
    if (rule.forceImageCol !== undefined) {
      detectedProductImageCol = rule.forceImageCol;
    }
    if (rule.forceLifestyleImageCol !== undefined) {
      detectedLifestyleImageCol = rule.forceLifestyleImageCol;
    }
    
    // Header-based detection (only if not already forced by factory rule)
    if (detectedProductImageCol === null || detectedLifestyleImageCol === null) {
      for (let hi = 0; hi < sheetHeaderLabels.length; hi++) {
        const label = sheetHeaderLabels[hi];
        if (!label) continue;
        if (detectedProductImageCol === null && productImageRegex.test(label)) {
          detectedProductImageCol = hi;
        } else if (detectedLifestyleImageCol === null && lifestyleImageRegex.test(label)) {
          detectedLifestyleImageCol = hi;
        }
      }
    }
    
    console.log(`[RawTable] Sheet "${sheetName}" image column detection: productCol=${detectedProductImageCol}, lifestyleCol=${detectedLifestyleImageCol}`);

    const sheetProductImages: ExcelImage[] = [];
    const sheetLifestyleImages: ExcelImage[] = [];
    for (const img of sheetImages) {
      if (img.fromCol === undefined) {
        // No column info — treat as product image (safer default)
        sheetProductImages.push(img);
        continue;
      }
      
      // If we have detected column indices, use them for precise classification
      if (detectedProductImageCol !== null && detectedLifestyleImageCol !== null) {
        // Exact match: classify based on detected columns
        if (img.fromCol === detectedLifestyleImageCol) {
          sheetLifestyleImages.push(img);
        } else if (img.fromCol === detectedProductImageCol) {
          sheetProductImages.push(img);
        } else {
          // Image not in either detected column — use proximity:
          // closer to product col → product, closer to lifestyle col → lifestyle
          const distToProduct = Math.abs(img.fromCol - detectedProductImageCol);
          const distToLifestyle = Math.abs(img.fromCol - detectedLifestyleImageCol);
          if (distToLifestyle < distToProduct) {
            sheetLifestyleImages.push(img);
          } else {
            sheetProductImages.push(img);
          }
        }
      } else if (detectedProductImageCol !== null && detectedLifestyleImageCol === null) {
        // Only product col detected, NO lifestyle col in headers.
        // When there's only ONE image column, ALL images default to product images.
        // This handles factories like CYZ/優卓 where some sheets only have a "單圖" column.
        sheetProductImages.push(img);
      } else if (detectedLifestyleImageCol !== null && detectedProductImageCol === null) {
        // Only lifestyle col detected, no product col
        // All images that aren't in the lifestyle col are product images
        if (img.fromCol === detectedLifestyleImageCol) {
          sheetLifestyleImages.push(img);
        } else {
          sheetProductImages.push(img);
        }
      } else {
        // Fallback: no header detection — use legacy heuristic (fromCol < 2 → lifestyle)
        // This preserves backward compatibility for factories without clear image column headers
        if (img.fromCol < 2) {
          sheetLifestyleImages.push(img);
        } else {
          sheetProductImages.push(img);
        }
      }
    }
    
    console.log(`[RawTable] Sheet "${sheetName}" classified images: ${sheetProductImages.length} product, ${sheetLifestyleImages.length} lifestyle`);

    const rowToProductImage = new Map<number, string>();
    const rowToProductImage2 = new Map<number, string>();
    const rowToProductImage3 = new Map<number, string>();
    const rowToLifestyleImage = new Map<number, string>();

    // Sort product images by column position (leftmost first) so image2/image3 are assigned
    // in left-to-right column order when multiple images exist in the same row range.
    const sortedProductImages = [...sheetProductImages].sort((a, b) => {
      const colA = a.fromCol ?? 999;
      const colB = b.fromCol ?? 999;
      if (colA !== colB) return colA - colB;
      return (a.fromRow ?? 0) - (b.fromRow ?? 0);
    });

    for (const img of sortedProductImages) {
      if (img.fromRow === undefined) continue;
      const fromRow = img.fromRow;
      const toRow = img.toRow ?? fromRow;
      const dataUri = `data:${img.mimeType};base64,${img.base64}`;
      for (let r = fromRow; r <= toRow; r++) {
        if (!rowToProductImage.has(r)) {
          rowToProductImage.set(r, dataUri);
        } else if (!rowToProductImage2.has(r)) {
          rowToProductImage2.set(r, dataUri);
        } else if (!rowToProductImage3.has(r)) {
          rowToProductImage3.set(r, dataUri);
        }
      }
    }

    for (const img of sheetLifestyleImages) {
      if (img.fromRow === undefined) continue;
      const fromRow = img.fromRow;
      const toRow = img.toRow ?? fromRow;
      const dataUri = `data:${img.mimeType};base64,${img.base64}`;
      for (let r = fromRow; r <= toRow; r++) {
        if (!rowToLifestyleImage.has(r)) {
          rowToLifestyleImage.set(r, dataUri);
        }
      }
    }

    // ── 2c. MERGED CELL IMAGE FILL-DOWN ────────────────────────────────────
    // When images are in merged cells, the Excel drawing anchors may only reference
    // the first row of the merge. After splitting merged cells, the subsequent rows
    // need to inherit the image from the row above.
    // This is critical for CYZ/優卓 where a single product image spans multiple
    // variant rows (e.g. different colors/sizes of the same product share one photo).
    if (rule.propagateMergedCells && sheet['!merges']) {
      const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = sheet['!merges'];
      
      for (const merge of merges) {
        const startRow = merge.s.r;
        const endRow = merge.e.r;
        if (startRow >= endRow) continue; // Skip single-row "merges"
        
        // Product image fill-down within merge range:
        // If the first row of this merge has a product image, propagate to all rows below
        const prodImg = rowToProductImage.get(startRow);
        if (prodImg) {
          for (let r = startRow + 1; r <= endRow; r++) {
            if (!rowToProductImage.has(r)) {
              rowToProductImage.set(r, prodImg);
            }
          }
        }

        // Product image2 fill-down within merge range
        const prodImg2 = rowToProductImage2.get(startRow);
        if (prodImg2) {
          for (let r = startRow + 1; r <= endRow; r++) {
            if (!rowToProductImage2.has(r)) {
              rowToProductImage2.set(r, prodImg2);
            }
          }
        }

        // Product image3 fill-down within merge range
        const prodImg3 = rowToProductImage3.get(startRow);
        if (prodImg3) {
          for (let r = startRow + 1; r <= endRow; r++) {
            if (!rowToProductImage3.has(r)) {
              rowToProductImage3.set(r, prodImg3);
            }
          }
        }

        // Lifestyle image fill-down within merge range
        const lifeImg = rowToLifestyleImage.get(startRow);
        if (lifeImg) {
          for (let r = startRow + 1; r <= endRow; r++) {
            if (!rowToLifestyleImage.has(r)) {
              rowToLifestyleImage.set(r, lifeImg);
            }
          }
        }
      }
    }

    console.log(`[RawTable] Sheet "${sheetName}" image inheritance (after fill-down): ${rowToProductImage.size} product rows, ${rowToLifestyleImage.size} lifestyle rows`);

    // ── 3. Extract data rows (after header) ─────────────────────────────────
    const dataStartIdx = sheetHeaderRowIndex + 1 + (rule.firstDataRowOffset ?? 0);
    const sheetRows: RawTableRow[] = [];

    for (let rowIdx = dataStartIdx; rowIdx < jsonData.length; rowIdx++) {
      const row = jsonData[rowIdx];
      if (!row) continue;

      const cells: (string | number | null)[] = [];
      for (let c = 0; c < sheetColumnCount; c++) {
        const val = row[c];
        if (val === '' || val === null || val === undefined) {
          cells.push(null);
        } else if (typeof val === 'number') {
          cells.push(val);
        } else {
          cells.push(String(val).trim());
        }
      }

      const nonEmptyCells = cells.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
      if (nonEmptyCells.length === 0) continue;

      let hasImage = rowToProductImage.has(rowIdx);
      let hasModelLikeData = false;
      let hasDimensionLikeData = false;
      let hasPriceLikeData = false;

      for (const cell of nonEmptyCells) {
        const str = String(cell);
        if (/\d+\s*[*×xX]\s*\d+/.test(str)) hasDimensionLikeData = true;
        if (/^\$?¥?￥?\s*\d+(\.\d+)?$/.test(str.replace(/,/g, ''))) hasPriceLikeData = true;
        if (/^[A-Za-z0-9][-A-Za-z0-9]{1,15}$/.test(str)) hasModelLikeData = true;
      }

      let passesFilter = true;
      if (rule.rowFilter) {
        passesFilter = rule.rowFilter(row, rowIdx);
      }

      const isProductRow = passesFilter && (
        (hasImage && nonEmptyCells.length >= 2) ||
        (hasModelLikeData && (hasDimensionLikeData || hasPriceLikeData)) ||
        (nonEmptyCells.length >= 3 && (hasDimensionLikeData || hasPriceLikeData))
      );

      const hasMinimalData = nonEmptyCells.length >= 2;

      const rowData: RawTableRow = {
        rowIndex: rowIdx,
        cells,
        productImageData: rowToProductImage.get(rowIdx) || null,
        productImageData2: rowToProductImage2.get(rowIdx) || null,
        productImageData3: rowToProductImage3.get(rowIdx) || null,
        lifestyleImageData: rowToLifestyleImage.get(rowIdx) || null,
        isProductRow,
        hasMinimalData,
        sourceSheet: sheetName,
      };

      sheetRows.push(rowData);
      allRows.push(rowData);
    }

    console.log(`[RawTable] Sheet "${sheetName}": ${sheetRows.length} data rows, ${sheetRows.filter(r => r.isProductRow).length} product rows`);

    sheets.push({
      sheetName,
      headerLabels: sheetHeaderLabels,
      headerRowIndex: sheetHeaderRowIndex,
      rows: sheetRows,
      columnCount: sheetColumnCount,
      images: sheetImages,
    });
  }

  // Backward compatibility: use first sheet's data as the top-level fields
  const firstSheet = sheets[0];
  const topHeaderLabels = firstSheet?.headerLabels || [];
  const topHeaderRowIndex = firstSheet?.headerRowIndex || 0;
  const topColumnCount = firstSheet?.columnCount || 0;

  console.log(`[RawTable] Total: ${allRows.length} rows across ${sheets.length} sheets`);

  return {
    headerLabels: topHeaderLabels,
    headerRowIndex: topHeaderRowIndex,
    rows: allRows,
    columnCount: topColumnCount,
    sheetNames,
    images: normalizedImages,
    factoryCode: rule.factoryCode,
    sheets,
  };
}



/**
 * Extract images from Excel using the sheet's drawing relationships.
 * Uses XLSX internal structures to find image positions relative to cells.
 * Also reads xl/drawings/*.xml to correlate each image with its row anchor.
 */
export async function extractImagesFromWorkbook(fileBuffer: ArrayBuffer): Promise<ExcelImage[]> {
  const images: ExcelImage[] = [];
  
  try {
    // ── Strategy 1: Use JSZip to directly unpack the xlsx ZIP ──────────────
    // xlsx files are ZIP archives. We read xl/media/* and xl/drawings/* directly.
    // @ts-ignore – dynamically imported to avoid SSR issues
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(fileBuffer);
    
    // Collect all media files: xl/media/image1.png, image1.jpeg, etc.
    const mediaEntries: { name: string; data: Uint8Array }[] = [];
    for (const [path, file] of Object.entries(zip.files)) {
      if (path.startsWith('xl/media/') && !file.dir) {
        const data = await (file as any).async('uint8array');
        mediaEntries.push({ name: path, data });
      }
    }
    
    console.log(`[ExcelParser] JSZip: found ${mediaEntries.length} media files in xlsx`);
    
    if (mediaEntries.length === 0) {
      // ── Fallback: use XLSX.read with bookImages ─────────────────────────
      return extractImagesViaXLSX(fileBuffer);
    }
    
    // Parse xl/drawings/ relationships to correlate image → row anchor
    // Each sheet has a drawing ref like xl/drawings/drawing1.xml
    // The anchor tells us <xdr:from><xdr:row>N</xdr:row> (0-based row index)
    const drawingAnchors: Map<string, { fromRow: number; toRow: number; fromCol: number; toCol: number; fromRowOff: number; toRowOff: number }> = new Map();
    
    for (const [path, file] of Object.entries(zip.files)) {
      if (path.startsWith('xl/drawings/') && path.endsWith('.xml') && !file.dir) {
        const xmlText = await (file as any).async('text');
        
        // Extract all twoCellAnchor blocks
        const anchorRegex = /<xdr:twoCellAnchor[^>]*>([\s\S]*?)<\/xdr:twoCellAnchor>/g;
        let anchorMatch;
        let anchorIdx = 0;
        while ((anchorMatch = anchorRegex.exec(xmlText)) !== null) {
          const block = anchorMatch[1];
          
          // Isolate <xdr:from> and <xdr:to> sub-blocks FIRST to avoid cross-contamination
          const fromBlockMatch = /<xdr:from>([\s\S]*?)<\/xdr:from>/m.exec(block);
          const toBlockMatch = /<xdr:to>([\s\S]*?)<\/xdr:to>/m.exec(block);
          const fromBlock = fromBlockMatch ? fromBlockMatch[1] : '';
          const toBlock = toBlockMatch ? toBlockMatch[1] : '';

          // Extract values from the isolated sub-blocks only
          const fromRowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(fromBlock);
          const fromColMatch = /<xdr:col>(\d+)<\/xdr:col>/.exec(fromBlock);
          const fromRowOffMatch = /<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(fromBlock);
          const toRowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(toBlock);
          const toColMatch = /<xdr:col>(\d+)<\/xdr:col>/.exec(toBlock);
          const toRowOffMatch = /<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(toBlock);
          
          // Extract image relationship ID (r:embed)
          const embedMatch = /r:embed="([^"]+)"/.exec(block);
          if (embedMatch) {
            drawingAnchors.set(`${path}:${anchorIdx}`, {
              fromRow: fromRowMatch ? parseInt(fromRowMatch[1]) : 0,
              toRow: toRowMatch ? parseInt(toRowMatch[1]) : 0,
              fromCol: fromColMatch ? parseInt(fromColMatch[1]) : 0,
              toCol: toColMatch ? parseInt(toColMatch[1]) : 0,
              fromRowOff: fromRowOffMatch ? parseInt(fromRowOffMatch[1]) : 0,
              toRowOff: toRowOffMatch ? parseInt(toRowOffMatch[1]) : 0,
            });
          }
          anchorIdx++;
        }
        
        // ═══ ALSO PARSE oneCellAnchor BLOCKS ═══════════════════════════════════
        // Many Chinese Excel editors (WPS, OfficePlus) embed images using oneCellAnchor
        // instead of twoCellAnchor. These only have a <xdr:from> element (no <xdr:to>).
        // Without this, images from such files have NO position data and can't be matched to rows.
        const oneCellAnchorRegex = /<xdr:oneCellAnchor[^>]*>([\s\S]*?)<\/xdr:oneCellAnchor>/g;
        let oneCellMatch;
        while ((oneCellMatch = oneCellAnchorRegex.exec(xmlText)) !== null) {
          const block = oneCellMatch[1];
          const fromBlockMatch = /<xdr:from>([\s\S]*?)<\/xdr:from>/m.exec(block);
          const fromBlock = fromBlockMatch ? fromBlockMatch[1] : '';
          const fromRowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(fromBlock);
          const fromColMatch = /<xdr:col>(\d+)<\/xdr:col>/.exec(fromBlock);
          const fromRowOffMatch = /<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(fromBlock);
          const embedMatch = /r:embed="([^"]+)"/.exec(block);
          if (embedMatch) {
            const fromRow = fromRowMatch ? parseInt(fromRowMatch[1]) : 0;
            drawingAnchors.set(`${path}:${anchorIdx}`, {
              fromRow,
              toRow: fromRow, // oneCellAnchor has no <to>, assume same row
              fromCol: fromColMatch ? parseInt(fromColMatch[1]) : 0,
              toCol: (fromColMatch ? parseInt(fromColMatch[1]) : 0) + 1, // assume spans 1 column
              fromRowOff: fromRowOffMatch ? parseInt(fromRowOffMatch[1]) : 0,
              toRowOff: 0,
            });
          }
          anchorIdx++;
        }
        
        console.log(`[ExcelParser] JSZip: parsed ${anchorIdx} anchors from ${path} (incl. oneCellAnchors)`);
      }
    }
    
    // Build relationships: drawing rId → media file name
    // xl/drawings/_rels/drawing1.xml.rels contains:
    //   <Relationship Id="rId1" Target="../media/image1.png" .../>
    // 
    // ═══ CRITICAL FIX: PER-DRAWING rId ISOLATION ═══════════════════════════════
    // Each drawing has its OWN rId namespace. rId1 in drawing1.xml.rels can point
    // to a DIFFERENT media file than rId1 in drawing2.xml.rels!
    // We MUST keep these maps separate to prevent cross-sheet image bleeding.
    // ═══════════════════════════════════════════════════════════════════════════
    const rIdToMediaPerDrawing: Map<string, Map<string, string>> = new Map();
    for (const [path, file] of Object.entries(zip.files)) {
      if (path.includes('drawings/_rels/') && path.endsWith('.rels') && !file.dir) {
        const xmlText = await (file as any).async('text');
        const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"[^>]*\/?>/g;
        let relMatch;
        // Derive the drawing XML path from the rels path
        // e.g., "xl/drawings/_rels/drawing1.xml.rels" → "xl/drawings/drawing1.xml"
        const drawingXmlPath = path.replace('/_rels/', '/').replace('.rels', '');
        const drawingRels = new Map<string, string>();
        while ((relMatch = relRegex.exec(xmlText)) !== null) {
          const rId = relMatch[1];
          const target = relMatch[2]; // e.g., "../media/image1.png"
          // Normalize to full path
          const mediaName = target.replace('../', 'xl/');
          drawingRels.set(rId, mediaName);
        }
        rIdToMediaPerDrawing.set(drawingXmlPath, drawingRels);
        console.log(`[ExcelParser] Drawing rels "${drawingXmlPath}": ${drawingRels.size} image references`);
      }
    }
    
    // ═══ BUILD DRAWING-PATH → SHEET-INDEX MAP ════════════════════════════════
    // Parse xl/worksheets/_rels/sheetN.xml.rels to find which drawing each sheet uses.
    // This ensures images from drawing2.xml are correctly mapped to their owning sheet.
    const drawingToSheetIdx = new Map<string, number>();
    for (const [path, file] of Object.entries(zip.files)) {
      // e.g., "xl/worksheets/_rels/sheet1.xml.rels"
      if (path.includes('worksheets/_rels/') && path.endsWith('.rels') && !file.dir) {
        const relsXml = await (file as any).async('text');
        // Extract sheet number from path (sheet1.xml.rels → index 0)
        const sheetNumMatch = path.match(/sheet(\d+)\.xml\.rels/);
        if (!sheetNumMatch) continue;
        const sheetIdx = parseInt(sheetNumMatch[1]) - 1; // sheet1 → index 0
        
        // Find drawing relationship in this sheet's rels
        const drawingRelMatch = /Target="[^"]*drawings\/(drawing\d+)\.xml"/.exec(relsXml);
        if (drawingRelMatch) {
          const drawingFile = `xl/drawings/${drawingRelMatch[1]}.xml`;
          drawingToSheetIdx.set(drawingFile, sheetIdx);
          console.log(`[ExcelParser] Sheet index ${sheetIdx} → ${drawingFile}`);
        }
      }
    }
    
    // Re-parse drawings to get rId per anchor with correct indexing
    // Build the final images array with row correlation
    const drawingPathList: string[] = [];
    for (const path of Object.keys(zip.files)) {
      if (path.startsWith('xl/drawings/') && path.endsWith('.xml') && !path.includes('_rels')) {
        drawingPathList.push(path);
      }
    }
    
    let globalImageIdx = 0;
    for (const drawingPath of drawingPathList) {
      const file = zip.files[drawingPath];
      if (!file) continue;
      const xmlText = await file.async('text');
      
      const anchorRegex = /<xdr:twoCellAnchor[^>]*>([\s\S]*?)<\/xdr:twoCellAnchor>/g;
      let anchorMatch;
      while ((anchorMatch = anchorRegex.exec(xmlText)) !== null) {
        const block = anchorMatch[1];

        // Isolate <xdr:from> and <xdr:to> sub-blocks to prevent cross-contamination
        const fromBlockMatch = /<xdr:from>([\s\S]*?)<\/xdr:from>/m.exec(block);
        const toBlockMatch = /<xdr:to>([\s\S]*?)<\/xdr:to>/m.exec(block);
        const fromBlock = fromBlockMatch ? fromBlockMatch[1] : '';
        const toBlock = toBlockMatch ? toBlockMatch[1] : '';

        const fromRowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(fromBlock);
        const fromColMatch = /<xdr:col>(\d+)<\/xdr:col>/.exec(fromBlock);
        const fromRowOffMatch = /<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(fromBlock);
        const toRowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(toBlock);
        const toColMatch = /<xdr:col>(\d+)<\/xdr:col>/.exec(toBlock);
        const toRowOffMatch = /<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(toBlock);
        const embedMatch = /r:embed="([^"]+)"/.exec(block);
        
        if (embedMatch) {
          const rId = embedMatch[1];
          // ═══ PER-DRAWING rId RESOLUTION (Sheet Isolation) ═════════════════
          // ALWAYS resolve rId from THIS drawing's own rels map FIRST.
          // This prevents cross-sheet image bleeding where rId1 in drawing1
          // could incorrectly resolve to drawing2's media file.
          // ══════════════════════════════════════════════════════════════════
          let mediaPath: string | undefined;
          
          // Strategy 1: Use the pre-built per-drawing rels map (preferred)
          const thisDrawingRels = rIdToMediaPerDrawing.get(drawingPath);
          if (thisDrawingRels) {
            mediaPath = thisDrawingRels.get(rId);
          }
          
          // Strategy 2: If not found in pre-built map, parse rels file on-the-fly
          if (!mediaPath) {
            const relsPath = drawingPath.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
            const relsFile = zip.files[relsPath];
            if (relsFile) {
              const relsXml = await relsFile.async('text');
              const thisRelMatch = new RegExp(`Id="${rId}"[^>]+Target="([^"]+)"`).exec(relsXml);
              if (thisRelMatch) {
                mediaPath = thisRelMatch[1].replace('../', 'xl/');
              }
            }
          }
          
          if (mediaPath) {
            const mediaEntry = mediaEntries.find(m => m.name === mediaPath);
            if (mediaEntry) {
              const extension = detectImageType(mediaEntry.data);
              const base64 = uint8ToBase64(mediaEntry.data);
              
              // sheetName derived from drawing path → sheet index mapping
              // Use the worksheet rels mapping (accurate) or fall back to drawing number (heuristic)
              let drawingSheetIdx: number;
              if (drawingToSheetIdx.has(drawingPath)) {
                drawingSheetIdx = drawingToSheetIdx.get(drawingPath)!;
              } else {
                drawingSheetIdx = parseInt(drawingPath.match(/drawing(\d+)/)?.[1] || '1') - 1;
              }
              
              const fromCol = fromColMatch ? parseInt(fromColMatch[1]) : undefined;
              const toCol = toColMatch ? parseInt(toColMatch[1]) : undefined;
              const fromColOffVal = /<xdr:colOff>(\d+)<\/xdr:colOff>/.exec(fromBlock)?.[1];
              const toColOffVal = /<xdr:colOff>(\d+)<\/xdr:colOff>/.exec(toBlock)?.[1];
              
              // Compute column span for aspect-ratio filtering
              const colSpan = (fromCol !== undefined && toCol !== undefined) ? (toCol - fromCol) : undefined;
              
              // ═══════════════════════════════════════════════════════════════════════
              // STRICT PHYSICAL GRID FILTERING — HARD-CODED COLUMN BOUNDARIES
              // ═══════════════════════════════════════════════════════════════════════
              // Column B (Index 1) = STRICTLY lifestyle/效果圖. NEVER a product image.
              // Column C (Index 2) = STRICTLY product/產品圖片. ALWAYS the product image.
              // Column A (Index 0) = product image for some factories (e.g. 京图/Jingtu).
              // No exceptions. No heuristics. No fallback overrides.
              // ═══════════════════════════════════════════════════════════════════════
              let imageRole: 'product' | 'lifestyle' | 'unknown' = 'unknown';
              if (fromCol === 0) {
                imageRole = 'product';   // Column A = product image (e.g. 京图 factory format)
              } else if (fromCol === 1) {
                imageRole = 'lifestyle'; // Column B = ALWAYS lifestyle
              } else if (fromCol === 2) {
                imageRole = 'product';   // Column C = ALWAYS product
              } else if (fromCol !== undefined && fromCol >= 3) {
                imageRole = 'product';   // Column D+ = also product (e.g. some factories use col 3)
              }
              // If fromCol is undefined, leave as 'unknown' — will be handled conservatively
              
              const fromRowVal = fromRowMatch ? parseInt(fromRowMatch[1]) : undefined;
              const toRowVal = toRowMatch ? parseInt(toRowMatch[1]) : undefined;
              const fromRowOffVal = fromRowOffMatch ? parseInt(fromRowOffMatch[1]) : 0;
              const toRowOffVal = toRowOffMatch ? parseInt(toRowOffMatch[1]) : 0;

              images.push({
                sheetName: `sheet${drawingSheetIdx}`,
                imageIndex: globalImageIdx,
                base64,
                mimeType: `image/${extension}`,
                fromRow: fromRowVal,
                toRow: toRowVal,
                fromCol,
                toCol,
                fromRowOff: fromRowOffVal,
                toRowOff: toRowOffVal,
                fromColOff: fromColOffVal ? parseInt(fromColOffVal) : 0,
                toColOff: toColOffVal ? parseInt(toColOffVal) : 0,
                colSpan,
                imageRole,
              });
              console.log(`[ExcelParser] Image[${globalImageIdx}] 🔒sheet${drawingSheetIdx} (from: ${drawingPath}) col=${fromCol}→${toCol} colSpan=${colSpan ?? '?'} role=${imageRole} row=${fromRowVal ?? '?'}(+${fromRowOffVal}EMU)-${toRowVal ?? '?'}(+${toRowOffVal}EMU)`);
              globalImageIdx++;
              continue;
            }
          }
        }
        
        // Fallback: add image by sequential order without anchor info
        if (globalImageIdx < mediaEntries.length) {
          const mediaEntry = mediaEntries[globalImageIdx];
          const extension = detectImageType(mediaEntry.data);
          const base64 = uint8ToBase64(mediaEntry.data);
          images.push({
            sheetName: 'unknown',
            imageIndex: globalImageIdx,
            base64,
            mimeType: `image/${extension}`,
          });
          globalImageIdx++;
        }
      }
      
      // ═══ PARSE oneCellAnchor BLOCKS (WPS Office / OfficePlus / some Chinese Excel editors) ═══
      // oneCellAnchor only has a <xdr:from> element — no <xdr:to>.
      // These are commonly used by WPS Office and OfficePlus for embedded product images.
      const oneCellAnchorRegex2 = /<xdr:oneCellAnchor[^>]*>([\s\S]*?)<\/xdr:oneCellAnchor>/g;
      let oneCellMatch2;
      while ((oneCellMatch2 = oneCellAnchorRegex2.exec(xmlText)) !== null) {
        const block = oneCellMatch2[1];
        const fromBlockMatch = /<xdr:from>([\s\S]*?)<\/xdr:from>/m.exec(block);
        const fromBlock = fromBlockMatch ? fromBlockMatch[1] : '';
        
        const fromRowMatch = /<xdr:row>(\d+)<\/xdr:row>/.exec(fromBlock);
        const fromColMatch = /<xdr:col>(\d+)<\/xdr:col>/.exec(fromBlock);
        const fromRowOffMatch = /<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(fromBlock);
        const fromColOffVal = /<xdr:colOff>(\d+)<\/xdr:colOff>/.exec(fromBlock)?.[1];
        const embedMatch = /r:embed="([^"]+)"/.exec(block);
        
        if (embedMatch) {
          const rId = embedMatch[1];
          let mediaPath: string | undefined;
          
          const thisDrawingRels = rIdToMediaPerDrawing.get(drawingPath);
          if (thisDrawingRels) {
            mediaPath = thisDrawingRels.get(rId);
          }
          
          if (!mediaPath) {
            const relsPath = drawingPath.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
            const relsFile = zip.files[relsPath];
            if (relsFile) {
              const relsXml = await relsFile.async('text');
              const thisRelMatch = new RegExp(`Id="${rId}"[^>]+Target="([^"]+)"`).exec(relsXml);
              if (thisRelMatch) {
                mediaPath = thisRelMatch[1].replace('../', 'xl/');
              }
            }
          }
          
          if (mediaPath) {
            const mediaEntry = mediaEntries.find(m => m.name === mediaPath);
            if (mediaEntry) {
              const extension = detectImageType(mediaEntry.data);
              const base64 = uint8ToBase64(mediaEntry.data);
              
              let drawingSheetIdx: number;
              if (drawingToSheetIdx.has(drawingPath)) {
                drawingSheetIdx = drawingToSheetIdx.get(drawingPath)!;
              } else {
                drawingSheetIdx = parseInt(drawingPath.match(/drawing(\d+)/)?.[1] || '1') - 1;
              }
              
              const fromCol = fromColMatch ? parseInt(fromColMatch[1]) : undefined;
              const fromRowVal = fromRowMatch ? parseInt(fromRowMatch[1]) : undefined;
              const fromRowOffVal = fromRowOffMatch ? parseInt(fromRowOffMatch[1]) : 0;
              
              // For oneCellAnchor, estimate toRow from extent if available, else assume same row
              // Try to extract <xdr:ext cx="..." cy="..."/> for size estimation
              const extCyMatch = /<(?:xdr:)?ext[^>]+cy="(\d+)"/.exec(block);
              // Average row height in EMU is ~200000 (about 15pt). Use this to estimate row span.
              const estimatedRowSpan = extCyMatch ? Math.max(0, Math.floor(parseInt(extCyMatch[1]) / 200000) - 1) : 0;
              const toRowVal = fromRowVal !== undefined ? fromRowVal + estimatedRowSpan : undefined;
              const toCol = fromCol !== undefined ? fromCol + 1 : undefined;
              
              // Compute column span
              const colSpan = 1; // oneCellAnchor typically spans ~1 column for product images
              
              // Image role assignment — same logic as twoCellAnchor
              let imageRole: 'product' | 'lifestyle' | 'unknown' = 'unknown';
              if (fromCol === 1) {
                imageRole = 'lifestyle';
              } else if (fromCol === 2) {
                imageRole = 'product';
              } else if (fromCol !== undefined && fromCol >= 3) {
                imageRole = 'product';
              } else if (fromCol === 0) {
                // Column A — for factories like 京图 where product image is in Col A
                imageRole = 'product';
              }
              
              images.push({
                sheetName: `sheet${drawingSheetIdx}`,
                imageIndex: globalImageIdx,
                base64,
                mimeType: `image/${extension}`,
                fromRow: fromRowVal,
                toRow: toRowVal,
                fromCol,
                toCol,
                fromRowOff: fromRowOffVal,
                toRowOff: 0,
                fromColOff: fromColOffVal ? parseInt(fromColOffVal) : 0,
                toColOff: 0,
                colSpan,
                imageRole,
              });
              console.log(`[ExcelParser] Image[${globalImageIdx}] 🔒sheet${drawingSheetIdx} (oneCellAnchor from: ${drawingPath}) col=${fromCol}→${toCol} colSpan=${colSpan} role=${imageRole} row=${fromRowVal ?? '?'}(+${fromRowOffVal}EMU)-${toRowVal ?? '?'}`);
              globalImageIdx++;
              continue;
            }
          }
        }
        
        // Fallback for oneCellAnchor without resolved media
        if (globalImageIdx < mediaEntries.length) {
          const mediaEntry = mediaEntries[globalImageIdx];
          const extension = detectImageType(mediaEntry.data);
          const base64 = uint8ToBase64(mediaEntry.data);
          images.push({
            sheetName: 'unknown',
            imageIndex: globalImageIdx,
            base64,
            mimeType: `image/${extension}`,
          });
          globalImageIdx++;
        }
      }
    }
    
    // If no anchors found but media exists, add all media files without position info
    if (images.length === 0 && mediaEntries.length > 0) {
      console.log(`[ExcelParser] No anchor XML found, adding ${mediaEntries.length} images without position info`);
      for (let i = 0; i < mediaEntries.length; i++) {
        const entry = mediaEntries[i];
        const extension = detectImageType(entry.data);
        const base64 = uint8ToBase64(entry.data);
        images.push({
          sheetName: 'media',
          imageIndex: i,
          base64,
          mimeType: `image/${extension}`,
        });
      }
    }
    
    console.log(`[ExcelParser] Extracted ${images.length} images via JSZip (with row anchors)`);
    
  } catch (err) {
    console.warn('[ExcelParser] JSZip extraction error, falling back to XLSX:', err);
    return extractImagesViaXLSX(fileBuffer);
  }
  
  return images;
}

/**
 * Fallback: extract images using SheetJS's bookImages option
 */
function extractImagesViaXLSX(fileBuffer: ArrayBuffer): ExcelImage[] {
  const images: ExcelImage[] = [];
  try {
    const workbook = XLSX.read(fileBuffer, {
      type: 'array',
      bookImages: true,
    });
    
    // @ts-ignore
    if (workbook.Workbook?.Media) {
      // @ts-ignore
      workbook.Workbook.Media.forEach((media: any, idx: number) => {
        if (media && media.data) {
          const uint8 = new Uint8Array(media.data);
          const base64 = uint8ToBase64(uint8);
          const extension = media.extension || detectImageType(uint8);
          images.push({
            sheetName: 'embedded',
            imageIndex: idx,
            base64,
            mimeType: `image/${extension}`,
          });
        }
      });
    }
    console.log(`[ExcelParser] XLSX fallback extracted ${images.length} images`);
  } catch (err) {
    console.warn('[ExcelParser] XLSX image extraction error:', err);
  }
  return images;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function detectImageType(bytes: Uint8Array): string {
  // Check magic bytes
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) return 'bmp';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'webp';
  return 'png'; // default
}
