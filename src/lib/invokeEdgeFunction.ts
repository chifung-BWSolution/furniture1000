import { parseInvokeError } from '@/lib/edgeFunctionErrors';
import { supabase } from '@/lib/supabase';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type InvokeEdgeResult<T = Record<string, unknown>> = {
  data: T | null;
  error: Error | null;
  status: number;
};

/**
 * Invoke a Supabase Edge Function via direct fetch (bypasses functions-relay).
 * Use for long-running jobs like full Shopify mirror reconcile.
 */
export async function invokeEdgeFunctionDirect<T = Record<string, unknown>>(
  slug: string,
  body: unknown = {},
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<InvokeEdgeResult<T>> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token ?? anonKey;

  const controller = new AbortController();
  // The caller may cancel on unmount. Forward that abort to our controller so
  // the request is really cancelled, not just ignored.
  const externalSignal = opts?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        return {
          data: null,
          error: new Error(text.slice(0, 300) || `HTTP ${res.status}`),
          status: res.status,
        };
      }
    }

    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error || `HTTP ${res.status}`;
      return { data, error: new Error(msg), status: res.status };
    }

    return { data, error: null, status: res.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // A caller-cancelled request is not a failure worth showing to the user.
      if (externalSignal?.aborted) {
        return { data: null, error: new Error('已取消'), status: 0 };
      }
      return {
        data: null,
        error: new Error('Edge Function 逾時，請稍後再試或聯絡管理員'),
        status: 408,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, error: new Error(message), status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Session access token for edge calls that must not fall back to the anon key. */
export async function requireUserAccessToken(): Promise<string> {
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) throw new Error('請先登入');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token?.trim();
  if (!token) throw new Error('請先登入');
  return token;
}

export async function invokeWithUserJwt<T = Record<string, unknown>>(
  slug: string,
  body: unknown,
): Promise<{ data: T | null; error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await requireUserAccessToken();
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : '請先登入' };
  }
  const { data, error } = await supabase.functions.invoke<T>(slug, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error || (data as { error?: string } | null)?.error) {
    const message = await parseInvokeError(error, data as { error?: string } | null);
    return { data: data ?? null, error: explainEmailInvokeError(message) };
  }
  return { data: data ?? null, error: null };
}

export function explainEmailInvokeError(message: string): string {
  if (message === 'Unauthorized' || message === '請先登入') return '請先登入';
  if (message === 'permission_denied') return '只有管理員、上載員或專案經理可以寄出這封信';
  if (message === 'recipient_not_allowed') {
    return '收件人必須是上載紀錄通知信箱，或在職帳號的電郵';
  }
  return message;
}
