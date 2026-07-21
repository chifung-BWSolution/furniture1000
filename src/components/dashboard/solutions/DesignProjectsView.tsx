import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Minus, DoorOpen, ChevronDown, ChevronUp, Loader2, Search,
  PackagePlus, Check, X, LayoutGrid, Sparkles,
} from 'lucide-react';
import {
  fetchProjects, fetchZones, fetchZoneProducts, fetchSearchProducts,
  createZone, deleteZone, createZoneProduct, updateZoneProductStatus,
  saveProject, updateProjectFloorPlan,
} from '@/lib/solutionsApi';
import { generateFloorPlanDataUrl } from '@/lib/floorPlanGenerator';
import { consumeSolutionFocusProjectId } from '@/lib/solutionProjectFocus';
import {
  EXISTING_PARTITION_OPTIONS,
  PROJECT_TYPE_OPTIONS,
  defaultRoomCounts,
  inferProjectType,
  projectTypeLabel,
  roomsForProjectType,
  zoneSeedsFromRoomCounts,
  type ExistingPartitionMode,
  type ProjectEngineeringType,
} from '@/lib/projectPartitionTemplates';
import { PRODUCT_CATEGORIES } from '@/constants/solutions-mock';
import { toast } from 'sonner';
import {
  ZONE_PRODUCT_STATUS_META,
  type DesignProject,
  type ProjectZone,
  type ZoneProduct,
  type SearchProduct,
  type ZoneProductStatus,
} from '@/types/solutions';

function countRoomsFromZones(
  type: ProjectEngineeringType,
  zones: ProjectZone[],
): Record<string, number> {
  const rooms = roomsForProjectType(type);
  const counts = defaultRoomCounts(type);
  for (const r of rooms) counts[r.key] = 0;
  for (const z of zones) {
    const match = rooms.find(
      (r) => z.name === r.label || z.name.startsWith(`${r.label} `) || z.code?.startsWith(r.codePrefix),
    );
    if (match) counts[match.key] = (counts[match.key] || 0) + 1;
  }
  return counts;
}

export function DesignProjectsView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [partitionOpen, setPartitionOpen] = useState(true);
  const [floorOpen, setFloorOpen] = useState(false);
  const [syncingRooms, setSyncingRooms] = useState(false);

  const [projectType, setProjectType] = useState<ProjectEngineeringType>('office');
  const [existingPartition, setExistingPartition] =
    useState<ExistingPartitionMode>('none');
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerZoneId, setPickerZoneId] = useState<string | null>(null);
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');

  useEffect(() => {
    const focusId = consumeSolutionFocusProjectId();
    fetchProjects()
      .then((rows) => {
        setProjects(rows);
        if (focusId && rows.some((r) => r.id === focusId)) {
          setActiveProjectId(focusId);
        } else if (rows.length > 0) {
          setActiveProjectId((cur) => cur || rows[0].id);
        }
      })
      .finally(() => setProjectsLoaded(true));
  }, []);

  const reloadZones = useCallback(async (projectId: string) => {
    setLoading(true);
    const [z, zp] = await Promise.all([
      fetchZones(projectId),
      fetchZoneProducts(projectId),
    ]);
    setZones(z);
    setZoneProducts(zp);
    setLoading(false);
    return z;
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    const project = projects.find((p) => p.id === activeProjectId);
    const type =
      project?.meta?.projectType ||
      inferProjectType(project?.name || '', project?.clientCompany);
    setProjectType(type);
    setExistingPartition(project?.meta?.existingPartition || 'none');

    reloadZones(activeProjectId).then((z) => {
      const fromMeta = project?.meta?.roomCounts;
      if (fromMeta && Object.keys(fromMeta).length > 0) {
        setRoomCounts({ ...defaultRoomCounts(type), ...fromMeta });
      } else if (z.length > 0) {
        setRoomCounts(countRoomsFromZones(type, z));
      } else {
        setRoomCounts(defaultRoomCounts(type));
      }
    });
  }, [activeProjectId, projects, reloadZones]);

  const project = projects.find((p) => p.id === activeProjectId) || null;
  const roomTemplates = useMemo(() => roomsForProjectType(projectType), [projectType]);

  const persistMeta = async (next: {
    projectType?: ProjectEngineeringType;
    existingPartition?: ExistingPartitionMode;
    roomCounts?: Record<string, number>;
  }) => {
    if (!project) return;
    const meta = {
      ...project.meta,
      projectType: next.projectType ?? projectType,
      existingPartition: next.existingPartition ?? existingPartition,
      roomCounts: next.roomCounts ?? roomCounts,
    };
    const res = await saveProject(project.id, { meta });
    if (res.ok) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, meta } : p)),
      );
    }
  };

  const syncZonesToCounts = async (
    type: ProjectEngineeringType,
    counts: Record<string, number>,
  ) => {
    if (!activeProjectId || syncingRooms) return;
    setSyncingRooms(true);
    try {
      const desired = zoneSeedsFromRoomCounts(type, counts);
      // Replace zones that have no products; keep zones with products when possible
      const emptyZones = zones.filter(
        (z) => !zoneProducts.some((zp) => zp.zoneId === z.id),
      );
      for (const z of emptyZones) {
        await deleteZone(z.id);
      }
      const kept = zones.filter((z) =>
        zoneProducts.some((zp) => zp.zoneId === z.id),
      );
      const created: ProjectZone[] = [...kept];
      for (let i = 0; i < desired.length; i++) {
        const seed = desired[i];
        const already = kept.find(
          (z) => z.name === seed.name || z.code === seed.code,
        );
        if (already) continue;
        const res = await createZone({
          projectId: activeProjectId,
          name: seed.name,
          code: seed.code,
          bounds: seed.bounds,
          aiSuggested: true,
          sortOrder: i,
        });
        if (res.ok && res.data) created.push(res.data);
      }
      setZones(created);
      const dataUrl = generateFloorPlanDataUrl(created, project?.name);
      await updateProjectFloorPlan(activeProjectId, dataUrl, 'image/svg+xml');
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProjectId
            ? { ...p, floorPlanUrl: dataUrl, floorPlanType: 'image/svg+xml' }
            : p,
        ),
      );
      await persistMeta({ projectType: type, roomCounts: counts });
    } finally {
      setSyncingRooms(false);
    }
  };

  const changeRoomQty = async (key: string, delta: number) => {
    const next = {
      ...roomCounts,
      [key]: Math.max(0, Math.min(20, (roomCounts[key] || 0) + delta)),
    };
    setRoomCounts(next);
    await syncZonesToCounts(projectType, next);
  };

  const changeProjectType = async (type: ProjectEngineeringType) => {
    setProjectType(type);
    const counts = defaultRoomCounts(type);
    setRoomCounts(counts);
    await syncZonesToCounts(type, counts);
    toast.success(`已切換為${projectTypeLabel(type)}間隔模板`);
  };

  const openPicker = async (zoneId?: string | null) => {
    setPickerZoneId(zoneId ?? null);
    setPickerOpen(true);
    if (products.length === 0) {
      setProductsLoading(true);
      fetchSearchProducts(80)
        .then(setProducts)
        .finally(() => setProductsLoading(false));
    }
  };

  const addProductToZone = async (product: SearchProduct) => {
    if (!activeProjectId) return;
    const zoneId = pickerZoneId || zones[0]?.id || null;
    if (!zoneId) {
      toast.error('請先設定間隔數量');
      return;
    }
    const res = await createZoneProduct({
      projectId: activeProjectId,
      zoneId,
      productId: product.id,
      productTitle: product.title,
      productImageUrl: product.imageUrl,
      salePrice: product.salePrice,
      scheme: project?.activeScheme || 'A',
      quantity: 1,
      status: 'pending',
    });
    if (res.ok && res.data) {
      setZoneProducts((prev) => [...prev, res.data!]);
      toast.success('已加入間隔', {
        description: `${product.title} → ${zones.find((z) => z.id === zoneId)?.name || '間隔'}`,
      });
    } else {
      toast.error('加入失敗', { description: res.error });
    }
  };

  const setStatus = async (id: string, status: ZoneProductStatus) => {
    setZoneProducts((prev) =>
      prev.map((zp) => (zp.id === id ? { ...zp, status } : zp)),
    );
    const res = await updateZoneProductStatus(id, status);
    if (!res.ok) toast.error('更新失敗', { description: res.error });
  };

  const filteredProducts = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
      if (category !== '全部' && p.category !== category) return false;
      return true;
    });
  }, [products, keyword, category]);

  if (!project) {
    if (!projectsLoaded) {
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <LayoutGrid className="h-10 w-10 text-muted-foreground/40" />
        <h2 className="font-display text-lg font-bold">尚無設計專案</h2>
        <p className="text-sm text-muted-foreground">請先到「方案列表」建立專案並上傳平面圖</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4 md:px-8">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-2xl font-bold tracking-tight">
                設計專案
              </h1>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-body text-xs font-medium text-primary">
                {projectTypeLabel(projectType)}
              </span>
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
              <select
                value={activeProjectId}
                onChange={(e) => setActiveProjectId(e.target.value)}
                className="h-10 min-w-[280px] max-w-xl flex-1 truncate rounded-lg border border-border bg-card px-3 font-display text-sm font-semibold"
                aria-label="選擇設計專案"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="font-body text-sm text-muted-foreground">
                {[project.clientCompany, project.clientName].filter(Boolean).join(' · ') || '未填客戶'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openPicker(null)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-body text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <PackagePlus className="h-4 w-4" />
            選擇產品
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 p-6 md:p-8">
        {/* Engineering type */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-2 font-body text-xs font-medium text-muted-foreground">
            工程類型（決定可見間隔）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => changeProjectType(opt.id)}
                className={cn(
                  'rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors',
                  projectType === opt.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
                title={opt.hint}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* 間隔 / 功能房間 */}
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <button
            type="button"
            onClick={() => setPartitionOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <span className="inline-flex items-center gap-2 font-display text-sm font-bold">
              <DoorOpen className="h-4 w-4 text-primary" />
              間隔／功能房間
              {syncingRooms ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            </span>
            {partitionOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {partitionOpen ? (
            <div className="space-y-5 border-t border-border px-4 py-4">
              <div>
                <p className="mb-2 font-body text-xs font-medium text-muted-foreground">現有間隔</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXISTING_PARTITION_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setExistingPartition(opt.id);
                        void persistMeta({ existingPartition: opt.id });
                      }}
                      className={cn(
                        'rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors',
                        existingPartition === opt.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 font-body text-xs font-medium text-muted-foreground">
                  新建房間類型（數量）— {projectTypeLabel(projectType)}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {roomTemplates.map((room) => (
                    <div
                      key={room.key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2"
                    >
                      <span className="font-body text-sm">{room.label}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={syncingRooms}
                          onClick={() => changeRoomQty(room.key, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-40"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center font-mono-data text-sm font-semibold">
                          {roomCounts[room.key] || 0}
                        </span>
                        <button
                          type="button"
                          disabled={syncingRooms}
                          onClick={() => changeRoomQty(room.key, 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1 font-body text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  調整數量後會同步文字間隔清單，設計師／PM 可為各間隔配置傢俬
                </p>
              </div>
            </div>
          ) : null}
        </section>

        {/* Text zone list + furniture */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold">間隔清單與傢俬配置</h2>
            <span className="font-mono-data text-xs text-muted-foreground">
              {zones.length} 個間隔 · {zoneProducts.filter((z) => z.zoneId).length} 件產品
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : zones.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              請在上方設定房間數量，以產生間隔
            </div>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-2">
            {zones.map((zone) => {
              const items = zoneProducts.filter((zp) => zp.zoneId === zone.id);
              return (
                <div
                  key={zone.id}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {zone.code ? (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono-data text-xs text-primary">
                          {zone.code}
                        </span>
                      ) : null}
                      <h3 className="font-display text-sm font-bold">{zone.name}</h3>
                      <span className="text-xs text-muted-foreground">{items.length} 件傢俬</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openPicker(zone.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
                    >
                      <Plus className="h-3 w-3" /> 加入產品
                    </button>
                  </div>
                  {items.length === 0 ? (
                    <p className="px-4 py-4 text-xs text-muted-foreground">尚未配置傢俬 — 按右上角「選擇產品」或本列「加入產品」</p>
                  ) : (
                    <ul className="divide-y divide-border/70">
                      {items.map((item) => (
                        <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="h-11 w-11 overflow-hidden rounded-md bg-muted">
                            {item.productImageUrl ? (
                              <img
                                src={item.productImageUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.productTitle}</p>
                            <p className="font-mono-data text-xs text-primary">
                              ${Number(item.salePrice || 0).toLocaleString()} × {item.quantity}
                            </p>
                          </div>
                          <select
                            value={item.status}
                            onChange={(e) =>
                              setStatus(item.id, e.target.value as ZoneProductStatus)
                            }
                            className={cn(
                              'rounded-full border px-2 py-1 text-xs font-medium',
                              ZONE_PRODUCT_STATUS_META[item.status]?.className,
                            )}
                          >
                            <option value="pending">未確定</option>
                            <option value="discussing">待討論</option>
                            <option value="confirmed">已確定</option>
                          </select>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            </div>
          )}
        </section>

        {/* Optional floor plan preview */}
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <button
            type="button"
            onClick={() => setFloorOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <span className="inline-flex items-center gap-2 font-display text-sm font-bold">
              <LayoutGrid className="h-4 w-4 text-primary" />
              平面圖預覽
            </span>
            {floorOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {floorOpen ? (
            <div className="border-t border-border p-4">
              {project.floorPlanUrl ? (
                <img
                  src={project.floorPlanUrl}
                  alt="平面圖"
                  className="max-h-80 w-full rounded-lg border border-border object-contain bg-muted/20"
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  尚未有平面圖 — 可在方案列表上傳，或調整間隔數量後自動產生示意
                </p>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {/* Product picker modal */}
      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center sm:p-6">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="font-display text-base font-bold">選擇產品</h3>
                <p className="text-xs text-muted-foreground">
                  加入至：
                  {pickerZoneId
                    ? zones.find((z) => z.id === pickerZoneId)?.name || '指定間隔'
                    : zones[0]?.name || '第一個間隔'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-md p-1.5 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 border-b border-border px-4 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜尋產品…"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <select
                  value={pickerZoneId || zones[0]?.id || ''}
                  onChange={(e) => setPickerZoneId(e.target.value || null)}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.code ? `${z.code} · ` : ''}
                      {z.name}
                    </option>
                  ))}
                </select>
                {['全部', ...PRODUCT_CATEGORIES.filter((c) => c !== '全部')].slice(0, 8).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs',
                      category === c
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {productsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {filteredProducts.map((p) => (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-xl border border-border bg-background"
                    >
                      <div className="aspect-[4/3] bg-muted">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="space-y-1.5 p-2.5">
                        <p className="line-clamp-2 text-xs font-medium">{p.title}</p>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono-data text-xs font-bold text-primary">
                            ${p.salePrice.toLocaleString()}
                          </span>
                          <button
                            type="button"
                            onClick={() => addProductToZone(p)}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
                          >
                            <Check className="h-3 w-3" /> 加入
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!productsLoading && filteredProducts.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">找不到產品</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
