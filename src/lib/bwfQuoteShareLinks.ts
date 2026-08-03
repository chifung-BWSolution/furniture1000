import { supabase } from '@/lib/supabase';
import { withInsertAuditFields } from '@/lib/pmsAudit';
import { buildCustomerPortalQuoteShareUrl } from '@/lib/customerPortalRoutes';

export type QuoteShareLink = {
  id: string;
  quoteUuid: string;
  quoteId: string;
  shareToken: string;
  status: 'active' | 'revoked';
  url: string;
};

function makeShareToken() {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `qtok_${rand.slice(0, 20)}`;
}

function mapShareRow(row: {
  id: string;
  quote_uuid: string;
  quote_id: string;
  share_token: string;
  status: string;
}): QuoteShareLink {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://fds.app';
  return {
    id: row.id,
    quoteUuid: row.quote_uuid,
    quoteId: row.quote_id,
    shareToken: row.share_token,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    url: buildCustomerPortalQuoteShareUrl(origin, row.share_token),
  };
}

/** Create a fresh share link for a saved quote (always new token / QR). */
export async function createQuoteShareLink(input: {
  quoteUuid: string;
  quoteId: string;
}): Promise<{ ok: true; data: QuoteShareLink } | { ok: false; error: string }> {
  const quoteUuid = input.quoteUuid.trim();
  const quoteId = input.quoteId.trim();
  if (!quoteUuid || !quoteId) {
    return { ok: false, error: '報價單尚未儲存，請先完成版本審核' };
  }
  try {
    const insertPayload = await withInsertAuditFields({
      quote_uuid: quoteUuid,
      quote_id: quoteId,
      share_token: makeShareToken(),
      status: 'active',
    });
    const { data, error } = await supabase
      .from('bwf_quote_share_links')
      .insert(insertPayload)
      .select('id, quote_uuid, quote_id, share_token, status')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message || '建立連結失敗' };
    }
    return { ok: true, data: mapShareRow(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '建立連結失敗' };
  }
}

/** Resolve an active quote_share token to the target quote. */
export async function resolveQuoteShareToken(
  token: string,
): Promise<{ quoteUuid: string; quoteId: string } | null> {
  // Tokens are `qtok_…`; strip accidental wrapping from copy/paste or QR readers.
  const shareToken = token
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/^quote_share=/i, '');
  if (!shareToken) return null;

  // If a full URL was pasted/scanned, pull the query param out.
  let normalized = shareToken;
  if (normalized.includes('quote_share=')) {
    try {
      const url = normalized.includes('://')
        ? new URL(normalized)
        : new URL(normalized, 'https://local.invalid');
      const fromQuery = url.searchParams.get('quote_share')?.trim();
      if (fromQuery) normalized = fromQuery;
    } catch {
      const m = normalized.match(/[?&#]quote_share=([^&]+)/i);
      if (m?.[1]) {
        try {
          normalized = decodeURIComponent(m[1]);
        } catch {
          normalized = m[1];
        }
      }
    }
  }

  const { data, error } = await supabase
    .from('bwf_quote_share_links')
    .select('quote_uuid, quote_id, status')
    .eq('share_token', normalized)
    .maybeSingle();
  if (error) {
    console.warn('[resolveQuoteShareToken]', error.message, { token: normalized });
    return null;
  }
  if (!data || data.status !== 'active') return null;

  try {
    void supabase
      .from('bwf_quote_share_links')
      .update({ last_viewed_at: new Date().toISOString() })
      .eq('share_token', normalized);
  } catch {
    /* non-blocking */
  }

  return {
    quoteUuid: String(data.quote_uuid),
    quoteId: String(data.quote_id || ''),
  };
}
