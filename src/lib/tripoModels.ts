import { supabase } from '@/lib/supabase';
import { invokeEdgeFunctionDirect } from '@/lib/invokeEdgeFunction';

export interface TripoJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  error: string | null;
  result: { credits_consumed?: number; storage_path?: string } | null;
}

export function tripoActive(job: TripoJob | null): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

export function tripoErrorLabel(error: string): string {
  return /代碼 2010|API 點數不足/.test(error)
    ? 'Tripo API 點數不足，請在開發者平台充值 API 點數；Studio 點數不通用。充值後可重新手動試生成。'
    : error;
}

export async function fetchTripoJob(productId: string): Promise<TripoJob | null> {
  const { data, error } = await supabase.from('processing_jobs')
    .select('id,status,progress,error,result')
    .eq('job_type', 'generate_tripo').eq('payload->>product_id', productId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as TripoJob | null;
}

/** The existing worker and cron keep processing even after the page closes. */
export function wakeModelWorker(): void {
  void invokeEdgeFunctionDirect('supabase-functions-process-jobs', { source: 'tripo-trial' }, { timeoutMs: 150_000 })
    .catch(() => undefined);
}

/** Existing product photo, so the user can skip uploading a duplicate file. */
export async function fetchProductImage(url: string): Promise<Blob> {
  let response: Response;
  try { response = await fetch(url); }
  catch { throw new Error('讀不到這張產品原圖，請改為上載圖片'); }
  if (!response.ok) throw new Error('讀不到這張產品原圖，請改為上載圖片');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('這張產品原圖不是圖片格式，請改為上載圖片');
  return blob;
}

/** Accepts an upload or a product photo fetched with `fetchProductImage`. */
export async function prepareTripoImage(source: Blob | File): Promise<Blob> {
  if (source.type && !source.type.startsWith('image/')) throw new Error('請選擇 JPG、PNG 或 WebP 圖片');
  if (source.size > 20 * 1024 * 1024) throw new Error('圖片不能超過 20MB');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(source); }
  catch { throw new Error('無法讀取這張圖片，請改用 JPG、PNG 或 WebP'); }
  try {
    if (Math.min(bitmap.width, bitmap.height) < 256) throw new Error('圖片的闊和高都需要至少 256 像素');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法處理圖片');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('無法處理圖片')), 'image/jpeg', 0.92,
    ));
  } finally { bitmap.close(); }
}

export async function requestTripoModel(productId: string, image: Blob, requestId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('請先登入');
  const path = `tripo-inputs/${auth.user.id}/${requestId}.jpg`;
  const { error: uploadError } = await supabase.storage.from('product-models').upload(path, image, { contentType: 'image/jpeg', upsert: false });
  if (uploadError && !/exists|duplicate/i.test(uploadError.message)) throw new Error(uploadError.message);
  const { error } = await supabase.rpc('fds_request_tripo_model', {
    p_product_id: productId, p_reference_path: path, p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  wakeModelWorker();
}
