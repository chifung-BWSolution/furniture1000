/**
 * Quotation floor plan (平面圖) stored on bwf_quote.project_data.
 * Zone names are read from the drawing with the existing Gemini proxy;
 * the quote stays a flat item list, so recognized rooms become section titles.
 */
import { isHttpImageUrl } from '@/lib/imageStorage';
import { DEFAULT_GEMINI_MODEL } from '@/lib/geminiModel';

export const MAX_ZONE_IMAGES = 8;

/** One floor plan keeps at most this many labeled regions (FDS-13). */
export const MAX_FLOOR_PLAN_ZONES = 24;

/** Images uploaded on the quote before any 分區. Not a section-title id. */
export const UNZONED_QUOTE_IMAGE_KEY = 'unzoned';

/** Rectangle as percentages of the floor-plan preview (0–100). */
export type QuoteZoneRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Suggested or confirmed range for one quote section title. */
export type QuoteZoneRegion = {
  zoneId: string;
  rect: QuoteZoneRect;
  /** False after the floor plan file changes, until the user confirms again. */
  confirmed: boolean;
};

export type DetectedFloorZone = {
  name: string;
  rect: QuoteZoneRect | null;
};

export type ZoneManagerRow = {
  id: string;
  /** 空間名稱 */
  name: string;
  /** 英文名稱 */
  nameEn: string;
  /** 類型，例如 會議室 / 工作區 */
  spaceType: string;
  /** 這個空間的數量 */
  quantity: number;
  rect: QuoteZoneRect | null;
};

export function blankZoneManagerRow(id: string, name = ''): ZoneManagerRow {
  return { id, name, nameEn: '', spaceType: '', quantity: 1, rect: null };
}

export type QuoteFloorPlan = {
  url: string;
  mimeType: string;
  fileName: string;
  previewUrl: string | null;
  regions: QuoteZoneRegion[];
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
    regions: parseQuoteZoneRegions(row.regions),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function rectParts(value: unknown): { x: number; y: number; w: number; h: number } | null {
  if (Array.isArray(value) && value.length >= 4) {
    const [x, y, w, h] = value.map(readNumber);
    if (x == null || y == null || w == null || h == null) return null;
    return { x, y, w, h };
  }
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const nested = row.rect && row.rect !== value ? rectParts(row.rect) : null;
  if (nested) return nested;
  const box = row.box ?? row.bbox ?? row.bounds;
  if (box && box !== value) {
    const fromBox = rectParts(box);
    if (fromBox) return fromBox;
  }
  const x = readNumber(row.x ?? row.left);
  const y = readNumber(row.y ?? row.top);
  const w = readNumber(row.w ?? row.width);
  const h = readNumber(row.h ?? row.height);
  if (x == null || y == null || w == null || h == null) return null;
  return { x, y, w, h };
}

/** Keep a box inside the preview. Drop it when it is too small to use. */
export function normalizeZoneRect(value: unknown, minSize = 2): QuoteZoneRect | null {
  const parts = rectParts(value);
  if (!parts) return null;
  let { x, y, w, h } = parts;
  if (w <= 1 && h <= 1) {
    x *= 100;
    y *= 100;
    w *= 100;
    h *= 100;
  }
  x = Math.min(100, Math.max(0, x));
  y = Math.min(100, Math.max(0, y));
  w = Math.min(100 - x, Math.max(0, w));
  h = Math.min(100 - y, Math.max(0, h));
  if (w < minSize || h < minSize) return null;
  return { x: round1(x), y: round1(y), w: round1(w), h: round1(h) };
}

export function parseQuoteZoneRegions(value: unknown): QuoteZoneRegion[] {
  if (!Array.isArray(value)) return [];
  const regions: QuoteZoneRegion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const zoneId = typeof row.zoneId === 'string' ? row.zoneId.trim() : '';
    if (!zoneId || seen.has(zoneId)) continue;
    const rect = normalizeZoneRect(row.rect ?? row);
    if (!rect) continue;
    seen.add(zoneId);
    regions.push({ zoneId, rect, confirmed: row.confirmed === true });
    if (regions.length >= MAX_FLOOR_PLAN_ZONES) break;
  }
  return regions;
}

export function unconfirmZoneRegions(regions: QuoteZoneRegion[]): QuoteZoneRegion[] {
  return regions.map((region) => ({ ...region, confirmed: false }));
}

/** Confirmed ranges for the zones the user kept. Names without a box stay name-only. */
export function regionsFromZoneRows(rows: ZoneManagerRow[]): QuoteZoneRegion[] {
  const regions: QuoteZoneRegion[] = [];
  for (const row of rows) {
    if (!row.rect) continue;
    const rect = normalizeZoneRect(row.rect);
    if (!rect) continue;
    regions.push({ zoneId: row.id, rect, confirmed: true });
    if (regions.length >= MAX_FLOOR_PLAN_ZONES) break;
  }
  return regions;
}

/** Match detected labels onto existing zones. New rooms are inserted first, up to 24. */
export function applyDetectedZones(
  existing: ZoneManagerRow[],
  detected: DetectedFloorZone[],
  createId: () => string,
): { rows: ZoneManagerRow[]; added: number } {
  const rows = existing.map((row) => ({
    ...row,
    rect: row.rect ? { ...row.rect } : null,
  }));
  const fresh: ZoneManagerRow[] = [];
  const seen = new Set<string>();
  for (const zone of detected) {
    const name = zone.name.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const found = rows.find((row) => row.name.trim().toLowerCase() === key)
      ?? fresh.find((row) => row.name.trim().toLowerCase() === key);
    if (found) {
      if (zone.rect) found.rect = zone.rect;
      continue;
    }
    if (rows.length + fresh.length >= MAX_FLOOR_PLAN_ZONES) continue;
    fresh.push({ ...blankZoneManagerRow(createId(), name), rect: zone.rect });
  }
  return { rows: [...fresh, ...rows], added: fresh.length };
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

/** Drop images whose section title no longer exists. Unzoned uploads stay. */
export function pruneQuoteZoneImages(
  images: QuoteZoneImageMap,
  sectionTitleIds: Iterable<string>,
): QuoteZoneImageMap {
  const live = new Set(sectionTitleIds);
  live.add(UNZONED_QUOTE_IMAGE_KEY);
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

function zonesFromModelText(text: string): DetectedFloorZone[] {
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
  const zones: DetectedFloorZone[] = [];
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
    const rect = typeof entry === 'string' ? null : normalizeZoneRect(entry);
    zones.push({ name, rect });
    if (zones.length >= MAX_FLOOR_PLAN_ZONES) break;
  }
  return zones;
}

/** Read labeled rooms and their boxes off a floor-plan JPEG. Returns [] when nothing is labeled. */
export async function detectZonesFromJpegBase64(jpegBase64: string): Promise<DetectedFloorZone[]> {
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
    '- 每個區域加一個包住該房間的矩形：x、y 是左上角相對整張圖的百分比，w、h 是寬高百分比，範圍 0 到 100',
    '- 看不清邊界就只留 name，不要猜一個框',
    '- 完全看不出分區時 zones 為空陣列',
    '只回 JSON：{"zones":[{"name":"老闆房","x":10,"y":20,"w":30,"h":25}]}',
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
  try {
    return zonesFromModelText(text);
  } catch {
    return [];
  }
}

const ZONE_SCENE_STYLE =
  '寫實室內設計效果圖，淺色物料，暖白燈光，乾淨構圖，無人、無文字、無商標，鏡頭平視';

export type ZoneSceneFurniture = {
  name: string;
  /** 傢俬功能，例如座椅、接待櫃。 */
  role: string;
  /** 這件傢俬的產品圖。點分區時用來勾選參考圖。 */
  imageUrl?: string;
};

export type ZoneSceneInput = {
  name: string;
  /** 分區功能，例如會議室、接待處。 */
  spaceType: string;
  furniture: ZoneSceneFurniture[];
};

function furniturePhrase(item: ZoneSceneFurniture): string {
  const name = item.name.trim();
  const role = item.role.trim();
  if (name && role && role !== name) return `${name}（${role}）`;
  return name || role;
}

/** 模型沒回應時，用分區和傢俬直接拼一段場景描述。 */
export function fallbackZoneScenePrompt(zone: ZoneSceneInput, referenceFurniture: ZoneSceneFurniture[] = []): string {
  const name = zone.name.trim();
  const spaceType = zone.spaceType.trim();
  const place = name && spaceType && spaceType !== name ? `${name}，用作${spaceType}` : (name || spaceType || '室內空間');
  const referenced = referenceFurniture.length ? referenceFurniture : zone.furniture;
  const pieces = referenced.map(furniturePhrase).filter(Boolean);
  const furnishing = pieces.length ? `場景裡要清楚看到參考圖中的${pieces.join('、')}。` : '';
  return `${place}。${furnishing}${ZONE_SCENE_STYLE}`.replace(/\s+/g, ' ').trim();
}

/** 每張參考圖一句提示，編號與上傳產品圖的順序相同。 */
export function referenceImagePromptBlock(furniture: ZoneSceneFurniture[]): string {
  const lines = furniture
    .map((item, index) => {
      const label = furniturePhrase(item) || '這件傢俬';
      const n = index + 1;
      return `參考圖${n}是${label}，對應上傳的第${n}張產品圖，如實保留這張圖的外形、顏色和比例`;
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return `【參考圖】${lines.join('。')}。`;
}

/** 場景描述後面附上參考圖提示。超出字數時先縮短場景，保留每張圖的對應。 */
export function withReferenceImagePrompts(
  text: string,
  furniture: ZoneSceneFurniture[],
  max = 500,
): string {
  const block = referenceImagePromptBlock(furniture);
  const base = text.replace(/【參考圖】[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  if (!block) return base.slice(0, max);
  const room = Math.max(0, max - block.length);
  let head = base.slice(0, room).trim();
  if (head && !/[。！？]$/.test(head)) head = `${head}。`;
  const combined = `${head}${block}`;
  return combined.length > max ? block.slice(0, max) : combined;
}

function withReferenceFurniture(text: string, furniture: ZoneSceneFurniture[]): string {
  const missing = furniture.filter((item) => {
    const name = item.name.trim();
    return name && !text.includes(name);
  });
  if (!missing.length) return text.replace(/\s+/g, ' ').trim();
  const extra = `場景裡要清楚看到參考圖中的${missing.map(furniturePhrase).filter(Boolean).join('、')}。`;
  const body = text.replace(/\s+/g, ' ').trim();
  return `${body}${body.endsWith('。') ? '' : '。'}${extra}`;
}

function plainSceneText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^["「『]+|["」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 按分區功能和裡面傢俬的功能，寫一段圖像描述。參考圖裡的傢俬一定會寫進描述。 */
export async function generateZoneScenePrompt(
  zone: ZoneSceneInput,
  referenceFurniture: ZoneSceneFurniture[] = [],
): Promise<string> {
  const fallback = withReferenceImagePrompts(
    withReferenceFurniture(fallbackZoneScenePrompt(zone, referenceFurniture), referenceFurniture),
    referenceFurniture,
  );
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return fallback;

  const list = (items: ZoneSceneFurniture[]) => items
    .map((item) => {
      const phrase = furniturePhrase(item);
      return phrase ? `- ${phrase}` : '';
    })
    .filter(Boolean)
    .join('\n');
  const referenced = list(referenceFurniture);
  const furniture = list(zone.furniture);
  const prompt = [
    '你是室內設計效果圖的提示詞助手。根據這個分區的功能，以及裡面已選傢俬的功能，寫一段給圖像模型的中文場景描述。',
    `分區名稱：${zone.name.trim() || '未命名'}`,
    `分區功能：${zone.spaceType.trim() || '按名稱判斷'}`,
    furniture ? `分區裡的傢俬：\n${furniture}` : '分區裡的傢俬：沒有',
    referenced ? `參考圖裡的傢俬（每一件的名稱都必須寫進描述，不能漏）：\n${referenced}` : '參考圖裡的傢俬：沒有',
    '要求：',
    '- 只寫一段話，220 字以內',
    '- 先寫這個空間做什麼，再寫傢俬如何擺在這個空間裡',
    '- 參考圖裡的每一件傢俬都要寫出名稱',
    '- 沒有傢俬時只描述空間本身',
    `- 結尾必須包含：${ZONE_SCENE_STYLE}`,
    '- 不要編號、不要引號、不要解釋',
  ].join('\n');

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/supabase-functions-gemini-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        model: DEFAULT_GEMINI_MODEL,
        feature: 'quote_zone_photo_prompt',
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return fallback;
    const text = plainSceneText(String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''));
    return withReferenceImagePrompts(
      withReferenceFurniture(text || fallback, referenceFurniture),
      referenceFurniture,
    );
  } catch {
    return withReferenceImagePrompts(fallback, referenceFurniture);
  }
}
