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

export interface QuoteListPage {
  rows: QuoteRecord[];
  count: number | null;
}

/**
 * Shared read cache for the quote list.
 *
 * The same rows used to be requested again on every mount: React StrictMode
 * mounts twice in development, and every sidebar click remounts the page.
 * Each of those fired its own identical round trip, and because the browser
 * keeps only 6 connections per host they queued behind each other — a 0.4 ms
 * database scan was observed taking 4-7 s in the network panel.
 *
 * - In-flight de-duplication: a second caller reuses the running request.
 * - TTL: coming back to the list within the window reuses the rows.
 */
const CACHE_TTL_MS = 30 * 1000;

type CacheEntry<T> = { at: number; value: T };

const pageCache = new Map<string, CacheEntry<Promise<QuoteListPage>>>();
const siblingCache = new Map<string, CacheEntry<Promise<QuoteRecord[]>>>();
const countCache = new Map<string, CacheEntry<Promise<number | null>>>();

function shared<T>(
  store: Map<string, CacheEntry<Promise<T>>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = load();
  store.set(key, { at: Date.now(), value });
  // A failed request must never be cached.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

/** Drop every cached quote-list read (manual refresh, quote moved to trash). */
export function invalidateQuoteListCache(): void {
  pageCache.clear();
  siblingCache.clear();
  countCache.clear();
}

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

export async function fetchQuoteListPage(
  from: number,
  pageSize: number,
  withCount: boolean,
  largeAmount = false,
  search = '',
  pitchingIds: string[] = [],
): Promise<QuoteListPage> {
  const term = search.trim();
  const pitchingKey = [...pitchingIds].filter(Boolean).sort().join(',');
  const key = `page:${from}:${pageSize}:${withCount ? 1 : 0}:${largeAmount ? 1 : 0}:${term}:${pitchingKey}`;
  return shared(pageCache, key, async () => {
    // Page chains before fetching their headers or siblings. Paging bwf_quote
    // directly lets old versions repeat the same chain on several pages.
    // Search runs inside the RPC so a match on another page is not dropped.
    const { data: ids, error: idsError, count } = await supabase
      .rpc(
        'latest_quote_version_ids',
        {
          p_large_amount: largeAmount,
          ...(term ? { p_search: term } : {}),
          ...(pitchingKey ? { p_pitching_ids: pitchingKey.split(',') } : {}),
        },
        withCount ? { count: 'exact' } : undefined,
      )
      .range(from, from + pageSize - 1);
    if (idsError) throw idsError;
    if (!ids?.length) return { rows: [], count: count ?? null };
    const { data, error } = await supabase.from('bwf_quote')
      .select(QUOTE_LIST_COLUMNS)
      .in('id', ids.map((row: { id: string }) => row.id))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    return { rows: ((data || []) as unknown as Record<string, unknown>[]).map(toQuoteListRecord), count: count ?? null };
  });
}

/** Counting can take seconds; run it independently of the first visible page. */
export async function fetchQuoteListCount(largeAmount = false): Promise<number | null> {
  const key = `count:${largeAmount ? 1 : 0}`;
  return shared(countCache, key, async () => {
    const { count, error } = await supabase.rpc('latest_quote_version_ids',
      { p_large_amount: largeAmount }, { count: 'exact', head: true });
    if (error) throw error;
    return count;
  });
}


/** Fetch only sibling versions not already present on the requested page. */
export async function attachQuoteListSiblings(rows: QuoteRecord[]): Promise<QuoteRecord[]> {
  const quoteIds = [...new Set(rows.map((row) => row.quote_id?.trim()).filter(Boolean))].sort();
  if (quoteIds.length === 0) return rows;
  const pageIds = rows.map((row) => row.id).sort();
  const key = `siblings:${quoteIds.join(',')}|${pageIds.join(',')}`;
  return shared(siblingCache, key, async () => {
    const { data, error } = await supabase.from('bwf_quote')
      .select(QUOTE_LIST_COLUMNS)
      .in('quote_id', quoteIds)
      .not('id', 'in', `(${pageIds.join(',')})`)
      .neq('status', '回收桶');
    if (error || !data) return rows;
    const siblings = (data as unknown as Record<string, unknown>[]).map(toQuoteListRecord);
    return [...new Map([...rows, ...siblings].map((row) => [row.id, row])).values()];
  });
}
