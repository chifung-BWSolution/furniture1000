import { supabase } from './supabase';
import { DEFAULT_GEMINI_MODEL } from './geminiModel';
import { fetchProductDetail, type ProductDetail } from './productSearch';
import { imageBlobToJpegBase64 } from './quoteFloorPlan';
import { generateQuoteReferenceImage } from './quotePhotoLibrary';
import type { LayoutProduct } from './quoteLayoutRender';

type Photo = { url: string; data: string };
type Verdict = { index: number; matches: boolean; single: boolean; plain: boolean; complete: boolean };
const pending = new Map<string, Promise<string>>();

/** Quote variant dimensions win. Fill gaps only when catalog dimensions agree with the quote. */
export function resolveRenderDimensions(product: LayoutProduct, detail: Partial<ProductDetail> | null): LayoutProduct {
  const parse = (value: unknown): string | null => {
    if (value == null || String(value).trim() === '') return null;
    const raw = String(value).trim();
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) <= 0) throw new Error(`${product.name}長寬高必須為大於0的毫米數值，請檢查產品尺寸`);
    return String(Number(raw));
  };
  const quote = [product.dimensionLMm, product.dimensionWMm, product.dimensionHMm].map(parse);
  const catalog = [detail?.dimension_l_mm, detail?.dimension_w_mm, detail?.dimension_h_mm].map(value => {
    const number = Number(value);
    return value != null && Number.isFinite(number) && number > 0 ? String(number) : null;
  });
  const compatible = quote.every((value, index) => value === null || (catalog[index] !== null && Number(value) === Number(catalog[index])));
  const dims = quote.map((value, index) => value ?? (compatible ? catalog[index] : null));
  return { ...product, dimensionLMm: dims[0], dimensionWMm: dims[1], dimensionHMm: dims[2] };
}

export function renderDimensionConstraints(product: LayoutProduct) {
  const length = product.dimensionLMm ? Number(product.dimensionLMm) : null;
  const width = product.dimensionWMm ? Number(product.dimensionWMm) : null;
  const height = product.dimensionHMm ? Number(product.dimensionHMm) : null;
  return { unit: 'mm', length, width, height,
    proportions: { lengthToWidth: length && width ? length / width : null, lengthToHeight: length && height ? length / height : null, widthToHeight: width && height ? width / height : null } };
}

/** Require a matching, complete single item; white/transparent pixels alone are insufficient. */
export function suitableProductPhoto(value: unknown, count: number): number | null {
  if (!Array.isArray(value)) throw new Error('產品圖片判斷結果無效，請重試');
  const rows = value as Verdict[];
  const eligible = rows.filter(row => Number.isInteger(row?.index) && row.index >= 0 && row.index < count && row.matches === true && row.single === true && row.plain === true && row.complete === true);
  return eligible[0]?.index ?? null;
}

async function inspectPhotos(photos: Photo[], product: LayoutProduct): Promise<Verdict[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('請先登入');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supabase-functions-gemini-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ model: DEFAULT_GEMINI_MODEL, feature: 'quote_product_reference_selection', contents: [{ parts: [
      { text: `判斷各張圖片是否適合用作此產品的單品外觀參考。產品：${JSON.stringify({ name: product.name, sku: product.sku, material: product.material, color: product.color, dimensions: renderDimensionConstraints(product) })}。尺寸為毫米，長寬高為產品局部軸，不能交換軸或把透視縮短誤當尺寸變化。有明確尺寸標註與要求不符的型號或規格不能選；沒有標註時依可見結構及比例判斷，不可宣稱量測精確。圖片從0開始編號。matches只在確認款式與明確指定的顏色材質相符時為true；single只在圖片僅有一件目標傢俬、沒有配套桌椅或其他物件時為true；plain只在白底、透明底或無場景的純色背景時為true；complete只在傢俬完整可見、沒有截斷或遮擋時為true。房間場景圖即使牆壁是白色也不是plain。圖冊拼圖、多視角拼圖或多件產品不是single。不確定填false。每張必須回一筆，依適用程度排序。只回JSON：{"photos":[{"index":0,"matches":true,"single":true,"plain":true,"complete":true}]}` },
      ...photos.flatMap((photo, index) => [{ text: `圖片${index}` }, { inlineData: { mimeType: 'image/jpeg', data: photo.data } }]),
    ] }] }), signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error('產品圖片自動判斷失敗，請重試');
  const body = await response.json();
  const raw = body?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(parsed.photos) || parsed.photos.length !== photos.length || new Set(parsed.photos.map((row: Verdict) => row.index)).size !== photos.length || parsed.photos.some((row: Verdict) => !Number.isInteger(row.index) || row.index < 0 || row.index >= photos.length || ['matches', 'single', 'plain', 'complete'].some(key => typeof (row as unknown as Record<string, unknown>)[key] !== 'boolean'))) throw new Error('產品圖片判斷結果無效，請重試');
  return parsed.photos;
}

async function loadPhoto(url: string): Promise<Photo> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('無法讀取產品圖片');
  return { url, data: await imageBlobToJpegBase64(await response.blob(), 1000) };
}

async function selectProductImage(product: LayoutProduct, quoteUuid: string | null, detail: ProductDetail | null): Promise<string> {
  // Reuse the detail RPC; never scan the heavy products.images column in a list.
  const urls = [...new Set([...(detail?.images || []), ...(detail?.image_urls || []), detail?.image_url, product.image].filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)))];
  if (!urls.length) throw new Error(`${product.name}沒有可用的產品圖片`);
  const fingerprint = JSON.stringify({ version: 2, dimensions: renderDimensionConstraints(product), urls, name: product.name, sku: product.sku, color: product.color, material: product.material });
  const key = 'fds-render-single:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  try { const cached = localStorage.getItem(key); if (cached && /^https?:\/\//i.test(cached)) return cached; } catch { /* Storage unavailable: continue normally. */ }
  const run = async () => {
    let source: string | undefined;
    let unreadable = false;
    for (let offset = 0; offset < urls.length; offset += 6) {
      const results = await Promise.allSettled(urls.slice(offset, offset + 6).map(loadPhoto));
      unreadable ||= results.some(result => result.status === 'rejected');
      const photos = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (!photos.length) continue;
      const verdicts = await inspectPhotos(photos, product);
      const selected = suitableProductPhoto(verdicts, photos.length);
      if (selected !== null) return photos[selected].url;
      const candidate = verdicts.find(row => row.matches && row.complete);
      if (!source && candidate) source = photos[candidate.index].url;
    }
    if (unreadable) throw new Error(`${product.name}部分圖片讀取失敗，請重試；暫不自動去背`);
    if (!source) throw new Error(`${product.name}沒有可確認款式且完整可見的圖片，暫不能生成`);
    // Only after every existing gallery image was checked, use the existing image-edit service.
    const cutout = await generateQuoteReferenceImage({ purpose: 'presentation_product', model: 'gemini', quoteUuid, aspectRatio: '1:1', referenceUrls: [source], prompt: `只提取圖片中一件「${product.name.slice(0, 100)}」主體，移除房間背景及其他傢俬、配件，放在純白背景。這是產品去背，不是設計新產品：保留原有輪廓、材質、顏色、桌面、腳架及細節，不補造被遮擋結構，不增加椅子。產品尺寸約束：${JSON.stringify(renderDimensionConstraints(product))}。鎖定長寬高比例，僅移除背景，不拉伸或壓扁產品，不交換長寬高軸。缺少的尺寸不得補造。不改視角，不輸出文字。` });
    const checked = await inspectPhotos([await loadPhoto(cutout.url)], product);
    if (suitableProductPhoto(checked, 1) === null) throw new Error(`${product.name}去背結果未能確認為完整單品，請重試`);
    return cutout.url;
  };
  let job = pending.get(key);
  if (!job) { job = run(); pending.set(key, job); }
  try {
    const url = await job;
    try { localStorage.setItem(key, url); } catch { /* Selected URL remains usable for this session. */ }
    return url;
  } finally { pending.delete(key); }
}

export async function automaticLayoutProducts(products: LayoutProduct[], quoteUuid: string | null): Promise<LayoutProduct[]> {
  const selected: LayoutProduct[] = [];
  // Bound memory/provider concurrency when a zone contains many gallery images.
  for (const product of products) {
    const detail = product.productId ? await fetchProductDetail(product.productId) : null;
    const resolved = resolveRenderDimensions(product, detail);
    selected.push({ ...resolved, image: await selectProductImage(resolved, quoteUuid, detail) });
  }
  return selected;
}
