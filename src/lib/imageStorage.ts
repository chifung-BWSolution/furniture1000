import { supabase } from './supabase';

// Shared Supabase Storage helpers for product images.
//
// WHY: base64 data-URLs must never be persisted into the database. The products
// / ready_to_shopify tables hold image columns; storing ~1MB base64 strings
// there bloats list queries and was the root cause of the Supabase "unhealthy"
// state. Every write path that may receive a pasted/cropped/imported image must
// upload it to Storage FIRST and persist only the returned public URL.
// See memory: products-heavy-images-column.

const BUCKET = 'product-images';

/** True if a string is a base64 image data-URL (or a raw base64 blob) that needs uploading. */
export function isBase64Image(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  return value.startsWith('data:image') || /^[A-Za-z0-9+/]{100}/.test(value);
}

/**
 * Upload a single base64 (or data-URL) image to Storage and return its public URL.
 * If the input is already an HTTP(S) URL, or not a base64 image, it is returned
 * unchanged. On upload failure the original string is returned (non-destructive),
 * so callers never lose the image — they just keep the base64 fallback.
 */
export async function uploadBase64Image(
  base64: string,
  productId: string,
  suffix: string,
): Promise<string> {
  if (!isBase64Image(base64)) return base64;

  const mimeMatch = base64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

  // Unique-ish path: id + suffix + time. Random tail avoids collisions when a
  // batch uploads several images within the same millisecond.
  const rand = Math.floor(performance.now() * 1000) % 100000;
  const filePath = `products/${productId}_${suffix}_${Date.now()}_${rand}.${ext}`;

  let bytes: Uint8Array;
  try {
    const binaryStr = atob(base64Data);
    bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  } catch (e) {
    console.warn('[imageStorage] base64 decode failed:', e);
    return base64;
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, bytes, { contentType: mimeType, upsert: true });
  if (error) {
    console.warn('[imageStorage] storage upload error:', error.message);
    return base64; // non-destructive fallback
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data.publicUrl || base64;
}

/**
 * Resolve a primary image + an array of extra images, uploading any base64 entries
 * to Storage. Returns HTTP URLs (or the original strings on failure). Extra images
 * are uploaded with a bounded concurrency to avoid hammering the Storage pool.
 */
export async function resolveImagesToStorage(
  productId: string,
  primary: string | null | undefined,
  extras: string[] = [],
  concurrency = 3,
): Promise<{ primary: string | null; extras: string[] }> {
  const resolvedPrimary = primary
    ? await uploadBase64Image(primary, productId, 'primary')
    : null;

  const resolvedExtras: string[] = new Array(extras.length);
  let cursor = 0;
  async function worker() {
    while (cursor < extras.length) {
      const i = cursor++;
      resolvedExtras[i] = await uploadBase64Image(extras[i], productId, `extra${i}`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, extras.length) }, () => worker()),
  );

  return { primary: resolvedPrimary, extras: resolvedExtras };
}
