// FDS 2.2：圖冊／報價單抽出的顏色只映射到既有 COLOR_MAP。
// 對不上的留給人工，不新增正式色。「訂造」是標記，不是新色。
import { COLOR_MAP, autoMatchColor } from '../constants/color-map.ts';

const CUSTOM_COLOR = /訂造|定制|訂製|定製|custom(?:\s*order)?|bespoke/gi;

/** Longer furniture words first, so 「胡桃木」does not collapse to the single character 「木」. */
const FURNITURE_ALIASES = ([
  ['黑胡桃', 'DarkBrown'],
  ['胡桃木', 'Sienna'],
  ['白橡木', 'Wheat'],
  ['橡木', 'Tan'],
  ['原木', 'BurlyWood'],
  ['櫻桃木', 'Crimson'],
  ['胡桃', 'Sienna'],
  ['櫻桃', 'Crimson'],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

export interface OfficialColorMapping {
  /** Official English names. First is primary, the rest are secondary (at most two). */
  colors: string[];
  original_colors: string[];
  custom_order: boolean;
  unmapped: string[];
}

function officialName(name: string): string | null {
  const found = COLOR_MAP.find((c) => c.en.toLowerCase() === name.toLowerCase());
  return found?.en ?? null;
}

function mapOne(raw: string): { en: string | null; custom: boolean; unmapped: string | null } {
  const custom = CUSTOM_COLOR.test(raw);
  CUSTOM_COLOR.lastIndex = 0;
  const stripped = raw.replace(CUSTOM_COLOR, ' ').replace(/\s+/g, ' ').trim();
  CUSTOM_COLOR.lastIndex = 0;
  if (!stripped) return { en: null, custom, unmapped: null };
  const alias = FURNITURE_ALIASES.find(([word]) => stripped.includes(word));
  const en = officialName(alias?.[1] ?? autoMatchColor(stripped));
  if (!en) return { en: null, custom, unmapped: stripped };
  return { en, custom, unmapped: null };
}

/** Map free-text colors onto the existing palette. Unmapped text is returned, never stored as a color. */
export function mapOfficialColors(rawColors: string[]): OfficialColorMapping {
  const original = rawColors.map((c) => c.trim()).filter(Boolean);
  const colors: string[] = [];
  const unmapped: string[] = [];
  const seen = new Set<string>();
  let custom = false;

  for (const raw of original) {
    const pieces = raw.split(/[/|,、；;]+/).map((s) => s.trim()).filter(Boolean);
    for (const piece of (pieces.length > 0 ? pieces : [raw])) {
      const mapped = mapOne(piece);
      if (mapped.custom) custom = true;
      if (mapped.unmapped) unmapped.push(mapped.unmapped);
      if (mapped.en && !seen.has(mapped.en)) {
        seen.add(mapped.en);
        colors.push(mapped.en);
      }
    }
  }

  return {
    colors: colors.slice(0, 3),
    original_colors: original,
    custom_order: custom,
    unmapped,
  };
}
