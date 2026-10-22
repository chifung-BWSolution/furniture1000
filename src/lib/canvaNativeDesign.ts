// FDS 2.1 — Canva AI 簡報（POST /v1/generations，非品牌模板 Autofill）
import { parseInvokeError } from '@/lib/edgeFunctionErrors';
import { supabase } from '@/lib/supabase';

const EDGE = 'supabase-functions-generate-canva-presentation';

export interface CanvaDesignBrief {
  title: string;
  /** Display name. Free text when the client is not in client_companies. */
  client?: string;
  /** client_companies.id when the user picked an existing client. */
  clientId?: string;
  project?: string;
  /** design_projects.id when the user picked an existing project. */
  projectId?: string;
  purpose?: string;
  /** 使用者原文 */
  content?: string;
  /** 確認後大綱（PoC 可手動或由前端整理） */
  outline?: string;
  language?: string;
  style?: string;
  pageCount?: number;
  confirmedAt?: string;
}

export type CanvaSessionStatus =
  | 'draft'
  | 'creating'
  | 'ready'
  | 'exporting'
  | 'exported'
  | 'failed';

export interface CanvaDesignSession {
  id: string;
  parent_id?: string | null;
  root_id?: string | null;
  content_version?: number;
  version_note?: string | null;
  status: CanvaSessionStatus;
  brief: CanvaDesignBrief;
  product_ids: string[];
  canva_design_id?: string | null;
  edit_url?: string | null;
  view_url?: string | null;
  export_job_id?: string | null;
  export_download_url?: string | null;
  export_error?: string | null;
  error?: string | null;
  thumbnail_url?: string | null;
  generation_mode?: 'blank' | 'autofill' | 'ai' | null;
  brand_template_id?: string | null;
  autofill_job_id?: string | null;
  populate_report?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(EDGE, { body });
  if (error) throw new Error(await parseInvokeError(error, data as { error?: string; message?: string } | null));
  if (!data) throw new Error('canva_edge_no_response');
  const row = data as T & { error?: string; message?: string; description?: string };
  if (row && typeof row === 'object' && 'error' in row && row.error && !('id' in row && 'status' in row)) {
    throw new Error(String(row.message || row.error));
  }
  return data as T;
}

export async function listCanvaDesignSessions(limit = 12): Promise<CanvaDesignSession[]> {
  const { data, error } = await supabase.rpc('fds_list_canva_design_sessions', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data as CanvaDesignSession[] | null) ?? [];
}

export async function saveCanvaDraft(
  brief: CanvaDesignBrief,
  productIds: string[],
  sessionId?: string,
  parentId?: string,
  versionNote?: string,
): Promise<{ session_id: string; content_version?: number; root_id?: string }> {
  return invoke({
    action: 'save_draft',
    session_id: sessionId,
    parent_id: parentId,
    version_note: versionNote,
    brief,
    product_ids: productIds,
  });
}

export interface CanvaSessionVersionRow {
  id: string;
  parent_id?: string | null;
  root_id?: string | null;
  content_version?: number;
  version_note?: string | null;
  status: CanvaSessionStatus;
  canva_design_id?: string | null;
  edit_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CanvaDesignExportRow {
  id: string;
  format: 'pptx' | 'pdf';
  export_job_id?: string | null;
  download_url?: string | null;
  url_expires_at?: string | null;
  error?: string | null;
  canva_design_id: string;
  created_at: string;
}

export async function listCanvaSessionVersions(sessionId: string): Promise<CanvaSessionVersionRow[]> {
  const { data, error } = await supabase.rpc('fds_list_canva_session_versions', { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  return (data as CanvaSessionVersionRow[] | null) ?? [];
}

export async function listCanvaDesignExports(sessionId: string, limit = 20): Promise<CanvaDesignExportRow[]> {
  const { data, error } = await supabase.rpc('fds_list_canva_design_exports', {
    p_session_id: sessionId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data as CanvaDesignExportRow[] | null) ?? [];
}

export async function createNativeCanvaDesign(sessionId: string): Promise<CanvaDesignSession> {
  return invoke({ action: 'create_native', session_id: sessionId });
}

export async function exportCanvaSessionPptx(sessionId: string): Promise<{
  export_download_url: string;
  export_job_id: string;
  url_expires_at?: string;
  format?: string;
}> {
  return invoke({ action: 'export_pptx', session_id: sessionId });
}

export async function exportCanvaSessionPdf(sessionId: string): Promise<{
  export_download_url: string;
  export_job_id: string;
  url_expires_at?: string;
}> {
  return invoke({ action: 'export_pdf', session_id: sessionId });
}

/** R5.2 專業 PDF 共用內容（獨立渲染，非 Canva 版面）。 */
export function proPdfHandoffPath(brief: CanvaDesignBrief): string {
  const q = new URLSearchParams();
  if (brief.title?.trim()) q.set('briefTitle', brief.title.trim());
  if (brief.client?.trim()) q.set('client', brief.client.trim());
  if (brief.project?.trim()) q.set('project', brief.project.trim());
  if (brief.purpose?.trim()) q.set('purpose', brief.purpose.trim());
  const s = q.toString();
  return `/fds/pm/pro-pdf${s ? `?${s}` : ''}`;
}

export async function probeCanvaNative(): Promise<{
  ok: boolean;
  connected?: boolean;
  scopes?: string | null;
  missing_scopes?: string[];
  design_generation?: boolean;
  message?: string;
}> {
  return invoke({ action: 'probe' });
}

/** PoC：把欄位整理成可確認大綱（T-902 可改為 AI） */
export function buildOutlineFromBrief(brief: CanvaDesignBrief): string {
  const lines: string[] = [];
  if (brief.client || brief.project) {
    lines.push(`客戶／專案：${[brief.client, brief.project].filter(Boolean).join(' · ')}`);
  }
  if (brief.purpose) lines.push(`目的：${brief.purpose}`);
  if (brief.style || brief.language || brief.pageCount) {
    lines.push(
      [
        brief.language ? `語言：${brief.language}` : '',
        brief.style ? `風格：${brief.style}` : '',
        brief.pageCount ? `期望約 ${brief.pageCount} 頁` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  if (brief.content?.trim()) {
    lines.push('', '── 內容 ──', brief.content.trim());
  }
  return lines.join('\n').trim();
}

export function defaultBrief(): CanvaDesignBrief {
  return {
    title: '',
    client: '',
    project: '',
    purpose: '',
    content: '',
    outline: '',
    language: '繁體中文',
    style: '專業、簡潔',
    pageCount: 12,
  };
}

/** Reads persisted backend/Canva progress; does not create another Canva job. */
export async function fetchCanvaGenerationStatus(sessionId: string): Promise<CanvaDesignSession> {
  return invoke({ action: 'generation_status', session_id: sessionId });
}
