import { useEffect, useState } from 'react';
import { Loader2, Link2, RefreshCw, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
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
  source?: 'manual' | 'pms' | null;
};

type CommentRow = {
  id: string;
  source: 'asana' | 'fds';
  author_name: string | null;
  body: string;
  asana_gid: string | null;
  pushed_at: string | null;
  push_error: string | null;
  created_at_remote: string | null;
  fetched_at: string;
};

const TASK_GID = /^\d{6,25}$/;

/**
 * 接受整條 Asana task 連結或單純 gid：
 *   https://app.asana.com/0/<project_gid>/<task_gid>[/f]
 *   https://app.asana.com/1/<workspace_gid>/project/<project_gid>/task/<task_gid>
 *   https://app.asana.com/0/0/<task_gid>/f
 * 只要不是 task 連結（例如 project 看板）就回 null，避免綁錯。
 */
export function parseAsanaTaskGid(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (TASK_GID.test(text)) return text;

  const path = text.replace(/[?#].*$/, '');
  // 由「我的任務」／搜尋開出的 task：https://app.asana.com/0/0/<task_gid>/f
  const zeroProject = path.match(/\/0\/0\/(\d{6,25})(?:\/|$)/);
  if (zeroProject) return zeroProject[1];

  const segments = path.split('/').filter(Boolean);
  const hasTaskSegment = segments.includes('task');
  const gidSegments = segments.filter((segment) => TASK_GID.test(segment));
  if (gidSegments.length === 0) return null;
  if (hasTaskSegment || gidSegments.length >= 2) return gidSegments[gidSegments.length - 1];
  return null;
}

function asanaTaskUrl(gid: string) {
  return `https://app.asana.com/0/0/${gid}/f`;
}

export function AsanaFactoryLinkPanel({ factoryId, factoryName }: { factoryId: string; factoryName: string }) {
  const [link, setLink] = useState<LinkRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [taskGid, setTaskGid] = useState('');
  const [loading, setLoading] = useState(true);
  const [oauthConnected, setOauthConnected] = useState<boolean | null>(null);
  const [oauthName, setOauthName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<'save' | 'sync' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('asana');
    if (status === 'connected') toast.success('Asana 已連接');
    if (status === 'error') toast.error('未能連接 Asana，請重新嘗試。');
    if (status) {
      url.searchParams.delete('asana');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const loadComments = async (linkId: string) => {
    const { data: commentRows } = await supabase.rpc('fds_asana_factory_comment_list', {
      p_link_id: linkId,
      p_limit: 50,
    });
    setComments(Array.isArray(commentRows) ? (commentRows as CommentRow[]) : []);
  };

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
    if (found) {
      await loadComments(found.id);
    } else {
      setComments([]);
    }
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

  // 後端 cron 每 30 分鐘雙向同步留言；面板開著時每分鐘跟 DB 對一次，
  // 新留言（Asana → FDS）與推送狀態（FDS → Asana）都會自動出現，毋須按「立即同步」。
  const activeLinkId = link?.id ?? null;
  useEffect(() => {
    if (!activeLinkId) return;
    let cancelled = false;
    let timer = 0;

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      const { data } = await supabase.rpc('fds_asana_factory_link_list');
      if (cancelled) return;
      const rows = Array.isArray(data) ? (data as LinkRow[]) : [];
      const found = rows.find((row) => row.factory_id === factoryId) ?? null;
      if (found) setLink(found);
      await loadComments(activeLinkId);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    timer = window.setInterval(() => void refresh(), 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLinkId, factoryId]);

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
      sessionStorage.setItem('fds_asana_return_path', window.location.pathname);
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
    const gid = parseAsanaTaskGid(taskGid);
    if (!gid) {
      setError('請貼上 Asana task 連結（例如 https://app.asana.com/0/1204466337313611/…）或 task gid。');
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
    setSettingsOpen(false);
    toast.success('已綁定 Asana 廠家 task');
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

  const saveEdit = async () => {
    if (!editingId || !editingBody.trim()) return;
    setCommentBusy(true);
    setError('');
    const { error: editError } = await supabase.rpc('fds_asana_factory_comment_edit', {
      p_id: editingId,
      p_body: editingBody.trim(),
    });
    if (editError) {
      setError(editError.message.includes('permission') ? '沒有權限編輯這則留言。' : editError.message);
      setCommentBusy(false);
      return;
    }
    setEditingId(null);
    await sync();
    setCommentBusy(false);
  };

  const deleteComment = async (comment: CommentRow) => {
    const ok = await confirm({
      title: '刪除這則留言？',
      description: comment.asana_gid ? '會一併從 Asana 同一個 task 刪除。' : '這則留言尚未推送，會直接移除。',
      confirmLabel: '刪除',
      cancelLabel: '返回',
      destructive: true,
    });
    if (!ok) return;
    setCommentBusy(true);
    setError('');
    const { error: deleteError } = await supabase.rpc('fds_asana_factory_comment_delete', { p_id: comment.id });
    if (deleteError) {
      setError(deleteError.message.includes('permission') ? '沒有權限刪除這則留言。' : deleteError.message);
      setCommentBusy(false);
      return;
    }
    await sync();
    setCommentBusy(false);
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (!link || !body) return;
    setCommentBusy(true);
    setError('');
    const { error: addError } = await supabase.rpc('fds_asana_factory_comment_add', {
      p_link_id: link.id,
      p_body: body,
    });
    if (addError) {
      setError(addError.message.includes('permission') ? '沒有權限新增留言。' : addError.message);
      setCommentBusy(false);
      return;
    }
    setCommentBody('');
    await sync();
    setCommentBusy(false);
  };

  const openSettings = () => {
    setError('');
    setTaskGid(link?.asana_task_gid ?? '');
    setSettingsOpen(true);
  };

  return (
    <section className="mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Asana 廠家同步</h3>
      </div>

      {loading ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在讀取綁定
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {error && !settingsOpen ? <p className="text-sm text-destructive">{error}</p> : null}

          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {oauthConnected ? (
              `已連接 Asana${oauthName ? `：${oauthName}` : ''}`
            ) : oauthConnected === false ? (
              <>
                未連接 Asana。
                <button type="button" className="font-medium text-primary underline" onClick={openSettings}>
                  連接 Asana
                </button>
              </>
            ) : null}
          </p>

          {link ? (
            <p className="text-xs text-muted-foreground">
              已綁定 task{' '}
              <a className="underline" href={asanaTaskUrl(link.asana_task_gid)} target="_blank" rel="noreferrer">
                {link.asana_task_gid}
              </a>{' '}
              · {link.comment_count} 則 Comment
              · 來源：{link.source === 'pms' ? 'PMS' : '手動'}
              {link.last_synced_at
                ? ` · 上次同步 ${new Date(link.last_synced_at).toLocaleString('zh-HK', { hour12: false })}`
                : ' · 未同步'}
              {link.last_error ? ` · 錯誤：${link.last_error}` : ''}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              未有對應的 Asana task。
              <button
                type="button"
                className="font-medium text-primary underline"
                onClick={openSettings}
              >
                連接對應的 Asana
              </button>
            </p>
          )}

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">留言</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                title="Asana 設定"
                aria-label="Asana 設定"
                onClick={openSettings}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
            {link ? (
              <div className="space-y-2">
                {comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {link.last_error ? `未能讀取 Asana 留言（${link.last_error}），請檢查 Asana 權限。` : '還沒有留言。'}
                  </p>
                ) : (
                  <ul className="max-h-60 space-y-1 overflow-auto text-sm">
                    {comments.map((comment) => (
                      <li key={comment.id} className="rounded border px-2 py-1">
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{comment.source === 'fds' ? 'FDS' : 'Asana'} · {comment.author_name || '—'}</span>
                          <span>
                            {new Date(comment.created_at_remote || comment.fetched_at).toLocaleString('zh-HK', { hour12: false })}
                          </span>
                          {comment.source === 'fds' ? (
                            <span className={comment.asana_gid ? 'text-emerald-700' : comment.push_error ? 'text-destructive' : 'text-amber-700'}>
                              {comment.asana_gid ? '已推送' : comment.push_error ? `推送失敗：${comment.push_error}` : '待推送'}
                            </span>
                          ) : null}
                        </div>
                        {editingId === comment.id ? (
                          <div className="mt-1 space-y-1">
                            <Textarea
                              rows={2}
                              value={editingBody}
                              maxLength={2000}
                              onChange={(event) => setEditingBody(event.target.value)}
                            />
                            <div className="flex gap-2">
                              <Button type="button" size="sm" disabled={commentBusy || !editingBody.trim()} onClick={() => void saveEdit()}>
                                儲存
                              </Button>
                              <Button type="button" size="sm" variant="ghost" disabled={commentBusy} onClick={() => setEditingId(null)}>
                                取消
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="whitespace-pre-wrap">{comment.body}</p>
                            {comment.source === 'fds' ? (
                              <div className="mt-1 flex gap-3 text-xs">
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={() => {
                                    setEditingId(comment.id);
                                    setEditingBody(comment.body);
                                  }}
                                >
                                  編輯
                                </button>
                                <button type="button" className="underline text-destructive" onClick={() => void deleteComment(comment)}>
                                  刪除
                                </button>
                              </div>
                            ) : null}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <Textarea
                  rows={3}
                  value={commentBody}
                  maxLength={2000}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="新增留言"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" disabled={commentBusy || !commentBody.trim()} onClick={() => void addComment()}>
                    {commentBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    送出並同步
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Modal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        size="lg"
        icon={<Link2 className="h-6 w-6" />}
        title="Asana 設定"
        description={`綁定「${factoryName}」對應的 Asana task。`}
        footer={
          <>
            {link ? (
              <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void sync()}>
                {busy === 'sync' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                立即同步
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={Boolean(busy)} onClick={() => void save()}>
              {busy === 'save' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {link ? '更新綁定' : '綁定'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Asana 帳號</p>
            {oauthConnected ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                已連接 Asana{oauthName ? `：${oauthName}` : ''}
                <button type="button" className="text-xs underline" disabled={connecting} onClick={() => void disconnect()}>
                  中斷連接
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                未連接 Asana。
                <Button type="button" size="sm" disabled={connecting} onClick={() => void connect()}>
                  {connecting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  連接 Asana
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground" htmlFor="asana-task-link">
              Asana task 連結
            </label>
            <Input
              id="asana-task-link"
              className="w-full"
              value={taskGid}
              onChange={(event) => setTaskGid(event.target.value)}
              placeholder="貼上 Asana task 連結"
            />
          </div>

          {link ? (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              已綁定 task {link.asana_task_gid} · {link.comment_count} 則 Comment · 來源：
              {link.source === 'pms' ? 'PMS' : '手動'}
              {link.last_synced_at
                ? ` · 上次同步 ${new Date(link.last_synced_at).toLocaleString('zh-HK', { hour12: false })}`
                : ' · 未同步'}
              {link.last_error ? ` · 錯誤：${link.last_error}` : ''}
            </p>
          ) : null}
        </div>
      </Modal>
    </section>
  );
}
