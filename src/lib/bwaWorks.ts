import { supabase } from '@/lib/supabase';

export type BwaWorkKind = 'project' | 'pitching';

export interface BwaWorkOption {
  kind: BwaWorkKind;
  project_id: string | null;
  pitching_id: string | null;
  code: string;
  name: string;
  customer_name: string | null;
}

function asOption(value: unknown): BwaWorkOption | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind === 'project' || row.kind === 'pitching' ? row.kind : null;
  if (!kind) return null;
  return {
    kind,
    project_id: typeof row.project_id === 'string' ? row.project_id : null,
    pitching_id: typeof row.pitching_id === 'string' ? row.pitching_id : null,
    code: String(row.code || ''),
    name: String(row.name || ''),
    customer_name: typeof row.customer_name === 'string' && row.customer_name ? row.customer_name : null,
  };
}

export async function searchBwaWorks(search: string): Promise<{ items: BwaWorkOption[]; error: string }> {
  const body = { search: search.trim(), limit: 15 };
  const slugs = ['supabase-functions-fetch-bwa-works', 'fetch-bwa-works'];
  let lastError = 'BWA 工程清單尚未部署。可以先手填編號和名稱。';
  for (const slug of slugs) {
    const { data, error } = await supabase.functions.invoke(slug, { body });
    if (error) {
      lastError = error.message || lastError;
      continue;
    }
    if (data?.error) {
      lastError = String(data.error);
      continue;
    }
    const items = Array.isArray(data?.items)
      ? data.items.map(asOption).filter((row): row is BwaWorkOption => row !== null)
      : [];
    return { items, error: '' };
  }
  return { items: [], error: lastError };
}
