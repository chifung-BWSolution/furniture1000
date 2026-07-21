import { useState, useEffect, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, CheckCircle2, MessageCircle, Edit3, MapPin, ArrowRight, Loader2,
} from 'lucide-react';
import {
  fetchZones, fetchZoneProducts, fetchDiscussions,
  updateZoneProductStatusWithProgress, bulkUpdateZoneProductStatusWithProgress,
  addDiscussion, computeProjectProgress,
} from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import { ClientZoneFloorPlan } from './shared/ClientZoneFloorPlan';
import { ClientProgressBar } from './shared/ClientProgressBar';
import { DiscussionPanel } from './shared/DiscussionPanel';
import { toast } from 'sonner';
import {
  CLIENT_ZONE_STATUS_META,
  type ProjectZone, type ZoneProduct, type ProductDiscussion,
} from '@/types/solutions';

interface CustomerDesignProjectsViewProps {
  initialProjectId?: string | null;
}

export function CustomerDesignProjectsView({ initialProjectId }: CustomerDesignProjectsViewProps) {
  const { loading: ctxLoading, projects, authorName, refresh } = useClientZoneContext();
  const [openProjectId, setOpenProjectId] = useState<string | null>(initialProjectId ?? null);
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [products, setProducts] = useState<ZoneProduct[]>([]);
  const [discussions, setDiscussions] = useState<ProductDiscussion[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (initialProjectId) setOpenProjectId(initialProjectId);
  }, [initialProjectId]);

  useEffect(() => {
    if (!openProjectId) return;
    setDetailLoading(true);
    Promise.all([
      fetchZones(openProjectId),
      fetchZoneProducts(openProjectId),
      fetchDiscussions(openProjectId),
    ]).then(([z, zp, disc]) => {
      const inZone = zp.filter((p) => p.zoneId);
      setZones(z);
      setProducts(inZone);
      setDiscussions(disc);
      setActiveZoneId(z[0]?.id ?? null);
    }).finally(() => setDetailLoading(false));
  }, [openProjectId]);

  const projectProgress = useMemo(
    () => computeProjectProgress(products),
    [products],
  );

  const handleProductAction = useCallback(async (
    zoneProductId: string,
    status: 'confirmed' | 'discussing',
    label: string,
    discussionBody?: string,
  ) => {
    if (!openProjectId) return;
    setProducts((prev) => prev.map((p) => (p.id === zoneProductId ? { ...p, status } : p)));
    const res = await updateZoneProductStatusWithProgress(zoneProductId, openProjectId, status);
    if (res.ok) {
      if (discussionBody) {
        const mentionRes = await addDiscussion({
          projectId: openProjectId,
          zoneProductId,
          author: authorName,
          authorRole: 'client',
          body: discussionBody,
          mentions: ['PM', '設計師'],
        });
        if (mentionRes.ok && mentionRes.data) {
          setDiscussions((prev) => [...prev, mentionRes.data!]);
        }
      }
      toast.success(`已${label}，已通知 PM / 設計師`);
      refresh();
    } else {
      toast.error('操作失敗', { description: res.error });
    }
  }, [openProjectId, authorName, refresh]);

  const handleZoneAction = useCallback(async (
    zoneId: string,
    status: 'confirmed' | 'discussing',
    label: string,
  ) => {
    if (!openProjectId) return;
    const ids = products.filter((p) => p.zoneId === zoneId).map((p) => p.id);
    if (ids.length === 0) return;
    setProducts((prev) => prev.map((p) => (p.zoneId === zoneId ? { ...p, status } : p)));
    const res = await bulkUpdateZoneProductStatusWithProgress(ids, openProjectId, status);
    res.ok
      ? toast.success(`分區已${label}（${ids.length} 件），已通知 PM / 設計師`)
      : toast.error('操作失敗', { description: res.error });
    if (res.ok) refresh();
  }, [openProjectId, products, refresh]);

  if (ctxLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!openProjectId) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
        <div className="mx-auto max-w-7xl">
          <h1 className="font-display text-2xl font-bold tracking-tight">我的設計專案</h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">點擊專案查看分區與產品方案</p>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenProjectId(p.id)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-base font-bold text-foreground">{p.name}</h3>
                  <p className="mt-0.5 font-body text-[14px] text-muted-foreground">
                    {[p.clientCompany, p.clientName].filter(Boolean).join(' · ') || '受邀專案'}
                  </p>
                  <div className="mt-2 max-w-xs">
                    <ClientProgressBar progress={p.progress} />
                    <span className="mt-1 block font-mono-data text-xs text-muted-foreground">
                      {p.progress}% 已確認
                    </span>
                  </div>
                </div>
                <ArrowRight className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {projects.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <MapPin className="h-7 w-7 text-primary" />
                </div>
                <h2 className="font-display text-base font-bold">尚未收到專案邀請</h2>
                <p className="font-body text-[15px] text-muted-foreground">
                  當設計師團隊邀請您查看方案時，專案會在此顯示
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const project = projects.find((p) => p.id === openProjectId);
  if (!project) return null;

  const visibleZones = activeZoneId
    ? zones.filter((z) => z.id === activeZoneId)
    : zones;

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => setOpenProjectId(null)}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> 返回專案列表
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{project.name}</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              查看各分區的產品方案，並進行確認或提出討論（僅顯示售價與規格）
            </p>
          </div>
          <div className="w-full max-w-[200px]">
            <ClientProgressBar progress={projectProgress} label="確認進度" />
          </div>
        </div>

        {detailLoading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="mt-6">
              <ClientZoneFloorPlan
                project={project}
                zones={zones}
                activeZoneId={activeZoneId}
                onZoneClick={setActiveZoneId}
              />
            </div>

            {zones.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveZoneId(null)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    !activeZoneId ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                  )}
                >
                  全部分區
                </button>
                {zones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => setActiveZoneId(z.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      activeZoneId === z.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                    )}
                  >
                    {z.name}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-6 space-y-8">
              {visibleZones.map((zone) => {
                const items = products.filter((zp) => zp.zoneId === zone.id);
                if (items.length === 0) return null;
                const zoneDiscussions = discussions.filter((d) =>
                  items.some((it) => it.id === d.zoneProductId),
                );
                return (
                  <div key={zone.id} id={`zone-${zone.id}`}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 font-display text-base font-bold">
                        {zone.code && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono-data text-xs text-primary">
                            {zone.code}
                          </span>
                        )}
                        {zone.name}
                        <span className="font-body text-[13px] font-normal text-muted-foreground">
                          （{items.length} 件）
                        </span>
                      </h2>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleZoneAction(zone.id, 'confirmed', '確認')}
                          className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20"
                        >
                          <CheckCircle2 className="h-3 w-3" /> 分區確認
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleZoneAction(zone.id, 'discussing', '標記討論')}
                          className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-500/20"
                        >
                          <MessageCircle className="h-3 w-3" /> 分區討論
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((zp) => (
                        <div key={zp.id} className="overflow-hidden rounded-xl border border-border bg-card">
                          <div className="aspect-[4/3] bg-muted">
                            {zp.productImageUrl ? (
                              <img
                                src={zp.productImageUrl}
                                alt={zp.productTitle}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">無圖片</div>
                            )}
                          </div>
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-display text-[15px] font-semibold text-foreground">{zp.productTitle}</h3>
                              <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium', CLIENT_ZONE_STATUS_META[zp.status].className)}>
                                {CLIENT_ZONE_STATUS_META[zp.status].label}
                              </span>
                            </div>
                            <p className="mt-1 font-mono-data text-base font-bold text-primary">
                              ${zp.salePrice.toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">數量 × {zp.quantity} · 方案 {zp.scheme}</p>
                            <div className="mt-2.5 grid grid-cols-3 gap-1">
                              <button
                                type="button"
                                onClick={() => void handleProductAction(zp.id, 'confirmed', '確認')}
                                className={cn(
                                  'flex items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-xs font-medium transition-colors',
                                  zp.status === 'confirmed'
                                    ? 'bg-emerald-500/20 text-emerald-700 ring-1 ring-emerald-500/40'
                                    : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20',
                                )}
                              >
                                <CheckCircle2 className="h-3 w-3" /> 確認
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleProductAction(zp.id, 'discussing', '提出討論')}
                                className={cn(
                                  'flex items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-xs font-medium transition-colors',
                                  zp.status === 'discussing'
                                    ? 'bg-amber-500/20 text-amber-700 ring-1 ring-amber-500/40'
                                    : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20',
                                )}
                              >
                                <MessageCircle className="h-3 w-3" /> 討論
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleProductAction(
                                  zp.id,
                                  'discussing',
                                  '要求修改',
                                  `客戶要求修改「${zp.productTitle}」@PM @設計師`,
                                )}
                                className="flex items-center justify-center gap-0.5 rounded-lg border border-border px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                              >
                                <Edit3 className="h-3 w-3" /> 修改
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
                      <DiscussionPanel
                        title={`${zone.name} 討論區`}
                        discussions={zoneDiscussions}
                        onSend={async (body, mentions) => {
                          const res = await addDiscussion({
                            projectId: openProjectId,
                            zoneProductId: items[0]?.id ?? null,
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
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
