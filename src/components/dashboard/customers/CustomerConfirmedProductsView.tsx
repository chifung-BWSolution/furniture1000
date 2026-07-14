import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, MessageSquare, Loader2, CheckSquare, Square,
} from 'lucide-react';
import {
  fetchInvitedProjectsWithProducts, fetchDiscussions,
  bulkUpdateZoneProductStatusWithProgress, addDiscussion,
  computeProjectProgress,
} from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import { ClientProgressBar } from './shared/ClientProgressBar';
import { DiscussionPanel } from './shared/DiscussionPanel';
import { toast } from 'sonner';
import {
  CLIENT_ZONE_STATUS_META,
  type ZoneProductStatus, type DesignProject, type ZoneProduct, type ProductDiscussion,
} from '@/types/solutions';

export function CustomerConfirmedProductsView() {
  const { loading: ctxLoading, authorName, clientEmail } = useClientZoneContext();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [productsByProject, setProductsByProject] = useState<Record<string, ZoneProduct[]>>({});
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [discussions, setDiscussions] = useState<ProductDiscussion[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ZoneProductStatus>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (ctxLoading) return;
    fetchInvitedProjectsWithProducts(clientEmail).then(({ projects: ps, productsByProject: map }) => {
      setProjects(ps);
      setProductsByProject(map);
      const withProducts = ps.find((p) => (map[p.id]?.length ?? 0) > 0);
      const initial = withProducts ?? ps[0] ?? null;
      setActiveProjectId(initial?.id ?? null);
      if (initial) {
        const prods = map[initial.id] ?? [];
        setStatuses(Object.fromEntries(prods.map((x) => [x.id, x.status])));
      }
      setLoaded(true);
    });
  }, [ctxLoading, clientEmail]);

  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const products = activeProjectId ? (productsByProject[activeProjectId] ?? []) : [];

  useEffect(() => {
    if (!activeProjectId) return;
    fetchDiscussions(activeProjectId).then(setDiscussions);
    const prods = productsByProject[activeProjectId] ?? [];
    setStatuses(Object.fromEntries(prods.map((x) => [x.id, x.status])));
    setSelected(new Set());
  }, [activeProjectId, productsByProject]);

  const confirmedCount = useMemo(
    () => Object.values(statuses).filter((s) => s === 'confirmed').length,
    [statuses],
  );
  const discussingCount = useMemo(
    () => Object.values(statuses).filter((s) => s === 'discussing').length,
    [statuses],
  );
  const pendingCount = useMemo(
    () => Object.values(statuses).filter((s) => s === 'pending').length,
    [statuses],
  );
  const progress = useMemo(() => computeProjectProgress(
    products.map((p) => ({ ...p, status: statuses[p.id] ?? p.status })),
  ), [products, statuses]);

  if (!loaded || ctxLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!project || products.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <CheckCircle2 className="h-8 w-8 text-primary" />
        </div>
        <h2 className="font-display text-lg font-bold">尚無待確認產品</h2>
        <p className="font-body text-sm text-muted-foreground">
          當您受邀的專案有產品方案時，會在此顯示供您確認
        </p>
      </div>
    );
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p) => p.id)));
    }
  };

  const bulkSetStatus = async (status: ZoneProductStatus, label: string) => {
    const ids = selected.size > 0 ? [...selected] : products.map((p) => p.id);
    if (ids.length === 0 || !activeProjectId) return;
    setStatuses((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = status;
      return next;
    });
    const res = await bulkUpdateZoneProductStatusWithProgress(ids, activeProjectId, status);
    if (res.ok) {
      toast.success(`已批量${label}（${ids.length} 件）`);
      setSelected(new Set());
    } else {
      toast.error('更新失敗', { description: res.error });
    }
  };

  const setStatus = async (id: string, s: ZoneProductStatus) => {
    if (!activeProjectId) return;
    setStatuses((prev) => ({ ...prev, [id]: s }));
    const res = await bulkUpdateZoneProductStatusWithProgress([id], activeProjectId, s);
    if (!res.ok) toast.error('更新失敗', { description: res.error });
  };

  const handleSendDiscussion = async (zoneProductId: string, body: string, mentions: string[]) => {
    const res = await addDiscussion({
      projectId: activeProjectId!,
      zoneProductId,
      author: authorName,
      authorRole: 'client',
      body,
      mentions,
    });
    if (res.ok && res.data) {
      setDiscussions((prev) => [...prev, res.data!]);
      toast.success('已送出留言，已通知 PM / 設計師');
    } else {
      toast.error('送出失敗', { description: res.error });
      throw new Error(res.error);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold tracking-tight">確定產品</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">批量確認產品狀態，並與 PM / 設計師討論</p>

        {projects.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {projects.map((p) => {
              const count = productsByProject[p.id]?.length ?? 0;
              if (count === 0) return null;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveProjectId(p.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors',
                    activeProjectId === p.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-3 font-body text-sm text-muted-foreground">{project.name}</p>

        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <ClientProgressBar progress={progress} label="整體確認進度" />
          <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
            <span className={cn('rounded-full border px-2 py-0.5', CLIENT_ZONE_STATUS_META.confirmed.className)}>
              已確認 {confirmedCount}
            </span>
            <span className={cn('rounded-full border px-2 py-0.5', CLIENT_ZONE_STATUS_META.discussing.className)}>
              待討論 {discussingCount}
            </span>
            <span className={cn('rounded-full border px-2 py-0.5', CLIENT_ZONE_STATUS_META.pending.className)}>
              待確認 {pendingCount}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {confirmedCount} / {products.length} 件已確認
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {selected.size === products.length ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            {selected.size > 0 ? `已選 ${selected.size} 件` : '全選'}
          </button>
          <button
            type="button"
            onClick={() => void bulkSetStatus('confirmed', '確認')}
            className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-500/20"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> 批量已確定
          </button>
          <button
            type="button"
            onClick={() => void bulkSetStatus('discussing', '標記待討論')}
            className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-600 hover:bg-amber-500/20"
          >
            <MessageSquare className="h-3.5 w-3.5" /> 批量待討論
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {products.map((p) => {
            const status = statuses[p.id] ?? p.status;
            const itemDiscussions = discussions.filter((d) => d.zoneProductId === p.id);
            const isSelected = selected.has(p.id);
            return (
              <div
                key={p.id}
                className={cn(
                  'overflow-hidden rounded-xl border bg-card transition-colors',
                  isSelected ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border',
                )}
              >
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => toggleSelect(p.id)}
                    className="shrink-0 text-muted-foreground hover:text-primary"
                  >
                    {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                  </button>
                  {p.productImageUrl ? (
                    <img
                      src={p.productImageUrl}
                      alt={p.productTitle}
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded-lg object-cover bg-muted"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
                      無圖
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[13.5px] font-semibold text-foreground">{p.productTitle}</h3>
                    <p className="font-mono-data text-[12px] text-primary">
                      ${p.salePrice.toLocaleString()} · 數量 × {p.quantity}
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', CLIENT_ZONE_STATUS_META[status].className)}>
                    {CLIENT_ZONE_STATUS_META[status].label}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void setStatus(p.id, 'confirmed')}
                      className={cn(
                        'flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all',
                        status === 'confirmed' ? CLIENT_ZONE_STATUS_META.confirmed.className : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> 已確定
                    </button>
                    <button
                      type="button"
                      onClick={() => void setStatus(p.id, 'discussing')}
                      className={cn(
                        'flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all',
                        status === 'discussing' ? CLIENT_ZONE_STATUS_META.discussing.className : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> 待討論
                    </button>
                  </div>
                </div>

                <DiscussionPanel
                  discussions={itemDiscussions}
                  defaultOpen={itemDiscussions.length > 0}
                  onSend={(body, mentions) => handleSendDiscussion(p.id, body, mentions)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
