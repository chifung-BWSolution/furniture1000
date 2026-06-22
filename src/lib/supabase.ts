import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables.');
}

// 方案 A: Global fetch timeout to prevent the UI hanging forever if Supabase
// truly stops responding. NOTE: this must be generous — bulk operations like
// 「全部退回」reload hundreds of product rows + image URLs, which can take well
// over 15s. A too-short timeout aborts these legitimate requests and surfaces
// as "AbortError: signal is aborted without reason", which previously also
// tripped the health-check banner into a false "unhealthy" state.
const FETCH_TIMEOUT_MS = 60_000; // 60s — only a genuinely stuck request hits this

function fetchWithTimeout(url: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const existingSignal = options.signal as AbortSignal | undefined;

  // Respect any caller-supplied abort signal (forward its abort to our controller)
  if (existingSignal) {
    if (existingSignal.aborted) controller.abort();
    else existingSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const timeout = setTimeout(
    () => controller.abort(new DOMException(`Supabase request exceeded ${FETCH_TIMEOUT_MS / 1000}s`, 'TimeoutError')),
    FETCH_TIMEOUT_MS,
  );
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeout));
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: fetchWithTimeout,
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// 方案 D: Health check — returns true if Supabase DB is reachable.
// Uses its OWN short abort signal (8s) independent of the 60s global fetch
// timeout, and probes a tiny count query (head:true, no rows transferred) so a
// slow bulk reload elsewhere can never make the probe itself time out.
export async function checkSupabaseHealth(): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8_000);
  try {
    const { error } = await supabase
      .from('products')
      .select('id', { count: 'estimated', head: true })
      .abortSignal(controller.signal);
    return !error;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// 方案 D: Poll health until recovered, then invoke callback
export function waitForSupabaseRecovery(
  onRecovered: () => void,
  intervalMs = 10_000,
  maxAttempts = 12  // ~2 minutes
): () => void {
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    const healthy = await checkSupabaseHealth();
    if (healthy) {
      clearInterval(timer);
      console.info('[Supabase] Connection recovered after', attempts, 'attempt(s).');
      onRecovered();
    } else if (attempts >= maxAttempts) {
      clearInterval(timer);
      console.error('[Supabase] Still unhealthy after', maxAttempts, 'attempts. Giving up.');
    }
  }, intervalMs);

  // Return a cancel function
  return () => clearInterval(timer);
}
