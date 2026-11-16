import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileText,
  History,
  Link2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Unlock,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CompactEmptyState } from '@/components/ui/empty-state';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { usePlatformRole } from '@/hooks/use-platform-role';
import { RFQ_LIST_PATH, rfqIdFromPath } from '@/lib/appSectionRoutes';
import {
  awardRfqLine,
  cancelRfq,
  formatRfqDateTime,
  formatRfqMoney,
  getRfqDetail,
  inviteRfqFactory,
  issueRfqLink,
  noAwardRfqLine,
  publishRfq,
  reopenRfqLine,
  revealRfq,
  rfqStatusClass,
  rfqStatusLabel,
  stripFactorySortName,
  type RfqCatalogPrice,
  type RfqDetail,
  type RfqInvitation,
  type RfqItem,
  type RfqSubmission,
  type RfqSubmissionItem,
} from '@/lib/rfq';
import { loadDirectoryFactories, type DirectoryFactory } from '@/lib/supplierLogins';
import { RfqEditorView } from './RfqEditorView';

type ReasonKind = 'reveal' | 'cancel' | 'award' | 'no_award' | 'reopen';

interface ReasonDialogState {
  kind: ReasonKind;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  itemId?: string;
  submissionId?: string;
}

const EVENT_LABELS: Record<string, string> = {
  draft_created: '建立草稿',
  published: '發布',
  revised: '升修訂',
  factory_invited: '加入廠家',
  link_issued: '產生連結',
  submitted: '廠家提交回價',
  withdrawn: '廠家撤回回價',
  revealed: '提前揭標',
  line_awarded: '按行定標',
  line_not_awarded: '此行不定標',
  line_reopened: '重開此行',
  cancelled: '取消 RFQ',
};

function numText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-HK');
}

function invitationStatusLabel(invitation: RfqInvitation): string {
  if (invitation.status === 'submitted') return '已提交';
  if (invitation.status === 'withdrawn') return '已撤回';
  return '未提交';
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('已複製連結');
  } catch {
    toast.error('未能自動複製，請在彈出的視窗手動複製。');
  }
}

export function RfqDetailView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profileRole } = usePlatformRole();
  const isAdmin = (profileRole ?? '').toLowerCase() === 'admin';
  const rfqId = rfqIdFromPath(location.pathname);

  const [detail, setDetail] = useState<RfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reasonDialog, setReasonDialog] = useState<ReasonDialogState | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [linkDialog, setLinkDialog] = useState<{ factoryName: string; link: string } | null>(null);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);
  const [factories, setFactories] = useState<DirectoryFactory[]>([]);
  const [factoryToAdd, setFactoryToAdd] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!rfqId) {
      setLoading(false);
      setError('找不到這張 RFQ。');
      return;
    }
    setLoading(true);
    const result = await getRfqDetail(rfqId);
    setDetail(result.detail);
    setError(result.error);
    setLoading(false);
  }, [rfqId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void loadDirectoryFactories().then((result) => {
      if (!cancelled) setFactories(result.factories);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submissionsByInvitation = useMemo(() => {
    const map = new Map<string, RfqSubmission>();
    for (const submission of detail?.submissions ?? []) {
      map.set(submission.invitation_id, submission);
    }
    return map;
  }, [detail?.submissions]);

  const submissionItemMap = useMemo(() => {
    const map = new Map<string, RfqSubmissionItem>();
    for (const submission of detail?.submissions ?? []) {
      for (const item of submission.items ?? []) {
        map.set(`${submission.invitation_id}:${item.rfq_item_id}`, item);
      }
    }
    return map;
  }, [detail?.submissions]);

  const catalogByProduct = useMemo(() => {
    const map = new Map<string, RfqCatalogPrice[]>();
    for (const row of detail?.catalog_prices ?? []) {
      const list = map.get(row.product_id) ?? [];
      list.push(row);
      map.set(row.product_id, list);
    }
    return map;
  }, [detail?.catalog_prices]);

  const openReason = (state: ReasonDialogState) => {
    setReasonText('');
    setReasonDialog(state);
  };

  const runReasonAction = async () => {
    if (!detail || !reasonDialog) return;
    if (!reasonText.trim()) {
      toast.error('請填寫原因。');
      return;
    }
    setBusy(true);
    try {
      let result: { error: string | null } = { error: null };
      if (reasonDialog.kind === 'reveal') {
        result = await revealRfq(detail.rfq.id, reasonText.trim());
      } else if (reasonDialog.kind === 'cancel') {
        result = await cancelRfq(detail.rfq.id, reasonText.trim());
      } else if (reasonDialog.kind === 'no_award') {
        result = await noAwardRfqLine(detail.rfq.id, reasonDialog.itemId!, reasonText.trim());
      } else if (reasonDialog.kind === 'reopen') {
        result = await reopenRfqLine(detail.rfq.id, reasonDialog.itemId!, reasonText.trim());
      } else if (reasonDialog.kind === 'award') {
        result = await awardRfqLine(
          detail.rfq.id,
          reasonDialog.itemId!,
          reasonDialog.submissionId!,
          reasonText.trim(),
        );
      }
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setReasonDialog(null);
      toast.success('已完成');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const requestLink = async (invitation: RfqInvitation) => {
    setLinkBusyId(invitation.id);
    try {
      const result = await issueRfqLink(invitation.id);
      if (result.error || !result.token) {
        toast.error(result.error || '未能產生連結');
        return;
      }
      const link = `${window.location.origin}/rfq/invite/${result.token}`;
      setLinkDialog({
        factoryName: result.factoryName || invitation.factory_name || invitation.factory_id,
        link,
      });
      await copyText(link);
      await load();
    } finally {
      setLinkBusyId(null);
    }
  };

  const publish = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await publishRfq(detail.rfq.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('RFQ 已發布', { description: '請為每家廠複製連結。' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const addFactory = async () => {
    if (!detail || !factoryToAdd) return;
    const factory = factories.find((row) => row.id === factoryToAdd);
    if (!factory) return;
    setInviteBusy(true);
    try {
      const result = await inviteRfqFactory(
        detail.rfq.id,
        factory.id,
        stripFactorySortName(factory.name) || factory.name,
        null,
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('已加入廠家', { description: '可即時為這家廠產生連結。' });
      setFactoryToAdd('');
      await load();
    } finally {
      setInviteBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <p className="p-6 text-sm text-muted-foreground">讀取 RFQ…</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <div className="mx-auto max-w-3xl space-y-4 fds-page-padding">
          <Button type="button" variant="ghost" onClick={() => navigate(RFQ_LIST_PATH)}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            返回 RFQ 列表
          </Button>
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error || '找不到這張 RFQ。'}
          </section>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <RfqEditorView
        mode={detail.rfq.status === 'draft' ? 'draft' : 'revise'}
        detail={detail}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
      />
    );
  }

  const status = detail.rfq.status;
  const canRevise = status === 'open' || status === 'review';
  const canCancel = ['open', 'review', 'awarded', 'not_awarded'].includes(status);
  const canAward = detail.rfq.revealed && ['open', 'review'].includes(status);
  const canEditDraft = status === 'draft';

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <button
            type="button"
            onClick={() => navigate(RFQ_LIST_PATH)}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            返回 RFQ 列表
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="fds-page-title">
                  <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
                  {detail.rfq.title}
                </h1>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${rfqStatusClass(status)}`}>
                  {rfqStatusLabel(status)}
                </span>
                <Badge variant="outline" className="font-mono text-xs">
                  {detail.rfq.rfq_no}
                </Badge>
                {detail.rfq.revision > 0 ? (
                  <Badge variant="outline" className="text-xs">
                    R{detail.rfq.revision}
                  </Badge>
                ) : null}
                {detail.rfq.sealed ? (
                  <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-900">
                    <Lock className="h-3 w-3" />
                    封標中
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-800">
                    <Unlock className="h-3 w-3" />
                    已揭標
                  </Badge>
                )}
              </div>
              <p className="fds-page-description">
                幣別 {detail.rfq.currency} · 截止 {formatRfqDateTime(detail.rfq.close_at)}
                {detail.rfq.created_by_email ? ` · 建立 ${detail.rfq.created_by_email}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2"
                onClick={() => void load()}
                disabled={busy}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                重新整理
              </Button>
              {canEditDraft && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 gap-2"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    編輯草稿
                  </Button>
                  <Button
                    type="button"
                    className="h-9 gap-2"
                    onClick={() => void publish()}
                    disabled={busy}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    發布
                  </Button>
                </>
              )}
              {canRevise && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-2"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  修改（升修訂）
                </Button>
              )}
              {isAdmin && !detail.rfq.revealed && canRevise && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-2"
                  onClick={() =>
                    openReason({
                      kind: 'reveal',
                      title: '提前揭標',
                      description: '揭標後，admin／uploader／pm 會看到已提交的單價。截止時間不變，截止前仍可提交。',
                      confirmLabel: '確認揭標',
                    })
                  }
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  提前揭標
                </Button>
              )}
              {isAdmin && canCancel && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-2 border-destructive/40 text-destructive hover:bg-destructive/5"
                  onClick={() =>
                    openReason({
                      kind: 'cancel',
                      title: '取消整張 RFQ',
                      description: '取消後不能再提交、不能再定標；已定專案價會保留並標成已取消。',
                      confirmLabel: '確認取消',
                      destructive: true,
                    })
                  }
                >
                  <Ban className="h-4 w-4" aria-hidden="true" />
                  取消 RFQ
                </Button>
              )}
            </div>
          </div>
        </section>

        {detail.rfq.cancel_reason && (
          <section className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-medium">已取消</p>
            <p className="mt-1 whitespace-pre-wrap">{detail.rfq.cancel_reason}</p>
          </section>
        )}

        {status === 'draft' && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 text-sm shadow-sm">
            這是草稿。發布前可改幣別、項目、數量、規格、截止與受邀廠；發布後幣別凍結。
          </section>
        )}

        {detail.rfq.sealed && status !== 'draft' && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">封標中</p>
            <p className="mt-1">
              截止前只顯示「有沒有提交」與「已報行數」，不顯示單價、小計或總額。截止後自動可看；
              admin 亦可提前揭標並寫原因。
            </p>
          </section>
        )}

        {detail.rfq.reveal_reason && detail.rfq.revealed_at && (
          <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-medium">已於 {formatRfqDateTime(detail.rfq.revealed_at)} 提前揭標</p>
            <p className="mt-1 whitespace-pre-wrap">{detail.rfq.reveal_reason}</p>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-4">
          {[
            { label: '項目', value: detail.counts.item_count },
            { label: '受邀廠家', value: detail.counts.invitation_count },
            { label: '已回價廠家', value: detail.counts.submitted_factory_count },
            { label: '已決定行', value: `${detail.counts.resolved_item_count}/${detail.counts.item_count}` },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{stat.value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="inline-flex items-center gap-2 text-base font-semibold">
                <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
                邀請連結
              </p>
              <p className="text-xs text-muted-foreground">
                每家廠一條連結；重新產生會作廢上一條。第一期不代發信，請自行傳給廠家。
              </p>
            </div>
          </div>

          {detail.invitations.length === 0 ? (
            <CompactEmptyState
              icon={Building2}
              title="未邀請廠家"
              description="草稿階段可回到編輯頁加入廠家。"
            />
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">廠家</th>
                    <th className="px-3 py-2 font-medium">狀態</th>
                    <th className="px-3 py-2 text-right font-medium">版本</th>
                    <th className="px-3 py-2 text-right font-medium">已報行數</th>
                    <th className="px-3 py-2 font-medium">最近提交</th>
                    <th className="px-3 py-2 font-medium">連結</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.invitations.map((invitation) => (
                    <tr key={invitation.id} className="border-t border-border/60">
                      <td className="px-3 py-2 font-medium">
                        {invitation.factory_name || invitation.factory_id}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {invitation.factory_id}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
                            invitation.status === 'submitted'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : invitation.status === 'withdrawn'
                                ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : 'border-border bg-muted text-muted-foreground'
                          }`}
                        >
                          {invitationStatusLabel(invitation)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {invitation.latest_version != null ? `v${invitation.latest_version}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {invitation.quoted_item_count}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatRfqDateTime(invitation.latest_submitted_at)}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5"
                          disabled={linkBusyId === invitation.id || status === 'cancelled' || status === 'draft'}
                          onClick={() => void requestLink(invitation)}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          {linkBusyId === invitation.id
                            ? '產生中…'
                            : invitation.has_active_token
                              ? '重新產生連結'
                              : '產生連結'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {status === 'open' && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-3">
              <div className="min-w-[240px] flex-1">
                <p className="text-xs font-medium text-muted-foreground">只加一家廠（不升修訂）</p>
                <Select value={factoryToAdd} onValueChange={setFactoryToAdd}>
                  <SelectTrigger className="mt-1 h-9" aria-label="加入受邀廠家">
                    <SelectValue placeholder="選擇廠家" />
                  </SelectTrigger>
                  <SelectContent>
                    {factories
                      .filter(
                        (factory) =>
                          !detail.invitations.some(
                            (invitation) => invitation.factory_id === factory.id,
                          ),
                      )
                      .map((factory) => (
                        <SelectItem key={factory.id} value={factory.id}>
                          {factory.name}
                          {factory.code ? ` (${factory.code})` : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5"
                disabled={!factoryToAdd || inviteBusy}
                onClick={() => void addFactory()}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {inviteBusy ? '加入中…' : '加入廠家'}
              </Button>
              <p className="w-full text-[11px] text-muted-foreground">
                只新增受邀廠，不升 revision；其他廠已提交的回價繼續有效。
              </p>
            </div>
          )}
        </section>

        {detail.items.length === 0 ? (
          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
            <CompactEmptyState
              icon={FileText}
              title="沒有項目"
              description="回到編輯頁加入項目後再發布。"
            />
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h2 className="text-base font-semibold">比價與按行定標</h2>
              <p className="text-xs text-muted-foreground">
                一行一個區塊、每家廠一欄。未揭標時單價位置是封標，不會顯示 0 或假價。
              </p>
            </div>
            {detail.items.map((item, index) => (
              <RfqItemComparison
                key={item.id}
                index={index}
                item={item}
                detail={detail}
                submissionsByInvitation={submissionsByInvitation}
                submissionItemMap={submissionItemMap}
                catalogPrices={
                  item.product_id ? catalogByProduct.get(item.product_id) ?? [] : []
                }
                canAward={canAward}
                isAdmin={isAdmin}
                busy={busy}
                onAward={(invitation, submission) =>
                  openReason({
                    kind: 'award',
                    title: `定標：第 ${index + 1} 行`,
                    description: `定給 ${invitation.factory_name || invitation.factory_id}（v${submission.version}）。請寫下原因；定標價只保留在這張 RFQ。`,
                    confirmLabel: '確認定標',
                    itemId: item.id,
                    submissionId: submission.id,
                  })
                }
                onNoAward={() =>
                  openReason({
                    kind: 'no_award',
                    title: `此行不定標：第 ${index + 1} 行`,
                    description: '這一行會標成不定標，並保留原因。',
                    confirmLabel: '確認不定標',
                    itemId: item.id,
                  })
                }
                onReopen={() =>
                  openReason({
                    kind: 'reopen',
                    title: `重開此行：第 ${index + 1} 行`,
                    description: '舊專案價會標成已重開，行回到未決定。歷史不會刪除。',
                    confirmLabel: '確認重開',
                    itemId: item.id,
                  })
                }
              />
            ))}
          </section>
        )}

        {detail.history.length > 0 && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <p className="inline-flex items-center gap-2 text-base font-semibold">
              <History className="h-4 w-4 text-primary" aria-hidden="true" />
              舊修訂回價（只保留紀錄，不能定標）
            </p>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {detail.history.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">R{row.revision} · v{row.version}</span>
                  <span>{row.factory_id}</span>
                  <span>{row.status === 'withdrawn' ? '已撤回' : '已提交'}</span>
                  <span className="text-xs">{formatRfqDateTime(row.submitted_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail.events.length > 0 && (
          <details className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <summary className="cursor-pointer text-base font-semibold">事件紀錄</summary>
            <ul className="mt-3 space-y-2 text-sm">
              {detail.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2 last:border-b-0">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">
                    {formatRfqDateTime(event.created_at)}
                  </span>
                  <span className="font-medium">
                    {EVENT_LABELS[event.event_type] || event.event_type}
                  </span>
                  {event.actor_email ? (
                    <span className="text-xs text-muted-foreground">{event.actor_email}</span>
                  ) : null}
                  {typeof event.detail?.reason === 'string' && event.detail.reason ? (
                    <span className="text-xs text-muted-foreground">— {event.detail.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <Modal
        open={reasonDialog !== null}
        onOpenChange={(next) => {
          if (!next) setReasonDialog(null);
        }}
        size="lg"
        title={reasonDialog?.title}
        description={reasonDialog?.description}
        footer={
          <>
            <ModalButton variant="secondary" onClick={() => setReasonDialog(null)}>
              取消
            </ModalButton>
            <ModalButton
              variant={reasonDialog?.destructive ? 'destructive' : 'primary'}
              onClick={() => void runReasonAction()}
              disabled={busy || !reasonText.trim()}
            >
              {busy ? '處理中…' : reasonDialog?.confirmLabel}
            </ModalButton>
          </>
        }
      >
        <label className="block text-sm font-medium">
          原因 <span className="text-destructive">*</span>
          <Textarea
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            placeholder="請寫下原因，會記錄在事件與專案價快照。"
            className="mt-2 min-h-[100px]"
            autoFocus
          />
        </label>
      </Modal>

      <Modal
        open={linkDialog !== null}
        onOpenChange={(next) => {
          if (!next) setLinkDialog(null);
        }}
        size="lg"
        title="廠家回價連結"
        description={`${linkDialog?.factoryName ?? ''} 專用。連結等同一把鑰匙，只傳給該廠家。`}
        footer={
          <>
            <ModalButton variant="secondary" onClick={() => setLinkDialog(null)}>
              關閉
            </ModalButton>
            <ModalButton
              variant="primary"
              onClick={() => {
                if (linkDialog) void copyText(linkDialog.link);
              }}
            >
              複製連結
            </ModalButton>
          </>
        }
      >
        <p className="break-all rounded-xl border border-border bg-muted/40 p-3 font-mono text-xs">
          {linkDialog?.link}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          重新產生連結會令上一條即時失效。複製連結不等於已送達。
        </p>
      </Modal>
    </div>
  );
}

interface RfqItemComparisonProps {
  index: number;
  item: RfqItem;
  detail: RfqDetail;
  submissionsByInvitation: Map<string, RfqSubmission>;
  submissionItemMap: Map<string, RfqSubmissionItem>;
  catalogPrices: RfqCatalogPrice[];
  canAward: boolean;
  isAdmin: boolean;
  busy: boolean;
  onAward: (invitation: RfqInvitation, submission: RfqSubmission) => void;
  onNoAward: () => void;
  onReopen: () => void;
}

function RfqItemComparison({
  index,
  item,
  detail,
  submissionsByInvitation,
  submissionItemMap,
  catalogPrices,
  canAward,
  isAdmin,
  busy,
  onAward,
  onNoAward,
  onReopen,
}: RfqItemComparisonProps) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      <div className="flex flex-wrap items-start gap-3 border-b border-border/60 p-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30">
          {item.image_url ? (
            <LoadingImage src={item.image_url} alt={item.name} className="h-16 w-16" />
          ) : (
            <FileText className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {index + 1}. {item.name}
            </h3>
            {item.model ? (
              <Badge variant="outline" className="font-mono text-xs">
                {item.model}
              </Badge>
            ) : null}
            {item.resolution === 'awarded' ? (
              <Badge variant="outline" className="gap-1 border-indigo-300 bg-indigo-50 text-indigo-800">
                <CheckCircle2 className="h-3 w-3" />
                已定標
              </Badge>
            ) : item.resolution === 'no_award' ? (
              <Badge variant="outline" className="gap-1 border-zinc-300 bg-zinc-100 text-zinc-700">
                <XCircle className="h-3 w-3" />
                不定標
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                未決定
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {numText(item.quantity)} {item.unit || ''}
            {item.dimensions ? ` · ${item.dimensions}` : ''}
            {item.specifications ? ` · ${item.specifications}` : ''}
          </p>
          {item.source_quote_item_id ? (
            <p className="mt-1 text-xs text-muted-foreground">來自報價版本的一個行</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.resolution === 'open' && canAward ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={busy}
              onClick={onNoAward}
            >
              此行不定標
            </Button>
          ) : null}
          {item.resolution !== 'open' && isAdmin ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={busy}
              onClick={onReopen}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              重開此行
            </Button>
          ) : null}
        </div>
      </div>

      {item.award ? (
        <div className="border-b border-border/60 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
          <p className="font-medium">
            定給 {item.award.factory_name || item.award.factory_id} · v{item.award.version} ·{' '}
            {formatRfqMoney(item.award.unit_price, item.award.currency)} × {numText(item.award.quantity)}
          </p>
          <p className="mt-1 text-xs">原因：{item.award.reason}</p>
        </div>
      ) : item.resolution === 'no_award' ? (
        <div className="border-b border-border/60 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          此行不定標{item.resolution_reason ? `：${item.resolution_reason}` : ''}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-muted/30">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">廠家</th>
              <th className="px-3 py-2 font-medium">版本</th>
              <th className="px-3 py-2 text-right font-medium">已報行數</th>
              <th className="px-3 py-2 text-right font-medium">單價</th>
              <th className="px-3 py-2 text-right font-medium">交期</th>
              <th className="px-3 py-2 text-right font-medium">有效期</th>
              <th className="px-3 py-2 text-right font-medium">MOQ</th>
              <th className="px-3 py-2 text-right font-medium">包裝</th>
              <th className="px-3 py-2 text-right font-medium">體積</th>
              <th className="px-3 py-2 font-medium">替代／備註</th>
              <th className="px-3 py-2 font-medium">定標</th>
            </tr>
          </thead>
          <tbody>
            {detail.invitations.map((invitation) => {
              const submission = submissionsByInvitation.get(invitation.id);
              const submitted =
                submission && submission.version === invitation.latest_version && submission.items != null;
              const line = submitted
                ? submissionItemMap.get(`${invitation.id}:${item.id}`)
                : undefined;
              const alreadyAwarded =
                item.award && item.award.factory_id === invitation.factory_id;
              const moqWarning =
                line?.moq != null && Number(line.moq) > Number(item.quantity);
              return (
                <tr key={invitation.id} className="border-t border-border/50 align-top">
                  <td className="px-3 py-2 font-medium">
                    {invitation.factory_name || invitation.factory_id}
                    {alreadyAwarded ? (
                      <span className="ml-2 text-[10px] font-normal text-indigo-700">得標</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {invitation.latest_version != null ? `v${invitation.latest_version}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {invitation.quoted_item_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {detail.rfq.sealed ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        封標
                      </span>
                    ) : !submitted ? (
                      <span className="text-muted-foreground">未提交</span>
                    ) : !line || line.no_quote || line.unit_price == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatRfqMoney(line.unit_price, detail.rfq.currency)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {detail.rfq.sealed ? '—' : line?.lead_time_days != null ? `${line.lead_time_days} 天` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {detail.rfq.sealed ? '—' : line?.validity_days != null ? `${line.validity_days} 天` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {detail.rfq.sealed ? '—' : numText(line?.moq)}
                    {!detail.rfq.sealed && moqWarning ? (
                      <span className="ml-1 inline-flex rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900">
                        高於數量
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {detail.rfq.sealed ? '—' : numText(line?.package_qty)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {detail.rfq.sealed ? '—' : numText(line?.volume)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {detail.rfq.sealed ? (
                      '—'
                    ) : (
                      <div className="max-w-[220px] space-y-1">
                        {line?.alternate_text ? <p>替代：{line.alternate_text}</p> : null}
                        {line?.note ? <p>{line.note}</p> : null}
                        {!line?.alternate_text && !line?.note ? '—' : null}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {alreadyAwarded ? (
                      <span className="text-xs font-medium text-indigo-700">已定標</span>
                    ) : canAward &&
                      item.resolution === 'open' &&
                      submitted &&
                      submission &&
                      line &&
                      !line.no_quote &&
                      line.unit_price != null ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busy}
                        onClick={() => onAward(invitation, submission)}
                      >
                        定標
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">歷史目錄價（只在這裡顯示，不影響客戶報價）</p>
        {!item.product_id ? (
          <p className="mt-1">手填行沒有 product_id，因此沒有歷史目錄價。</p>
        ) : catalogPrices.length === 0 ? (
          <p className="mt-1">這張單的受邀廠未有已審核目錄價。</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {catalogPrices.slice(0, 8).map((price, priceIndex) => (
              <li key={`${price.factory_id}-${price.quote_year}-${priceIndex}`}>
                {price.factory_name || price.factory_id} · {price.quote_year ?? '—'} ·{' '}
                {formatRfqMoney(price.catalog_price, price.currency || detail.rfq.currency)}
                {price.unit ? ` / ${price.unit}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
