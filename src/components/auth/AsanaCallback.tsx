import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

let completion: Promise<void> | undefined;

async function completeAsanaCallback() {
  const params = new URLSearchParams(window.location.search);
  const savedPath = sessionStorage.getItem('fds_asana_return_path') || '';
  const returnPath = /^\/fds\/factories\/[^/]+$/.test(savedPath) ? savedPath : '/fds/factories';
  const code = params.get('code');
  const state = params.get('state');
  window.history.replaceState(null, '', window.location.pathname);
  let result = 'error';
  try {
    if (code && state && !params.has('error')) {
      const { data, error } = await supabase.functions.invoke('fds-asana-oauth', {
        body: { action: 'callback', code, state },
      });
      if (!error && data?.ok) result = 'connected';
    }
  } catch {
    result = 'error';
  } finally {
    sessionStorage.removeItem('fds_asana_return_path');
    window.location.replace(`${returnPath}?asana=${result}`);
  }
}

export default function AsanaCallback() {
  useEffect(() => {
    completion ??= completeAsanaCallback();
  }, []);
  return <div className="flex h-screen items-center justify-center">正在連接 Asana…</div>;
}
