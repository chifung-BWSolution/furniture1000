import { supabase } from '@/lib/supabase';
import {
  PACKAGE_PRICE_NOTE,
  PACKAGE_PRICE_YEAR,
  type PackageLine,
  type PackageQuoteSnapshot,
} from '@/lib/packagePricingMath';

type PgError = { message?: string; code?: string } | null;

export function packageQuoteErrorMessage(error: PgError): string {
  const message = error?.message || '';
  if (error?.code === '42P01' || error?.code === '42703' || error?.code === '42883') {
    return '套餐計價還沒準備好，暫時不能使用。請聯絡管理員。';
  }
  if (error?.code === '42501' || message.toLowerCase().includes('permission')) {
    return '沒有權限。';
  }
  return '沒有完成，請再試一次。';
}

interface LineRow {
  id: string;
  area: string;
  item_name: string;
  grade: string;
  material: string;
  dimension_text: string;
  unit_text: string;
  unit_price: number | null;
  standard_note: string;
  premium_note: string;
  default_quantity: number | null;
}

function mapLine(row: LineRow, quantity: number): PackageLine {
  return {
    id: row.id,
    area: row.area,
    itemName: row.item_name,
    grade: row.grade,
    material: row.material,
    dimension: row.dimension_text,
    unit: row.unit_text,
    quantity,
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    standardNote: row.standard_note || '',
    premiumNote: row.premium_note || '',
  };
}

export async function loadPackageTemplate(): Promise<{ lines: PackageLine[]; error: PgError }> {
  const { data, error } = await supabase
    .from('fds_package_price_lines')
    .select('id, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity, sort_order')
    .order('sort_order', { ascending: true });
  if (error) return { lines: [], error };
  const lines = ((data || []) as LineRow[]).map((row) => mapLine(row, Number(row.default_quantity) || 0));
  return { lines, error: null };
}

export async function savePackageBasePrice(id: string, unitPrice: number): Promise<PgError> {
  const { error } = await supabase
    .from('fds_package_price_lines')
    .update({ unit_price: unitPrice, updated_at: new Date().toISOString() })
    .eq('id', id);
  return error;
}

export interface SavedPackageQuote {
  id: string;
  title: string;
  updatedAt: string;
  shareToken: string | null;
}

export async function listPackageQuotes(): Promise<{ quotes: SavedPackageQuote[]; error: PgError }> {
  const { data, error } = await supabase
    .from('fds_package_quotes')
    .select('id, title, updated_at, share_token')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) return { quotes: [], error };
  const quotes = (data || []).map((row) => ({
    id: String(row.id),
    title: String(row.title || ''),
    updatedAt: String(row.updated_at || ''),
    shareToken: row.share_token ? String(row.share_token) : null,
  }));
  return { quotes, error: null };
}

function snapshotOf(title: string, lines: PackageLine[]): PackageQuoteSnapshot {
  return {
    title: title.trim() || '套餐參考報價',
    priceYear: PACKAGE_PRICE_YEAR,
    note: PACKAGE_PRICE_NOTE,
    lines,
  };
}

export async function savePackageQuote(input: {
  id: string | null;
  title: string;
  lines: PackageLine[];
}): Promise<{ id: string | null; error: PgError }> {
  const snapshot = snapshotOf(input.title, input.lines);
  const title = snapshot.title;
  if (input.id) {
    const { error } = await supabase
      .from('fds_package_quotes')
      .update({ title, snapshot, updated_at: new Date().toISOString() })
      .eq('id', input.id);
    return { id: error ? null : input.id, error };
  }
  const { data, error } = await supabase
    .from('fds_package_quotes')
    .insert({ title, snapshot })
    .select('id')
    .single();
  if (error || !data) return { id: null, error: error || { message: 'insert failed' } };
  return { id: String(data.id), error: null };
}

export async function loadPackageQuote(id: string): Promise<{
  title: string;
  lines: PackageLine[];
  shareToken: string | null;
  error: PgError;
}> {
  const { data, error } = await supabase
    .from('fds_package_quotes')
    .select('title, snapshot, share_token')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    return { title: '', lines: [], shareToken: null, error: error || { message: 'missing' } };
  }
  const snapshot = data.snapshot as PackageQuoteSnapshot;
  return {
    title: String(data.title || snapshot?.title || ''),
    lines: Array.isArray(snapshot?.lines) ? snapshot.lines : [],
    shareToken: data.share_token ? String(data.share_token) : null,
    error: null,
  };
}

function newShareToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function ensurePackageShareToken(id: string): Promise<{ token: string | null; error: PgError }> {
  const { data, error } = await supabase
    .from('fds_package_quotes')
    .select('share_token')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return { token: null, error: error || { message: 'missing' } };
  if (data.share_token) return { token: String(data.share_token), error: null };
  const token = newShareToken();
  const { error: updateError } = await supabase
    .from('fds_package_quotes')
    .update({ share_token: token, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) return { token: null, error: updateError };
  return { token, error: null };
}

export async function loadSharedPackageQuote(token: string): Promise<{
  snapshot: PackageQuoteSnapshot | null;
  error: PgError;
}> {
  const { data, error } = await supabase.rpc('fds_package_quote_by_token', { p_token: token });
  if (error) return { snapshot: null, error };
  if (!data || typeof data !== 'object') return { snapshot: null, error: null };
  return { snapshot: data as PackageQuoteSnapshot, error: null };
}
