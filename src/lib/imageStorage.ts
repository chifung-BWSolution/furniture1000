import { supabase } from './supabase';

// Product images are stored ONLY as Supabase Storage public HTTP URLs in Postgres.
// Never persist base64 / data-URL strings — they blow up list queries and cause 500s.

const BUCKET = 'product-images';
const UPLOAD_MAX_RETRIES = 3;
const UPLOAD_RETRY_BASE_MS = 800;
const DEFAULT_MAX_DIM = 1200;
const DEFAULT_JPEG_QUALITY = 0.92;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildStoragePublicUrl(filePath: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  if (data?.publicUrl) return data.publicUrl;
  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${filePath}`;
}

function storagePath(productId: string, suffix: string, ext: string): string {
  const rand = Math.floor(performance.now() * 1000) % 100000;
  return `products/${productId}_${suffix}_${Date.now()}_${rand}.${ext}`;
}

/** Never persist base64 blobs in Postgres. */
export function stripBase64ForDb(value: string | null | undefined): string {
  if (!value) return '';
  return isBase64Image(value) ? '' : value;
}

export function isHttpImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('http://') || value.startsWith('https://');
}

/** DB image columns must be Storage/public HTTP URLs only — never base64 or blobs. */
export function httpOnlyImageForDb(value: string | null | undefined): string | null {
  const s = (value || '').trim();
  if (!s) return null;
  return isHttpImageUrl(s) ? s : null;
}

/** True when any image field is non-empty but not yet an HTTP URL (upload failed or skipped). */
export function productImageFieldsPendingStorage(row: {
  image_url?: unknown;
  image_url_2?: unknown;
  image_url_3?: unknown;
  lifestyle_image_url?: unknown;
}): boolean {
  const fields = [row.image_url, row.image_url_2, row.image_url_3, row.lifestyle_image_url];
  return fields.some((v) => typeof v === 'string' && v.trim() !== '' && !isHttpImageUrl(v));
}

/** PDF catalog import uses tiny SVG placeholders — not real product photos. */
export function isSvgPlaceholder(value: string | null | undefined): boolean {
  return !!value && value.startsWith('data:image/svg+xml');
}

/** True if a string is a base64 image data-URL (or a raw base64 blob). */
export function isBase64Image(value: string | null | undefined): boolean {
  if (!value) return false;
  if (isHttpImageUrl(value)) return false;
  if (isSvgPlaceholder(value)) return false;
  return value.startsWith('data:image') || /^[A-Za-z0-9+/]{100}/.test(value);
}

function extFromMime(mimeType: string): string {
  return mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
}

function dataUrlToBlob(dataUrl: string): Blob {
  const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function uploadWithRetry(
  filePath: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ error: { message: string; statusCode?: string } | null }> {
  let lastErr: { message: string; statusCode?: string } | null = null;
  for (let attempt = 0; attempt < UPLOAD_MAX_RETRIES; attempt++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, bytes, { contentType: mimeType, upsert: true });
    if (!error) return { error: null };
    lastErr = error;
    const status = String((error as { statusCode?: string }).statusCode ?? '');
    if (status.startsWith('4')) return { error: lastErr };
    if (attempt < UPLOAD_MAX_RETRIES - 1) {
      await sleep(UPLOAD_RETRY_BASE_MS * (attempt + 1));
    }
  }
  return { error: lastErr };
}

/** Resize image file/blob to max dimensions; returns JPEG blob (no data-URL). */
export async function resizeImageToBlob(
  file: File | Blob,
  maxDim = DEFAULT_MAX_DIM,
  quality = DEFAULT_JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height / width) * maxDim);
          width = maxDim;
        } else {
          width = Math.round((width / height) * maxDim);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('image encode failed'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

/** Upload a File/Blob directly to Storage; returns public HTTP URL. */
export async function uploadFileToStorage(
  file: File | Blob,
  productId: string,
  suffix: string,
  options?: { resize?: boolean },
): Promise<string> {
  const shouldResize = options?.resize !== false;
  const blob = shouldResize ? await resizeImageToBlob(file) : file;
  const mimeType = blob.type || 'image/jpeg';
  const ext = extFromMime(mimeType);
  const filePath = storagePath(productId, suffix, ext);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { error } = await uploadWithRetry(filePath, bytes, mimeType);
  if (error) throw new Error(error.message);
  return buildStoragePublicUrl(filePath);
}

function designProjectStoragePath(
  projectId: string,
  suffix: string,
  ext: string,
): string {
  const safeId =
    projectId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'project';
  const rand = Math.floor(performance.now() * 1000) % 100000;
  return `design-projects/${safeId}/${suffix}_${Date.now()}_${rand}.${ext}`;
}

/**
 * Upload a design-project floor plan (JPG/PNG/WebP/PDF) to Storage.
 * Images are resized to JPEG; PDFs are stored as-is. Returns public HTTP URL.
 */
export async function uploadProjectFloorPlanFile(
  projectId: string,
  file: File,
): Promise<{ url: string; mimeType: string; fileName: string }> {
  const lowerName = file.name.toLowerCase();
  const isPdf =
    file.type === 'application/pdf' || lowerName.endsWith('.pdf');
  const isImage =
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp)$/i.test(lowerName);

  if (!isPdf && !isImage) {
    throw new Error('只支援 PDF / JPG / PNG / WebP');
  }

  const blob = isImage ? await resizeImageToBlob(file) : file;
  const mimeType = isPdf
    ? 'application/pdf'
    : blob.type || 'image/jpeg';
  const ext = isPdf ? 'pdf' : extFromMime(mimeType);
  const filePath = designProjectStoragePath(projectId, 'floor-plan', ext);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { error } = await uploadWithRetry(filePath, bytes, mimeType);
  if (error) throw new Error(error.message);
  return {
    url: buildStoragePublicUrl(filePath),
    mimeType,
    fileName: file.name,
  };
}

/** Upload a JPEG preview rendered from a PDF floor plan. */
export async function uploadProjectFloorPlanPreview(
  projectId: string,
  blob: Blob,
): Promise<string> {
  const mimeType = blob.type || 'image/jpeg';
  const ext = extFromMime(mimeType);
  const filePath = designProjectStoragePath(
    projectId,
    'floor-plan-preview',
    ext,
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { error } = await uploadWithRetry(filePath, bytes, mimeType);
  if (error) throw new Error(error.message);
  return buildStoragePublicUrl(filePath);
}

/** Upload blob bytes to Storage; returns public HTTP URL. */
export async function uploadBlobToStorage(
  blob: Blob,
  productId: string,
  suffix: string,
): Promise<string> {
  const mimeType = blob.type || 'image/jpeg';
  const ext = extFromMime(mimeType);
  const filePath = storagePath(productId, suffix, ext);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { error } = await uploadWithRetry(filePath, bytes, mimeType);
  if (error) throw new Error(error.message);
  return buildStoragePublicUrl(filePath);
}

/**
 * Ensure a value is an HTTP Storage URL.
 * HTTP URLs pass through; data-URLs are decoded in-memory and uploaded (never returned as base64).
 */
export async function uploadImageSourceToStorage(
  source: string,
  productId: string,
  suffix: string,
): Promise<string | null> {
  if (!source?.trim()) return null;
  if (isHttpImageUrl(source)) return source;
  if (!isBase64Image(source)) return null;
  const blob = dataUrlToBlob(source);
  return uploadBlobToStorage(blob, productId, suffix);
}

/** @deprecated Use uploadFileToStorage or uploadImageSourceToStorage. Kept for legacy call sites. */
export async function uploadBase64Image(
  base64: string,
  productId: string,
  suffix: string,
): Promise<string> {
  const url = await uploadImageSourceToStorage(base64, productId, suffix);
  if (!url) throw new Error('image upload failed');
  return url;
}

type ImageRow = {
  id: string;
  image_url?: unknown;
  image_url_2?: unknown;
  image_url_3?: unknown;
  lifestyle_image_url?: unknown;
};

async function resolveRowImageFields<T extends ImageRow>(row: T): Promise<T> {
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  const v1 = asStr(row.image_url);
  const v2 = asStr(row.image_url_2);
  const v3 = asStr(row.image_url_3);
  const vLife = asStr(row.lifestyle_image_url);

  const [u1, u2, u3, uLife] = await Promise.all([
    v1 ? uploadImageSourceToStorage(v1, row.id, 'primary') : Promise.resolve(row.image_url ?? null),
    v2 ? uploadImageSourceToStorage(v2, row.id, 'extra0') : Promise.resolve(row.image_url_2 ?? null),
    v3 ? uploadImageSourceToStorage(v3, row.id, 'extra1') : Promise.resolve(row.image_url_3 ?? null),
    vLife ? uploadImageSourceToStorage(vLife, row.id, 'lifestyle') : Promise.resolve(row.lifestyle_image_url ?? null),
  ]);

  return {
    ...row,
    image_url: httpOnlyImageForDb(String(u1 ?? '')),
    image_url_2: httpOnlyImageForDb(String(u2 ?? '')),
    image_url_3: httpOnlyImageForDb(String(u3 ?? '')),
    lifestyle_image_url: httpOnlyImageForDb(String(uLife ?? '')),
  } as T;
}

/** Upload any image fields on product rows before DB upsert. Never writes base64 to output. */
export async function resolveRowsImagesToStorage<
  T extends { id: string },
>(rows: T[], concurrency = 3): Promise<T[]> {
  const out: T[] = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const i = cursor++;
      out[i] = await resolveRowImageFields(rows[i] as T & ImageRow);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()),
  );
  return out;
}

/** Resolve a primary image + extra image URLs before DB upsert (catalog → RTS sync). */
export async function resolveImagesToStorage(
  productId: string,
  primary: string | null,
  extraInputs: string[],
): Promise<{ primary: string | null; extras: string[] }> {
  const resolvedPrimary = primary?.trim()
    ? await uploadImageSourceToStorage(primary.trim(), productId, 'primary')
    : null;

  const resolvedExtras = (await Promise.all(
    extraInputs.map((src, idx) => uploadImageSourceToStorage(src, productId, `extra${idx}`)),
  )).filter((src): src is string => Boolean(src));

  return { primary: resolvedPrimary, extras: resolvedExtras };
}

/** Resolve RTS image_url + images[] — all entries must be Storage URLs (no base64). */
export async function resolveRtsImageFieldsForDb(
  productId: string,
  primary: string | null | undefined,
  imagesJson: { src: string; position?: number; alt?: string }[] | null | undefined,
): Promise<{ image_url: string | null; images: { src: string; position?: number }[] | null }> {
  const resolvedPrimary = primary?.trim()
    ? await uploadImageSourceToStorage(primary.trim(), productId, 'primary')
    : null;

  const srcList = (imagesJson ?? []).map((im) => im.src).filter(Boolean);
  const resolvedExtras = await Promise.all(
    srcList.map((src, idx) => uploadImageSourceToStorage(src, productId, `extra${idx}`)),
  );

  const images = resolvedExtras
    .filter((src): src is string => Boolean(src))
    .map((src, idx) => ({ src, position: idx + 1 }));

  return {
    image_url: resolvedPrimary,
    images: images.length > 0 ? images : null,
  };
}

/** True when source had an image but resolved row has no HTTP URL (upload failed). */
export function productImageUploadFailed(
  source: {
    image_url?: unknown;
    image_url_2?: unknown;
    image_url_3?: unknown;
    lifestyle_image_url?: unknown;
  },
  resolved: {
    image_url?: unknown;
    image_url_2?: unknown;
    image_url_3?: unknown;
    lifestyle_image_url?: unknown;
  },
): boolean {
  const keys = ['image_url', 'image_url_2', 'image_url_3', 'lifestyle_image_url'] as const;
  for (const key of keys) {
    const src = typeof source[key] === 'string' ? source[key].trim() : '';
    const out = typeof resolved[key] === 'string' ? resolved[key].trim() : '';
    if (src && !isHttpImageUrl(out)) return true;
  }
  return false;
}

const IMAGE_FIELD_LABELS: Record<string, string> = {
  image_url: '主圖 (image_url)',
  image_url_2: '產品圖片2 (image_url_2)',
  image_url_3: '產品圖片3 (image_url_3)',
  lifestyle_image_url: '效果圖 (lifestyle_image_url)',
};

/** Human-readable reasons when image upload to Storage did not produce HTTP URLs. */
export function describeProductImageUploadFailures(
  source: {
    image_url?: unknown;
    image_url_2?: unknown;
    image_url_3?: unknown;
    lifestyle_image_url?: unknown;
  },
  resolved: {
    image_url?: unknown;
    image_url_2?: unknown;
    image_url_3?: unknown;
    lifestyle_image_url?: unknown;
  },
): string[] {
  const reasons: string[] = [];
  const keys = ['image_url', 'image_url_2', 'image_url_3', 'lifestyle_image_url'] as const;
  for (const key of keys) {
    const src = typeof source[key] === 'string' ? source[key].trim() : '';
    const out = typeof resolved[key] === 'string' ? resolved[key].trim() : '';
    if (src && !isHttpImageUrl(out)) {
      const kind = src.startsWith('data:') ? 'base64 嵌入圖' : src.slice(0, 48);
      reasons.push(`${IMAGE_FIELD_LABELS[key]}：未能上傳至 Storage（${kind}${src.length > 48 ? '…' : ''}）`);
    }
  }
  return reasons;
}

/** Upload row images with retries; re-reads from sourceRows each attempt for failed rows. */
export async function resolveRowsImagesToStorageWithRetry<
  T extends { id: string } & ImageRow,
>(
  sourceRows: T[],
  options?: { maxAttempts?: number; concurrency?: number; onRetry?: (attempt: number, pendingCount: number) => void },
): Promise<{
  resolved: T[];
  failed: Array<{ index: number; reasons: string[] }>;
}> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const concurrency = options?.concurrency ?? 4;
  let resolved = await resolveRowsImagesToStorage(sourceRows, concurrency);

  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    const pendingIndices = sourceRows
      .map((_, i) => i)
      .filter((i) => productImageUploadFailed(sourceRows[i], resolved[i]));
    if (pendingIndices.length === 0) break;

    options?.onRetry?.(attempt, pendingIndices.length);
    const retried = await resolveRowsImagesToStorage(
      pendingIndices.map((i) => sourceRows[i]),
      concurrency,
    );
    for (let j = 0; j < pendingIndices.length; j++) {
      resolved[pendingIndices[j]] = retried[j];
    }
  }

  const failed = sourceRows
    .map((source, index) => ({
      index,
      reasons: describeProductImageUploadFailures(source, resolved[index]),
    }))
    .filter((f) => f.reasons.length > 0);

  return { resolved, failed };
}

/** @deprecated Legacy rows only — new uploads go straight to Storage. */
export function rtsImagesPendingMigration(row: {
  image_url?: string | null;
  images?: { src?: string }[] | null;
}): boolean {
  if (isBase64Image(row.image_url)) return true;
  return (row.images ?? []).some((im) => isBase64Image(im.src));
}
