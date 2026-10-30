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
  /** First area of this space; the canvas draws from `rects`. */
  rect: QuoteZoneRect | null;
  /** One space can sit in several places on the plan (copied areas). */
  rects?: QuoteZoneRect[];
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
    // Models often answer "12%" or "12px" even when asked for plain numbers.
    const parsed = Number.parseFloat(value.replace(/[%\s]/g, '').replace(/px$/i, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Box numbers exactly as the model wrote them, before deciding the scale. */
type RawRect = { x: number; y: number; w: number; h: number };

const NESTED_RECT_KEYS = ['rect', 'box', 'bbox', 'bounds', 'boundingBox', 'region', 'area'];

function rectFromArray(value: unknown[]): RawRect | null {
  const nums = value.slice(0, 4).map(readNumber);
  if (nums.length < 4 || nums.some((part) => part == null)) return null;
  const [a, b, c, d] = nums as number[];
  // Corner pairs (x1, y1, x2, y2) show up when a model reuses its own box format.
  if (c < a || d < b) {
    return { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
  }
  return { x: a, y: b, w: c, h: d };
}

/** Gemini writes detections as box_2d: [ymin, xmin, ymax, xmax]. */
function rectFromBox2d(value: unknown[]): RawRect | null {
  const nums = value.slice(0, 4).map(readNumber);
  if (nums.length < 4 || nums.some((part) => part == null)) return null;
  const [ymin, xmin, ymax, xmax] = nums as number[];
  return {
    x: Math.min(xmin, xmax),
    y: Math.min(ymin, ymax),
    w: Math.abs(xmax - xmin),
    h: Math.abs(ymax - ymin),
  };
}

function rectParts(value: unknown): RawRect | null {
  if (Array.isArray(value)) return rectFromArray(value);
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const box2d = row.box_2d ?? row.box2d ?? row.box2D;
  if (Array.isArray(box2d)) return rectFromBox2d(box2d);
  for (const key of NESTED_RECT_KEYS) {
    const nested = row[key];
    if (nested && nested !== value) {
      const parts = rectParts(nested);
      if (parts) return parts;
    }
  }
  const x1 = readNumber(row.x1 ?? row.left ?? row.l);
  const y1 = readNumber(row.y1 ?? row.top ?? row.t);
  const x2 = readNumber(row.x2 ?? row.right);
  const y2 = readNumber(row.y2 ?? row.bottom);
  if (x1 != null && y1 != null && x2 != null && y2 != null) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  const x = readNumber(row.x ?? row.left);
  const y = readNumber(row.y ?? row.top);
  const w = readNumber(row.w ?? row.width);
  const h = readNumber(row.h ?? row.height);
  if (x == null || y == null || w == null || h == null) return null;
  return { x, y, w, h };
}

function rectExtent(rect: RawRect): number {
  return Math.max(rect.x + rect.w, rect.y + rect.h);
}

/** 0–1 fractions mean percentages when written as fractions. */
function fractionScale(rect: RawRect): number {
  const extent = rectExtent(rect);
  return extent > 0 && extent <= 1.2 ? 100 : 1;
}

/**
 * Percentages can arrive as 0–1 fractions or as Gemini's 0–1000 box convention.
 * Decide once per response: a 0–1000 answer puts most boxes past 100, and scaling
 * it is better than clamping every box away. A lone box that only slightly overshoots
 * 100 is still read as percent, so one sloppy number cannot rescale the whole answer.
 */
function responseScale(rects: RawRect[]): number {
  if (!rects.length) return 1;
  const extent = Math.max(...rects.map(rectExtent));
  if (extent > 0 && extent <= 1.2) return 100;
  if (extent > 1000) return 1;
  const over = rects.filter((rect) => rectExtent(rect) > 100.5).length;
  if (over * 2 >= rects.length && (extent > 150 || rects.length > 1)) return 0.1;
  return 1;
}

/** Keep a box inside the preview. Drop it when it is too small to use. */
function fitRect(parts: RawRect, scale: number, minSize: number): QuoteZoneRect | null {
  let x = parts.x * scale;
  let y = parts.y * scale;
  let w = parts.w * scale;
  let h = parts.h * scale;
  if (![x, y, w, h].every((value) => Number.isFinite(value))) return null;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  x = Math.min(100, Math.max(0, x));
  y = Math.min(100, Math.max(0, y));
  w = Math.min(100 - x, Math.max(0, w));
  h = Math.min(100 - y, Math.max(0, h));
  if (w < minSize || h < minSize) return null;
  return { x: round1(x), y: round1(y), w: round1(w), h: round1(h) };
}

/** Keep a box inside the preview. Drop it when it is too small to use. */
export function normalizeZoneRect(value: unknown, minSize = 2): QuoteZoneRect | null {
  const parts = rectParts(value);
  if (!parts) return null;
  return fitRect(parts, fractionScale(parts), minSize);
}

export function parseQuoteZoneRegions(value: unknown): QuoteZoneRegion[] {
  if (!Array.isArray(value)) return [];
  const regions: QuoteZoneRegion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const zoneId = typeof row.zoneId === 'string' ? row.zoneId.trim() : '';
    if (!zoneId) continue;
    const rect = normalizeZoneRect(row.rect ?? row);
    if (!rect) continue;
    // A space may hold several areas; only an identical box is a duplicate.
    const key = `${zoneId}|${rect.x},${rect.y},${rect.w},${rect.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
    const boxes = row.rects?.length ? row.rects : row.rect ? [row.rect] : [];
    for (const box of boxes) {
      const rect = normalizeZoneRect(box);
      if (!rect) continue;
      const key = `${row.id}|${rect.x},${rect.y},${rect.w},${rect.h}`;
      if (regions.some((region) => `${region.zoneId}|${region.rect.x},${region.rect.y},${region.rect.w},${region.rect.h}` === key)) continue;
      regions.push({ zoneId: row.id, rect, confirmed: true });
      if (regions.length >= MAX_FLOOR_PLAN_ZONES) return regions;
    }
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
    rects: row.rects?.map((rect) => ({ ...rect })),
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
      // A fresh box replaces the old areas of that space instead of leaving them behind.
      if (zone.rect) {
        found.rect = zone.rect;
        found.rects = [zone.rect];
      }
      continue;
    }
    if (rows.length + fresh.length >= MAX_FLOOR_PLAN_ZONES) continue;
    fresh.push({ ...blankZoneManagerRow(createId(), name), rect: zone.rect, rects: zone.rect ? [zone.rect] : [] });
  }
  return { rows: [...fresh, ...rows], added: fresh.length };
}

/**
 * Canvas rows carry `${zone.id}::${index}` so every copied area can be moved on its own
 * while the list below still shows one row per space.
 */
export function zoneCanvasRows(rows: ZoneManagerRow[]): ZoneManagerRow[] {
  return rows.flatMap((zone) => {
    const rects = zone.rects?.length ? zone.rects : zone.rect ? [zone.rect] : [];
    return (rects.length ? rects : [null]).map((rect, index) => ({ ...zone, id: `${zone.id}::${index}`, rect }));
  });
}

/** Fold canvas edits back into the zone list. A space whose last area was deleted is dropped. */
export function applyZoneCanvasChange(rows: ZoneManagerRow[], next: ZoneManagerRow[]): ZoneManagerRow[] {
  const out: ZoneManagerRow[] = rows.flatMap((zone) => {
    const rects = next
      .filter((row) => row.id.startsWith(`${zone.id}::`) && row.rect)
      .map((row) => row.rect as QuoteZoneRect);
    if ((zone.rects?.length || zone.rect) && !rects.length) return [];
    return [{ ...zone, rects, rect: rects[0] ?? null }];
  });
  for (const row of next) {
    if (!row.id.includes('::')) {
      out.push({ ...blankZoneManagerRow(row.id), ...row, rects: row.rect ? [row.rect] : [] });
    }
  }
  return out;
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

function readZoneName(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  const row = entry as Record<string, unknown>;
  for (const key of ['name', 'label', 'room', 'title'] as const) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** Turn a model answer into zones. A name without a usable box stays name-only. */
export function zonesFromDetectedText(text: string): DetectedFloorZone[] {
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
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw)
    ? raw
    : record && Array.isArray(record.zones)
      ? (record.zones as unknown[])
      : record && Array.isArray(record.rooms)
        ? (record.rooms as unknown[])
        : [];
  const entries: { name: string; rect: RawRect | null }[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const name = readZoneName(entry).replace(/\s+/g, ' ').trim();
    if (!name || name.length > 40) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ name, rect: rectParts(entry) });
    if (entries.length >= MAX_FLOOR_PLAN_ZONES) break;
  }
  const scale = responseScale(entries.flatMap((entry) => (entry.rect ? [entry.rect] : [])));
  return entries.map((entry) => ({
    name: entry.name,
    rect: entry.rect ? fitRect(entry.rect, scale, 2) : null,
  }));
}

// ---- Gemini: prompts and network calls below this line ----

function zoneDetectPrompt(): string {
  return [
    '你是辦公室平面圖分區辨識助手。看附圖，找出圖上已標示名稱的房間或功能分區，並回報每個分區的位置。',
    '規則：',
    '- 用圖上的文字，不要翻譯、不要發明圖上沒有的房間',
    '- 去掉純尺寸、圖例、公司名、指北針、比例尺',
    '- 名稱保留房間名（例如 老闆房、會議室、開放辦公區）',
    '- 最多 24 個，由左至右、由上至下',
    '- 每個分區都要有框：沿房間四周的牆線畫，開放式區域（例如開放辦公區）用包住整區座位的外框',
    '- 框不用精準，使用者之後會自己調整，但不可以只給名稱不給框',
    '- x、y 是框的左上角，w、h 是框的寬高，全部是相對整張圖的百分比，0 到 100，不要用像素',
    '- 完全看不出分區時 zones 為空陣列',
    '只回 JSON：{"zones":[{"name":"STORAGE","x":4,"y":30,"w":5,"h":12}]}',
  ].join('\n');
}

/** Second pass: the model listed these rooms but gave no usable box. */
function zoneRectPrompt(names: string[]): string {
  return [
    '你是辦公室平面圖分區辨識助手。看附圖，下面這些房間已經有名字，但還沒有位置：',
    ...names.map((name) => `- ${name}`),
    '只為上面每一個名稱回一個包住該房間的框。',
    '規則：',
    '- 名稱照抄，不要新增、不要改名，也不要漏掉任何一個',
    '- 沿房間四周的牆線畫；開放式區域用包住整區座位的外框',
    '- x、y 是框的左上角，w、h 是框的寬高，相對整張圖的百分比，0 到 100，不要用像素',
    '- 框不用精準，使用者之後會自己調整',
    '只回 JSON：{"zones":[{"name":"STORAGE","x":4,"y":30,"w":5,"h":12}]}',
  ].join('\n');
}

async function askGeminiForZones(prompt: string, jpegBase64: string): Promise<DetectedFloorZone[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('尚未設定資料庫連線，無法識別分區');
  }

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
    return zonesFromDetectedText(text);
  } catch {
    return [];
  }
}

/**
 * Read labeled rooms and their boxes off a floor-plan JPEG. Returns [] when nothing is labeled.
 * Rooms the model named but could not box get one more focused pass, so the zone manager
 * opens with ranges the user can drag instead of a bare list of names.
 */
export async function detectZonesFromJpegBase64(jpegBase64: string): Promise<DetectedFloorZone[]> {
  if (!jpegBase64.trim()) throw new Error('平面圖是空的');

  const zones = await askGeminiForZones(zoneDetectPrompt(), jpegBase64);
  const missing = zones.filter((zone) => !zone.rect).map((zone) => zone.name);
  if (!zones.length || !missing.length) return zones;

  const retry = await askGeminiForZones(zoneRectPrompt(missing.slice(0, MAX_FLOOR_PLAN_ZONES)), jpegBase64)
    .catch(() => [] as DetectedFloorZone[]);
  if (!retry.length) return zones;
  const boxes = new Map<string, QuoteZoneRect>();
  for (const zone of retry) {
    const key = zone.name.trim().toLowerCase();
    if (zone.rect && key && !boxes.has(key)) boxes.set(key, zone.rect);
  }
  return zones.map((zone) => (zone.rect ? zone : { ...zone, rect: boxes.get(zone.name.trim().toLowerCase()) ?? null }));
}

const ZONE_SCENE_STYLE =
  '寫實室內設計效果圖，牆身和地板用淺色，暖白燈光，乾淨構圖，無人、無文字、無商標，鏡頭平視。不要改寫傢俬本身的顏色、物料或結構';

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
      return `參考圖${n}是${label}，原樣使用上傳的第${n}張產品圖，保留腳架、扶手、靠背、層板、開口和顏色，不可簡化或換成別的款`;
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
    '- 只寫一段話，180 字以內',
    '- 先寫這個空間做什麼，再寫每件傢俬放在哪裡',
    '- 不要描寫傢俬的顏色、物料、腳數或外形，這些以產品圖為準',
    '- 每件傢俬只出現一次，不要合併，也不要用另一款代替',
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
