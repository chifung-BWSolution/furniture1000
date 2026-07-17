import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  dismissAppUpdateBanner,
  getAppUpdateState,
  reloadAfterFlush,
  snoozeAppUpdate,
  subscribeAppUpdate,
  type AppUpdateState,
} from '@/lib/appUpdateGuard';
import { unsavedGuard } from '@/lib/unsavedGuard';
import { useAuth } from '@/contexts/AuthProvider';
import { writeResumeQuote, readQuickQuoteEditingId } from '@/lib/quickQuoteSession';

/**
 * Global banner: shown when a new deploy / stale chunk is detected.
 * Never auto-reloads — user must confirm.
 */
export function AppUpdateBanner() {
  const { user } = useAuth();
  const [state, setState] = useState<AppUpdateState>(() => getAppUpdateState());
  const [reloading, setReloading] = useState(false);

  useEffect(() => subscribeAppUpdate(setState), []);

  if (!state.visible) return null;

  const dirty = unsavedGuard.isDirty;

  const handleReload = async () => {
    setReloading(true);
    try {
      // Ensure resume marker exists even if editor flush handler was unmounted.
      const editingId = readQuickQuoteEditingId(user?.email);
      if (editingId) {
        writeResumeQuote(user?.email, { quoteId: editingId });
      }
      await reloadAfterFlush();
    } catch {
      setReloading(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex justify-center p-3">
      <div className="pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-xl border border-amber-500/40 bg-card p-4 shadow-2xl">
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-foreground">
            系統有新版本
          </p>
          <p className="mt-1 font-body text-xs leading-relaxed text-muted-foreground">
            偵測到新部署。請重新整理以載入最新程式；不會自動重整，避免報價草稿中斷。
            {dirty
              ? ' 已嘗試把「報價單草稿編輯」內容寫入本機暫存，重整後可自動恢復。'
              : ' 重新整理後會載入最新版本。'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={reloading}
              onClick={() => void handleReload()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 font-body text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} />
              {reloading ? '重新整理中…' : '重新整理'}
            </button>
            <button
              type="button"
              disabled={reloading}
              onClick={() => snoozeAppUpdate()}
              className="rounded-lg border border-border px-3 py-1.5 font-body text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-60"
            >
              稍後再說
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="關閉"
          disabled={reloading}
          onClick={() => dismissAppUpdateBanner()}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
