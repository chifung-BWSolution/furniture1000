import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables.');
}

// 方案 A: Global fetch timeout (15s) to prevent hanging when Supabase is unhealthy
function fetchWithTimeout(url: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const existingSignal = options.signal as AbortSignal | undefined;

  // Respect any existing abort signal
  if (existingSignal) {
    existingSignal.addEventListener('abort', () => controller.abort());
  }

  const timeout = setTimeout(() => controller.abort(), 15_000);
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

// 方案 D: Health check — returns true if Supabase DB is reachable
export async function checkSupabaseHealth(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('products')
      .select('id')
      .limit(1)
      .maybeSingle();
    return !error;
  } catch {
    return false;
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
