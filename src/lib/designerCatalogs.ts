import { supabase } from '@/lib/supabase';

export type CatalogDocType = 'quote' | 'catalog';
export type CatalogStatus = 'uploaded' | 'parsing' | 'review' | 'ready' | 'failed';

export interface CatalogSegment {
  seq: number;
  start_page: number;
  end_page: number;
  kind: string;
  title?: string | null;
}

export interface CatalogDocument {
  id: string;
  title?: string | null;
  factory_name?: string | null;
  doc_type: CatalogDocType;
  status: CatalogStatus;
  page_count?: number | null;
  parsing_progress?: number | null;
  created_at: string;
  product_count: number;
  segments: CatalogSegment[];
}

export interface CatalogList {
  can_open_source: boolean;
  factories: string[];
  items: CatalogDocument[];
}

function rpcErrorMessage(message: string): string {
  if (message.includes('permission_denied')) return '沒有權限（只限公司職員）';
  return message;
}

export async function fetchDesignerCatalogs(opts: {
  query?: string;
  factory?: string;
  docType?: CatalogDocType | '';
}): Promise<CatalogList> {
  const { data, error } = await supabase.rpc('fds_designer_catalogs', {
    p_query: opts.query?.trim() || null,
    p_factory: opts.factory || null,
    p_doc_type: opts.docType || null,
  });
  if (error) throw new Error(rpcErrorMessage(error.message));
  const raw = (data ?? {}) as Partial<CatalogList>;
  return {
    can_open_source: raw.can_open_source === true,
    factories: Array.isArray(raw.factories) ? raw.factories.filter((name) => typeof name === 'string') : [],
    items: Array.isArray(raw.items) ? raw.items : [],
  };
}
