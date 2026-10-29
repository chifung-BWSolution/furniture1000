import { useEffect, useState } from 'react';
import { Loader2, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    if (found) {
      const { data: commentRows } = await supabase.rpc('fds_asana_factory_comment_list', {
        p_link_id: found.id,
        p_limit: 50,
      });
      setComments(Array.isArray(commentRows) ? (commentRows as CommentRow[]) : []);
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

  return (
    <section className="mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Asana 廠家同步</h3>
        <span className="text-xs text-muted-foreground">雙向：Asana → FDS；FDS 留言會追加到同一個 task</span>
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
          {oauthConnected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  value={taskGid}
                  onChange={(event) => setTaskGid(event.target.value)}
                  placeholder="Asana task gid，例如 1204466337313611"
                  inputMode="numeric"
                />
                <Button type="button" size="sm" disabled={Boolean(busy)} onClick={() => void save()}>
                  {busy === 'save' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  {link ? '更新綁定' : '綁定'}
                </Button>
                {link ? (
                  <>
                    <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void sync()}>
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
                  · 來源：{link.source === 'pms' ? 'PMS' : '手動'}
                  {link.last_synced_at ? ` · 上次同步 ${link.last_synced_at.slice(0, 16).replace('T', ' ')}` : ' · 未同步'}
                  {link.last_error ? ` · 錯誤：${link.last_error}` : ''}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">未綁定。貼上 Asana task gid，或先從 PMS 讀取廠家已設定嘅 Asana 連結。</p>
                  <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void sync()}>
                    {busy === 'sync' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                    從 PMS 讀取綁定
                  </Button>
                </div>
              )}
              {link ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-medium">留言（Asana ↔ FDS）</p>
                  {comments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">還沒有留言。</p>
                  ) : (
                    <ul className="max-h-60 space-y-1 overflow-auto text-sm">
                      {comments.map((comment) => (
                        <li key={comment.id} className="rounded border px-2 py-1">
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{comment.source === 'fds' ? 'FDS' : 'Asana'} · {comment.author_name || '—'}</span>
                            <span>{(comment.created_at_remote || comment.fetched_at).slice(0, 16).replace('T', ' ')}</span>
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
                    placeholder="新增留言；送出後會追加到 Asana 同一個 task"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" disabled={commentBusy || !commentBody.trim()} onClick={() => void addComment()}>
                      {commentBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      送出並同步
                    </Button>
                    <span className="text-xs text-muted-foreground">只追加，不會改寫 Asana 既有留言。</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
