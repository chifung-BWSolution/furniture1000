// FDS 2.1 T-901 — Canva 原生簡報（非 Design Imports / 本機 PPTX）
import { supabase } from '@/lib/supabase';

const EDGE = 'supabase-functions-generate-canva-presentation';

export interface CanvaDesignBrief {
  title: string;
  client?: string;
  project?: string;
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
  generation_mode?: 'blank' | 'autofill' | null;
  brand_template_id?: string | null;
  autofill_job_id?: string | null;
  populate_report?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(EDGE, { body });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('canva_edge_no_response');
  const row = data as T & { error?: string; description?: string };
  if (row && typeof row === 'object' && 'error' in row && row.error) {
    throw new Error(String(row.error));
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
): Promise<{ session_id: string }> {
  return invoke({
    action: 'save_draft',
    session_id: sessionId,
    parent_id: parentId,
    brief,
    product_ids: productIds,
  });
}

export async function createNativeCanvaDesign(sessionId: string): Promise<CanvaDesignSession> {
  return invoke({ action: 'create_native', session_id: sessionId });
}

export async function exportCanvaSessionPptx(sessionId: string): Promise<{
  export_download_url: string;
  export_job_id: string;
}> {
  return invoke({ action: 'export_pptx', session_id: sessionId });
}

export async function probeCanvaNative(): Promise<{
  ok: boolean;
  connected?: boolean;
  scopes?: string | null;
  missing_scopes?: string[];
  brand_template_configured?: boolean;
  brand_template_id?: string;
  autofill_scopes_required?: string[];
  message?: string;
}> {
  return invoke({ action: 'probe' });
}

export async function fetchCanvaTemplateDataset(): Promise<{
  brand_template_id: string;
  fields: string[];
}> {
  return invoke({ action: 'template_dataset' });
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
