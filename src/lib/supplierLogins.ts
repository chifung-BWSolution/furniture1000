import { supabase } from '@/lib/supabase';
import { loadManufacturerDirectory } from '@/lib/manufacturerDirectory';

export type SupplierLogin = {
  id: string;
  email: string;
  factoryId: string;
  factoryName: string;
  active: boolean;
};

export type SupplierDocumentRow = {
  id: string;
  title: string | null;
  status: string;
  factoryId: string | null;
  factoryName: string;
  docType: string;
  createdAt: string;
  errorMessage: string | null;
};

export type DirectoryFactory = {
  id: string;
  name: string;
};

type PostgrestError = { code?: string; message: string } | null;

type LoginRow = {
  id: string;
  email: string;
  factory_id: string;
  factory_name: string | null;
  active: boolean;
};

type LoginTable = {
  select: (columns: string) => {
    order: (
      column: string,
      options: { ascending: boolean },
    ) => Promise<{ data: LoginRow[] | null; error: PostgrestError }>;
  };
  update: (patch: Record<string, unknown>) => {
    eq: (column: string, value: string) => Promise<{ error: PostgrestError }>;
  };
};

function logins(): LoginTable {
  return (supabase as unknown as { from: (table: string) => LoginTable }).from('supplier_logins');
}

export function isMissingSupplierLoginTable(error: PostgrestError): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message}`;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    error.code === 'PGRST202' ||
    /schema cache|does not exist|Could not find/i.test(text)
  );
}

export async function loadDirectoryFactories(): Promise<{ factories: DirectoryFactory[]; error: string | null }> {
  try {
    const rows = await loadManufacturerDirectory();
    const factories = rows
      .map((row) => ({ id: String(row.id ?? ''), name: String(row.display_name ?? '').trim() }))
      .filter((row) => row.id && row.name);
    return { factories, error: null };
  } catch (err) {
    return { factories: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadSupplierLogins(): Promise<{
  rows: SupplierLogin[];
  missingTable: boolean;
  error: string | null;
}> {
  const { data, error } = await logins()
    .select('id, email, factory_id, factory_name, active')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingSupplierLoginTable(error)) return { rows: [], missingTable: true, error: null };
    return { rows: [], missingTable: false, error: error.message };
  }
  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      factoryId: row.factory_id,
      factoryName: row.factory_name ?? '',
      active: row.active,
    })),
    missingTable: false,
    error: null,
  };
}

export async function setSupplierLoginActive(id: string, active: boolean): Promise<{ error: string | null }> {
  const { error } = await logins().update({ active, updated_at: new Date().toISOString() }).eq('id', id);
  return { error: error?.message ?? null };
}

export async function inviteSupplier(input: {
  email: string;
  factoryId: string;
  factoryName: string;
}): Promise<{ ok: boolean; error: string | null; alreadyRegistered: boolean }> {
  const body = {
    email: input.email.trim().toLowerCase(),
    factory_id: input.factoryId,
    factory_name: input.factoryName,
    display_name: input.factoryName,
  };
  const slugs = ['supabase-functions-invite-supplier', 'invite-supplier'];
  let lastError = '邀請失敗';
  for (const slug of slugs) {
    const { data, error } = await supabase.functions.invoke(slug, { body });
    if (error) {
      lastError = error.message;
      if (/not found|404/i.test(error.message)) continue;
      return { ok: false, error: error.message, alreadyRegistered: false };
    }
    const payload = data as { error?: string; already_registered?: boolean } | null;
    if (payload?.error) {
      lastError = payload.error;
      if (/not found|404/i.test(payload.error)) continue;
      return { ok: false, error: payload.error, alreadyRegistered: false };
    }
    return { ok: true, error: null, alreadyRegistered: payload?.already_registered === true };
  }
  return { ok: false, error: lastError, alreadyRegistered: false };
}

export async function loadSupplierReviewDocuments(): Promise<{
  rows: SupplierDocumentRow[];
  missing: boolean;
  error: string | null;
}> {
  const rpc = supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: unknown; error: PostgrestError }>;
  };
  const { data, error } = await rpc.rpc('fds_supplier_review_documents');
  if (error) {
    if (isMissingSupplierLoginTable(error)) return { rows: [], missing: true, error: null };
    if (/permission_denied|42501/i.test(`${error.code ?? ''} ${error.message}`)) {
      return { rows: [], missing: false, error: null };
    }
    return { rows: [], missing: false, error: error.message };
  }
  const list = Array.isArray(data) ? data : [];
  return {
    rows: list.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? ''),
        title: item.title == null ? null : String(item.title),
        status: String(item.status ?? ''),
        factoryId: item.factory_id == null ? null : String(item.factory_id),
        factoryName: String(item.factory_name ?? ''),
        docType: String(item.doc_type ?? ''),
        createdAt: String(item.created_at ?? ''),
        errorMessage: item.error_message == null ? null : String(item.error_message),
      };
    }),
    missing: false,
    error: null,
  };
}
