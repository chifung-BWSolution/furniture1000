import { useState } from 'react';
import { cn } from '@/lib/utils';
import { UserCog, UserPlus, Check, X, Power, Mail, ChevronDown } from 'lucide-react';
import {
  MOCK_USERS, ROLE_META, PERMISSIONS, ROLE_PERMISSIONS,
  type PlatformUser, type UserRole,
} from '@/constants/analytics-mock';
import { toast } from 'sonner';

const ROLE_OPTIONS: UserRole[] = ['admin', 'uploader', 'pm', 'designer', 'client'];

function fmt(d: string) {
  const x = new Date(d);
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export function UserManagementView() {
  const [users, setUsers] = useState<PlatformUser[]>(MOCK_USERS);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('uploader');
  const [permRole, setPermRole] = useState<UserRole>('uploader');

  const toggleActive = (id: string) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, active: !u.active } : u)));
    const u = users.find((x) => x.id === id);
    toast.success(u?.active ? '已停用帳號' : '已啟用帳號', { description: u?.name });
  };
  const changeRole = (id: string, role: UserRole) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    toast.success('已更新角色', { description: ROLE_META[role].label });
  };
  const invite = () => {
    if (!inviteEmail.trim()) { toast.error('請輸入電郵'); return; }
    setUsers((prev) => [{ id: 'u' + (prev.length + 1), name: inviteEmail.split('@')[0], email: inviteEmail.trim(), role: inviteRole, active: true, lastLogin: new Date().toISOString() }, ...prev]);
    toast.success('已發送邀請', { description: inviteEmail.trim() });
    setShowInvite(false); setInviteEmail('');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <UserCog className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">用戶管理</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">{users.length} 位用戶 · {users.filter((u) => u.active).length} 啟用中</span>
        </div>
        <button onClick={() => setShowInvite(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"><UserPlus className="h-3.5 w-3.5" /> 邀請新用戶</button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* user list */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">用戶</th>
                  <th className="px-3 py-2.5 text-left font-medium">角色</th>
                  <th className="px-3 py-2.5 text-left font-medium">最後登入</th>
                  <th className="px-3 py-2.5 text-center font-medium">狀態</th>
                  <th className="px-3 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-display text-[12px] font-bold text-primary">{u.name.slice(0, 1)}</div>
                        <div>
                          <p className="font-body text-[13px] font-medium text-foreground">{u.name}</p>
                          <p className="font-mono-data text-[10.5px] text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="relative inline-block">
                        <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value as UserRole)} className={cn('appearance-none rounded-full border px-2.5 py-0.5 pr-6 text-[10.5px] font-medium focus:outline-none', ROLE_META[u.role].className)}>
                          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 opacity-60" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono-data text-[11.5px] text-muted-foreground">{fmt(u.lastLogin)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', u.active ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600' : 'border-border bg-muted text-muted-foreground')}>
                        {u.active ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{u.active ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => toggleActive(u.id)} className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]', u.active ? 'border-border text-rose-500 hover:bg-rose-500/10' : 'border-border text-emerald-600 hover:bg-emerald-500/10')}>
                        <Power className="h-3 w-3" /> {u.active ? '停用' : '啟用'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* role permission matrix */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="font-display text-sm font-bold">角色權限設定</h3>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
                {ROLE_OPTIONS.map((r) => (
                  <button key={r} onClick={() => setPermRole(r)} className={cn('rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors', permRole === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{ROLE_META[r].label}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
              {PERMISSIONS.map((perm, i) => {
                const allowed = ROLE_PERMISSIONS[permRole][i];
                return (
                  <div key={perm} className={cn('flex items-center justify-between rounded-lg border px-3 py-2', allowed ? 'border-primary/20 bg-primary/5' : 'border-border')}>
                    <span className="font-body text-[12.5px] text-foreground">{perm}</span>
                    <span className={cn('flex h-5 w-5 items-center justify-center rounded-full', allowed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground/50')}>
                      {allowed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInvite(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-base font-bold">邀請新用戶</h3>
              <button onClick={() => setShowInvite(false)} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block font-body text-[12px] font-medium text-muted-foreground">電郵地址</label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email" placeholder="name@company.com" className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-body text-[12px] font-medium text-muted-foreground">指派角色</label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_OPTIONS.map((r) => (
                    <button key={r} onClick={() => setInviteRole(r)} className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors', inviteRole === r ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>{ROLE_META[r].label}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowInvite(false)} className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent">取消</button>
              <button onClick={invite} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"><UserPlus className="h-3.5 w-3.5" /> 發送邀請</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
