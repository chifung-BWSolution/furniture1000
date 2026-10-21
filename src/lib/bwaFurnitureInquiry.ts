import { supabase } from '@/lib/supabase';

export type BwaInquiryStatus = 'draft' | 'sent' | 'replied';

export interface BwaInquirySummary {
  id: string;
  bwa_project_ref: string;
  bwa_project_name: string;
  bwa_pitching_id: string | null;
  bwa_project_id: string | null;
  status: BwaInquiryStatus;
  sent_at: string | null;
  replied_at: string | null;
  created_at: string;
  item_count: number;
  returned_count: number;
}

export interface BwaInquiryItem {
  id: string;
  sort_order: number;
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  returned_unit_price: number | null;
}

export interface BwaInquiryDetail {
  id: string;
  bwa_project_ref: string;
  bwa_project_name: string;
  bwa_pitching_id: string | null;
  bwa_project_id: string | null;
  note: string;
  status: BwaInquiryStatus;
  sent_at: string | null;
  replied_at: string | null;
  created_at: string;
  items: BwaInquiryItem[];
}

export interface BwaInquiryDraftItem {
  name: string;
  spec: string;
  quantity: number;
  unit: string;
}

type PostgrestError = { message?: string; code?: string } | null;

export function inquiryErrorMessage(error: PostgrestError): string {
  const message = error?.message || '';
  if (
    error?.code === '42P01'
    || error?.code === '42703'
    || error?.code === 'PGRST202'
    || error?.code === 'PGRST204'
    || message.includes('bwa_furniture_inquiry')
    || message.includes('bwa_list_furniture_inquiries')
    || message.includes('bwa_save_furniture_inquiry')
    || message.includes('bwa_pitching_id')
  ) {
    return '詢價資料尚未部署。這次沒有改正式資料庫。';
  }
  if (error?.code === '42501' || message.includes('permission_denied')) return '沒有權限。';
  if (message.includes('need_items')) return '至少要有一項有名稱的傢俬。';
  if (message.includes('cost_not_accepted')) return '不能提交成本、廠家或毛利。';
  return '詢價沒有完成。';
}

export function inquiryStatusLabel(status: BwaInquiryStatus): string {
  if (status === 'sent') return '已送交 BWF';
  if (status === 'replied') return 'BWF 已回覆賣價';
  return '草稿';
}

function asStatus(value: unknown): BwaInquiryStatus {
  if (value === 'sent' || value === 'replied') return value;
  return 'draft';
}

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asSummary(value: unknown): BwaInquirySummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    bwa_project_ref: String(row.bwa_project_ref || ''),
    bwa_project_name: String(row.bwa_project_name || ''),
    bwa_pitching_id: asUuid(row.bwa_pitching_id),
    bwa_project_id: asUuid(row.bwa_project_id),
    status: asStatus(row.status),
    sent_at: typeof row.sent_at === 'string' ? row.sent_at : null,
    replied_at: typeof row.replied_at === 'string' ? row.replied_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    item_count: Number(row.item_count) || 0,
    returned_count: Number(row.returned_count) || 0,
  };
}

export async function listFurnitureInquiries(): Promise<{ rows: BwaInquirySummary[]; error: PostgrestError }> {
  const { data, error } = await supabase.rpc('bwa_list_furniture_inquiries');
  const rows = Array.isArray(data) ? data.map(asSummary).filter((row): row is BwaInquirySummary => row !== null) : [];
  return { rows, error };
}

export async function getFurnitureInquiry(id: string): Promise<{ inquiry: BwaInquiryDetail | null; error: PostgrestError }> {
  const { data, error } = await supabase.rpc('bwa_get_furniture_inquiry', { p_id: id });
  if (error || !data || typeof data !== 'object') return { inquiry: null, error };
  const row = data as Record<string, unknown>;
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    inquiry: {
      id: String(row.id || id),
      bwa_project_ref: String(row.bwa_project_ref || ''),
      bwa_project_name: String(row.bwa_project_name || ''),
      bwa_pitching_id: asUuid(row.bwa_pitching_id),
      bwa_project_id: asUuid(row.bwa_project_id),
      note: String(row.note || ''),
      status: asStatus(row.status),
      sent_at: typeof row.sent_at === 'string' ? row.sent_at : null,
      replied_at: typeof row.replied_at === 'string' ? row.replied_at : null,
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
      items: items.map((item, index) => {
        const line = item as Record<string, unknown>;
        return {
          id: String(line.id || index),
          sort_order: Number(line.sort_order) || index,
          name: String(line.name || ''),
          spec: String(line.spec || ''),
          quantity: Number(line.quantity) || 0,
          unit: String(line.unit || ''),
          returned_unit_price: line.returned_unit_price == null || line.returned_unit_price === ''
            ? null
            : Number(line.returned_unit_price),
        };
      }),
    },
    error: null,
  };
}

export async function saveFurnitureInquiry(input: {
  id: string | null;
  projectRef: string;
  projectName: string;
  pitchingId: string | null;
  projectId: string | null;
  note: string;
  items: BwaInquiryDraftItem[];
}): Promise<{ id: string | null; error: PostgrestError }> {
  const items = input.items.map((item) => ({
    name: item.name,
    spec: item.spec,
    quantity: item.quantity,
    unit: item.unit,
  }));
  const { data, error } = await supabase.rpc('bwa_save_furniture_inquiry', {
    p_id: input.id,
    p_project_ref: input.projectRef,
    p_project_name: input.projectName,
    p_note: input.note,
    p_pitching_id: input.pitchingId,
    p_project_id: input.projectId,
    p_items: items,
  });
  const missingNewSignature = error?.code === 'PGRST202'
    || (error?.message || '').includes('bwa_save_furniture_inquiry');
  if (missingNewSignature && !input.pitchingId && !input.projectId) {
    const fallback = await supabase.rpc('bwa_save_furniture_inquiry', {
      p_id: input.id,
      p_project_ref: input.projectRef,
      p_project_name: input.projectName,
      p_note: input.note,
      p_items: items,
    });
    return { id: typeof fallback.data === 'string' ? fallback.data : null, error: fallback.error };
  }
  return { id: typeof data === 'string' ? data : null, error };
}

export async function sendFurnitureInquiry(id: string): Promise<PostgrestError> {
  const { error } = await supabase.rpc('bwa_send_furniture_inquiry', { p_id: id });
  return error;
}

export async function replyFurnitureInquiry(
  id: string,
  prices: { id: string; returned_unit_price: number | null }[],
): Promise<PostgrestError> {
  const { error } = await supabase.rpc('bwf_reply_furniture_inquiry', {
    p_id: id,
    p_prices: prices,
  });
  return error;
}
