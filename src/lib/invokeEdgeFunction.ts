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
  opts?: { timeoutMs?: number },
): Promise<InvokeEdgeResult<T>> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token ?? anonKey;

  const controller = new AbortController();
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
