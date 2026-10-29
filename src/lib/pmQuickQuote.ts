/**
 * PM報價 — 快速報價／報價預算（2026-10-24 PRD 釐清）。
 *
 * - 快速報價：BWF PM 建報價單給 BWA PM，報價單關聯 BWA 的 pitching／項目。
 * - 報價預算：BWA PM 選對應 pitching 下具體報價單裡的傢俬，即時試算預算。
 *
 * 資料沿用現有 bwf_quote／bwf_quote_item／save_bwf_quote_items（RLS allow-all，
 * BWA 與 BWF 同用 pm 角色，2026-10-23 已撤回角色隔離），只加 bwa_* 關聯欄，
 * 不另建詢價表。快速報價單以 bwf_quote.bwa_pitching_id／bwa_project_id 有值為標記，
 * status 固定「快速報價」，與傢俬報價的內部流程（待審核／版本審核）分開。
 *
 * 規格欄沿用 bwf_quote_item.remarks（PDF 併入材質欄，快速報價不出 PDF，僅預算試算顯示）。
 */

import { supabase } from '@/lib/supabase';
import { withInsertAuditFields, withUpdateAuditFields } from '@/lib/pmsAudit';

export const PM_QUOTE_STATUS = '快速報價';

export interface PmQuoteItem {
  id: string;
  sortOrder: number;
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface PmQuoteSummary {
  id: string;
  quoteId: string;
  bwaPitchingId: string | null;
  bwaProjectId: string | null;
  bwaProjectRef: string;
  bwaProjectName: string;
  totalAmount: number;
  submitter: string;
  createdAt: string;
  itemCount: number;
}

export interface PmQuoteDetail extends PmQuoteSummary {
  items: PmQuoteItem[];
}

export interface PmQuoteDraftItem {
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

type PgError = { message?: string; code?: string } | null;

export function pmQuoteErrorMessage(error: PgError): string {
  const message = error?.message || '';
  if (error?.code === '42P01' || error?.code === '42703') {
    return '這項功能還沒準備好，暫時不能儲存。請聯絡管理員。';
  }
  if (message.includes('duplicate key')) return '已有同一編號的報價單，請重新儲存。';
  if (error?.code === '42501') return '沒有權限。';
  return '儲存沒有完成。';
}

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function itemTotal(item: PmQuoteItem): number {
  return asNumber(item.quantity) * asNumber(item.unitPrice);
}

export function pmQuoteItemsTotal(items: PmQuoteItem[]): number {
  return items.reduce((sum, item) => sum + itemTotal(item), 0);
}

export function formatHkMoney(value: number): string {
  return `HK$ ${value.toLocaleString('en-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function mapItemRow(row: Record<string, unknown>, index: number): PmQuoteItem {
  return {
    id: String(row.id || index),
    sortOrder: asNumber(row.sort_order) || index,
    name: String(row.name || ''),
    spec: String(row.remarks || ''),
    quantity: asNumber(row.quantity),
    unit: String(row.unit || ''),
    unitPrice: asNumber(row.unit_price),
  };
}

/** 快速報價單號：QQ-<BWA 編號或 PM>-<隨機碼>，撞號時加長隨機碼重試。 */
async function newQuoteId(ref: string): Promise<string> {
  const base = (ref.trim() || 'PM').replace(/\s+/g, '').slice(0, 24) || 'PM';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 2 + (attempt < 2 ? 4 : 4 + attempt));
    const candidate = `QQ-${base}-${suffix}`;
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('id')
      .eq('quote_id', candidate)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return candidate;
  }
  throw new Error('無法產生報價單號，請重試。');
}

export async function savePmQuickQuote(input: {
  id: string | null;
  projectRef: string;
  projectName: string;
  pitchingId: string | null;
  projectId: string | null;
  submitter: string;
  items: PmQuoteDraftItem[];
}): Promise<{ id: string | null; quoteId: string | null; error: PgError }> {
  const lines = input.items
    .map((item, index) => ({
      sort_order: index,
      name: item.name.trim(),
      remarks: item.spec.trim(),
      quantity: asNumber(item.quantity) || 0,
      unit: item.unit.trim(),
      unit_price: asNumber(item.unitPrice),
    }))
    .filter((item) => item.name);
  if (lines.length === 0) {
    return { id: null, quoteId: null, error: { message: 'need_items' } };
  }
  if (!input.submitter.trim()) {
    return { id: null, quoteId: null, error: { message: 'need_submitter' } };
  }
  const totalAmount = lines.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );
  const bwaFields = {
    bwa_pitching_id: input.pitchingId,
    bwa_project_id: input.projectId,
    bwa_project_ref: input.projectRef.trim(),
    bwa_project_name: input.projectName.trim(),
  };

  try {
    if (input.id) {
      const updatePayload = await withUpdateAuditFields({
        status: PM_QUOTE_STATUS,
        total_amount: totalAmount,
        submitter: input.submitter.trim(),
        project_data: {
          formData: { clientName: input.projectName.trim() },
          quickQuote: true,
        },
        ...bwaFields,
      });
      const { error } = await supabase
        .from('bwf_quote')
        .update(updatePayload)
        .eq('id', input.id)
        .eq('status', PM_QUOTE_STATUS);
      if (error) throw error;
      const { error: itemsError } = await supabase.rpc('save_bwf_quote_items', {
        p_quote_uuid: input.id,
        p_items: lines,
      });
      if (itemsError) throw itemsError;
      return { id: input.id, quoteId: null, error: null };
    }

    const quoteId = await newQuoteId(input.projectRef || input.projectName);
    const insertPayload = await withInsertAuditFields({
      quote_id: quoteId,
      version: 'v1',
      status: PM_QUOTE_STATUS,
      total_amount: totalAmount,
      submitter: input.submitter.trim(),
      project_data: {
        formData: { clientName: input.projectName.trim() },
        quickQuote: true,
      },
      pitching_code: input.projectRef.trim() || quoteId,
      pitching_name: input.projectName.trim(),
      ...bwaFields,
    });
    const { data: inserted, error } = await supabase
      .from('bwf_quote')
      .insert(insertPayload)
      .select('id')
      .single();
    if (error) throw error;
    if (!inserted?.id) throw new Error('報價單已建立但缺少 id');
    const { error: itemsError } = await supabase.rpc('save_bwf_quote_items', {
      p_quote_uuid: inserted.id,
      p_items: lines,
    });
    if (itemsError) throw itemsError;
    return { id: inserted.id, quoteId, error: null };
  } catch (error) {
    return { id: null, quoteId: null, error: error as PgError };
  }
}

/** 依 BWA pitching／project 找快速報價單（兩者任一命中，或只選了提案時以提案 id 命中）。 */
export async function listPmQuotesForWork(input: {
  pitchingId: string | null;
  projectId: string | null;
}): Promise<{ rows: PmQuoteSummary[]; error: PgError }> {
  let query = supabase
    .from('bwf_quote')
    .select(
      'id,quote_id,bwa_pitching_id,bwa_project_id,bwa_project_ref,bwa_project_name,total_amount,submitter,created_at,status',
    )
    .eq('status', PM_QUOTE_STATUS)
    .order('created_at', { ascending: false })
    .limit(50);
  if (input.projectId) {
    query = query.eq('bwa_project_id', input.projectId);
  } else if (input.pitchingId) {
    query = query.eq('bwa_pitching_id', input.pitchingId);
  } else {
    return { rows: [], error: null };
  }
  const { data, error } = await query;
  if (error) return { rows: [], error };
  const rows = (Array.isArray(data) ? data : [])
    .map((row): PmQuoteSummary | null => {
      const record = row as Record<string, unknown>;
      if (typeof record.id !== 'string') return null;
      return {
        id: record.id,
        quoteId: String(record.quote_id || ''),
        bwaPitchingId: asUuid(record.bwa_pitching_id),
        bwaProjectId: asUuid(record.bwa_project_id),
        bwaProjectRef: String(record.bwa_project_ref || ''),
        bwaProjectName: String(record.bwa_project_name || ''),
        totalAmount: asNumber(record.total_amount),
        submitter: String(record.submitter || ''),
        createdAt: typeof record.created_at === 'string' ? record.created_at : '',
        itemCount: 0,
      };
    })
    .filter((row): row is PmQuoteSummary => row !== null);
  return { rows, error: null };
}

/** 載入多張快速報價單的品項（報價預算頁一次取回試算）。 */
export async function getPmQuoteItems(
  quoteUuids: string[],
): Promise<{ itemsByQuote: Record<string, PmQuoteItem[]>; error: PgError }> {
  if (quoteUuids.length === 0) return { itemsByQuote: {}, error: null };
  const { data, error } = await supabase
    .from('bwf_quote_item')
    .select('id,quote_uuid,sort_order,name,remarks,quantity,unit,unit_price')
    .in('quote_uuid', quoteUuids)
    .order('sort_order', { ascending: true });
  if (error) return { itemsByQuote: {}, error };
  const itemsByQuote: Record<string, PmQuoteItem[]> = {};
  for (const row of Array.isArray(data) ? data : []) {
    const record = row as Record<string, unknown>;
    const quoteUuid = String(record.quote_uuid || '');
    if (!quoteUuid) continue;
    (itemsByQuote[quoteUuid] ||= []).push(mapItemRow(record, itemsByQuote[quoteUuid]?.length || 0));
  }
  return { itemsByQuote, error: null };
}

export async function getPmQuickQuote(
  id: string,
): Promise<{ quote: PmQuoteDetail | null; error: PgError }> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select(
      'id,quote_id,bwa_pitching_id,bwa_project_id,bwa_project_ref,bwa_project_name,total_amount,submitter,created_at,status',
    )
    .eq('id', id)
    .eq('status', PM_QUOTE_STATUS)
    .limit(1);
  if (error) return { quote: null, error };
  const row = (Array.isArray(data) ? data : [])[0] as Record<string, unknown> | undefined;
  if (!row) return { quote: null, error: { message: 'not_found' } };
  const summary: PmQuoteSummary = {
    id: String(row.id || id),
    quoteId: String(row.quote_id || ''),
    bwaPitchingId: asUuid(row.bwa_pitching_id),
    bwaProjectId: asUuid(row.bwa_project_id),
    bwaProjectRef: String(row.bwa_project_ref || ''),
    bwaProjectName: String(row.bwa_project_name || ''),
    totalAmount: asNumber(row.total_amount),
    submitter: String(row.submitter || ''),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    itemCount: 0,
  };
  const { itemsByQuote, error: itemsError } = await getPmQuoteItems([summary.id]);
  if (itemsError) return { quote: null, error: itemsError };
  const items = itemsByQuote[summary.id] || [];
  return { quote: { ...summary, items }, error: null };
}

/** 報價預算列表：所有 PM 快速報價單（status=快速報價），只取列表用的輕量欄位。 */
export async function listPmQuickQuotes(limit = 200): Promise<{ rows: PmQuoteSummary[]; error: PgError }> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select('id,quote_id,bwa_pitching_id,bwa_project_id,bwa_project_ref,bwa_project_name,total_amount,submitter,created_at')
    .eq('status', PM_QUOTE_STATUS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error };
  const rows = (Array.isArray(data) ? data : [])
    .map((row): PmQuoteSummary | null => {
      const record = row as Record<string, unknown>;
      if (typeof record.id !== 'string') return null;
      return {
        id: record.id,
        quoteId: String(record.quote_id || ''),
        bwaPitchingId: asUuid(record.bwa_pitching_id),
        bwaProjectId: asUuid(record.bwa_project_id),
        bwaProjectRef: String(record.bwa_project_ref || ''),
        bwaProjectName: String(record.bwa_project_name || ''),
        totalAmount: asNumber(record.total_amount),
        submitter: String(record.submitter || ''),
        createdAt: typeof record.created_at === 'string' ? record.created_at : '',
        itemCount: 0,
      };
    })
    .filter((row): row is PmQuoteSummary => row !== null);
  return { rows, error: null };
}
