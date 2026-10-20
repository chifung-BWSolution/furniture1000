// ============================================================================
// 產品模型檔（D-5 SU／D-6 3D／F-AI-008）
// SKP 給設計師的 SU，GLB 給 3D 預覽，FBX 給其他 3D 軟件。
// 檔案在私有 bucket product-models，只經 fds_* RPC 讀寫，下載用 5 分鐘簽名 URL。
// ============================================================================
import { supabase } from '@/lib/supabase';

export const PRODUCT_MODELS_BUCKET = 'product-models';
export const PRODUCT_MODEL_MAX_BYTES = 100 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

export type ModelFormat = 'skp' | 'glb' | 'fbx';

export interface ProductModelFile {
  id: string;
  model_type: 'su' | '3d';
  format: ModelFormat;
  source: 'uploaded' | 'generated';
  storage_path: string;
  file_name: string | null;
  size_bytes: number | null;
  created_at: string;
}

export type ModelFlags = Record<string, { su: boolean; '3d': boolean }>;

export type SkpStatus =
  | { status: 'none' }
  | { status: 'ready'; storage_path: string; size_bytes: number | null; file_name: string | null }
  | {
      status: 'queued' | 'running' | 'failed' | 'cancelled' | 'succeeded';
      job_id: string;
      attempts: number;
      error: string | null;
      created_at: string;
    };

function modelError(message: string): string {
  if (message.includes('permission_denied')) return '沒有權限';
  if (message.includes('product_not_found')) return '找不到產品';
  if (message.includes('model_not_found')) return '找不到模型';
  if (message.includes('format_invalid')) return '只接受 .skp、.glb 或 .fbx';
  if (message.includes('storage_object_missing')) return '檔案未上載成功';
  if (message.includes('storage_path_invalid')) return '模型路徑不正確';
  return message;
}

export function modelFormatOf(fileName: string): ModelFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'skp' || ext === 'glb' || ext === 'fbx' ? ext : null;
}

export async function fetchProductModels(productId: string): Promise<ProductModelFile[]> {
  const { data, error } = await supabase.rpc('fds_product_models', { p_product_id: productId });
  if (error) throw new Error(modelError(error.message));
  return (data ?? []) as ProductModelFile[];
}

export async function fetchModelFlags(productIds: string[]): Promise<ModelFlags> {
  if (productIds.length === 0) return {};
  const { data, error } = await supabase.rpc('fds_product_model_flags', { p_product_ids: productIds });
  if (error) throw new Error(modelError(error.message));
  return (data ?? {}) as ModelFlags;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadProductModel(productId: string, file: File): Promise<void> {
  const format = modelFormatOf(file.name);
  if (!format) throw new Error('只接受 .skp、.glb 或 .fbx');
  if (file.size > PRODUCT_MODEL_MAX_BYTES) throw new Error('檔案超過 100MB');
  const path = `uploaded/${productId}/${await sha256Hex(file)}.${format}`;
  const upload = await supabase.storage.from(PRODUCT_MODELS_BUCKET).upload(path, file, {
    contentType: format === 'glb' ? 'model/gltf-binary' : 'application/octet-stream',
    upsert: false,
  });
  if (upload.error && !/exists|duplicate/i.test(upload.error.message)) throw new Error(upload.error.message);
  const { error } = await supabase.rpc('fds_product_model_register', {
    p_product_id: productId,
    p_storage_path: path,
    p_file_name: file.name,
  });
  if (error) throw new Error(modelError(error.message));
}

export async function deleteProductModel(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('fds_product_model_delete', { p_id: id });
  if (error) throw new Error(modelError(error.message));
  const path = (data as { storage_path?: string } | null)?.storage_path;
  if (path) await supabase.storage.from(PRODUCT_MODELS_BUCKET).remove([path]);
}

export async function downloadModel(storagePath: string, fileName?: string | null): Promise<void> {
  const { data, error } = await supabase.storage
    .from(PRODUCT_MODELS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: fileName || true });
  if (error || !data?.signedUrl) throw new Error(error?.message ?? '無法產生下載連結');
  const link = document.createElement('a');
  link.href = data.signedUrl;
  link.click();
}

/** Preview URL, not a download. Expires with the same short TTL as a download link. */
export async function signedModelUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PRODUCT_MODELS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? '無法開啟模型');
  return data.signedUrl;
}

/** Browser-built GLB or FBX, stored on the parametric model's product. */
export async function registerGeneratedFile(
  furnitureModelId: string,
  blob: Blob,
  fileName: string,
  format: 'glb' | 'fbx',
): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const path = `generated/${furnitureModelId.toLowerCase()}/${hash}.${format}`;
  const upload = await supabase.storage.from(PRODUCT_MODELS_BUCKET).upload(path, blob, {
    contentType: format === 'glb' ? 'model/gltf-binary' : 'application/octet-stream',
    upsert: false,
  });
  if (upload.error && !/exists|duplicate/i.test(upload.error.message)) {
    throw new Error(upload.error.message);
  }
  const { error } = await supabase.rpc('fds_product_model_register_generated', {
    p_furniture_model_id: furnitureModelId,
    p_storage_path: path,
    p_file_name: fileName,
  });
  if (error) throw new Error(modelError(error.message));
}

export async function registerGeneratedGlb(
  furnitureModelId: string,
  blob: Blob,
  fileName: string,
): Promise<void> {
  return registerGeneratedFile(furnitureModelId, blob, fileName, 'glb');
}

export async function requestSkp(furnitureModelId: string): Promise<SkpStatus> {
  const { data, error } = await supabase.rpc('fds_request_skp', { p_furniture_model_id: furnitureModelId });
  if (error) throw new Error(modelError(error.message));
  return data as SkpStatus;
}

export async function fetchSkpStatus(furnitureModelId: string): Promise<SkpStatus> {
  const { data, error } = await supabase.rpc('fds_skp_status', { p_furniture_model_id: furnitureModelId });
  if (error) throw new Error(modelError(error.message));
  return data as SkpStatus;
}
