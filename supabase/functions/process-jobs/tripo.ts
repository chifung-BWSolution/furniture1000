import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const API = "https://openapi.tripo3d.ai/v3";
const MAX_MODEL_BYTES = 50 * 1024 * 1024;
export class TripoStop extends Error {}
type State = { submission_started?: boolean; task_id?: string; submitted_at?: string };
type TripoJob = { id: string; payload: { product_id: string; reference_path: string; user_id: string; state?: State } };

async function tripo(path: string, apiKey: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  });
  const value = await response.json().catch(() => null);
  // Tripo can return HTTP 200 with a business error code.
  if (!response.ok || value?.code !== 0 || !value?.data) {
    console.warn("[tripo] API error", response.status, value?.code);
    if (value?.code === 2010) throw new Error("Tripo API 點數不足，請在開發者平台充值 API 點數（Studio 點數不通用）");
    throw new Error(`Tripo 請求失敗（HTTP ${response.status}，代碼 ${value?.code ?? "unknown"}），請檢查 API 點數及設定`);
  }
  return value.data;
}

async function readGlb(url: string): Promise<Uint8Array> {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new TripoStop("Tripo 模型下載網址不正確");
  const response = await fetch(target, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("Tripo 模型下載失敗，下次會重新取得下載網址");
  if (Number(response.headers.get("content-length")) > MAX_MODEL_BYTES) throw new TripoStop("試用模型超過 50MB，請降低模型複雜度");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > MAX_MODEL_BYTES) { await reader.cancel(); throw new TripoStop("試用模型超過 50MB"); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (size < 12) throw new TripoStop("Tripo 回傳的 GLB 檔案無效");
  const view = new DataView(bytes.buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== size) {
    throw new TripoStop("Tripo 回傳的檔案不是有效 GLB 2.0");
  }
  return bytes;
}

export async function runTripoJob(admin: SupabaseClient, job: TripoJob) {
  const apiKey = Deno.env.get("TRIPO_API_KEY");
  if (!apiKey) throw new TripoStop("TRIPO_API_KEY 未設定");
  const state = job.payload.state ?? {};
  if (!state.task_id) {
    // Persist BEFORE spending credits. An interrupted/uncertain submission is never resubmitted automatically.
    if (state.submission_started) throw new TripoStop("上次提交結果未能確認，為避免重複扣點已停止。請先在 Tripo 後台核對任務。");
    const submittedAt = new Date().toISOString();
    const { data: locked, error: lockError } = await admin.from("processing_jobs").update({
      payload: { ...job.payload, state: { submission_started: true, submitted_at: submittedAt } },
    }).eq("id", job.id).eq("status", "running").select("id");
    if (lockError) throw lockError;
    if (!locked?.length) return "cancelled";
    const { data: image, error: imageError } = await admin.storage.from("product-models").createSignedUrl(job.payload.reference_path, 3600);
    if (imageError || !image?.signedUrl) throw new TripoStop("參考圖不存在或無法讀取");
    let result;
    try {
      result = await tripo("/generation/image-to-model", apiKey, {
        input: image.signedUrl,
        model: "v3.1-20260211",
        texture: true, pbr: true, texture_quality: "standard",
        face_limit: 30000, orientation: "align_image",
        enable_image_autofix: false,
      });
      if (typeof result.task_id !== "string" || !result.task_id) throw new Error("missing task id");
    } catch (error) {
      throw new TripoStop(`${error instanceof Error ? error.message : "Tripo 提交失敗"}。不會自動再次提交，請先核對 Tripo 後台。`);
    }
    const { data: saved, error } = await admin.rpc("fds_processing_job_checkpoint", {
      p_job_id: job.id, p_state: { submission_started: true, submitted_at: submittedAt, task_id: result.task_id }, p_progress: 0.05,
    });
    if (error) throw error;
    if (!saved) return "cancelled";
    return "tripo_pending";
  }
  if (!/^[A-Za-z0-9_-]+$/.test(state.task_id)) throw new TripoStop("Tripo 任務識別碼無效");
  if (!state.submitted_at || !Number.isFinite(Date.parse(state.submitted_at)) || Date.now() - Date.parse(state.submitted_at) > 60 * 60 * 1000) {
    throw new TripoStop("Tripo 任務超過一小時，請到 Tripo 後台核對；不會重新扣點提交");
  }
  const result = await tripo(`/tasks/${encodeURIComponent(state.task_id)}`, apiKey);
  if (result.status === "failed" || result.status === "cancelled") throw new TripoStop(`Tripo 任務${result.status === "failed" ? "失敗" : "已取消"}，請在 Tripo 後台查看原因`);
  if (result.status !== "success") {
    if (!["queued", "running"].includes(result.status)) throw new TripoStop("Tripo 回傳未知任務狀態");
    const progress = Math.min(0.9, Math.max(0.05, Number(result.progress || 0) / 100));
    const { error } = await admin.rpc("fds_processing_job_checkpoint", { p_job_id: job.id, p_state: state, p_progress: progress });
    if (error) throw error;
    return "tripo_pending";
  }
  // Query on every attempt to get a fresh provider download URL, rather than persisting an expiring link.
  if (typeof result.output?.model_url !== "string") throw new TripoStop("Tripo 沒有回傳模型檔");
  const bytes = await readGlb(result.output.model_url);
  const { data: current, error: heartbeatError } = await admin.rpc("fds_processing_job_heartbeat", { p_job_id: job.id, p_progress: 0.95 });
  if (heartbeatError) throw heartbeatError;
  if (current !== "running") return "cancelled";
  const path = `generated/tripo/${job.id}/model.glb`;
  const { error: uploadError } = await admin.storage.from("product-models").upload(path, bytes, { contentType: "model/gltf-binary", upsert: true });
  if (uploadError) throw uploadError;
  const credits = Number(result.credits_consumed);
  const { data: completed, error } = await admin.rpc("fds_tripo_model_complete", {
    p_job_id: job.id, p_storage_path: path, p_credits: Number.isFinite(credits) && credits >= 0 ? credits : 0,
  });
  if (error) throw error;
  return completed ? "succeeded" : "cancelled";
}
