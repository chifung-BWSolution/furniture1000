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
    || message.includes('get_customer_quote')
    || message.includes('list_customer_quotes')
    || message.includes('save_customer_quote_scheme')
  ) {
    return '分享報價尚未部署。這次沒有改正式資料庫。';
  }
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

export async function saveCustomerQuoteScheme(input: {
  token: string | null;
  quoteId: string;
  lines: { id: string; quantity: number; selected: boolean }[];
}): Promise<void> {
  const { error } = await supabase.rpc('save_customer_quote_scheme', {
    p_token: input.token,
    p_quote_id: input.quoteId,
    p_lines: input.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      selected: line.selected,
    })),
  });
  if (error) throw error;
}
