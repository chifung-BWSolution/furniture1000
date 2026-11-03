import { fetchProductDetail, type ProductDetail } from './productSearch';
import { generateQuoteReferenceImage } from './quotePhotoLibrary';
import type { LayoutProduct } from './quoteLayoutRender';

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

/** 白底／透明底是像素問題，不需要 AI：縮到 64×64，只看外框一圈。 */
const PLAIN_BG_SIZE = 64;
/** 邊框至少 90% 像素要是近白或透明，才當作純色背景。 */
const PLAIN_BG_MIN_RATIO = 0.9;

/** 純函式，方便測試：外框像素是否為近白或透明。 */
export function plainBackground(pixels: Uint8ClampedArray, width: number, height: number): boolean {
  if (width < 4 || height < 4 || pixels.length < width * height * 4) return false;
  let sampled = 0;
  let plain = 0;
  for (let y = 0; y < height; y += 1) {
    const edgeRow = y < 2 || y >= height - 2;
    for (let x = 0; x < width; x += 1) {
      if (!edgeRow && x >= 2 && x < width - 2) continue;
      const i = (y * width + x) * 4;
      sampled += 1;
      if (pixels[i + 3] < 16) { plain += 1; continue; }
      const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (min >= 236 && max - min <= 12) plain += 1;
    }
  }
  return sampled > 0 && plain / sampled >= PLAIN_BG_MIN_RATIO;
}

/** 下載圖片並在本地判斷背景，通常幾百毫秒，無 AI、無費用。 */
async function plainPhotoAt(url: string): Promise<'plain' | 'other' | 'error'> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return 'error';
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement('canvas');
      canvas.width = PLAIN_BG_SIZE;
      canvas.height = PLAIN_BG_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return 'error';
      ctx.drawImage(bitmap, 0, 0, PLAIN_BG_SIZE, PLAIN_BG_SIZE);
      const { data } = ctx.getImageData(0, 0, PLAIN_BG_SIZE, PLAIN_BG_SIZE);
      return plainBackground(data, PLAIN_BG_SIZE, PLAIN_BG_SIZE) ? 'plain' : 'other';
    } finally {
      bitmap.close();
    }
  } catch {
    return 'error';
  }
}

/** Catalog image order: the main image first, then the gallery images from the second one onward. */
export function renderReferenceImages(detail: Partial<ProductDetail> | null, product: Pick<LayoutProduct, 'image'>): string[] {
  return [...new Set([...(detail?.images || []), ...(detail?.image_urls || []), detail?.image_url, product.image].filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)))];
}

async function selectProductImage(product: LayoutProduct, quoteUuid: string | null, detail: ProductDetail | null): Promise<string> {
  // Reuse the detail RPC; never scan the heavy products.images column in a list.
  const urls = renderReferenceImages(detail, product);
  if (!urls.length) throw new Error(`${product.name}沒有可用的產品圖片`);
  // 參考圖一律只用產品主圖（第一張）：圖集第二張起的場景照不再固定被選中。
  const [mainImage] = urls;
  const fingerprint = JSON.stringify({ version: 4, dimensions: renderDimensionConstraints(product), urls: [mainImage], name: product.name, sku: product.sku, color: product.color, material: product.material });
  const key = 'fds-render-single:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  try { const cached = localStorage.getItem(key); if (cached && /^https?:\/\//i.test(cached)) return cached; } catch { /* Storage unavailable: continue normally. */ }
  const run = async () => {
    // 主圖本身已是白底／透明底就直接用。
    const verdict = await plainPhotoAt(mainImage);
    if (verdict === 'plain') return mainImage;
    if (verdict === 'error') throw new Error(`${product.name}主圖讀取失敗，請重試`);
    // 只有主圖不是白底時才去背，並用本地判斷驗收。
    const cutout = await generateQuoteReferenceImage({ purpose: 'presentation_product', model: 'grok', quoteUuid, aspectRatio: '1:1', referenceUrls: [mainImage], prompt: `只提取圖片中一件「${product.name.slice(0, 100)}」主體，移除房間背景及其他傢俬、配件，放在純白背景。這是產品去背，不是設計新產品：保留原有輪廓、材質、顏色、桌面、腳架及細節，不補造被遮擋結構，不增加椅子。產品尺寸約束：${JSON.stringify(renderDimensionConstraints(product))}。鎖定長寬高比例，僅移除背景，不拉伸或壓扁產品，不交換長寬高軸。缺少的尺寸不得補造。不改視角，不輸出文字。` });
    if (await plainPhotoAt(cutout.url) !== 'plain') throw new Error(`${product.name}去背結果不是純色背景，請重試`);
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

export async function automaticLayoutProducts(
  products: LayoutProduct[],
  quoteUuid: string | null,
  /** Reports how many products already have a confirmed single-item photo. */
  onProgress?: (progress: { done: number; total: number; name: string }) => void,
): Promise<LayoutProduct[]> {
  const selected: LayoutProduct[] = [];
  // Bound memory/provider concurrency when a zone contains many gallery images.
  for (const [index, product] of products.entries()) {
    onProgress?.({ done: index, total: products.length, name: product.name });
    const detail = product.productId ? await fetchProductDetail(product.productId) : null;
    const resolved = resolveRenderDimensions(product, detail);
    selected.push({ ...resolved, image: await selectProductImage(resolved, quoteUuid, detail) });
    onProgress?.({ done: index + 1, total: products.length, name: product.name });
  }
  return selected;
}
