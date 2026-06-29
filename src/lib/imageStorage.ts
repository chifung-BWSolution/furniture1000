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
const UPLOAD_MAX_RETRIES = 3;
const UPLOAD_RETRY_BASE_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildStoragePublicUrl(filePath: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  if (data?.publicUrl) return data.publicUrl;
  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${filePath}`;
}

/** Never persist base64 blobs in Postgres — they blow up list queries and time out upserts. */
export function stripBase64ForDb(value: string | null | undefined): string {
  if (!value) return '';
  return isBase64Image(value) ? '' : value;
}

export function isHttpImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('http://') || value.startsWith('https://');
}

/** True if a string is a base64 image data-URL (or a raw base64 blob) that needs uploading. */
export function isBase64Image(value: string | null | undefined): boolean {
  if (!value) return false;
  if (isHttpImageUrl(value)) return false;
  return value.startsWith('data:image') || /^[A-Za-z0-9+/]{100}/.test(value);
}

async function uploadWithRetry(
  filePath: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ error: { message: string } | null }> {
  let lastErr: { message: string } | null = null;
  for (let attempt = 0; attempt < UPLOAD_MAX_RETRIES; attempt++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, bytes, { contentType: mimeType, upsert: true });
    if (!error) return { error: null };
    lastErr = error;
    if (attempt < UPLOAD_MAX_RETRIES - 1) {
      await sleep(UPLOAD_RETRY_BASE_MS * (attempt + 1));
    }
  }
  return { error: lastErr };
}

async function uploadBase64BlobToStorage(
  base64: string,
  productId: string,
  suffix: string,
): Promise<string> {
  const mimeMatch = base64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

  const rand = Math.floor(performance.now() * 1000) % 100000;
  const filePath = `products/${productId}_${suffix}_${Date.now()}_${rand}.${ext}`;

  let bytes: Uint8Array;
  try {
    const binaryStr = atob(base64Data);
    bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  } catch (e) {
    throw e instanceof Error ? e : new Error('base64 decode failed');
  }

  const { error } = await uploadWithRetry(filePath, bytes, mimeType);
  if (error) {
    throw new Error(error.message);
  }

  return buildStoragePublicUrl(filePath);
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

  try {
    return await uploadBase64BlobToStorage(base64, productId, suffix);
  } catch (e) {
    console.warn('[imageStorage] storage upload error:', e instanceof Error ? e.message : e);
    return base64;
  }
}

/**
 * In-place-safe batch resolver for product rows about to be upserted.
 *
 * For each row, uploads any base64 `image_url` / `image_url_2` / `image_url_3`
 * to Storage and replaces the field with the public URL. Rows are processed
 * with bounded concurrency so a large import doesn't fire hundreds of parallel
 * Storage uploads. Returns NEW row objects (does not mutate the inputs). Any row
 * whose upload fails keeps its original base64 value (non-destructive).
 *
 * Each row must have an `id` (used as the Storage path prefix).
 */
export async function resolveRowsImagesToStorage<
  T extends { id: string },
>(rows: T[], concurrency = 2): Promise<T[]> {
  const out: T[] = new Array(rows.length);
  let cursor = 0;
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  async function worker() {
    while (cursor < rows.length) {
      const i = cursor++;
      const row = rows[i] as T & {
        image_url?: unknown; image_url_2?: unknown; image_url_3?: unknown;
      };
      const v1 = asStr(row.image_url), v2 = asStr(row.image_url_2), v3 = asStr(row.image_url_3);
      const u1 = v1 ? await uploadBase64Image(v1, row.id, 'primary') : (row.image_url ?? null);
      const u2 = v2 ? await uploadBase64Image(v2, row.id, 'extra0') : (row.image_url_2 ?? null);
      const u3 = v3 ? await uploadBase64Image(v3, row.id, 'extra1') : (row.image_url_3 ?? null);
      out[i] = {
        ...row,
        image_url: isBase64Image(String(u1 ?? '')) ? '' : u1,
        image_url_2: isBase64Image(String(u2 ?? '')) ? null : u2,
        image_url_3: isBase64Image(String(u3 ?? '')) ? null : u3,
      };
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()),
  );
  return out;
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
  concurrency = 2,
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

/**
 * Resolve RTS image_url + images[] for ready_to_shopify writes.
 * Tries Storage upload first; on failure keeps base64 so migrate-rts-images cron
 * can convert later. Never strips base64 — that was the bug that dropped images.
 */
export async function resolveRtsImageFieldsForDb(
  productId: string,
  primary: string | null | undefined,
  imagesJson: { src: string; position?: number; alt?: string }[] | null | undefined,
): Promise<{ image_url: string | null; images: { src: string; position?: number }[] | null }> {
  const resolvedPrimary = primary?.trim()
    ? (await uploadBase64Image(primary, productId, 'primary')) || null
    : null;

  const srcList = (imagesJson ?? []).map((im) => im.src).filter(Boolean);
  const { extras } = await resolveImagesToStorage(productId, null, srcList);
  const images = extras
    .filter(Boolean)
    .map((src, idx) => ({ src, position: idx + 1 }));

  return {
    image_url: resolvedPrimary,
    images: images.length > 0 ? images : null,
  };
}

/** True when any RTS image field is still base64 and awaiting migrate-rts-images cron. */
export function rtsImagesPendingMigration(row: {
  image_url?: string | null;
  images?: { src?: string }[] | null;
}): boolean {
  if (isBase64Image(row.image_url)) return true;
  return (row.images ?? []).some((im) => isBase64Image(im.src));
}
