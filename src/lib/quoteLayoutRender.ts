import { supabase } from './supabase';
import { DEFAULT_GEMINI_MODEL } from './geminiModel';
import { imageBlobToJpegBase64, type QuoteFloorPlan, type QuoteZoneRect } from './quoteFloorPlan';
import { uploadBase64Image } from './imageStorage';
import { cropPresentationFloorPlan, presentationZoneBounds } from './presentationFloorPlan';

export type LayoutProduct = { productId?: string | null; id: string; name: string; category?: string; sku?: string; image: string; quantity: number; material?: string; color?: string; dimensionLMm?: string | null; dimensionWMm?: string | null; dimensionHMm?: string | null; isSectionTitle?: boolean; isCustomTerm?: boolean; isOptional?: boolean };
export type LayoutZone = { id: string; name: string; products: LayoutProduct[] };
/**
 * AI 對照結果分三級：
 * - issues：數量、位置、朝向、門洞或產品款式明顯不符，需要修正；
 * - minor：材質色差、光影、細節等小問題，可直接忽略通過；
 * - uncertain：遮擋或相機方向不明，AI 不猜測，交由人工核對。
 */
export type LayoutReview = { issues: string[]; minor: string[]; uncertain: string[] };
/** AI 生圖進度：percent 0–100，label 是當前階段的中文說明。 */
export type LayoutRenderProgress = { percent: number; label: string };
export type LayoutRenderProgressHandler = (progress: LayoutRenderProgress) => void;
/**
 * 重新生成的依據：上一次生成的效果圖（第三張參考圖）＋用戶填寫的修改意見。
 * 意見只能用來修正已存在的差異，不是新增傢俬、改數量或改門窗的授權。
 */
export type LayoutRenderRevision = { previousImageUrl?: string; feedback?: string; /** 重新生成時沿用同一個區域，意見才對得上同一間房。 */ areaIndex?: number; /** 自動修正：差異由系統按對照結果產生，可按清單修正數量、位置及門洞。 */ autoFix?: boolean };

/**
 * 生圖只有單一 HTTP 請求，後端沒有逐秒進度，所以用時間估算往前推，
 * 最多推到區間上限（完成時由呼叫方再報 100）。放慢曲線令長任務不會卡在 89% 不動。
 */
function estimateProgress(from: number, to: number, expectedMs: number, report: (percent: number) => void) {
  const started = Date.now();
  const timer = window.setInterval(() => {
    const ratio = Math.min(1, (Date.now() - started) / expectedMs);
    report(from + (to - from) * (1 - Math.exp(-2 * ratio)));
  }, 600);
  return () => window.clearInterval(timer);
}

async function reviewLayoutImage(planUrl: string, renderUrl: string, productUrl: string, inventory: unknown): Promise<LayoutReview | null> {
  try {
    const responses = await Promise.all([fetch(planUrl), fetch(renderUrl), fetch(productUrl)]);
    if (responses.some(response => !response.ok)) return null;
    const images = await Promise.all(responses.map(async response => imageBlobToJpegBase64(await response.blob())));
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supabase-functions-gemini-proxy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ model: DEFAULT_GEMINI_MODEL, feature: 'quote_floor_plan_zones', contents: [{ parts: [
        { text: `第一張為局部分區平面圖，第二張為生成的透視圖，第三張為產品圖集。按已確認傢俬清單比較數量、相對位置、門洞及產品外觀：${JSON.stringify(inventory)}。透視遮擋或相機方向不明時，不要猜測，列入 uncertain。影響傢俬數量、位置、朝向、門洞或出入口、產品款式及結構的差異列入 issues；材質色差、光影、地板牆面等裝飾細節、輕微比例或輕微遮擋等不影響使用的列入 minor。只回 JSON：{"issues":["明顯差異"],"minor":["可忽略的小問題"],"uncertain":["需要人工確認的項目"]}。不要聲稱已精確驗證。` },
        ...images.map(image => ({ inlineData: { mimeType: 'image/jpeg', data: image } })),
      ] }] }), signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const text = String(body?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.issues) || !Array.isArray(parsed.uncertain)) return null;
    const clean = (values: unknown[]) => values.filter((value): value is string => typeof value === 'string' && !!value.trim()).slice(0, 8).map(value => value.trim().slice(0, 200));
    return { issues: clean(parsed.issues), minor: Array.isArray(parsed.minor) ? clean(parsed.minor) : [], uncertain: clean(parsed.uncertain) };
  } catch { return null; }
}
/**
 * 同一分區可能圈了多間互不相連的房（例如 4 間 MANAGER ROOM）。
 * 重疊或幾乎相接的矩形當作同一間房，其餘各自成一個候選區域。
 */
export function groupZoneRects(rects: QuoteZoneRect[]): QuoteZoneRect[][] {
  const touching = (a: QuoteZoneRect, b: QuoteZoneRect) => {
    const gap = 0.2;
    return a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
  };
  const groups: QuoteZoneRect[][] = [];
  const remaining = [...rects];
  while (remaining.length) {
    const group = [remaining.shift() as QuoteZoneRect];
    for (let index = 0; index < group.length; index += 1) {
      const current = group[index];
      for (let other = remaining.length - 1; other >= 0; other -= 1) {
        if (!touching(current, remaining[other])) continue;
        group.push(...remaining.splice(other, 1));
      }
    }
    groups.push(group);
  }
  return groups;
}

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
    ] }] }), signal: AbortSignal.timeout(150000),
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
    ctx.font = '12px sans-serif';
    ctx.fillText(`L ${p.dimensionLMm || '?'} × W ${p.dimensionWMm || '?'} × H ${p.dimensionHMm || '?'} mm`, x + 8, y + 334, 384);
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

export async function generateZoneLayoutImage(
  plan: QuoteFloorPlan,
  zone: LayoutZone,
  quoteUuid: string | null,
  /** 生圖是長時間單一請求，用這個回報目前階段，讓介面顯示進度條。 */
  onProgress?: LayoutRenderProgressHandler,
  /** 重新生成時帶入上一張效果圖及修改意見；第一次生成留空。 */
  revision?: LayoutRenderRevision,
) {
  let lastPercent = 0;
  const report = (percent: number, label: string) => {
    // 生圖期間同時有時間估算和真實階段回報，只准前進，避免進度條倒退。
    const next = Math.max(lastPercent, Math.max(0, Math.min(100, Math.round(percent))));
    lastPercent = next;
    onProgress?.({ percent: next, label });
  };
  report(4, '檢查分區、產品與擺放位置');
  const { generateQuoteReferenceImage } = await import('./quotePhotoLibrary');
  const source = plan.previewUrl || (plan.mimeType.startsWith('image/') ? plan.url : '');
  if (!source) throw new Error('請先上傳平面圖');
  if (!zone.products.length) throw new Error('此分區尚未有報價產品');
  const zoneRegions = plan.regions.filter(region => region.zoneId === zone.id).map(region => region.rect);
  const regionBounds = presentationZoneBounds(zoneRegions);
  if (!regionBounds) throw new Error('此分區尚未框選平面圖範圍，請先到分區管理設定');
  const missing = zone.products.flatMap(product => {
    const count = Math.max(0, Math.floor(product.quantity));
    const assigned = plan.placements?.assignments[product.id] || [];
    const positions = plan.placements?.positions[zone.id] || [];
    const selected = assigned.slice(0, count).filter(id => id && positions.some(position => position.id === id && zoneRegions.some(rect => position.x >= rect.x && position.x <= rect.x + rect.w && position.y >= rect.y && position.y <= rect.y + rect.h))).length;
    return selected < count ? [`${product.name}：已選分區內位置 ${selected} 件／分區報價 ${count} 件，尚差 ${count - selected} 件`] : [];
  });
  if (missing.length) throw new Error(`擺放位置數量不符，請到平面圖為產品補選位置或修改分區報價數量：${missing.join('；')}`);
  // 一個分區可能圈了幾間互不相連的房：一張透視圖放不進整塊 bounding box，
  // 所以隨機抽一間有傢俬的區域生成（每次只生成其中一處）。
  const zonePositions = plan.placements?.positions[zone.id] || [];
  const assignedPositionIds = new Set(Object.values(plan.placements?.assignments || {}).flat().filter(Boolean));
  const insideRect = (rect: QuoteZoneRect, point: { x: number; y: number }) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
  const areaGroups = groupZoneRects(zoneRegions);
  const furnishedAreas = areaGroups.filter(group => zonePositions.some(position => assignedPositionIds.has(position.id) && group.some(rect => insideRect(rect, position))));
  const areaCandidates = furnishedAreas.length ? furnishedAreas : areaGroups;
  // 重新生成時沿用上次的區域，其他情況才隨機抽一處。
  const preferredArea = typeof revision?.areaIndex === 'number' ? revision.areaIndex : -1;
  const areaIndex = preferredArea >= 0 && preferredArea < areaGroups.length
    ? preferredArea
    : Math.max(0, areaGroups.indexOf(areaCandidates[Math.floor(Math.random() * areaCandidates.length)]));
  const chosenAreas = areaGroups[areaIndex] || zoneRegions;
  const areaBounds = presentationZoneBounds(chosenAreas) || regionBounds;
  // Include walls and door swings just beyond a tightly drawn zone rectangle.
  const marginX = Math.max(1, areaBounds.w * 0.12);
  const marginY = Math.max(1, areaBounds.h * 0.12);
  const left = Math.max(0, areaBounds.x - marginX), top = Math.max(0, areaBounds.y - marginY);
  const bounds = { x: left, y: top, w: Math.min(100, areaBounds.x + areaBounds.w + marginX) - left, h: Math.min(100, areaBounds.y + areaBounds.h + marginY) - top };
  report(10, `自動挑選產品圖片（${zone.products.length} 件）`);
  const { automaticLayoutProducts, renderDimensionConstraints } = await import('./quoteRenderProductImages');
  // 個別產品要走去背時可能花一兩分鐘，除了真實件數也用時間估算補住進度。
  let productLabel = `自動挑選產品圖片（${zone.products.length} 件）`;
  const stopPreparing = estimateProgress(12, 38, 90_000, percent => report(percent, productLabel));
  let renderProducts: LayoutProduct[];
  try {
    renderProducts = await automaticLayoutProducts(zone.products, quoteUuid, ({ done, total, name }) => {
      const ratio = total > 0 ? done / total : 1;
      productLabel = done >= total ? '產品圖片已備妥' : `自動挑選產品圖片 ${done}/${total}：${name}`;
      report(12 + ratio * 26, productLabel);
    });
  } finally {
    stopPreparing();
  }
  report(42, '讀取並裁切分區平面圖');
  const response = await fetch(source);
  if (!response.ok) throw new Error('無法讀取平面圖，請稍後重試');
  const cropped = await cropPresentationFloorPlan(await response.blob(), [{ name: zone.name, rect: bounds }]);
  const zoneImage = cropped.zones[0]?.imageUrl;
  if (!zoneImage) throw new Error('無法裁切分區平面圖，請稍後重試');
  const notes = plan.rendering?.notes[zone.id];
  // 只保留所選區域內的實例；其他區域的傢俬不列入這張圖，避免 AI 把別區產品搬進來。
  const areaPositions = zonePositions.filter(position => chosenAreas.some(rect => insideRect(rect, position)));
  const areaPositionById = new Map(areaPositions.map(position => [position.id, position]));
  const localPositions = renderProducts.flatMap(product => {
    const instances = (plan.placements?.assignments[product.id] || []).slice(0, Math.max(0, Math.floor(product.quantity))).flatMap(id => {
      const position = areaPositionById.get(id);
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
    });
    return instances.length ? [{
      productId: product.id,
      name: product.name,
      quantity: instances.length,
      dimensionsMm: renderDimensionConstraints(product),
      material: product.material,
      color: product.color,
      positions: instances,
    }] : [];
  });
  report(47, '組合產品參考圖集');
  const areaProductIds = new Set(localPositions.map(product => product.productId));
  const areaProducts = renderProducts.filter(product => areaProductIds.has(product.id));
  const sheet = await productSheet([{ ...zone, products: areaProducts.length ? areaProducts : renderProducts }]);
  const localRegions = chosenAreas.map(rect => ({ x: (rect.x - bounds.x) / bounds.w * 100, y: (rect.y - bounds.y) / bounds.h * 100, w: rect.w / bounds.w * 100, h: rect.h / bounds.h * 100 }));
  // 重新生成：第三張參考圖是上一版效果圖，只作修訂基礎，不能當成新增傢俬或改動佈局的依據。
  const previousImageUrl = (revision?.previousImageUrl || '').trim();
  const feedback = (revision?.feedback || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const areaLabel = areaGroups.length > 1 ? `第 ${areaIndex + 1} 個區域（此分區在平面圖上共有 ${areaGroups.length} 個互不相連的區域，本次只生成這一個）` : '及周邊';
  const prompt = [
    `第一張圖是分區「${zone.name}」${areaLabel}的局部平面圖，第二張是帶產品id的產品圖集。只生成一張室內平視透視圖。`,
    ...(areaGroups.length > 1 ? ['只生成框選的這個區域：不要把同一分區其他區域的房間或傢俬併入同一張圖，也不要自行換成另一個區域。'] : []),
    '以下規則是本次生成的具體約束。優先順序：已確認產品清單和位置決定傢俬數量及布局；平面圖決定牆體、門窗及出入口；報價明確填寫的尺寸、材質和顏色優先於產品圖片；未填寫的外觀細節才參考對應產品圖。裝修風格不得改變產品或布局。',
    `所有座標統一為第一張局部圖百分比，左上(0,0)、右下(100,100)，圖上方為0度，順時針。目標分區範圍：${JSON.stringify(localRegions)}。範圍外只供辨認牆體和門窗，不生成鄰區傢俬。`,
    ...(previousImageUrl ? [revision?.autoFix
      ? `第三張是同一分區上一次生成的效果圖，本次只做對照後的修正：保留鏡頭方向、風格、光影及已符合平面圖的佈局，不要整體重畫。按第一張平面圖及已確認傢俬清單修正以下差異（可依清單加減、移位、改朝向或修正門洞，令成品與平面圖及清單完全一致），但不可加入清單以外的傢俬或改動牆體：${feedback}`
      : `第三張是同一分區上一次生成的效果圖，只作本次修訂基礎：保留其中鏡頭方向、風格、光影及已符合平面圖的佈局，不要整體重畫。${feedback ? `用戶修改意見（只可修正下列項目；不可當成新增傢俬、加減數量、改動門窗或改變佈局的授權）：${feedback}` : '用戶未填寫修改意見，只修正明顯遮擋、比例及光影問題，佈局保持不變。'}`] : []),
    `唯一傢俬清單（dimensionsMm為長寬高毫米；footprint為平面佔地框；positions每筆代表一件實物）：${JSON.stringify(localPositions)}`,
    '每個positions實例只生成一次，不能新增清單外的實物。未分配位置必須保持空白，不能為對稱、美觀或常見會議室配置補椅子；桌端沒有椅子位置就保持無椅。不要把一張桌子當成包含配套椅子的套餐。',
    '第二張每格僅以標註id對應的單件產品為外觀參考。即使圖片是場景照，也只取該產品的輪廓、桌面、腳架、扶手、靠背等結構；圖內其他桌椅、裝飾、牆體、門窗、鏡頭和布局全部忽略。不得用場景中的其他傢俬替代指定產品。圖集及平面圖不可成為牆上掛畫。',
    '先依第一張圖辨認目標房間的真實門洞與相連空間，保留所在牆面、相對位置及開向。選擇能展示圖中已確認出入口及主要傢俬的斜向鏡頭；不可為拍攝方便移門、封門、新增門洞或移動傢俬。若透視遮擋，優先調整鏡頭，不改布局；圖中未能確認的門窗不可憑空補出。',
    '尺寸約束：每件產品依dimensionsMm的length、width、height毫米及proportions比例建立體積。長寬是產品本身的平面軸，高度是由地面向上的軸，旋轉擺放不交換長寬高。不得為填滿圈選框、配合鏡頭或讓產品放得下而拉伸、壓扁、縮窄或任意縮放；圈選框僅作擺位參考，不能覆蓋實際尺寸。桌椅及櫃體之間按已知毫米尺寸保持相對尺度；透視只改投影，不能改產品幾何比例。若空間不足，調整鏡頭而不是改尺寸或移動傢俬。缺少尺寸的軸保持參考圖比例，不虛構數值。',
    'angle為null表示未確認朝向，並非0度；有清楚平面符號時沿用符號，否則不得宣稱朝向已確認。未知尺寸不可自行標成實測尺寸。保持產品結構及比例，不鏡像、不合併。',
    `全案裝修及照明風格（僅作用於非產品部分）：${plan.rendering?.style || DEFAULT_LAYOUT_STYLE}`,
    ...(notes?.trim() ? [`輔助識別文字，座標沿用原圖、不能用作本局部圖定位；若與上述清單或平面圖衝突則忽略：${notes}`] : []),
    '輸出前核對各產品數量、桌端空位、產品款式及門洞位置。只輸出效果圖，無人、無文字。',
  ].join('\n');
  if (prompt.length > 16000) throw new Error('布局資料過長，請縮短分區描述');
  report(54, 'AI 正在生成透視圖');
  const stopGenerating = estimateProgress(54, 90, 90_000, percent => report(percent, 'AI 正在生成透視圖'));
  let asset: Awaited<ReturnType<typeof generateQuoteReferenceImage>>;
  try {
    asset = await generateQuoteReferenceImage({ purpose: 'quote_layout', model: 'grok', quoteUuid, aspectRatio: '16:9', prompt, referenceUrls: [zoneImage, sheet, ...(previousImageUrl ? [previousImageUrl] : [])] });
  } finally {
    stopGenerating();
  }
  report(92, 'AI 正在對照平面圖與成品');
  const stopReviewing = estimateProgress(92, 99, 30_000, percent => report(percent, 'AI 正在對照平面圖與成品'));
  let review: LayoutReview | null;
  try {
    review = await reviewLayoutImage(zoneImage, asset.url, sheet, localPositions);
  } finally {
    stopReviewing();
  }
  report(100, '完成');
  return { asset, zoneImage, review, area: { index: areaIndex + 1, total: areaGroups.length } };
}
