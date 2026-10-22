import { supabase } from '@/lib/supabase';

export interface QuoteRecord {
  id: string;
  quote_id: string;
  version: string;
  status: string;
  total_amount: number;
  cost_price: number | null;
  submitter: string;
  bwf_pitching_id: string | null;
  project_data: {
    formData?: {
      clientName?: string;
      clientContactName?: string;
      company?: string;
      projectManager?: string;
      clientIndustry?: string[];
      clientIndustryOther?: string;
    };
    clientInfo?: {
      name?: string;
      contactName?: string;
      phone?: string;
      email?: string;
    };
    [key: string]: unknown;
  };
  created_at: string;
  modified_date?: string | null;
}


/** Only list facts: never download questionnaire snapshots, terms or embedded images. */
export const QUOTE_LIST_COLUMNS = [
  'id,quote_id,version,status,total_amount,cost_price,submitter,bwf_pitching_id,created_at,modified_date',
  'client_name:project_data->formData->>clientName',
  'contact_name:project_data->formData->>clientContactName',
  'company:project_data->formData->>company',
  'project_manager:project_data->formData->>projectManager',
  'client_industry:project_data->formData->clientIndustry',
  'client_industry_other:project_data->formData->>clientIndustryOther',
  'client_info_name:project_data->clientInfo->>name',
  'client_info_contact:project_data->clientInfo->>contactName',
  'quote_date:project_data->quoteMeta->>date',
].join(',');

type QuoteListProjection = Omit<QuoteRecord, 'project_data'> & {
  client_name?: string | null;
  contact_name?: string | null;
  company?: string | null;
  project_manager?: string | null;
  client_industry?: string[] | null;
  client_industry_other?: string | null;
  client_info_name?: string | null;
  client_info_contact?: string | null;
  quote_date?: string | null;
};

export function toQuoteListRecord(row: Record<string, unknown>): QuoteRecord {
  const raw = row as unknown as QuoteListProjection;
  return {
    ...raw,
    project_data: {
      formData: {
        clientName: raw.client_name ?? undefined, clientContactName: raw.contact_name ?? undefined,
        company: raw.company ?? undefined, projectManager: raw.project_manager ?? undefined,
        clientIndustry: raw.client_industry ?? undefined, clientIndustryOther: raw.client_industry_other ?? undefined,
      },
      clientInfo: { name: raw.client_info_name ?? undefined, contactName: raw.client_info_contact ?? undefined },
      quoteMeta: { date: raw.quote_date },
    },
  };
}

export async function fetchQuoteListPage(from: number, pageSize: number, withCount: boolean, largeAmount = false) {
  let query = supabase.from('bwf_quote')
    .select(QUOTE_LIST_COLUMNS, withCount ? { count: 'exact' } : undefined)
    .neq('status', '回收桶')
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (largeAmount) query = query.gt('total_amount', 50000);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: ((data || []) as unknown as Record<string, unknown>[]).map(toQuoteListRecord), count: count ?? null };
}

/** Counting can take seconds; run it independently of the first visible page. */
export async function fetchQuoteListCount(largeAmount = false): Promise<number | null> {
  let query = supabase.from('bwf_quote').select('id', { count: 'exact', head: true }).neq('status', '回收桶');
  if (largeAmount) query = query.gt('total_amount', 50000);
  const { count, error } = await query;
  if (error) throw error;
  return count;
}


/** Fetch only sibling versions not already present on the requested page. */
export async function attachQuoteListSiblings(rows: QuoteRecord[]): Promise<QuoteRecord[]> {
  const quoteIds = [...new Set(rows.map((row) => row.quote_id?.trim()).filter(Boolean))];
  if (quoteIds.length === 0) return rows;
  const { data, error } = await supabase.from('bwf_quote')
    .select(QUOTE_LIST_COLUMNS)
    .in('quote_id', quoteIds)
    .not('id', 'in', `(${rows.map((row) => row.id).join(',')})`)
    .neq('status', '回收桶');
  if (error || !data) return rows;
  const siblings = (data as unknown as Record<string, unknown>[]).map(toQuoteListRecord);
  return [...new Map([...rows, ...siblings].map((row) => [row.id, row])).values()];
}
