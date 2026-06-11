import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Link2, Mail, Copy, ShieldCheck, Eye, EyeOff, RefreshCw, XCircle,
  Send, Check, ChevronDown,
} from 'lucide-react';
import {
  fetchProjects, fetchInvitations,
  createInvitation, updateInvitationStatus,
} from '@/lib/solutionsApi';
import { toast } from 'sonner';
import { INVITATION_STATUS_META, type DesignProject, type ProjectInvitation } from '@/types/solutions';

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function InviteClientsView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const shareUrl = `https://fds.app/share/${projectId}/tok_a1b2c3`;

  useEffect(() => {
    fetchProjects().then((rows) => {
      setProjects(rows);
      if (rows.length > 0) setProjectId((cur) => cur || rows[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    fetchInvitations(projectId).then(setInvitations);
  }, [projectId]);

  const reload = () => fetchInvitations(projectId).then(setInvitations);

  const handleSendEmail = async () => {
    if (!email.trim()) { toast.error('請輸入電郵地址'); return; }
    const res = await createInvitation({ projectId, channel: 'email', email: email.trim() });
    if (res.ok) {
      toast.success('已發送邀請', { description: email.trim() });
      setEmail('');
      reload();
    } else {
      toast.error('發送失敗', { description: res.error });
    }
  };

  const handleCreateLink = async () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    const res = await createInvitation({ projectId, channel: 'link', email: null });
    if (res.ok) { toast.success('已產生分享連結'); reload(); }
    else toast.error('產生失敗', { description: res.error });
  };

  const handleResend = async (id: string) => {
    const res = await updateInvitationStatus(id, 'sent');
    if (res.ok) { toast.success('已重新發送'); reload(); }
    else toast.error('操作失敗', { description: res.error });
  };

  const handleRevoke = async (id: string) => {
    setInvitations((prev) => prev.map((i) => i.id === id ? { ...i, status: 'revoked' } : i));
    const res = await updateInvitationStatus(id, 'revoked');
    if (res.ok) toast.success('已撤銷邀請');
    else { toast.error('撤銷失敗', { description: res.error }); reload(); }
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">邀請客戶</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">向客戶發送邀請，讓他們以純連結模式查看與確認方案</p>
          </div>
          <div className="relative">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 appearance-none rounded-lg border border-border bg-card pl-3 pr-9 font-display text-sm font-semibold focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {/* Two main actions */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Share link */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10"><Link2 className="h-4.5 w-4.5 text-primary" /></div>
              <div>
                <h3 className="font-display text-sm font-bold">產生分享連結</h3>
                <p className="text-[11px] text-muted-foreground">無需註冊，客戶點擊即可查看</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <span className="flex-1 truncate font-mono-data text-[11.5px] text-muted-foreground">{shareUrl}</span>
              <button
                onClick={handleCreateLink}
                className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors', copied ? 'bg-emerald-500/15 text-emerald-600' : 'bg-primary/10 text-primary hover:bg-primary/20')}
              >
                {copied ? <><Check className="h-3.5 w-3.5" /> 已複製</> : <><Copy className="h-3.5 w-3.5" /> 複製</>}
              </button>
            </div>
          </div>

          {/* Email invite */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10"><Mail className="h-4.5 w-4.5 text-primary" /></div>
              <div>
                <h3 className="font-display text-sm font-bold">發送 Email 邀請</h3>
                <p className="text-[11px] text-muted-foreground">直接寄送邀請連結至客戶信箱</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="client@example.com"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-body text-sm placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button onClick={handleSendEmail} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90">
                <Send className="h-3.5 w-3.5" /> 發送
              </button>
            </div>
          </div>
        </div>

        {/* Permission notice */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="font-display text-sm font-bold text-primary">客戶權限說明</h3>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PermRow allowed icon={<Eye className="h-3.5 w-3.5" />} text="查看售價與產品規格" />
            <PermRow allowed icon={<Eye className="h-3.5 w-3.5" />} text="參與討論與確認方案" />
            <PermRow icon={<EyeOff className="h-3.5 w-3.5" />} text="無法查看成本價" />
            <PermRow icon={<EyeOff className="h-3.5 w-3.5" />} text="無法修改資料或上傳檔案" />
          </div>
        </div>

        {/* Sent invitations list */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h3 className="font-display text-sm font-bold">已發送邀請</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">收件人 / 方式</th>
                <th className="px-3 py-2.5 text-left font-medium">狀態</th>
                <th className="px-3 py-2.5 text-left font-medium">查看時間</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {invitations.map((inv) => {
                const meta = INVITATION_STATUS_META[inv.status];
                return (
                  <tr key={inv.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {inv.channel === 'email' ? <Mail className="h-4 w-4 text-muted-foreground" /> : <Link2 className="h-4 w-4 text-muted-foreground" />}
                        <span className="font-body text-[13px] text-foreground">{inv.email ?? '純連結分享'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', meta.className)}>{meta.label}</span></td>
                    <td className="px-3 py-3 font-mono-data text-[11.5px] text-muted-foreground">{formatDateTime(inv.viewedAt)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => handleResend(inv.id)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-3 w-3" /> 重發</button>
                        <button onClick={() => handleRevoke(inv.id)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10"><XCircle className="h-3 w-3" /> 撤銷</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PermRow({ allowed, icon, text }: { allowed?: boolean; icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full', allowed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-500')}>{icon}</span>
      <span className="font-body text-[12.5px] text-foreground">{text}</span>
    </div>
  );
}
