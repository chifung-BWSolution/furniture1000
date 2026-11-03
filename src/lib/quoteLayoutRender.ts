import { supabase } from './supabase';
import { DEFAULT_GEMINI_MODEL } from './geminiModel';
import { imageBlobToJpegBase64, type QuoteFloorPlan } from './quoteFloorPlan';
import { uploadBase64Image } from './imageStorage';

export type LayoutProduct = { id: string; name: string; category?: string; sku?: string; image: string; quantity: number; material?: string; color?: string; dimensionLMm?: string | null; dimensionWMm?: string | null; dimensionHMm?: string | null; isSectionTitle?: boolean; isCustomTerm?: boolean; isOptional?: boolean };
export type LayoutZone = { id: string; name: string; products: LayoutProduct[] };
export function layoutZones(items: LayoutProduct[]): LayoutZone[] {
  const zones: LayoutZone[] = [];
  let current: LayoutZone | undefined;
  for (const item of items) {
    if (item.isSectionTitle) { current = { id: item.id, name: item.name, products: [] }; zones.push(current); }
    else if (current && !item.isCustomTerm && !item.isOptional) current.products.push({ ...item, name: item.name || item.category || item.sku || '未命名傢俬' });
  }
  return zones;
}
export function layoutDescription(zones: LayoutZone[], plan: QuoteFloorPlan): string {
  return JSON.stringify(zones.map(z => ({ id: z.id, name: z.name, regions: plan.regions.filter(r => r.zoneId === z.id).map(r => r.rect), products: z.products.map(p => ({ id: p.id, name: p.name, quantity: p.quantity, material: p.material, color: p.color, dimensionsMm: [p.dimensionLMm, p.dimensionWMm, p.dimensionHMm], placements: (plan.placements?.assignments[p.id] || []).slice(0, Math.max(0, Math.floor(p.quantity))).flatMap(id => { const position = plan.placements?.positions[z.id]?.find(pos => pos.id === id); return position ? [position] : []; }) })) })));
}
export async function recognizeLayout(plan: QuoteFloorPlan, zones: LayoutZone[]): Promise<Record<string, string>> {
  const source = plan.previewUrl || (plan.mimeType.startsWith('image/') ? plan.url : '');
  if (!source) throw new Error('請先產生平面圖預覽');
  const response = await fetch(source);
  if (!response.ok) throw new Error('無法讀取平面圖');
  const data = await imageBlobToJpegBase64(await response.blob());
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('請先登入');
  const result = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supabase-functions-gemini-proxy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ model: DEFAULT_GEMINI_MODEL, feature: 'quote_floor_plan_zones', contents: [{ parts: [
      { text: `識別附圖傢俬位置與朝向，配對以下報價產品。位置用整張圖百分比座標(x,y)，朝向用相對圖上方順時針角度。每件實物分別描述，列產品id；未知配對或朝向寫待確認，不推測。數量與報價不符必須指出，不新增產品。分區框與產品資料：${layoutDescription(zones, plan)}。只回JSON：{"zones":[{"id":"分區id","notes":"各件傢俬的產品id、位置、角度及待確認問題"}]}` },
      { inlineData: { mimeType: 'image/jpeg', data } },
    ] }] }), signal: AbortSignal.timeout(90000),
  });
  const body = await result.json();
  if (!result.ok) throw new Error('布局識別失敗，請稍後重試');
  const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  if (!Array.isArray(parsed.zones)) throw new Error('識別結果無效');
  const notes: Record<string, string> = {};
  for (const z of zones) {
    const found = parsed.zones.find((v: { id?: string; notes?: unknown }) => v.id === z.id);
    if (typeof found?.notes !== 'string' || !found.notes.trim()) throw new Error(`未能識別 ${z.name}，請重新識別或手動填寫`);
    notes[z.id] = found.notes;
  }
  return notes;
}
export async function productSheet(zones: LayoutZone[]): Promise<string> {
  const products = zones.flatMap(z => z.products).filter(p => p.image);
  if (!products.length) throw new Error('分區內沒有產品圖片');
  if (products.length > 48) throw new Error('產品超過48件，請先逐區生成');
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = Math.ceil(products.length / 4) * 340;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立產品圖集');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < products.length; i++) {
    const p = products[i]; const img = new Image(); img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { img.src = ''; reject(new Error(`讀取產品圖逾時：${p.name}`)); }, 20000);
      img.onload = () => { window.clearTimeout(timer); resolve(); };
      img.onerror = () => { window.clearTimeout(timer); reject(new Error(`無法讀取產品圖：${p.name}`)); };
      img.src = p.image;
    });
    const scale = Math.min(380 / img.width, 270 / img.height);
    const x = (i % 4) * 400; const y = Math.floor(i / 4) * 340;
    ctx.drawImage(img, x + (400 - img.width * scale) / 2, y, img.width * scale, img.height * scale);
    ctx.fillStyle = '#111827'; ctx.font = '14px sans-serif';
    ctx.fillText(p.id, x + 8, y + 292, 384); ctx.fillText(p.name, x + 8, y + 316, 384);
  }
  return uploadBase64Image(canvas.toDataURL('image/jpeg', 0.88), crypto.randomUUID(), 'quote-layout-products');
}

export const DEFAULT_LAYOUT_STYLE = '現代簡約辦公室，淺木地板、米白牆面、柔和自然光；傢俬材質及顏色依報價產品。';

/** Detected room names are matched to the same zone-manager rows used by the quote. */
export function detectedLayoutNotes(rows: { id: string; name: string }[], detected: { name: string; furnitureLayout?: string }[]): Record<string, string> {
  const byName = new Map(detected.map(z => [z.name.trim().toLowerCase(), z.furnitureLayout]));
  return Object.fromEntries(rows.flatMap(row => {
    const note = byName.get(row.name.trim().toLowerCase());
    return note ? [[row.id, note]] : [];
  }));
}

export async function generateZoneLayoutImage(plan: QuoteFloorPlan, zone: LayoutZone, quoteUuid: string | null) {
  const { generateQuoteReferenceImage } = await import('./quotePhotoLibrary');
  const source = plan.previewUrl || (plan.mimeType.startsWith('image/') ? plan.url : '');
  if (!source) throw new Error('請先上傳平面圖');
  if (!zone.products.length) throw new Error('此分區尚未有報價產品');
  const notes = plan.rendering?.notes[zone.id];
  if (!notes?.trim()) throw new Error('此分區尚未識別位置與方向，請重新上傳平面圖或在平面圖渲染補充布局');
  const sheet = await productSheet([zone]);
  const prompt = [
    `只生成分區「${zone.name}」的室內平視透視效果圖；按該區框還原房間、門窗、通道，保留原圖傢俬位置和朝向。`,
    `全案統一風格：${plan.rendering?.style || DEFAULT_LAYOUT_STYLE}`,
    layoutDescription([zone], plan), `上傳時識別的布局：${notes}`,
    '產品資料中的 placements 為使用者指定或明確配對的位置，優先於文字布局，不可互換產品的位置。未指定位置的產品不可宣稱有確認擺位。將圖上傢俬類別與報價產品編號配對，數量、尺寸、材質以報價資料為準，外觀以產品圖集為準。圖上與報價有差異時按原有位置放置報價產品，不添加報價外傢俬。不推測未知尺寸，無人、無文字。',
  ].join('\n');
  if (prompt.length > 16000) throw new Error('布局資料過長，請縮短分區描述');
  const overview = plan.rendering?.images.overview;
  return generateQuoteReferenceImage({ purpose: 'quote_layout', model: 'gemini', quoteUuid, aspectRatio: '16:9', prompt, referenceUrls: [source, sheet, ...(overview ? [overview] : [])] });
}
