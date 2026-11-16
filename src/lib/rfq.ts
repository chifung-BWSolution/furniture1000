// FDS Supplier RFQ（第一期乙）前端資料層。
// 所有寫入與封標判斷都在 Postgres RPC；這裡只負責型別、錯誤碼映射與格式。
import { supabase } from '@/lib/supabase';

export type RfqStatus =
  | 'draft'
  | 'open'
  | 'review'
  | 'awarded'
  | 'not_awarded'
  | 'cancelled';

export type RfqCurrency = 'CNY' | 'HKD' | 'USD';

export interface RfqListRow {
  id: string;
  rfq_no: string;
  title: string;
  currency: string;
  stored_status: RfqStatus;
  status: RfqStatus;
  revision: number;
  close_at: string | null;
  sealed_bid: boolean;
  revealed_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_email: string | null;
  item_count: number;
  invitation_count: number;
  submitted_factory_count: number;
  resolved_item_count: number;
}

export interface RfqItemAward {
  id: string;
  factory_id: string;
  factory_name: string | null;
  version: number;
  unit_price: number;
  currency: string;
  quantity: number;
  reason: string;
  status: string;
  awarded_at: string;
}

export interface RfqItem {
  id: string;
  sort_order: number;
  name: string;
  model: string | null;
  quantity: number;
  unit: string | null;
  specifications: string | null;
  dimensions: string | null;
  image_url: string | null;
  product_id: string | null;
  source_quote_id: string | null;
  source_quote_item_id: string | null;
  resolution: 'open' | 'awarded' | 'no_award';
  resolution_reason: string | null;
  resolved_at: string | null;
  award: RfqItemAward | null;
}

export interface RfqInvitation {
  id: string;
  factory_id: string;
  factory_name: string;
  contact_email: string | null;
  status: 'invited' | 'submitted' | 'withdrawn';
  revision: number;
  latest_version: number | null;
  latest_submitted_at: string | null;
  latest_status: string | null;
  quoted_item_count: number;
  has_active_token: boolean;
}

export interface RfqSubmissionItem {
  submission_item_id: string;
  rfq_item_id: string;
  unit_price: number | null;
  no_quote: boolean;
  lead_time_days: number | null;
  validity_days: number | null;
  moq: number | null;
  package_qty: number | null;
  volume: number | null;
  alternate_product_id: string | null;
  alternate_text: string | null;
  note: string | null;
}

/** Sealed detail omits every price field and only keeps quoted_item_count. */
export interface RfqSubmission {
  id: string;
  invitation_id: string;
  factory_id: string;
  version: number;
  submitted_at: string;
  submitter_email: string;
  receipt_code?: string;
  total_amount?: number;
  quoted_item_count?: number;
  items?: RfqSubmissionItem[];
}

export interface RfqHistoryRow {
  id: string;
  revision: number;
  version: number;
  status: 'submitted' | 'withdrawn';
  factory_id: string;
  submitter_email: string;
  submitted_at: string;
  withdrawn_at: string | null;
}

export interface RfqCatalogPrice {
  product_id: string;
  factory_id: string | null;
  factory_name: string | null;
  catalog_price: number;
  currency: string | null;
  unit: string | null;
  variant_label: string | null;
  quote_year: number | null;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string | null;
}

export interface RfqEvent {
  id: string;
  rfq_item_id: string | null;
  invitation_id: string | null;
  event_type: string;
  actor_kind: 'staff' | 'supplier' | 'link' | 'system';
  actor_email: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface RfqHeader {
  id: string;
  rfq_no: string;
  title: string;
  currency: string;
  status: RfqStatus;
  stored_status: RfqStatus;
  revision: number;
  close_at: string | null;
  sealed: boolean;
  revealed: boolean;
  revealed_at: string | null;
  reveal_reason: string | null;
  close_revealed: boolean;
  published_at: string | null;
  notes: string | null;
  cancel_reason: string | null;
  source_quote_id: string | null;
  created_at: string;
  created_by_email: string | null;
  server_now: string;
}

export interface RfqDetail {
  rfq: RfqHeader;
  counts: {
    item_count: number;
    invitation_count: number;
    submitted_factory_count: number;
    resolved_item_count: number;
  };
  items: RfqItem[];
  invitations: RfqInvitation[];
  submissions: RfqSubmission[];
  history: RfqHistoryRow[];
  awards: Array<RfqItemAward & {
    rfq_item_id: string;
    invitation_id: string;
    submission_id: string;
  }>;
  catalog_prices: RfqCatalogPrice[];
  events: RfqEvent[];
}

export interface RfqPublicItem {
  id: string;
  sort_order: number;
  name: string;
  model: string | null;
  quantity: number;
  unit: string | null;
  specifications: string | null;
  dimensions: string | null;
  image_url: string | null;
  product_id: string | null;
  my: {
    submission_item_id: string;
    unit_price: number | null;
    no_quote: boolean;
    lead_time_days: number | null;
    validity_days: number | null;
    moq: number | null;
    package_qty: number | null;
    volume: number | null;
    alternate_product_id: string | null;
    alternate_text: string | null;
    note: string | null;
  } | null;
  decision: 'awarded' | 'not_selected' | 'not_awarded' | 'pending';
}

export interface RfqPublicView {
  rfq: {
    rfq_no: string;
    title: string;
    currency: string;
    status: RfqStatus;
    revision: number;
    close_at: string | null;
    notes: string | null;
    server_now: string;
  };
  invitation: {
    factory_id: string;
    factory_name: string;
    revision: number;
  };
  items: RfqPublicItem[];
  submission: {
    id: string;
    version: number;
    status: 'submitted' | 'withdrawn';
    receipt_code: string;
    submitted_at: string;
    withdrawn_at: string | null;
    submitter_email: string;
  } | null;
  can_submit: boolean;
}

export interface RfqDraftItem {
  name: string;
  model?: string | null;
  quantity: number;
  unit?: string | null;
  specifications?: string | null;
  dimensions?: string | null;
  image_url?: string | null;
  product_id?: string | null;
  source_quote_id?: string | null;
  source_quote_item_id?: string | null;
}

export interface RfqDraftInvitation {
  factory_id: string;
  factory_name: string;
  contact_email?: string | null;
}

export interface RfqDraftPayload {
  title: string;
  currency: string;
  close_at: string | null;
  notes?: string | null;
  items: RfqDraftItem[];
  invitations: RfqDraftInvitation[];
  source_quote_id?: string | null;
}

export interface RfqSubmitLine {
  rfq_item_id: string;
  unit_price?: number | null;
  no_quote?: boolean;
  lead_time_days?: number | null;
  validity_days?: number | null;
  moq?: number | null;
  package_qty?: number | null;
  volume?: number | null;
  alternate_text?: string | null;
  note?: string | null;
}

const RFQ_ERROR_MESSAGES: Record<string, string> = {
  permission_denied: '沒有權限執行這個動作。',
  rfq_not_found: '找不到這張 RFQ，可能已被移除。',
  rfq_not_draft: '這張 RFQ 已不是草稿，不能這樣修改。',
  currency_locked: 'RFQ 發布後幣別已凍結；要改幣別請另開一張。',
  close_required: '請填一個未來的截止時間。',
  items_required: '至少要有一行項目才能發布。',
  invitation_required: '至少要邀請一家廠家才能發布。',
  revision_mismatch: '這條連結屬於舊修訂，已失效；請向採購同事索取新連結。',
  token_invalid: '這條連結無效、已過期或已作廢。',
  deadline_passed: '已過截止時間，不能再提交或撤回。',
  sealed: 'RFQ 尚未揭標，不能定標。',
  negative_price: '單價不能是負數。',
  empty_submission: '至少要有一行填上有效單價才能提交。',
  line_already_resolved: '這一行已經有定標或不定標決定。',
  line_not_resolved: '這一行還未決定，不需要重開。',
  award_version_stale: '這家廠已有更新的回價版本，請重新整理後再定標。',
  reason_required: '請填寫原因。',
  factory_mismatch: '廠家不符。',
  rfq_cancelled: '這張 RFQ 已取消，不能再操作。',
  award_exists: '已有定標的行，請先由管理員重開該行，才可以升修訂。',
  title_required: '請填 RFQ 標題。',
  invalid_currency: '幣別格式不正確。',
  invalid_items: '有項目或數量格式不正確，請檢查後再試。',
  invalid_email: '請填一個格式正確的電郵。',
};

/** First line of a PostgREST/Postgres error is the stable errcode we raised. */
export function rfqErrorCode(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error.split('\n')[0].trim();
  const message = (error as { message?: string }).message;
  if (!message) return '';
  return message.split('\n')[0].trim();
}

export function rfqErrorText(error: unknown): string {
  const code = rfqErrorCode(error);
  return RFQ_ERROR_MESSAGES[code] || (code ? `未能完成：${code}` : '未能完成，請再試一次。');
}

async function callRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { data: null, error: rfqErrorText(error) };
  return { data: (data as T) ?? null, error: null };
}

export async function listRfqs(status?: RfqStatus | null): Promise<{
  rows: RfqListRow[];
  error: string | null;
}> {
  const { data, error } = await callRpc<RfqListRow[]>('fds_rfq_list', {
    p_status: status ?? null,
  });
  return { rows: Array.isArray(data) ? data : [], error };
}

export async function getRfqDetail(id: string): Promise<{
  detail: RfqDetail | null;
  error: string | null;
}> {
  const { data, error } = await callRpc<RfqDetail>('fds_rfq_detail', { p_rfq_id: id });
  return { detail: data, error };
}

export async function saveRfqDraft(
  id: string | null,
  payload: RfqDraftPayload,
): Promise<{ id: string | null; rfqNo: string | null; error: string | null }> {
  const { data, error } = await callRpc<{ id: string; rfq_no: string }>(
    'fds_rfq_save_draft',
    { p_rfq_id: id, p_payload: payload },
  );
  return { id: data?.id ?? null, rfqNo: data?.rfq_no ?? null, error };
}

export async function publishRfq(id: string): Promise<{ revision: number | null; error: string | null }> {
  const { data, error } = await callRpc<{ revision: number }>('fds_rfq_publish', { p_rfq_id: id });
  return { revision: data?.revision ?? null, error };
}

export async function reviseRfq(
  id: string,
  payload: Pick<RfqDraftPayload, 'title' | 'close_at' | 'notes' | 'items'> & { currency?: string },
): Promise<{ revision: number | null; error: string | null }> {
  const { data, error } = await callRpc<{ revision: number }>('fds_rfq_revise', {
    p_rfq_id: id,
    p_payload: payload,
  });
  return { revision: data?.revision ?? null, error };
}

export async function inviteRfqFactory(
  rfqId: string,
  factoryId: string,
  factoryName: string,
  contactEmail?: string | null,
): Promise<{ invitationId: string | null; error: string | null }> {
  const { data, error } = await callRpc<{ invitation_id: string }>('fds_rfq_invite_factory', {
    p_rfq_id: rfqId,
    p_factory_id: factoryId,
    p_factory_name: factoryName,
    p_contact_email: contactEmail ?? null,
  });
  return { invitationId: data?.invitation_id ?? null, error };
}

export async function issueRfqLink(invitationId: string): Promise<{
  token: string | null;
  expiresAt: string | null;
  factoryName: string | null;
  error: string | null;
}> {
  const { data, error } = await callRpc<{
    token: string;
    expires_at: string;
    factory_name: string | null;
  }>('fds_rfq_issue_link', { p_invitation_id: invitationId });
  return {
    token: data?.token ?? null,
    expiresAt: data?.expires_at ?? null,
    factoryName: data?.factory_name ?? null,
    error,
  };
}

export async function revealRfq(id: string, reason: string): Promise<{ error: string | null }> {
  const { error } = await callRpc('fds_rfq_reveal', { p_rfq_id: id, p_reason: reason });
  return { error };
}

export async function cancelRfq(id: string, reason: string): Promise<{ error: string | null }> {
  const { error } = await callRpc('fds_rfq_cancel', { p_rfq_id: id, p_reason: reason });
  return { error };
}

export async function reopenRfqLine(
  rfqId: string,
  itemId: string,
  reason: string,
): Promise<{ error: string | null }> {
  const { error } = await callRpc('fds_rfq_reopen_line', {
    p_rfq_id: rfqId,
    p_rfq_item_id: itemId,
    p_reason: reason,
  });
  return { error };
}

export async function awardRfqLine(
  rfqId: string,
  itemId: string,
  submissionId: string,
  reason: string,
): Promise<{ error: string | null }> {
  const { error } = await callRpc('fds_rfq_award_line', {
    p_rfq_id: rfqId,
    p_rfq_item_id: itemId,
    p_submission_id: submissionId,
    p_reason: reason,
  });
  return { error };
}

export async function noAwardRfqLine(
  rfqId: string,
  itemId: string,
  reason: string,
): Promise<{ error: string | null }> {
  const { error } = await callRpc('fds_rfq_no_award_line', {
    p_rfq_id: rfqId,
    p_rfq_item_id: itemId,
    p_reason: reason,
  });
  return { error };
}

export async function openRfqByToken(token: string): Promise<{
  view: RfqPublicView | null;
  error: string | null;
}> {
  const { data, error } = await callRpc<RfqPublicView>('fds_rfq_open_by_token', {
    p_token: token,
  });
  return { view: data, error };
}

export async function submitRfqByToken(
  token: string,
  lines: RfqSubmitLine[],
  submitterEmail: string,
  idempotencyKey: string,
): Promise<{
  receiptCode: string | null;
  version: number | null;
  duplicate: boolean;
  error: string | null;
}> {
  const { data, error } = await callRpc<{
    receipt_code: string;
    version: number;
    duplicate: boolean;
  }>('fds_rfq_submit_by_token', {
    p_token: token,
    p_items: lines,
    p_submitter_email: submitterEmail,
    p_idempotency_key: idempotencyKey,
  });
  return {
    receiptCode: data?.receipt_code ?? null,
    version: data?.version ?? null,
    duplicate: data?.duplicate === true,
    error,
  };
}

export async function withdrawRfqByToken(token: string): Promise<{ error: string | null }> {
  const { error } = await callRpc('fds_rfq_withdraw_by_token', { p_token: token });
  return { error };
}

// ── 顯示格式 ─────────────────────────────────────────────────────────
export const RFQ_CURRENCIES: RfqCurrency[] = ['CNY', 'HKD', 'USD'];

export function rfqStatusLabel(status: RfqStatus | string): string {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'open':
      return '進行中';
    case 'review':
      return '評審中';
    case 'awarded':
      return '已定標';
    case 'not_awarded':
      return '不定標';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

export function rfqStatusClass(status: RfqStatus | string): string {
  switch (status) {
    case 'draft':
      return 'border-slate-300 bg-slate-50 text-slate-700';
    case 'open':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800';
    case 'review':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    case 'awarded':
      return 'border-indigo-300 bg-indigo-50 text-indigo-800';
    case 'not_awarded':
      return 'border-zinc-300 bg-zinc-100 text-zinc-700';
    case 'cancelled':
      return 'border-rose-300 bg-rose-50 text-rose-800';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

/** `1.向氏 QXS` → `向氏 QXS`; only used for the supplier-facing label. */
export function stripFactorySortName(name: string | null | undefined): string {
  return (name || '').replace(/^\s*\d+\s*[.、]\s*/, '').trim();
}

const HK_DATE_TIME = new Intl.DateTimeFormat('zh-HK', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatRfqDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return HK_DATE_TIME.format(date).replace(',', '');
}

/** `datetime-local` value in Asia/Hong_Kong (yyyy-MM-ddTHH:mm). */
export function toHkDateTimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** `datetime-local` is Hong Kong wall time; store the corresponding UTC instant. */
export function hkDateTimeLocalToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatRfqMoney(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('zh-HK', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('zh-HK')}`;
  }
}
