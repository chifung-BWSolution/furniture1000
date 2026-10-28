import { supabase } from '@/lib/supabase';
import type { ParametricModel } from '@/lib/furnitureParametric';
import type { EvidenceStatus } from '@/lib/modelEvidence';
import type { SkpStatus } from '@/lib/productModels';

export type QualityStatus = 'unreviewed' | 'draft' | 'pending_review' | 'accepted' | 'rejected';

/** 「預覽可用」「SKP 可用」「已驗收」互相獨立；舊模型沒有驗收證據時顯示未驗收。 */
export const QUALITY_LABEL: Record<QualityStatus, string> = {
  unreviewed: '未驗收',
  draft: '估算草稿',
  pending_review: '待驗收',
  accepted: '已驗收',
  rejected: '驗收不通過',
};

export interface FurnitureModelVersion {
  id: string;
  parent_id: string | null;
  kind: string;
  width_mm: number | null;
  depth_mm: number | null;
  height_mm: number | null;
  estimated: boolean;
  quality_status: QualityStatus;
  engine_version: string | null;
  params_hash: string | null;
  review: { decision?: string; note?: string; reviewer_staff_id?: string } | null;
  reviewed_at: string | null;
  created_at: string;
  dimensions: { key: string; label: string; status: EvidenceStatus | null; critical: boolean | null }[];
  files: { id: string; format: string; storage_path: string; file_name: string | null; size_bytes: number | null }[];
  skp: SkpStatus | null;
}

export interface FurnitureModelDetail {
  id: string;
  product_id: string | null;
  parent_id: string | null;
  kind: string;
  parametric: ParametricModel;
  quality_status: QualityStatus;
  params_hash: string | null;
  engine_version: string | null;
  review: FurnitureModelVersion['review'];
  reviewed_at: string | null;
  created_at: string;
}

const qualityOf = (value: unknown): QualityStatus =>
  typeof value === 'string' && value in QUALITY_LABEL ? (value as QualityStatus) : 'unreviewed';

export async function fetchFurnitureModelVersions(productId: string): Promise<FurnitureModelVersion[]> {
  const { data, error } = await supabase.rpc('fds_furniture_model_versions', { p_product_id: productId });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((row: FurnitureModelVersion) => ({ ...row, quality_status: qualityOf(row.quality_status) }));
}

export async function fetchFurnitureModelDetail(id: string): Promise<FurnitureModelDetail> {
  const { data, error } = await supabase.rpc('fds_furniture_model_detail', { p_id: id });
  if (error || !data) throw new Error(error?.message ?? '找不到模型版本');
  return { ...(data as FurnitureModelDetail), quality_status: qualityOf((data as FurnitureModelDetail).quality_status) };
}

/** Same product and same parameters return the existing version instead of a duplicate. */
export async function saveFurnitureModel(productId: string, model: ParametricModel, parentId?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('fds_save_furniture_model', {
    p_kind: model.kind,
    p_parametric: model,
    p_estimated: model.estimated_axes.length > 0,
    p_product_id: productId,
    p_parent_id: parentId ?? null,
  });
  if (error || typeof data !== 'string') throw new Error(error?.message ?? '沒有回傳編號');
  return data;
}

export interface ReviewChecks {
  errors: string[];
  appearance_ok: boolean;
  params_hash: string;
  compared_images?: number;
}

export async function reviewFurnitureModel(id: string, decision: 'accepted' | 'rejected', note: string, checks: ReviewChecks): Promise<QualityStatus> {
  const { data, error } = await supabase.rpc('fds_review_furniture_model', { p_id: id, p_decision: decision, p_note: note, p_checks: checks });
  if (error) {
    const known: Record<string, string> = {
      review_closed: '這個版本已完成驗收；修改請另存新版本',
      review_note_required: '驗收不通過時請寫明原因',
      review_stale: '版本內容已改變，請重新開啟驗收',
      review_blocked_evidence: '尚有估算或未確認的關鍵尺寸，只能驗收不通過',
      review_blocked_checks: '程式檢查未通過，不能驗收通過',
      review_blocked_appearance: '請先完成外形核對',
    };
    throw new Error(Object.entries(known).find(([code]) => error.message.includes(code))?.[1] ?? error.message);
  }
  return qualityOf((data as { quality_status?: string } | null)?.quality_status);
}
