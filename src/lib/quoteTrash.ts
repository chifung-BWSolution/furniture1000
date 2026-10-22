import { supabase } from '@/lib/supabase';
import { invalidateQuoteListCache } from '@/lib/quoteListData';

/** Soft-delete marker stored on the existing bwf_quote.status column. */
export const QUOTE_TRASH_STATUS = '回收桶';

type TrashMeta = {
  previousStatus?: string;
  trashedAt?: string;
};

export type TrashedQuoteRow = {
  id: string;
  quoteId: string;
  version: string;
  totalAmount: number;
  submitter: string;
  createdAt: string | null;
  clientName: string;
  trashedAt: string | null;
  previousStatus: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readTrashMeta(projectData: unknown): TrashMeta {
  const raw = asRecord(projectData)._fdsTrash;
  return asRecord(raw) as TrashMeta;
}

function clientNameFromProject(projectData: unknown): string {
  const form = asRecord(asRecord(projectData).formData);
  const client = asRecord(asRecord(projectData).clientInfo);
  const name = String(form.clientName || client.name || '').trim();
  return name;
}

export function isQuoteInTrash(status: string | null | undefined): boolean {
  return status === QUOTE_TRASH_STATUS;
}

const trashListeners = new Set<() => void>();

/** Sidebar badge refreshes after a quote is moved to or restored from the trash. */
export function subscribeTrashedQuotes(listener: () => void): () => void {
  trashListeners.add(listener);
  return () => {
    trashListeners.delete(listener);
  };
}

/**
 * Badge count cache.
 *
 * The badge is rendered by the sidebar, which mounts on every section change
 * (and twice more under React StrictMode). Without a cache each mount fired
 * its own exact-count query against `bwf_quote`; the in-flight entry also
 * stops the StrictMode double mount from issuing a second request.
 */
const TRASH_COUNT_TTL_MS = 60 * 1000;
let trashCountCache: { at: number; value: Promise<number> } | null = null;

function notifyTrashedQuotesChanged(): void {
  // The badge must show the new number, so the cached count is dropped.
  trashCountCache = null;
  // The cached quote list still holds the row that just moved in or out.
  invalidateQuoteListCache();
  trashListeners.forEach((listener) => listener());
}

export async function moveQuoteToTrash(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select('status, project_data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('找不到報價單');
  if (data.status === QUOTE_TRASH_STATUS) return;

  const projectData = asRecord(data.project_data);
  const next = {
    ...projectData,
    _fdsTrash: {
      previousStatus: String(data.status || '待審核'),
      trashedAt: new Date().toISOString(),
    },
  };
  const { error: updateError } = await supabase
    .from('bwf_quote')
    .update({ status: QUOTE_TRASH_STATUS, project_data: next })
    .eq('id', id);
  if (updateError) throw updateError;
  notifyTrashedQuotesChanged();
}

export async function restoreQuoteFromTrash(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select('status, project_data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('找不到報價單');
  if (data.status !== QUOTE_TRASH_STATUS) return;

  const projectData = asRecord(data.project_data);
  const meta = readTrashMeta(projectData);
  const previous = String(meta.previousStatus || '待審核').trim() || '待審核';
  const rest = { ...projectData };
  delete rest._fdsTrash;
  const { error: updateError } = await supabase
    .from('bwf_quote')
    .update({
      status: previous === QUOTE_TRASH_STATUS ? '待審核' : previous,
      project_data: rest,
    })
    .eq('id', id);
  if (updateError) throw updateError;
  notifyTrashedQuotesChanged();
}

/** Same `status = 回收桶` rows as {@link listTrashedQuotes}, without downloading quote JSON. */
export async function countTrashedQuotes(force = false): Promise<number> {
  if (!force && trashCountCache && Date.now() - trashCountCache.at < TRASH_COUNT_TTL_MS) {
    return trashCountCache.value;
  }
  const value = (async () => {
    const { count, error } = await supabase
      .from('bwf_quote')
      .select('id', { count: 'exact', head: true })
      .eq('status', QUOTE_TRASH_STATUS);
    if (error) throw error;
    return count ?? 0;
  })();
  trashCountCache = { at: Date.now(), value };
  value.catch(() => {
    if (trashCountCache?.value === value) trashCountCache = null;
  });
  return value;
}

export async function listTrashedQuotes(): Promise<TrashedQuoteRow[]> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select('id, quote_id, version, total_amount, submitter, created_at, project_data')
    .eq('status', QUOTE_TRASH_STATUS)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((row) => {
    const meta = readTrashMeta(row.project_data);
    return {
      id: String(row.id),
      quoteId: String(row.quote_id || ''),
      version: String(row.version || ''),
      totalAmount: Number(row.total_amount) || 0,
      submitter: String(row.submitter || ''),
      createdAt: row.created_at ? String(row.created_at) : null,
      clientName: clientNameFromProject(row.project_data),
      trashedAt: meta.trashedAt ? String(meta.trashedAt) : null,
      previousStatus: String(meta.previousStatus || '待審核'),
    };
  });
}
