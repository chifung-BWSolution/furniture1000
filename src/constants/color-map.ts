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

  // ── Extended W3C Colors ──
  { cn: '薄荷奶油', en: 'MintCream', hex: '#F5FFFA' },
  { cn: '幽靈白', en: 'GhostWhite', hex: '#F8F8FF' },
  { cn: '水晶白', en: 'Azure', hex: '#F0FFFF' },
  { cn: '蜜瓜色', en: 'Honeydew', hex: '#F0FFF0' },
  { cn: '蕾絲白', en: 'FloralWhite', hex: '#FFFAF0' },
  { cn: '紅木色', en: 'OldLace', hex: '#FDF5E6' },
  { cn: '玉米絲色', en: 'Cornsilk', hex: '#FFF8DC' },
  { cn: '薰衣草紅', en: 'LavenderBlush', hex: '#FFF0F5' },
  { cn: '貝殼色', en: 'Seashell', hex: '#FFF5EE' },
  { cn: '薄荷色', en: 'MediumAquamarine', hex: '#66CDAA' },
  { cn: '水藍色', en: 'Aquamarine', hex: '#7FFFD4' },
  { cn: '淺青色', en: 'Aqua', hex: '#00FFFF' },
  { cn: '湖藍色', en: 'CadetBlue', hex: '#5F9EA0' },
  { cn: '粉藍色', en: 'PowderBlue', hex: '#B0E0E6' },
  { cn: '淡藍色', en: 'PaleTurquoise', hex: '#AFEEEE' },
  { cn: '藍綠色', en: 'MediumTurquoise', hex: '#48D1CC' },
  { cn: '暗藍綠', en: 'DarkTurquoise', hex: '#00CED1' },
  { cn: '石板藍', en: 'SlateBlue', hex: '#6A5ACD' },
  { cn: '深石板藍', en: 'DarkSlateBlue', hex: '#483D8B' },
  { cn: '中石板藍', en: 'MediumSlateBlue', hex: '#7B68EE' },
  { cn: '藍紫色', en: 'BlueViolet', hex: '#8A2BE2' },
  { cn: '深蘭花紫', en: 'DarkOrchid', hex: '#9932CC' },
  { cn: '中蘭花紫', en: 'MediumOrchid', hex: '#BA55D3' },
  { cn: '薊紫色', en: 'Thistle', hex: '#D8BFD8' },
  { cn: '熱粉色', en: 'HotPink', hex: '#FF69B4' },
  { cn: '淺珊瑚色', en: 'LightCoral', hex: '#F08080' },
  { cn: '淺鮭魚色', en: 'LightSalmon', hex: '#FFA07A' },
  { cn: '暗鮭魚色', en: 'DarkSalmon', hex: '#E9967A' },
  { cn: '番茄色', en: 'Tomato', hex: '#FF6347' },
  { cn: '玫瑰色', en: 'MediumVioletRed', hex: '#C71585' },
  { cn: '淡粉紫', en: 'PaleVioletRed', hex: '#DB7093' },
  { cn: '橄欖褐色', en: 'DarkGoldenrod', hex: '#B8860B' },
  { cn: '金菊色', en: 'Goldenrod', hex: '#DAA520' },
  { cn: '淡金菊', en: 'LightGoldenrod', hex: '#FAFAD2' },
  { cn: '淡黃色', en: 'LightYellow', hex: '#FFFFE0' },
  { cn: '木瓜色', en: 'PapayaWhip', hex: '#FFEFD5' },
  { cn: '水蜜桃色', en: 'PeachPuff', hex: '#FFDAB9' },
  { cn: '橡皮色', en: 'MoccasinColor', hex: '#FFE4B5' },
  { cn: '海貝色', en: 'Moccasin', hex: '#FFE4B5' },
  { cn: '那瓦霍白', en: 'NavajoWhite', hex: '#FFDEAD' },
  { cn: '杏色', en: 'Bisque', hex: '#FFE4C4' },
  { cn: '草坪綠', en: 'LawnGreen', hex: '#7CFC00' },
  { cn: '查特酒綠', en: 'Chartreuse', hex: '#7FFF00' },
  { cn: '黃綠色', en: 'YellowGreen', hex: '#9ACD32' },
  { cn: '綠黃色', en: 'GreenYellow', hex: '#ADFF2F' },
  { cn: '淡綠色', en: 'PaleGreen', hex: '#98FB98' },
  { cn: '春綠色', en: 'SpringGreen', hex: '#00FF7F' },
  { cn: '深海綠', en: 'DarkSeaGreen', hex: '#8FBC8F' },
  { cn: '中海綠', en: 'MediumSeaGreen', hex: '#3CB371' },
  { cn: '暗翠綠', en: 'DarkTurquoise', hex: '#00CED1' },
  { cn: '石灰色', en: 'Lime', hex: '#00FF00' },
  { cn: '深石灰綠', en: 'LimeGreen', hex: '#32CD32' },
  { cn: '深石板灰', en: 'DarkSlateGray', hex: '#2F4F4F' },
  { cn: '午夜藍', en: 'MidnightBlue', hex: '#191970' },
  { cn: '深藏青', en: 'DarkSlateBlue', hex: '#483D8B' },
  { cn: '紫紅色', en: 'Fuchsia', hex: '#FF00FF' },
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
