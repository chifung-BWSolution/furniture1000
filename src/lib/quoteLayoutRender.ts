import { supabase } from './supabase';
import { DEFAULT_GEMINI_MODEL } from './geminiModel';
import { imageBlobToJpegBase64, type QuoteFloorPlan } from './quoteFloorPlan';
import { uploadBase64Image } from './imageStorage';
import { cropPresentationFloorPlan, presentationZoneBounds } from './presentationFloorPlan';

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
  const products = zones.flatMap(z => z.products);
  if (!products.length) throw new Error('分區內沒有產品圖片');
  const missing = products.filter(p => !p.image?.trim());
  if (missing.length) throw new Error(`請先為以下產品加入產品圖片：${missing.map(p => p.name).join('、')}`);
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

export function confirmedLayoutProducts(zone: LayoutZone, references: Record<string, string> = {}): LayoutProduct[] {
  const unconfirmed = zone.products.filter(product => !references[product.id]);
  if (unconfirmed.length) throw new Error(`請先到「渲染圖設置」確認單品圖：${unconfirmed.map(product => product.name).join('、')}`);
  return zone.products.map(product => ({ ...product, image: references[product.id] }));
}

export async function generateZoneLayoutImage(plan: QuoteFloorPlan, zone: LayoutZone, quoteUuid: string | null) {
  const { generateQuoteReferenceImage } = await import('./quotePhotoLibrary');
  const source = plan.previewUrl || (plan.mimeType.startsWith('image/') ? plan.url : '');
  if (!source) throw new Error('請先上傳平面圖');
  if (!zone.products.length) throw new Error('此分區尚未有報價產品');
  const zoneRegions = plan.regions.filter(region => region.zoneId === zone.id).map(region => region.rect);
  const regionBounds = presentationZoneBounds(zoneRegions);
  if (!regionBounds) throw new Error('此分區尚未框選平面圖範圍，請先到分區管理設定');
  // Include walls and door swings just beyond a tightly drawn zone rectangle.
  const marginX = Math.max(1, regionBounds.w * 0.12);
  const marginY = Math.max(1, regionBounds.h * 0.12);
  const left = Math.max(0, regionBounds.x - marginX), top = Math.max(0, regionBounds.y - marginY);
  const bounds = { x: left, y: top, w: Math.min(100, regionBounds.x + regionBounds.w + marginX) - left, h: Math.min(100, regionBounds.y + regionBounds.h + marginY) - top };
  const missing = zone.products.filter(product => {
    const count = Math.max(0, Math.floor(product.quantity));
    const assigned = plan.placements?.assignments[product.id] || [];
    const positions = plan.placements?.positions[zone.id] || [];
    return count > 0 && assigned.slice(0, count).filter(id => id && positions.some(position => position.id === id && zoneRegions.some(rect => position.x >= rect.x && position.x <= rect.x + rect.w && position.y >= rect.y && position.y <= rect.y + rect.h))).length < count;
  });
  if (missing.length) throw new Error(`請先為以下產品選擇分區範圍內的全部擺放位置：${missing.map(product => product.name).join('、')}`);
  const renderProducts = confirmedLayoutProducts(zone, plan.rendering?.productImages);
  const response = await fetch(source);
  if (!response.ok) throw new Error('無法讀取平面圖，請稍後重試');
  const cropped = await cropPresentationFloorPlan(await response.blob(), [{ name: zone.name, rect: bounds }]);
  const zoneImage = cropped.zones[0]?.imageUrl;
  if (!zoneImage) throw new Error('無法裁切分區平面圖，請稍後重試');
  const notes = plan.rendering?.notes[zone.id];
  const sheet = await productSheet([{ ...zone, products: renderProducts }]);
  const localPositions = zone.products.map(product => ({
    productId: product.id,
    name: product.name,
    quantity: Math.max(0, Math.floor(product.quantity)),
    dimensionsMm: { length: product.dimensionLMm, width: product.dimensionWMm, height: product.dimensionHMm },
    material: product.material,
    color: product.color,
    positions: (plan.placements?.assignments[product.id] || []).slice(0, Math.max(0, Math.floor(product.quantity))).flatMap(id => {
      const position = plan.placements?.positions[zone.id]?.find(item => item.id === id);
      return position ? [{
        instanceId: `${product.id}:${id}`,
        x: (position.x - bounds.x) / bounds.w * 100,
        y: (position.y - bounds.y) / bounds.h * 100,
        angle: position.angle,
        ...(position.rect ? { footprint: {
          x: (position.rect.x - bounds.x) / bounds.w * 100,
          y: (position.rect.y - bounds.y) / bounds.h * 100,
          w: position.rect.w / bounds.w * 100,
          h: position.rect.h / bounds.h * 100,
        } } : {}),
      }] : [];
    }),
  }));
  const localRegions = zoneRegions.map(rect => ({ x: (rect.x - bounds.x) / bounds.w * 100, y: (rect.y - bounds.y) / bounds.h * 100, w: rect.w / bounds.w * 100, h: rect.h / bounds.h * 100 }));
  const prompt = [
    `第一張圖是分區「${zone.name}」及周邊的局部平面圖，第二張是帶產品id的產品圖集。只生成此分區的一張室內平視透視圖。`,
    '以下規則是本次生成的具體約束。優先順序：已確認產品清單和位置決定傢俬數量及布局；平面圖決定牆體、門窗及出入口；報價明確填寫的尺寸、材質和顏色優先於產品圖片；未填寫的外觀細節才參考對應產品圖。裝修風格不得改變產品或布局。',
    `所有座標統一為第一張局部圖百分比，左上(0,0)、右下(100,100)，圖上方為0度，順時針。目標分區範圍：${JSON.stringify(localRegions)}。範圍外只供辨認牆體和門窗，不生成鄰區傢俬。`,
    `唯一傢俬清單（dimensionsMm為長寬高毫米；footprint為平面佔地框；positions每筆代表一件實物）：${JSON.stringify(localPositions)}`,
    '每個positions實例只生成一次，不能新增清單外的實物。未分配位置必須保持空白，不能為對稱、美觀或常見會議室配置補椅子；桌端沒有椅子位置就保持無椅。不要把一張桌子當成包含配套椅子的套餐。',
    '第二張每格僅以標註id對應的單件產品為外觀參考。即使圖片是場景照，也只取該產品的輪廓、桌面、腳架、扶手、靠背等結構；圖內其他桌椅、裝飾、牆體、門窗、鏡頭和布局全部忽略。不得用場景中的其他傢俬替代指定產品。圖集及平面圖不可成為牆上掛畫。',
    '先依第一張圖辨認目標房間的真實門洞與相連空間，保留所在牆面、相對位置及開向。選擇能展示圖中已確認出入口及主要傢俬的斜向鏡頭；不可為拍攝方便移門、封門、新增門洞或移動傢俬。若透視遮擋，優先調整鏡頭，不改布局；圖中未能確認的門窗不可憑空補出。',
    'angle為null表示未確認朝向，並非0度；有清楚平面符號時沿用符號，否則不得宣稱朝向已確認。未知尺寸不可自行標成實測尺寸。保持產品結構及比例，不鏡像、不合併。',
    `全案裝修及照明風格（僅作用於非產品部分）：${plan.rendering?.style || DEFAULT_LAYOUT_STYLE}`,
    ...(notes?.trim() ? [`輔助識別文字，座標沿用原圖、不能用作本局部圖定位；若與上述清單或平面圖衝突則忽略：${notes}`] : []),
    '輸出前核對各產品數量、桌端空位、產品款式及門洞位置。只輸出效果圖，無人、無文字。',
  ].join('\n');
  if (prompt.length > 16000) throw new Error('布局資料過長，請縮短分區描述');
  return generateQuoteReferenceImage({ purpose: 'quote_layout', model: 'gemini', quoteUuid, aspectRatio: '16:9', prompt, referenceUrls: [zoneImage, sheet] });
}
