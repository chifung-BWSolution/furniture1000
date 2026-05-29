/**
 * Standardized Color Mapping: Chinese Display ↔ English W3C Storage
 * 
 * Display: Chinese names shown in UI dropdowns
 * Storage: W3C English color names stored in database
 * 
 * Focused on common furniture colors with comprehensive coverage.
 */

export interface ColorMapping {
  /** Chinese display name */
  cn: string;
  /** English W3C color name (stored in DB) */
  en: string;
  /** Hex preview swatch */
  hex: string;
}

export const COLOR_MAP: ColorMapping[] = [
  // ── Neutrals & Basics ──
  { cn: '白色', en: 'White', hex: '#FFFFFF' },
  { cn: '象牙色', en: 'Ivory', hex: '#FFFFF0' },
  { cn: '米色', en: 'Beige', hex: '#F5F5DC' },
  { cn: '亞麻色', en: 'Linen', hex: '#FAF0E6' },
  { cn: '奶白色', en: 'AntiqueWhite', hex: '#FAEBD7' },
  { cn: '淺灰色', en: 'LightGray', hex: '#D3D3D3' },
  { cn: '灰色', en: 'Gray', hex: '#808080' },
  { cn: '暗灰色', en: 'DimGray', hex: '#696969' },
  { cn: '深灰色', en: 'DarkGray', hex: '#A9A9A9' },
  { cn: '銀色', en: 'Silver', hex: '#C0C0C0' },
  { cn: '煙灰色', en: 'Gainsboro', hex: '#DCDCDC' },
  { cn: '石板灰', en: 'SlateGray', hex: '#708090' },
  { cn: '黑色', en: 'Black', hex: '#000000' },

  // ── Browns & Wood Tones (Furniture-critical) ──
  { cn: '咖啡色', en: 'SaddleBrown', hex: '#8B4513' },
  { cn: '巧克力色', en: 'Chocolate', hex: '#D2691E' },
  { cn: '棕色', en: 'Brown', hex: '#A52A2A' },
  { cn: '深棕色', en: 'DarkBrown', hex: '#654321' },
  { cn: '胡桃木色', en: 'Sienna', hex: '#A0522D' },
  { cn: '黃褐色', en: 'Tan', hex: '#D2B48C' },
  { cn: '秘魯色', en: 'Peru', hex: '#CD853F' },
  { cn: '小麥色', en: 'Wheat', hex: '#F5DEB3' },
  { cn: '桃花心木色', en: 'Maroon', hex: '#800000' },
  { cn: '原木色', en: 'BurlyWood', hex: '#DEB887' },
  { cn: '橙棕色', en: 'SandyBrown', hex: '#F4A460' },
  { cn: '古銅色', en: 'RosyBrown', hex: '#BC8F8F' },
  { cn: '卡其色', en: 'Khaki', hex: '#F0E68C' },
  { cn: '深卡其色', en: 'DarkKhaki', hex: '#BDB76B' },

  // ── Reds & Pinks ──
  { cn: '紅色', en: 'Red', hex: '#FF0000' },
  { cn: '深紅色', en: 'DarkRed', hex: '#8B0000' },
  { cn: '火磚色', en: 'FireBrick', hex: '#B22222' },
  { cn: '暗紅色', en: 'Crimson', hex: '#DC143C' },
  { cn: '印度紅', en: 'IndianRed', hex: '#CD5C5C' },
  { cn: '粉紅色', en: 'Pink', hex: '#FFC0CB' },
  { cn: '淺粉色', en: 'LightPink', hex: '#FFB6C1' },
  { cn: '深粉色', en: 'DeepPink', hex: '#FF1493' },
  { cn: '珊瑚色', en: 'Coral', hex: '#FF7F50' },
  { cn: '鮭魚色', en: 'Salmon', hex: '#FA8072' },

  // ── Oranges & Yellows ──
  { cn: '橙色', en: 'Orange', hex: '#FFA500' },
  { cn: '深橙色', en: 'DarkOrange', hex: '#FF8C00' },
  { cn: '橙紅色', en: 'OrangeRed', hex: '#FF4500' },
  { cn: '金色', en: 'Gold', hex: '#FFD700' },
  { cn: '黃色', en: 'Yellow', hex: '#FFFF00' },
  { cn: '檸檬黃', en: 'LemonChiffon', hex: '#FFFACD' },
  { cn: '淡金色', en: 'LightGoldenrodYellow', hex: '#FAFAD2' },

  // ── Greens ──
  { cn: '綠色', en: 'Green', hex: '#008000' },
  { cn: '深綠色', en: 'DarkGreen', hex: '#006400' },
  { cn: '森林綠', en: 'ForestGreen', hex: '#228B22' },
  { cn: '橄欖綠', en: 'Olive', hex: '#808000' },
  { cn: '暗橄欖綠', en: 'DarkOliveGreen', hex: '#556B2F' },
  { cn: '淺綠色', en: 'LightGreen', hex: '#90EE90' },
  { cn: '薄荷綠', en: 'MediumSpringGreen', hex: '#00FA9A' },
  { cn: '海綠色', en: 'SeaGreen', hex: '#2E8B57' },
  { cn: '青綠色', en: 'Teal', hex: '#008080' },

  // ── Blues ──
  { cn: '藍色', en: 'Blue', hex: '#0000FF' },
  { cn: '鋼藍色', en: 'SteelBlue', hex: '#4682B4' },
  { cn: '深藍色', en: 'DarkBlue', hex: '#00008B' },
  { cn: '海軍藍', en: 'Navy', hex: '#000080' },
  { cn: '天藍色', en: 'SkyBlue', hex: '#87CEEB' },
  { cn: '寶藍色', en: 'RoyalBlue', hex: '#4169E1' },
  { cn: '淺藍色', en: 'LightBlue', hex: '#ADD8E6' },
  { cn: '深天藍色', en: 'DeepSkyBlue', hex: '#00BFFF' },
  { cn: '道奇藍', en: 'DodgerBlue', hex: '#1E90FF' },
  { cn: '矢車菊藍', en: 'CornflowerBlue', hex: '#6495ED' },
  { cn: '青色', en: 'Cyan', hex: '#00FFFF' },
  { cn: '暗青色', en: 'DarkCyan', hex: '#008B8B' },

  // ── Purples & Violets ──
  { cn: '紫色', en: 'Purple', hex: '#800080' },
  { cn: '暗紫色', en: 'DarkViolet', hex: '#9400D3' },
  { cn: '靛藍色', en: 'Indigo', hex: '#4B0082' },
  { cn: '薰衣草色', en: 'Lavender', hex: '#E6E6FA' },
  { cn: '蘭花紫', en: 'Orchid', hex: '#DA70D6' },
  { cn: '梅紅色', en: 'Plum', hex: '#DDA0DD' },
  { cn: '品紅色', en: 'Magenta', hex: '#FF00FF' },
  { cn: '紫羅蘭色', en: 'Violet', hex: '#EE82EE' },
  { cn: '中紫色', en: 'MediumPurple', hex: '#9370DB' },
  { cn: '暗洋紅', en: 'DarkMagenta', hex: '#8B008B' },

  // ── Metallic / Special (Furniture) ──
  { cn: '玫瑰金', en: 'RosyBrown', hex: '#BC8F8F' },
  { cn: '香檳色', en: 'BlanchedAlmond', hex: '#FFEBCD' },
  { cn: '青銅色', en: 'DarkGoldenrod', hex: '#B8860B' },
  { cn: '炭灰色', en: 'DarkSlateGray', hex: '#2F4F4F' },
  { cn: '煙白色', en: 'WhiteSmoke', hex: '#F5F5F5' },
  { cn: '雪白色', en: 'Snow', hex: '#FFFAFA' },
];

/**
 * Lookup: English W3C name → Chinese display label
 */
export function getChineseColorLabel(englishName: string): string {
  if (!englishName) return '';
  const found = COLOR_MAP.find(
    (c) => c.en.toLowerCase() === englishName.toLowerCase()
  );
  return found?.cn || englishName;
}

/**
 * Lookup: Chinese label → English W3C name
 */
export function getEnglishColorName(chineseLabel: string): string {
  if (!chineseLabel) return '';
  const found = COLOR_MAP.find((c) => c.cn === chineseLabel);
  return found?.en || chineseLabel;
}

/**
 * Get hex color for a given English color name (for swatch display)
 */
export function getColorHex(englishName: string): string {
  if (!englishName) return '#D3D3D3';
  const found = COLOR_MAP.find(
    (c) => c.en.toLowerCase() === englishName.toLowerCase()
  );
  return found?.hex || '#D3D3D3';
}

/**
 * Auto-match an AI-extracted color string (Chinese or English) to the closest mapping.
 * Returns the English W3C name if matched, or empty string if no match.
 */
export function autoMatchColor(rawColorStr: string): string {
  if (!rawColorStr || !rawColorStr.trim()) return '';
  const normalized = rawColorStr.trim().toLowerCase();

  // 1. Exact match on English name (case-insensitive)
  const exactEn = COLOR_MAP.find(
    (c) => c.en.toLowerCase() === normalized
  );
  if (exactEn) return exactEn.en;

  // 2. Exact match on Chinese name
  const exactCn = COLOR_MAP.find((c) => c.cn === rawColorStr.trim());
  if (exactCn) return exactCn.en;

  // 3. Partial match: check if the raw string contains any Chinese or English name
  for (const c of COLOR_MAP) {
    if (normalized.includes(c.cn) || normalized.includes(c.en.toLowerCase())) {
      return c.en;
    }
  }

  // 4. Common Chinese keyword mapping
  const keywordMap: Record<string, string> = {
    '白': 'White', '黑': 'Black', '灰': 'Gray', '紅': 'Red', '藍': 'Blue',
    '綠': 'Green', '棕': 'Brown', '咖': 'SaddleBrown', '金': 'Gold',
    '銀': 'Silver', '粉': 'Pink', '紫': 'Purple', '橙': 'Orange',
    '黃': 'Yellow', '青': 'Teal', '木': 'BurlyWood', '原': 'BurlyWood',
    '胡桃': 'Sienna', '橡': 'Tan', '櫻桃': 'Crimson', '深': 'DarkGray',
    '淺': 'LightGray',
  };
  for (const [keyword, enName] of Object.entries(keywordMap)) {
    if (rawColorStr.includes(keyword)) return enName;
  }

  return ''; // No match
}
