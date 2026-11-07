import { supabase } from '@/lib/supabase';
import { readStoredQuoteShareToken } from '@/lib/customerPortalRoutes';
import {
  mapRowToItem,
  type BwfQuoteItemInput,
  type BwfQuoteItemRow,
} from '@/lib/bwfQuoteItems';

export interface CustomerQuoteHeader {
  id: string;
  quote_id: string;
  version: string;
  status: string;
  total_amount: number;
  created_at: string;
  modified_date?: string | null;
  project_data: Record<string, unknown>;
  pitching?: null;
}

type PostgrestError = { code?: string; message?: string } | null;

export function customerQuoteError(error: PostgrestError): string {
  const message = error?.message || '';
  if (
    error?.code === 'PGRST202'
    || message.includes('get_shared_quote')
    || message.includes('get_quote_pdf_payload')
    || message.includes('get_customer_quote')
    || message.includes('list_customer_quotes')
    || message.includes('save_customer_quote_scheme')
    || message.includes('submit_customer_quote_request')
  ) {
    return '分享報價暫時不能使用。已保存的資料沒有被改動。';
  }
  if (message.includes('empty_request')) return '未選擇任何產品，未能提交。';
  if (message.includes('invalid_quantity')) return '有產品數量無效，請重新輸入。';
  if (message.includes('catalog_product_unavailable')) return '所選家具已下架或不在客戶目錄，請重新選擇。';
  if (message.includes('original_item_not_found')) return '找不到要更換的原報價項目，請重新整理後再試。';
  if (error?.code === '42501' || message.includes('permission_denied') || message.includes('invalid_token')) {
    return '分享連結無效或已撤銷。';
  }
  return message || '無法載入分享報價。';
}

function asHeader(value: unknown): CustomerQuoteHeader | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string') return null;
  const projectData = row.project_data && typeof row.project_data === 'object' && !Array.isArray(row.project_data)
    ? row.project_data as Record<string, unknown>
    : {};
  return {
    id: row.id,
    quote_id: String(row.quote_id || ''),
    version: String(row.version || ''),
    status: String(row.status || ''),
    total_amount: Number(row.total_amount) || 0,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    modified_date: typeof row.modified_date === 'string' ? row.modified_date : null,
    project_data: projectData,
    pitching: null,
  };
}

function asItems(value: unknown): BwfQuoteItemInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => mapRowToItem(item as BwfQuoteItemRow));
}

export async function fetchSharedCustomerQuote(token: string): Promise<{
  quote: CustomerQuoteHeader;
  items: BwfQuoteItemInput[];
} | null> {
  const { data, error } = await supabase.rpc('get_shared_quote', { p_token: token });
  if (error) throw error;
  const quote = asHeader(data);
  if (!quote) return null;
  const row = data as Record<string, unknown>;
  return { quote, items: asItems(row.items) };
}

export async function fetchCustomerQuote(id: string): Promise<{
  quote: CustomerQuoteHeader;
  items: BwfQuoteItemInput[];
} | null> {
  const { data, error } = await supabase.rpc('get_customer_quote', { p_id: id });
  if (error) throw error;
  const quote = asHeader(data);
  if (!quote) return null;
  const row = data as Record<string, unknown>;
  return { quote, items: asItems(row.items) };
}

export async function listCustomerQuotes(): Promise<CustomerQuoteHeader[]> {
  const { data, error } = await supabase.rpc('list_customer_quotes');
  if (error) throw error;
  return Array.isArray(data)
    ? data.map(asHeader).filter((row): row is CustomerQuoteHeader => row !== null)
    : [];
}

export async function loadCustomerSafeItems(quoteUuid: string): Promise<BwfQuoteItemInput[]> {
  const token = readStoredQuoteShareToken()?.trim() || '';
  if (token) {
    const shared = await fetchSharedCustomerQuote(token);
    if (shared?.quote.id === quoteUuid) return shared.items;
  }
  const quote = await fetchCustomerQuote(quoteUuid);
  return quote?.items ?? [];
}

export interface CustomerQuoteRequestLine {
  id: string;
  quantity: number;
  selected: boolean;
  note?: string;
  /** 加入目錄商品（加選／換款）時使用；原有明細留空。 */
  kind?: 'addition' | 'replacement';
  /** 目錄商品 id（products.id 或 shopify_product_id）。 */
  productId?: string;
  /** 換款時被替換的原報價項目。 */
  originalItemId?: string;
  /** 以下只在讀回提交紀錄時有值（顯示用）。 */
  name?: string;
  unit?: string;
  unitPrice?: number | null;
  originalName?: string;
  image?: string;
}

export type CustomerQuoteRequestType =
  | 'scheme'
  | 'selection'
  | 'quantity'
  | 'additional'
  | 'replacement'
  | 'change'
  | 'confirm'
  | 'reject';

/**
 * FDS-14：客戶提交只建立自己的需求記錄，正式報價的單價與明細不會被改寫。
 * 同一份內容重送會回傳同一筆需求（伺服器以內容雜湊去重）。
 * 加選／換款的商品資格由伺服器按客戶目錄重新核對，前端傳入的價格只作顯示。
 */
export async function submitCustomerQuoteRequest(input: {
  token: string | null;
  quoteId: string;
  lines: CustomerQuoteRequestLine[];
  note?: string;
  requestType?: CustomerQuoteRequestType;
  idempotencyKey?: string | null;
  quoteVersion?: string | null;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('submit_customer_quote_request', {
    p_token: input.token,
    p_quote_id: input.quoteId,
    p_lines: input.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      selected: line.selected,
      ...(line.note ? { note: line.note } : {}),
      ...(line.kind ? { kind: line.kind } : {}),
      ...(line.productId ? { productId: line.productId } : {}),
      ...(line.originalItemId ? { originalItemId: line.originalItemId } : {}),
    })),
    p_note: (input.note ?? '').slice(0, 1000),
    p_idempotency_key: input.idempotencyKey ?? null,
    p_request_type: input.requestType ?? 'scheme',
    p_quote_version: input.quoteVersion ?? '',
  });
  if (error) throw error;
  return data ? String(data) : null;
}

/** 舊呼叫點沿用同一支提交（不再改寫正式報價）。 */
export async function saveCustomerQuoteScheme(input: {
  token: string | null;
  quoteId: string;
  lines: { id: string; quantity: number; selected: boolean }[];
}): Promise<void> {
  await submitCustomerQuoteRequest({
    token: input.token,
    quoteId: input.quoteId,
    lines: input.lines,
    requestType: 'scheme',
  });
}

/** 加選／換款一併提交；伺服器會逐項核對原項目歸屬與目錄上架資格。 */
export async function submitCustomerQuoteChanges(input: {
  token: string | null;
  quoteId: string;
  quoteVersion?: string | null;
  note?: string;
  additions: { productId: string; quantity: number; note?: string }[];
  replacements: {
    originalItemId: string;
    productId: string;
    quantity: number;
    note?: string;
  }[];
}): Promise<string | null> {
  const lines: CustomerQuoteRequestLine[] = [
    ...input.additions.map((row) => ({
      id: row.productId,
      productId: row.productId,
      kind: 'addition' as const,
      quantity: row.quantity,
      selected: true,
      note: row.note,
    })),
    ...input.replacements.map((row) => ({
      id: row.productId,
      productId: row.productId,
      originalItemId: row.originalItemId,
      kind: 'replacement' as const,
      quantity: row.quantity,
      selected: true,
      note: row.note,
    })),
  ];
  if (lines.length === 0) return null;
  return submitCustomerQuoteRequest({
    token: input.token,
    quoteId: input.quoteId,
    quoteVersion: input.quoteVersion,
    note: input.note,
    requestType: 'change',
    lines,
  });
}

/**
 * 確認／拒絕所顯示的報價版本（沒有關聯設計專案也適用）。
 * 只記錄客戶對這個版本的決定，不改寫正式報價金額。
 */
export async function confirmSharedCustomerQuote(input: {
  token: string | null;
  quoteId: string;
  quoteVersion: string;
  note?: string;
  decision?: 'confirmed' | 'rejected';
}): Promise<string | null> {
  const decision = input.decision === 'rejected' ? 'rejected' : 'confirmed';
  return submitCustomerQuoteRequest({
    token: input.token,
    quoteId: input.quoteId,
    quoteVersion: input.quoteVersion,
    note: input.note,
    requestType: decision === 'rejected' ? 'reject' : 'confirm',
    lines: [],
    idempotencyKey: `${decision}:${input.quoteVersion || 'v1'}`.slice(0, 120),
  });
}

export interface CustomerSharedQuoteRequestRow {
  id: string;
  quote_uuid: string;
  quote_id: string;
  quote_version: string;
  request_type: CustomerQuoteRequestType | string;
  status: string;
  note: string;
  lines: CustomerQuoteRequestLine[];
  total_cents: number;
  submitted_at: string;
}

/** 客戶讀回自己在這張報價的提交（回執與待處理提示）。 */
export async function fetchSharedQuoteRequests(
  token: string | null,
  quoteId?: string | null,
): Promise<CustomerSharedQuoteRequestRow[]> {
  const { data, error } = await supabase.rpc('fds_shared_quote_requests', {
    p_token: token,
    p_quote_id: quoteId?.trim() || null,
    p_limit: 50,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as CustomerSharedQuoteRequestRow[]).map((row) => ({
    ...row,
    lines: Array.isArray(row.lines) ? row.lines : [],
  }));
}
