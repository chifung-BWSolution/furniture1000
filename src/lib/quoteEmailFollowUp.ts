import { supabase } from '@/lib/supabase';

/**
 * FDS-15 郵件模板與跟進（每張正式報價各自保存）。
 *
 * 固定三段不可刪除：
 *   1. 報價內容簡述
 *   2. 可電話聯繫（負責同事電話，範本未填就不發送）
 *   3. 該報價加單授權連結（只接受該單現有的有效分享連結）
 * 可附加自訂段落。手動與自動發送都用發送當下的範本。
 */

export type QuoteEmailStatus =
  | 'not_sent'
  | 'sent'
  | 'auto_follow_up_active'
  | 'viewed'
  | 'stopped';

export type QuoteEmailMessageKind = 'manual' | 'follow_up';
export type QuoteEmailMessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface QuoteEmailCustomSection {
  title: string;
  body: string;
}

export interface QuoteEmailMessageRow {
  id: string;
  kind: QuoteEmailMessageKind;
  to_email: string;
  status: QuoteEmailMessageStatus;
  attempts: number;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export interface QuoteEmailViewRow {
  viewed_at: string;
  is_valid: boolean;
  reason: string | null;
  user_agent: string | null;
}

export interface QuoteEmailStatusData {
  quote_uuid: string;
  intro_text: string;
  contact_phone: string;
  custom_sections: unknown;
  status: QuoteEmailStatus;
  recipient_email: string | null;
  auto_follow_up: boolean;
  last_sent_at: string | null;
  next_follow_up_at: string | null;
  first_viewed_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  share_token: string | null;
  item_count: number;
  total_amount: number;
  sample_items: string | null;
  messages: QuoteEmailMessageRow[];
  views: QuoteEmailViewRow[];
}

export const QUOTE_EMAIL_STATUS_LABELS: Record<QuoteEmailStatus, string> = {
  not_sent: 'Not Sent',
  sent: 'Sent',
  auto_follow_up_active: 'Auto Follow-up Active',
  viewed: 'Viewed',
  stopped: 'Stopped',
};

export const QUOTE_EMAIL_FIXED_LABELS = {
  summary: '報價內容簡述',
  contact: '可電話聯繫',
  share: '加單授權連結',
} as const;

const MAX_CUSTOM_SECTIONS = 10;
const MAX_SECTION_TITLE = 60;
const MAX_SECTION_BODY = 800;

export function normalizeCustomQuoteEmailSections(value: unknown): QuoteEmailCustomSection[] {
  if (!Array.isArray(value)) return [];
  const out: QuoteEmailCustomSection[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const title = String(record.title ?? '').trim().slice(0, MAX_SECTION_TITLE);
    const body = String(record.body ?? '').trim().slice(0, MAX_SECTION_BODY);
    if (!title && !body) continue;
    out.push({ title, body });
    if (out.length >= MAX_CUSTOM_SECTIONS) break;
  }
  return out;
}

export type QuoteEmailProblem =
  | 'recipient_missing'
  | 'recipient_invalid'
  | 'contact_phone_missing'
  | 'share_link_missing';

export const QUOTE_EMAIL_PROBLEM_TEXT: Record<QuoteEmailProblem, string> = {
  recipient_missing: '請填寫客戶收件電郵。',
  recipient_invalid: '收件電郵格式不正確。',
  contact_phone_missing: '請先填寫負責同事的聯絡電話；沒有電話不會發送。',
  share_link_missing: '這張報價還沒有有效的客戶連結。請先建立客戶分享連結，再加入郵件。',
};

const EMAIL_PATTERN = /^[^@<>"\s]+@[^@<>"\s]+\.[^@<>"\s]+$/;

export function isQuoteEmailAddress(value: string): boolean {
  const text = value.trim();
  return text.length > 0 && text.length <= 320 && EMAIL_PATTERN.test(text);
}

/** 發送前檢查；回傳第一個要處理的問題，沒有問題回傳 null。 */
export function quoteEmailReadiness(input: {
  recipient: string;
  contactPhone: string;
  shareToken: string | null;
}): QuoteEmailProblem | null {
  const recipient = input.recipient.trim();
  if (!recipient) return 'recipient_missing';
  if (!isQuoteEmailAddress(recipient)) return 'recipient_invalid';
  if (!input.contactPhone.trim()) return 'contact_phone_missing';
  if (!input.shareToken) return 'share_link_missing';
  return null;
}

export interface QuoteEmailSection {
  key: 'summary' | 'contact' | 'share' | `custom-${number}`;
  label: string;
  body: string;
}

export function formatQuoteEmailMoney(cents: number): string {
  return `HK$ ${(Math.max(0, Number(cents) || 0) / 100).toLocaleString('en-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 三個固定段 + 自訂段，固定段永遠存在而且排在前面。 */
export function buildQuoteEmailSections(input: {
  itemCount: number;
  totalCents: number;
  sampleItems: string | null;
  introText: string;
  contactPhone: string;
  quoteUrl: string;
  customSections: QuoteEmailCustomSection[];
}): QuoteEmailSection[] {
  const count = Math.max(0, Math.round(Number(input.itemCount) || 0));
  const summaryParts = [
    count > 0 ? `共 ${count} 項傢俬。` : '報價內容請見加單授權連結。',
    input.sampleItems ? `包括：${input.sampleItems}。` : '',
    input.totalCents > 0 ? `參考總額 ${formatQuoteEmailMoney(input.totalCents)}。` : '',
    input.introText.trim(),
  ].filter(Boolean);
  return [
    {
      key: 'summary',
      label: QUOTE_EMAIL_FIXED_LABELS.summary,
      body: summaryParts.join(' '),
    },
    {
      key: 'contact',
      label: QUOTE_EMAIL_FIXED_LABELS.contact,
      body: input.contactPhone.trim()
        ? `如對方案有任何問題，可致電 ${input.contactPhone.trim()} 與負責同事聯絡。`
        : '（未填負責同事電話，未能發送。）',
    },
    {
      key: 'share',
      label: QUOTE_EMAIL_FIXED_LABELS.share,
      body: input.quoteUrl
        ? `需要加單、改數量或替換款式，請用這個連結提交：${input.quoteUrl}`
        : '（這張報價未有有效客戶連結，未能發送。）',
    },
    ...input.customSections.map((section, index) => ({
      key: `custom-${index}` as const,
      label: section.title || `自訂內容 ${index + 1}`,
      body: section.body,
    })),
  ];
}

export function quoteEmailErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (raw.includes('contact_phone_missing')) return QUOTE_EMAIL_PROBLEM_TEXT.contact_phone_missing;
  if (raw.includes('share_link_missing')) return QUOTE_EMAIL_PROBLEM_TEXT.share_link_missing;
  if (raw.includes('invalid_recipient')) return QUOTE_EMAIL_PROBLEM_TEXT.recipient_invalid;
  if (raw.includes('quote_not_found')) return '找不到這張報價，可能已被移動或刪除。';
  if (raw.includes('auto_follow_up_stopped')) return '這張報價已停止自動跟進，不會再自動發信。';
  if (raw.includes('permission_denied') || raw.includes('42501')) return '沒有權限處理這張報價的郵件。';
  if (raw.includes('PGRST202') || raw.includes('Could not find the function')) {
    return '郵件功能尚未部署到這個環境，暫時不能使用。';
  }
  return raw || '沒有完成，請再試一次。';
}

export async function loadQuoteEmailStatus(quoteUuid: string): Promise<QuoteEmailStatusData | null> {
  const { data, error } = await supabase.rpc('fds_quote_email_status', { p_quote_uuid: quoteUuid });
  if (error) throw new Error(quoteEmailErrorMessage(error));
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return {
    quote_uuid: String(row.quote_uuid ?? quoteUuid),
    intro_text: String(row.intro_text ?? ''),
    contact_phone: String(row.contact_phone ?? ''),
    custom_sections: row.custom_sections,
    status: (String(row.status ?? 'not_sent') as QuoteEmailStatus) || 'not_sent',
    recipient_email: row.recipient_email ? String(row.recipient_email) : null,
    auto_follow_up: row.auto_follow_up !== false,
    last_sent_at: row.last_sent_at ? String(row.last_sent_at) : null,
    next_follow_up_at: row.next_follow_up_at ? String(row.next_follow_up_at) : null,
    first_viewed_at: row.first_viewed_at ? String(row.first_viewed_at) : null,
    stopped_at: row.stopped_at ? String(row.stopped_at) : null,
    stop_reason: row.stop_reason ? String(row.stop_reason) : null,
    share_token: row.share_token ? String(row.share_token) : null,
    item_count: Math.max(0, Number(row.item_count) || 0),
    total_amount: Number(row.total_amount) || 0,
    sample_items: row.sample_items ? String(row.sample_items) : null,
    messages: Array.isArray(row.messages) ? (row.messages as QuoteEmailMessageRow[]) : [],
    views: Array.isArray(row.views) ? (row.views as QuoteEmailViewRow[]) : [],
  };
}

export async function saveQuoteEmailTemplate(input: {
  quoteUuid: string;
  introText: string;
  contactPhone: string;
  customSections: QuoteEmailCustomSection[];
}): Promise<void> {
  const { error } = await supabase.rpc('fds_quote_email_template_save', {
    p_quote_uuid: input.quoteUuid,
    p_intro: input.introText.slice(0, 2000),
    p_contact_phone: input.contactPhone.trim().slice(0, 40),
    p_custom_sections: normalizeCustomQuoteEmailSections(input.customSections),
  });
  if (error) throw new Error(quoteEmailErrorMessage(error));
}

export async function scheduleQuoteEmail(input: {
  quoteUuid: string;
  to: string;
  kind?: QuoteEmailMessageKind;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('fds_quote_email_schedule', {
    p_quote_uuid: input.quoteUuid,
    p_to: input.to.trim(),
    p_kind: input.kind ?? 'manual',
  });
  if (error) throw new Error(quoteEmailErrorMessage(error));
  return data ? String(data) : null;
}

export async function stopQuoteEmail(quoteUuid: string, reason = 'manual'): Promise<void> {
  const { error } = await supabase.rpc('fds_quote_email_stop', {
    p_quote_uuid: quoteUuid,
    p_reason: reason,
  });
  if (error) throw new Error(quoteEmailErrorMessage(error));
}

/**
 * 客戶端在真的載入授權頁後呼叫。GET、圖片載入與已知掃描器都不會停信。
 */
export async function recordQuoteShareView(token: string): Promise<{ valid: boolean; reason: string | null } | null> {
  const shareToken = token.trim();
  if (!shareToken) return null;
  const forceInvalid = isLikelyAutomatedClient();
  const { data, error } = await supabase.rpc('record_quote_share_view', {
    p_token: shareToken,
    p_user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    p_referer: typeof document === 'undefined' ? null : document.referrer || null,
    p_force_invalid: forceInvalid,
  });
  if (error) return null;
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return { valid: row.valid === true, reason: row.reason ? String(row.reason) : null };
}

/** 瀏覽器層面像自動化工具（例如 headless 或 webdriver）時，不要把查看當成真人。 */
export function isLikelyAutomatedClient(): boolean {
  if (typeof navigator === 'undefined') return true;
  const nav = navigator as Navigator & { webdriver?: boolean };
  if (nav.webdriver) return true;
  const ua = String(nav.userAgent || '');
  return /(headlesschrome|phantomjs|puppeteer|playwright)/i.test(ua);
}
