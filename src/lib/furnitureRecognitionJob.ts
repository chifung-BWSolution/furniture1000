import { uploadFileToStorage } from '@/lib/imageStorage';
import { supabase } from '@/lib/supabase';

const SLUGS = ['supabase-functions-generate-furniture-model', 'generate-furniture-model'] as const;

export type FurnitureRecognitionStatus = {
  jobId: string | null;
  status: 'none' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  target: 'skp' | 'fbx' | null;
  error: string | null;
  result: Record<string, unknown> | null;
  imageUrls: string[];
  productScope: 'single' | 'arrangement' | null;
  productCount: number | null;
};

const EMPTY_STATUS: FurnitureRecognitionStatus = {
  jobId: null,
  status: 'none',
  target: null,
  error: null,
  result: null,
  imageUrls: [],
  productScope: null,
  productCount: null,
};

function asStatus(data: unknown): FurnitureRecognitionStatus {
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const status = row.status;
  const known = status === 'queued' || status === 'running' || status === 'succeeded' || status === 'failed' || status === 'cancelled';
  if (!known) return EMPTY_STATUS;
  const target = row.target === 'skp' || row.target === 'fbx' ? row.target : null;
  const scope = row.productScope === 'single' || row.productScope === 'arrangement' ? row.productScope : null;
  const count = typeof row.productCount === 'number' && Number.isInteger(row.productCount) ? row.productCount : null;
  const urls = Array.isArray(row.imageUrls) ? row.imageUrls.filter((url): url is string => typeof url === 'string') : [];
  return {
    jobId: typeof row.jobId === 'string' ? row.jobId : null,
    status,
    target,
    error: typeof row.error === 'string' ? row.error : null,
    result: row.result && typeof row.result === 'object' ? row.result as Record<string, unknown> : null,
    imageUrls: urls,
    productScope: scope,
    productCount: count,
  };
}

export async function fetchFurnitureRecognition(productId: string): Promise<FurnitureRecognitionStatus> {
  const { data, error } = await supabase.rpc('fds_furniture_recognition_status', { p_product_id: productId });
  if (error) throw new Error(error.message);
  return asStatus(data);
}

export async function enqueueFurnitureRecognition(input: {
  productId: string;
  target: 'skp' | 'fbx';
  imageUrls: string[];
  title: string;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  productScope?: 'single' | 'arrangement' | null;
  productCount?: number | null;
}): Promise<{ jobId: string; alreadyQueued: boolean }> {
  const { data, error } = await supabase.rpc('fds_furniture_recognition_enqueue', {
    p_product_id: input.productId,
    p_target: input.target,
    p_image_urls: input.imageUrls,
    p_title: input.title,
    p_width_mm: input.widthMm,
    p_depth_mm: input.depthMm,
    p_height_mm: input.heightMm,
    p_product_scope: input.productScope ?? null,
    p_product_count: input.productCount ?? null,
  });
  if (error) throw new Error(error.message);
  const row = (data && typeof data === 'object' ? data : {}) as { jobId?: string; alreadyQueued?: boolean };
  if (!row.jobId) throw new Error('無法排入辨認');
  return { jobId: row.jobId, alreadyQueued: row.alreadyQueued === true };
}

export async function acknowledgeFurnitureRecognition(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('fds_furniture_recognition_ack', { p_job_id: jobId });
  if (error) throw new Error(error.message);
}

export async function cancelFurnitureRecognition(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('fds_furniture_recognition_cancel', { p_job_id: jobId });
  if (error) throw new Error(error.message);
}

/** Start the worker without waiting for Gemini. Cron retries the job if this call is lost. */
export function kickFurnitureRecognition(jobId: string): void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!supabaseUrl || !anonKey) return;
  void supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token ?? anonKey;
    for (const slug of SLUGS) {
      void fetch(`${supabaseUrl}/functions/v1/${slug}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ job_id: jobId }),
        keepalive: true,
      }).then((res) => {
        if (res.status !== 404) return;
      }).catch(() => undefined);
    }
  });
}

/** Catalog URLs pass through. Local supplement files are uploaded before the job can see them. */
export async function collectRecognitionUrls(productId: string, photos: (string | File)[]): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const src of photos) {
    const url = typeof src === 'string' ? src : await uploadFileToStorage(src, productId, 'recognition');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length === 6) break;
  }
  return urls;
}
