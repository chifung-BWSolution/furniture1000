/**
 * Quotation floor plan (平面圖) stored on bwf_quote.project_data.
 * Zone names are read from the drawing with the existing Gemini proxy;
 * the quote stays a flat item list, so recognized rooms become section titles.
 */
import { isHttpImageUrl } from '@/lib/imageStorage';
import { DEFAULT_GEMINI_MODEL } from '@/lib/geminiModel';

export const MAX_ZONE_IMAGES = 8;

export type QuoteFloorPlan = {
  url: string;
  mimeType: string;
  fileName: string;
  previewUrl: string | null;
};

export type QuoteZoneImageMap = Record<string, string[]>;

export function parseQuoteFloorPlan(value: unknown): QuoteFloorPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  if (!isHttpImageUrl(url)) return null;
  const mimeType = typeof row.mimeType === 'string' ? row.mimeType.trim() : '';
  const fileName = typeof row.fileName === 'string' ? row.fileName.trim() : '';
  const previewRaw = typeof row.previewUrl === 'string' ? row.previewUrl.trim() : '';
  return {
    url,
    mimeType: mimeType || 'application/octet-stream',
    fileName: fileName || '平面圖',
    previewUrl: isHttpImageUrl(previewRaw) ? previewRaw : null,
  };
}

export function parseQuoteZoneImages(value: unknown): QuoteZoneImageMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: QuoteZoneImageMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = key.trim();
    if (!id || !Array.isArray(raw)) continue;
    const urls: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const url = entry.trim();
      if (!isHttpImageUrl(url) || urls.includes(url)) continue;
      urls.push(url);
      if (urls.length >= MAX_ZONE_IMAGES) break;
    }
    if (urls.length) next[id] = urls;
  }
  return next;
}

/** Drop images whose section title no longer exists. */
export function pruneQuoteZoneImages(
  images: QuoteZoneImageMap,
  sectionTitleIds: Iterable<string>,
): QuoteZoneImageMap {
  const live = new Set(sectionTitleIds);
  const next: QuoteZoneImageMap = {};
  for (const [id, urls] of Object.entries(images)) {
    if (!live.has(id) || urls.length === 0) continue;
    next[id] = urls;
  }
  return next;
}

/** Shrink a floor-plan bitmap and return raw JPEG base64 for Gemini. */
export async function imageBlobToJpegBase64(blob: Blob, maxDim = 1600): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height, 1));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法讀取平面圖');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  } finally {
    bitmap.close();
  }
}

function zoneNamesFromModelText(text: string): string[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  let raw: unknown = null;
  if (start >= 0 && end > start) {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } else if (arrayStart >= 0 && arrayEnd > arrayStart) {
    raw = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
  } else {
    return [];
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { zones?: unknown }).zones)
      ? (raw as { zones: unknown[] }).zones
      : [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const name = (typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
        ? (entry as { name: string }).name
        : ''
    ).replace(/\s+/g, ' ').trim();
    if (!name || name.length > 40) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 24) break;
  }
  return names;
}

/** Read room / zone labels off a floor-plan JPEG. Returns [] when nothing is labeled. */
export async function detectZonesFromJpegBase64(jpegBase64: string): Promise<string[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('尚未設定資料庫連線，無法識別分區');
  }
  if (!jpegBase64.trim()) throw new Error('平面圖是空的');

  const prompt = [
    '你是辦公室平面圖分區辨識助手。看附圖，只列出圖上已經標示的房間或功能分區名稱。',
    '規則：',
    '- 用圖上的文字，不要翻譯、不要發明圖上沒有的房間',
    '- 去掉純尺寸、圖例、公司名、指北針、比例尺',
    '- 名稱保留房間名（例如 老闆房、會議室、開放辦公區）',
    '- 最多 24 個，由左至右、由上至下',
    '- 完全看不出分區時 zones 為空陣列',
    '只回 JSON：{"zones":[{"name":"老闆房"}]}',
  ].join('\n');

  const response = await fetch(`${supabaseUrl}/functions/v1/supabase-functions-gemini-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({
      model: DEFAULT_GEMINI_MODEL,
      feature: 'quote_floor_plan_zones',
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
        ],
      }],
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string'
      ? data.error
      : typeof data?.error?.message === 'string'
        ? data.error.message
        : `識別分區失敗（${response.status}）`;
    throw new Error(message);
  }
  const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  if (!text) return [];
  return zoneNamesFromModelText(text);
}
