import { useEffect, useState } from 'react';
import { Loader2, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { confirm } from '@/components/ui/confirm-dialog';
import { supabase } from '@/lib/supabase';

/**
 * FDS-12：把 FDS 廠家綁到 Asana 專案「BWFS 辦公室傢俬廠 Office Furniture Listing」的 task。
 * 只做唯讀同步（Asana → FDS）；不會向 Asana 發留言。
 */

type LinkRow = {
  id: string;
  factory_id: string;
  factory_name: string;
  asana_task_gid: string;
  last_synced_at: string | null;
  last_error: string | null;
  comment_count: number;
  enabled: boolean;
};

const TASK_GID = /^\d{6,25}$/;

export function AsanaFactoryLinkPanel({ factoryId, factoryName }: { factoryId: string; factoryName: string }) {
  const [link, setLink] = useState<LinkRow | null>(null);
  const [taskGid, setTaskGid] = useState('');
  const [loading, setLoading] = useState(true);
  const [oauthConnected, setOauthConnected] = useState<boolean | null>(null);
  const [oauthName, setOauthName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | 'sync' | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const { data, error: loadError } = await supabase.rpc('fds_asana_factory_link_list');
    if (loadError) {
      setError(loadError.message.includes('permission') ? '沒有權限查看 Asana 綁定。' : loadError.message);
      return;
    }
    const rows = Array.isArray(data) ? (data as LinkRow[]) : [];
    const found = rows.find((row) => row.factory_id === factoryId) ?? null;
    setLink(found);
    setTaskGid(found?.asana_task_gid ?? '');
    setError('');
    try {
      const status = await supabase.functions.invoke('fds-asana-oauth', { body: { action: 'status' } });
      const body = status.data as { connected?: boolean; asana_user_name?: string | null } | null;
      setOauthConnected(Boolean(body?.connected));
      setOauthName(body?.asana_user_name ?? '');
    } catch {
      setOauthConnected(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // Reload only when a different factory is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId]);

  const connect = async () => {
    setConnecting(true);
    setError('');
    try {
      const { data, error: startError } = await supabase.functions.invoke('fds-asana-oauth', {
        body: { action: 'start' },
      });
      const url = (data as { authorize_url?: string } | null)?.authorize_url;
      if (startError || !url) {
        setError(startError?.message || (data as { error?: string } | null)?.error || '未能開始 Asana 連接。');
        return;
      }
      window.location.assign(url);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: '中斷 Asana 連接？',
      description: '中斷後不能用你的 Asana 授權同步廠家；已同步的資料仍保留。',
      confirmLabel: '中斷連接',
      cancelLabel: '返回',
      destructive: true,
    });
    if (!ok) return;
    setConnecting(true);
    await supabase.functions.invoke('fds-asana-oauth', { body: { action: 'disconnect' } });
    setConnecting(false);
    await load();
  };

  const save = async () => {
    const gid = taskGid.trim();
    if (!TASK_GID.test(gid)) {
      setError('Asana task gid 應為數字（例如 1204466337313611）。');
      return;
    }
    setBusy('save');
    setError('');
    const { error: saveError } = await supabase.rpc('fds_asana_factory_link_set', {
      p_factory_id: factoryId,
      p_factory_name: factoryName,
      p_task_gid: gid,
    });
    setBusy(null);
    if (saveError) {
      setError(saveError.message.includes('permission') ? '只有管理員或上載員可以綁定 Asana。' : saveError.message);
      return;
    }
    await load();
    toast.success('已綁定 Asana 廠家 task');
  };

  const remove = async () => {
    if (!link) return;
    const ok = await confirm({
      title: '移除 Asana 綁定？',
      description: '移除後不會再同步這個廠家的 Asana Description／Comment；已同步的內容會一併刪除。',
      confirmLabel: '移除綁定',
      cancelLabel: '返回',
      destructive: true,
    });
    if (!ok) return;
    setBusy('remove');
    setError('');
    const { error: removeError } = await supabase.rpc('fds_asana_factory_link_remove', { p_id: link.id });
    setBusy(null);
    if (removeError) {
      setError(removeError.message);
      return;
    }
    setLink(null);
    setTaskGid('');
    toast.success('已移除 Asana 綁定');
  };

  const sync = async () => {
    setBusy('sync');
    setError('');
    const { data, error: syncError } = await supabase.functions.invoke('sync-asana-factories', { body: {} });
    setBusy(null);
    if (syncError || (data as { error?: string } | null)?.error) {
      setError((data as { error?: string } | null)?.error || syncError?.message || '同步失敗');
      return;
    }
    await load();
    toast.success('已同步 Asana 廠家資料');
  };

  return (
    <section className="mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Asana 廠家同步</h3>
        <span className="text-xs text-muted-foreground">唯讀：Asana → FDS，不會向 Asana 發留言</span>
      </div>

      {loading ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在讀取綁定
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {oauthConnected === false ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>未連接 Asana。連接後才能用你的授權同步廠家。</span>
              <Button type="button" size="sm" disabled={connecting} onClick={() => void connect()}>
                {connecting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                連接 Asana
              </Button>
            </div>
          ) : oauthConnected ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              已連接 Asana{oauthName ? `：${oauthName}` : ''}
              <button type="button" className="underline" disabled={connecting} onClick={() => void disconnect()}>
                中斷連接
              </button>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              value={taskGid}
              onChange={(event) => setTaskGid(event.target.value)}
              placeholder="Asana task gid，例如 1204466337313611"
              inputMode="numeric"
            />
            <Button type="button" size="sm" disabled={Boolean(busy) || oauthConnected !== true} onClick={() => void save()}>
              {busy === 'save' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {link ? '更新綁定' : '綁定'}
            </Button>
            {link ? (
              <>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(busy) || oauthConnected !== true} onClick={() => void sync()}>
                  {busy === 'sync' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                  立即同步
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void remove()}>
                  {busy === 'remove' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
                  移除
                </Button>
              </>
            ) : null}
          </div>
          {link ? (
            <p className="text-xs text-muted-foreground">
              已綁定 task {link.asana_task_gid} · {link.comment_count} 則 Comment
              {link.last_synced_at ? ` · 上次同步 ${link.last_synced_at.slice(0, 16).replace('T', ' ')}` : ' · 未同步'}
              {link.last_error ? ` · 錯誤：${link.last_error}` : ''}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">未綁定。貼上 Asana 專案內該廠家的 task gid 即可。</p>
          )}
        </div>
      )}
    </section>
  );
}
