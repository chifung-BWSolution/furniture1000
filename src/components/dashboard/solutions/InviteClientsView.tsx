import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Building2,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  XCircle,
} from 'lucide-react';
import {
  createInvitation,
  fetchInvitations,
  fetchProjects,
  updateInvitationStatus,
} from '@/lib/solutionsApi';
import {
  createQuoteShareLink,
  revokeQuoteShareLink,
} from '@/lib/bwfQuoteShareLinks';
import { consumeSolutionFocusProjectId } from '@/lib/solutionProjectFocus';
import { toast } from 'sonner';
import {
  INVITATION_STATUS_META,
  type DesignProject,
  type ProjectInvitation,
} from '@/types/solutions';
import {
  buildCustomerPortalInviteUrl,
  buildCustomerPortalQuoteShareUrl,
} from '@/lib/customerPortalRoutes';
import { supabase } from '@/lib/supabase';

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '尚未查看';
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isQuoteShareToken(token: string): boolean {
  return token.trim().startsWith('qtok_');
}

function invitationUrl(token: string) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://fds.app';
  if (isQuoteShareToken(token)) {
    return buildCustomerPortalQuoteShareUrl(origin, token);
  }
  return buildCustomerPortalInviteUrl(origin, token);
}

/** Resolve the design project's linked bwf_quote for no-login portal share. */
async function resolveProjectQuote(project: DesignProject): Promise<{
  quoteUuid: string;
  quoteId: string;
  displayName: string;
} | null> {
  const scheme = project.meta?.clientQuoteScheme;
  const schemeUuid = String(scheme?.quoteUuid || '').trim();
  const schemeQuoteId = String(scheme?.quoteId || '').trim();
  if (schemeUuid && schemeQuoteId) {
    return {
      quoteUuid: schemeUuid,
      quoteId: schemeQuoteId,
      displayName: schemeQuoteId,
    };
  }

  const metaQuoteId = String(
    project.meta?.quoteId || project.meta?.pitchingCode || '',
  ).trim();
  if (metaQuoteId) {
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('id, quote_id, project_data')
      .eq('quote_id', metaQuoteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data?.id) {
      return {
        quoteUuid: String(data.id),
        quoteId: String(data.quote_id || metaQuoteId),
        displayName: String(data.quote_id || metaQuoteId),
      };
    }
  }

  // Fallback: latest quote whose project_data references this design project.
  const { data: rows, error: listError } = await supabase
    .from('bwf_quote')
    .select('id, quote_id, project_data, created_at')
    .order('created_at', { ascending: false })
    .limit(80);
  if (listError || !rows?.length) return null;
  const match = rows.find((row) => {
    const pd =
      row.project_data &&
      typeof row.project_data === 'object' &&
      !Array.isArray(row.project_data)
        ? (row.project_data as Record<string, unknown>)
        : null;
    if (!pd) return false;
    if (String(pd.designProjectId || '').trim() === project.id) return true;
    const nested = pd.clientQuoteScheme;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nestedUuid = String(
        (nested as { quoteUuid?: string }).quoteUuid || '',
      ).trim();
      if (nestedUuid && nestedUuid === String(row.id)) return true;
    }
    return false;
  });
  if (!match?.id) return null;
  const quoteId = String(match.quote_id || '').trim() || project.name;
  return {
    quoteUuid: String(match.id),
    quoteId,
    displayName: quoteId,
  };
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function InviteClientsView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [email, setEmail] = useState('');
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'link' | 'email' | null>(null);
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    const focusId = consumeSolutionFocusProjectId();
    fetchProjects()
      .then((rows) => {
        setProjects(rows);
        if (focusId && rows.some((r) => r.id === focusId)) {
          setProjectId(focusId);
        } else if (rows.length > 0) {
          setProjectId((cur) => cur || rows[0].id);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setInvitations([]);
      return;
    }
    void fetchInvitations(projectId).then(setInvitations);
  }, [projectId]);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) || null,
    [projects, projectId],
  );
  const activeInvitations = invitations.filter((i) => i.status !== 'revoked');

  const reload = () => fetchInvitations(projectId).then(setInvitations);

  const markCopied = (id: string) => {
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(''), 1600);
  };

  const handleCreateLink = async () => {
    if (!projectId || !project) return;
    setSubmitting('link');
    try {
      const quote = await resolveProjectQuote(project);
      if (!quote) {
        toast.error('找不到可分享的報價單', {
          description:
            '請先在客戶專區「報價方案」儲存，或完成報價單草稿後再建立連結。',
        });
        return;
      }

      const shareRes = await createQuoteShareLink({
        quoteUuid: quote.quoteUuid,
        quoteId: quote.quoteId,
      });
      if (shareRes.ok === false) {
        toast.error('產生失敗', { description: shareRes.error });
        return;
      }

      const displayName =
        quote.displayName || quote.quoteId || project.name || '報價方案';
      const res = await createInvitation({
        projectId,
        channel: 'link',
        shareToken: shareRes.data.shareToken,
        displayLabel: displayName,
      });
      if (!res.ok || !res.data) {
        toast.error('產生失敗', { description: res.error });
        return;
      }

      const url = shareRes.data.url || invitationUrl(res.data.shareToken);
      try {
        await copyText(url);
        markCopied(res.data.id);
        toast.success('免登入連結已建立並複製', {
          description: `${displayName} — 客戶可直接開啟報價方案及客戶專區各頁`,
        });
      } catch {
        toast.success('免登入連結已建立', {
          description: displayName,
        });
      }
      await reload();
    } finally {
      setSubmitting(null);
    }
  };

  const handleSendEmail = async () => {
    const address = email.trim().toLowerCase();
    if (!projectId || !address) {
      toast.error('請輸入客戶登入電郵');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      toast.error('電郵格式不正確');
      return;
    }
    setSubmitting('email');
    const res = await createInvitation({
      projectId,
      channel: 'email',
      email: address,
    });
    setSubmitting(null);
    if (!res.ok || !res.data) {
      toast.error('建立邀請失敗', { description: res.error });
      return;
    }
    const url = invitationUrl(res.data.shareToken);
    const subject = encodeURIComponent(`BWF 客戶專區邀請：${project?.name || '傢俬方案'}`);
    const body = encodeURIComponent(
      `您好，\n\nBWF 已為您建立專屬客戶專區。請使用 ${address} 登入後查看屬於您的方案、報價及產品：\n${url}\n\n此連結不會顯示任何成本資料。`,
    );
    window.location.href = `mailto:${encodeURIComponent(address)}?subject=${subject}&body=${body}`;
    toast.success('已建立個人邀請並開啟電郵程式', {
      description: '請在電郵程式確認內容後發送',
    });
    setEmail('');
    await reload();
  };

  const handleCopy = async (inv: ProjectInvitation) => {
    try {
      await copyText(invitationUrl(inv.shareToken));
      markCopied(inv.id);
      toast.success('已複製 Portal 連結');
    } catch {
      toast.error('瀏覽器未允許複製，請重試');
    }
  };

  const handleResend = async (inv: ProjectInvitation) => {
    const res = await updateInvitationStatus(inv.id, 'sent');
    if (!res.ok) {
      toast.error('操作失敗', { description: res.error });
      return;
    }
    if (inv.channel === 'email' && inv.email) {
      const subject = encodeURIComponent(`BWF 客戶專區邀請：${project?.name || '傢俬方案'}`);
      const body = encodeURIComponent(
        `您好，\n\n再次附上您的 BWF 客戶專區連結：\n${invitationUrl(inv.shareToken)}\n\n請使用 ${inv.email} 登入。`,
      );
      window.location.href = `mailto:${encodeURIComponent(inv.email)}?subject=${subject}&body=${body}`;
    } else {
      await handleCopy(inv);
    }
    toast.success(inv.channel === 'email' ? '已開啟重發電郵' : '連結已重新複製');
    await reload();
  };

  const handleRevoke = async (id: string) => {
    const target = invitations.find((row) => row.id === id);
    setInvitations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: 'revoked' } : i)),
    );
    const res = await updateInvitationStatus(id, 'revoked');
    if (res.ok) {
      if (target && isQuoteShareToken(target.shareToken)) {
        await revokeQuoteShareLink(target.shareToken);
      }
      toast.success('已撤銷邀請，該連結不再可用');
    } else {
      toast.error('撤銷失敗', { description: res.error });
      await reload();
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">邀請客戶</h1>
            <p className="mt-1 max-w-3xl font-body text-sm text-muted-foreground">
              為 BW 客戶建立免登入 Portal 連結或個人 Email 邀請；可複製、重發及撤銷。連結可直接開啟報價方案，並瀏覽客戶專區各頁；成本資料一律隱藏。
            </p>
          </div>
          <div className="relative min-w-[280px]">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-11 w-full appearance-none rounded-lg border border-border bg-card pl-3 pr-9 font-display text-sm font-semibold focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              aria-label="選擇專案"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.clientCompany || p.clientName || '未填客戶'}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !project ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            請先在「方案列表」建立專案
          </div>
        ) : (
          <>
            <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">目前專案</p>
                <h2 className="mt-1 font-display text-xl font-bold">{project.name}</h2>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-4 w-4" />
                    {project.clientCompany || '未填客戶公司'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-4 w-4" />
                    {project.clientName || '未填聯絡人'}
                  </span>
                  <span>{activeInvitations.length} 個有效邀請</span>
                </div>
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
                <p className="font-semibold text-primary">邀請流程</p>
                <p className="mt-1">1 選專案 → 2 建立連結 → 3 客戶免登入開啟 Portal</p>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Link2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold">建立可轉寄 Portal 連結</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      類似報價單「生成 QR Code 及連結」：免登入開啟報價方案，亦可瀏覽客戶專區其他頁面。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => void handleCreateLink()}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {submitting === 'link' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  建立並複製連結
                </button>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold">建立個人 Email 邀請</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      以客戶登入電郵綁定專案，建立後會開啟您的電郵程式。
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    placeholder="客戶登入電郵，例如 client@example.com"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    disabled={submitting !== null}
                    onClick={() => void handleSendEmail()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {submitting === 'email' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    建立邀請
                  </button>
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="font-display text-base font-bold text-primary">客戶 Portal 權限</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <PermRow allowed icon={<Eye className="h-4 w-4" />} text="只看自己的專案內容" />
                <PermRow allowed icon={<Eye className="h-4 w-4" />} text="查看售價、產品與報價" />
                <PermRow icon={<EyeOff className="h-4 w-4" />} text="不顯示任何成本價" />
                <PermRow icon={<EyeOff className="h-4 w-4" />} text="不能進入 BW 內部功能" />
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <h2 className="font-display text-base font-bold">邀請管理</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    每個邀請都有獨立 Token；撤銷後不再列入該客戶可見專案。
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{invitations.length} 個紀錄</span>
              </div>
              {invitations.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                  尚未建立邀請
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 text-left font-medium">收件人／方式</th>
                        <th className="px-3 py-3 text-left font-medium">狀態</th>
                        <th className="px-3 py-3 text-left font-medium">建立／查看</th>
                        <th className="px-5 py-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {invitations.map((inv) => {
                        const meta = INVITATION_STATUS_META[inv.status];
                        return (
                          <tr key={inv.id} className="hover:bg-muted/30">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                {inv.channel === 'email' ? (
                                  <Mail className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <Link2 className="h-4 w-4 text-muted-foreground" />
                                )}
                                <div>
                                  <p className="font-medium">
                                    {inv.channel === 'link'
                                      ? inv.email || '可轉寄 Portal 連結'
                                      : inv.email || 'Email 邀請'}
                                  </p>
                                  <p className="mt-0.5 font-mono-data text-xs text-muted-foreground">
                                    {isQuoteShareToken(inv.shareToken)
                                      ? '免登入報價連結 · '
                                      : ''}
                                    {inv.shareToken.slice(0, 18)}…
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className={cn(
                                  'rounded-full border px-2.5 py-1 text-xs font-medium',
                                  meta.className,
                                )}
                              >
                                {meta.label}
                              </span>
                            </td>
                            <td className="px-3 py-3 font-mono-data text-xs text-muted-foreground">
                              <p>{formatDateTime(inv.createdAt)}</p>
                              {inv.viewedAt ? <p className="mt-1">查看：{formatDateTime(inv.viewedAt)}</p> : null}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  disabled={inv.status === 'revoked'}
                                  onClick={() => void handleCopy(inv)}
                                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
                                >
                                  {copiedId === inv.id ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                  複製
                                </button>
                                <button
                                  type="button"
                                  disabled={inv.status === 'revoked'}
                                  onClick={() => void handleResend(inv)}
                                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" /> 重發
                                </button>
                                {inv.status !== 'revoked' ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleRevoke(inv.id)}
                                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-rose-500 hover:bg-rose-500/10"
                                  >
                                    <XCircle className="h-3.5 w-3.5" /> 撤銷
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function PermRow({
  allowed,
  icon,
  text,
}: {
  allowed?: boolean;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          allowed
            ? 'bg-emerald-500/15 text-emerald-600'
            : 'bg-rose-500/15 text-rose-500',
        )}
      >
        {icon}
      </span>
      <span className="font-body text-foreground">{text}</span>
    </div>
  );
}
