import { buildGammaRequest, gammaRequest } from './gamma.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function handleGamma(service: SupabaseClient, userId: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const action = String(body.action);
  if (!['create_native', 'generation_status', 'design_pages', 'export_pptx', 'export_pdf', 'remove_design'].includes(action)) return null;
  const table = () => service.from('canva_design_sessions');
  const { data: session, error } = await table().select('*').eq('id', String(body.session_id ?? '')).eq('staff_id', userId).maybeSingle();
  if (error) throw error;
  if (!session) throw new Error('session_not_found');
  const isGamma = session.populate_report?.provider === 'gamma';
  if (action !== 'create_native' && !isGamma) return null;
  if (action === 'remove_design') {
    if (!session.canva_design_id || session.status === 'creating') throw new Error('此記錄不能移除。');
    const { data: removed, error: removeError } = await table().delete().eq('id', session.id).eq('staff_id', userId).eq('status', session.status).select('id').maybeSingle();
    if (removeError) throw removeError;
    if (!removed) throw new Error('記錄狀態已變更，請重新整理。');
    return { removed: true };
  }
  if (action === 'design_pages') return { pages: [] };
  if (action === 'export_pdf') throw new Error('請在 Gamma 編輯頁匯出 PDF。');
  if (action === 'export_pptx') {
    if (!session.export_download_url) throw new Error('PPTX 尚未準備好，請稍後重新整理。');
    return { export_download_url: session.export_download_url, export_job_id: session.populate_report.generation_job_id };
  }
  if (action === 'create_native') {
    if (session.canva_design_id || session.status === 'creating') throw new Error('此草稿已有設計或正在生成，請建立新版本。');
    const request = buildGammaRequest(session.brief);
    const { data: claimed, error: claimError } = await table().update({ status: 'creating', error: null, populate_report: { provider: 'gamma' } }).eq('id', session.id).eq('staff_id', userId).eq('status', session.status).is('canva_design_id', null).select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new Error('生成任務已啟動，請重新整理。');
    try {
      const result = await gammaRequest('/agent/generations', request);
      if (!result.generationId) throw new Error('Gamma 沒有回傳任務編號。');
      const { data, error } = await table().update({ populate_report: { provider: 'gamma', generation_job_id: result.generationId, engine: 'agent' }, updated_at: new Date().toISOString() }).eq('id', session.id).eq('staff_id', userId).select('*').single();
      if (error) throw error;
      return data;
    } catch (error) {
      // A transport timeout can occur after Gamma accepts a paid request. Require
      // manual review rather than automatically submitting another generation.
      await table().update({ error: 'Gamma 提交結果未確認，請先查看 Gamma 工作區，避免重複生成。', updated_at: new Date().toISOString() }).eq('id', session.id).eq('staff_id', userId);
      throw error;
    }
  }
  if (session.status !== 'creating' || !session.populate_report?.generation_job_id) return session;
  const result = await gammaRequest(`/${session.populate_report.engine === 'agent' ? 'agent/' : ''}generations/${encodeURIComponent(session.populate_report.generation_job_id)}`);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (result.status === 'completed' && result.gammaUrl) Object.assign(patch, { status: 'ready', canva_design_id: `gamma:${result.gamma?.gammaId ?? session.populate_report.generation_job_id}`, edit_url: result.gammaUrl, view_url: result.gammaUrl, export_download_url: result.exportUrl ?? null, error: null });
  else if (result.status === 'failed') Object.assign(patch, { status: 'failed', error: 'Gamma 生成失敗，請查看 Gamma 工作區。' });
  else return session;
  const { data, error: updateError } = await table().update(patch).eq('id', session.id).eq('staff_id', userId).eq('status', 'creating').select('*').maybeSingle();
  if (updateError) throw updateError;
  return data ?? session;
}
