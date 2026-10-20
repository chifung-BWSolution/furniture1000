import { supabase } from '@/lib/supabase';
import { invokeEdgeFunctionDirect } from '@/lib/invokeEdgeFunction';
import { materialTermsForTags } from '@/constants/material-tags';
import { expandColorFilters, splitColorTerms, type SearchFilters, type SearchProduct } from '@/lib/productSearch';

export interface ImageSearchResult {
  indexed: number;
  items: SearchProduct[];
}

export interface EmbeddingStatus {
  with_image: number;
  indexed: number;
  can_index: boolean;
}

function num(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

async function call(slug: string, body: unknown) {
  let result = await invokeEdgeFunctionDirect(slug, body, { timeoutMs: 90_000 });
  if (result.status === 404) {
    const bare = slug.replace(/^supabase-functions-/, '');
    result = await invokeEdgeFunctionDirect(bare, body, { timeoutMs: 90_000 });
  }
  return result;
}

/** Shrink a photo before it leaves the browser. The embedding model only needs a clear view. */
async function fileToJpeg(file: File): Promise<{ base64: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const max = 768;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法讀取圖片');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('圖片壓縮失敗'))), 'image/jpeg', 0.82);
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { base64: btoa(binary), mime: 'image/jpeg' };
}

export async function searchByImage(file: File, filters: SearchFilters): Promise<ImageSearchResult> {
  const image = await fileToJpeg(file);
  const { text, colors: queryColors } = splitColorTerms(filters.query);
  const colors = expandColorFilters([...filters.colors, ...queryColors]);
  const materials = materialTermsForTags(filters.materialTags);
  const { data, error } = await call('supabase-functions-search-by-image', {
    image_base64: image.base64,
    mime_type: image.mime,
    filters: {
      factory: filters.factory || null,
      level1: filters.level1 || null,
      level2: filters.level2 || null,
      colors,
      materials,
      price_min: num(filters.priceMin),
      price_max: num(filters.priceMax),
      l_min: num(filters.lMin),
      l_max: num(filters.lMax),
      w_min: num(filters.wMin),
      w_max: num(filters.wMax),
      h_min: num(filters.hMin),
      h_max: num(filters.hMax),
      in_stock: filters.inStock || null,
      scope: filters.scope,
      text: text || null,
    },
  });
  if (error || !data) throw new Error(error?.message ?? '以圖搜款失敗');
  const payload = data as unknown as ImageSearchResult;
  return {
    indexed: Number(payload.indexed ?? 0),
    items: (payload.items ?? []).map((item) => ({ ...item, relation: 'similar' as const, exact: false })),
  };
}

export async function fetchEmbeddingStatus(): Promise<EmbeddingStatus> {
  const { data, error } = await supabase.rpc('fds_embedding_status');
  if (error) throw new Error(error.message);
  return data as EmbeddingStatus;
}

export async function startImageIndex(): Promise<{ indexed: number; remaining: boolean }> {
  const { data, error } = await call('supabase-functions-embed-products', { source: 'ui' });
  if (error || !data) throw new Error(error?.message ?? '無法開始索引');
  const payload = data as { indexed?: number; remaining?: boolean };
  return { indexed: Number(payload.indexed ?? 0), remaining: payload.remaining === true };
}
