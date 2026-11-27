import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { storeQuoteShareToken } from '@/lib/customerPortalRoutes';
import { supabase } from '@/lib/supabase';

/**
 * Resolves own-domain short quotation share links (`/q/<code>`) to the
 * customer portal (`/customer?quote_share=<token>`).
 */
export function QuoteShareShortRedirect() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      setInvalid(true);
      return;
    }
    if (trimmed.startsWith('qtok_')) {
      storeQuoteShareToken(trimmed);
      navigate(`/customer?quote_share=${encodeURIComponent(trimmed)}`, { replace: true });
      return;
    }

    let cancelled = false;
    setInvalid(false);
    void supabase
      .rpc('resolve_quote_share_short_code', { p_code: trimmed })
      .then(({ data, error }) => {
        if (cancelled) return;
        const token = typeof data === 'string' ? data.trim() : '';
        if (error || !token) {
          setInvalid(true);
          return;
        }
        storeQuoteShareToken(token);
        navigate(`/customer?quote_share=${encodeURIComponent(token)}`, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  if (!invalid) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在開啟報價單…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background px-6 text-center">
      <div className="max-w-md space-y-2 rounded-xl border bg-card p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">此報價連結已失效或不存在</h1>
        <p className="text-sm text-muted-foreground">
          請聯絡您的項目經理取得最新的報價分享連結。
        </p>
      </div>
    </div>
  );
}
