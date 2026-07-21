import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Loader2, Search, Check, CheckCircle2, X, LayoutGrid, UserRound, Tag,
} from 'lucide-react';
import {
  fetchProjects, fetchZones, fetchZoneProducts, fetchActiveShopifyProducts,
  createZoneProduct, updateZoneProductStatus, saveProject,
} from '@/lib/solutionsApi';
import { useAppStore } from '@/hooks/use-app-store';
import { consumeSolutionFocusProjectId } from '@/lib/solutionProjectFocus';
import { resolveDesignProjectPmLabels } from '@/lib/solutionProjectPm';
import {
  inferProjectType,
  projectTypeLabel,
} from '@/lib/projectPartitionTemplates';
import { toast } from 'sonner';
import {
  ZONE_PRODUCT_STATUS_META,
  type DesignProject,
  type ProjectZone,
  type ZoneProduct,
  type SearchProduct,
  type ZoneProductStatus,
} from '@/types/solutions';

function zoneCodePrefix(code: string | null): string {
  return code?.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || '其他';
}

function zoneBaseName(name: string): string {
  return (
    name
      .trim()
      .replace(/\s+\d+$/, '')
      .replace(/[（(]\d+[）)]$/, '')
      .trim() || '其他間隔'
  );
}

export function DesignProjectsView() {
  const appStore = useAppStore();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pmNames, setPmNames] = useState<Record<string, string>>({});

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerZoneId, setPickerZoneId] = useState<string | null>(null);
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [productLevel1, setProductLevel1] = useState('');
  const [productLevel2, setProductLevel2] = useState('');
  const [confirmingProject, setConfirmingProject] = useState(false);

  useEffect(() => {
    const focusId = consumeSolutionFocusProjectId();
    fetchProjects()
      .then(async (rows) => {
        setProjects(rows);
        setPmNames(await resolveDesignProjectPmLabels(rows));
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
    void reloadZones(activeProjectId);
  }, [activeProjectId, reloadZones]);

  const project = projects.find((p) => p.id === activeProjectId) || null;
  const projectType =
    project?.meta?.projectType ||
    inferProjectType(project?.name || '', project?.clientCompany);
  const zoneGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; prefix: string; label: string; zones: ProjectZone[] }
    >();
    for (const zone of zones) {
      const prefix = zoneCodePrefix(zone.code);
      const label = zoneBaseName(zone.name);
      const key = `${prefix}:${label}`;
      const group = groups.get(key) || { key, prefix, label, zones: [] };
      group.zones.push(zone);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [zones]);

  const openPicker = async (zoneId?: string | null) => {
    setPickerZoneId(zoneId ?? null);
    setPickerOpen(true);
    if (products.length === 0) {
      setProductsLoading(true);
      fetchActiveShopifyProducts(1000)
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

  const confirmProject = async () => {
    if (!project || confirmingProject) return;
    const selectedProducts = zoneProducts.filter((product) => product.zoneId);
    if (zones.length === 0 || selectedProducts.length === 0) {
      toast.error('請先設定間隔並加入產品');
      return;
    }
    setConfirmingProject(true);
    const result = await saveProject(project.id, {
      status: 'confirmed',
      progress: 100,
    });
    setConfirmingProject(false);
    if (!result.ok) {
      toast.error('確定方案失敗', { description: result.error });
      return;
    }
    setProjects((current) =>
      current.map((row) =>
        row.id === project.id
          ? { ...row, status: 'confirmed', progress: 100 }
          : row,
      ),
    );
    toast.success('方案已確定', {
      description: `${zones.length} 個間隔 · ${selectedProducts.length} 件產品`,
    });
    appStore.setCurrentView('confirmed-projects');
  };

  const filteredProducts = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
      if (productLevel1 && p.level1Category !== productLevel1) return false;
      if (productLevel2 && p.level2Category !== productLevel2) return false;
      return true;
    });
  }, [products, keyword, productLevel1, productLevel2]);

  const productLevel1Options = useMemo(
    () =>
      [...new Set(products.map((product) => product.level1Category).filter(Boolean))] as string[],
    [products],
  );
  const productLevel2Options = useMemo(
    () =>
      [
        ...new Set(
          products
            .filter(
              (product) =>
                product.level1Category === productLevel1 &&
                product.level2Category,
            )
            .map((product) => product.level2Category as string),
        ),
      ],
    [productLevel1, products],
  );

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
        <div className="mx-auto grid max-w-[1440px] gap-4 px-7 py-4 md:grid-cols-[minmax(0,1fr)_320px] md:px-10">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-2xl font-bold tracking-tight">
                設計專案
              </h1>
              <span className="text-sm font-medium text-muted-foreground">
                （客戶專區 &gt; 報價方案）
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
            </div>
          </div>
          <div className="grid gap-2 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[15px]">
              <Tag className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-muted-foreground">專案分類</span>
              <span className="ml-auto font-semibold text-foreground">
                {projectTypeLabel(projectType)}
              </span>
            </div>
            <div className="flex items-center gap-2 border-t border-border/70 pt-2 text-[15px]">
                <UserRound className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">項目經理</span>
              <span className="ml-auto font-semibold text-foreground">
                {pmNames[project.id] || '正在讀取…'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void confirmProject()}
              disabled={confirmingProject}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {confirmingProject ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              確定方案
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] space-y-6 px-7 py-8 md:px-10 md:py-10">
        {/* Text zone list + furniture */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold">間隔清單與傢俬配置</h2>
            <span className="font-mono-data text-[15px] text-muted-foreground">
              {zones.length} 個間隔 · {zoneProducts.filter((z) => z.zoneId).length} 件產品
            </span>
          </div>
          {!loading && zoneGroups.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <span className="mr-1 text-[15px] font-semibold text-muted-foreground">
                間隔數量
              </span>
              {zoneGroups.map((group) => (
                <span
                  key={group.key}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-[15px]"
                >
                  <span className="font-semibold text-foreground">
                    {group.prefix} · {group.label}
                  </span>
                  <span className="text-muted-foreground">
                    ：{group.zones.length}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : zones.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              請到「方案列表」展開此專案並設定間隔／功能房間
            </div>
          ) : (
            <div className="space-y-7">
            {zoneGroups.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className="flex items-center gap-3 border-b border-border pb-2.5">
                  <span className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-sm font-bold text-primary">
                    {group.prefix}
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold">
                      {group.prefix} · {group.label}
                    </h3>
                    <p className="mt-0.5 text-[15px] text-muted-foreground">
                      {group.zones.length} 個{group.label}
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                {group.zones.map((zone) => {
              const items = zoneProducts.filter((zp) => zp.zoneId === zone.id);
              return (
                <div
                  key={zone.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      {zone.code ? (
                        <span className="rounded bg-primary/15 px-2 py-1 font-mono-data text-[15px] text-primary">
                          {zone.code}
                        </span>
                      ) : null}
                      <h3 className="font-display text-base font-bold">{zone.name}</h3>
                      <span className="text-[15px] text-muted-foreground">{items.length} 件傢俬</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openPicker(zone.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[15px] font-medium text-primary hover:bg-primary/15"
                    >
                      <Plus className="h-3 w-3" /> 加入產品
                    </button>
                  </div>
                  {items.length === 0 ? (
                    <p className="px-5 py-6 text-[15px] text-muted-foreground">尚未配置傢俬 — 按本列右上角「加入產品」</p>
                  ) : (
                    <ul className="divide-y divide-border/70">
                      {items.map((item) => (
                        <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                          <div className="h-14 w-14 overflow-hidden rounded-lg bg-muted">
                            {item.productImageUrl ? (
                              <img
                                src={item.productImageUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-medium">{item.productTitle}</p>
                            <p className="font-mono-data text-[15px] text-primary">
                              ${Number(item.salePrice || 0).toLocaleString()} × {item.quantity}
                            </p>
                          </div>
                          <select
                            value={item.status}
                            onChange={(e) =>
                              setStatus(item.id, e.target.value as ZoneProductStatus)
                            }
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-[15px] font-medium',
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
              </section>
            ))}
            </div>
          )}
        </section>

      </div>

      {/* Product picker modal */}
      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center sm:p-6">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="font-display text-base font-bold">選擇產品</h3>
                <p className="text-[15px] text-muted-foreground">
                  加入至：
                  {pickerZoneId
                    ? zones.find((z) => z.id === pickerZoneId)?.name || '指定間隔'
                    : zones[0]?.name || '第一個間隔'}
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  只顯示目前可供選購並已有售價的產品
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
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-[15px]"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.code ? `${z.code} · ` : ''}
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[13px] font-semibold text-muted-foreground">
                  一級分類
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setProductLevel1('');
                    setProductLevel2('');
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[15px]',
                    !productLevel1
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  全部
                </button>
                {productLevel1Options.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      setProductLevel1(category);
                      setProductLevel2('');
                    }}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[15px]',
                      productLevel1 === category
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {category}
                  </button>
                ))}
              </div>
              {productLevel1 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[13px] font-semibold text-muted-foreground">
                    二級分類
                  </span>
                  <button
                    type="button"
                    onClick={() => setProductLevel2('')}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[15px]',
                      !productLevel2
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    全部
                  </button>
                  {productLevel2Options.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setProductLevel2(category)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[15px]',
                        productLevel2 === category
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}
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
                        <p className="line-clamp-2 text-[15px] font-medium">{p.title}</p>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono-data text-[15px] font-bold text-primary">
                            ${p.salePrice.toLocaleString()}
                          </span>
                          <button
                            type="button"
                            onClick={() => addProductToZone(p)}
                            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[15px] font-medium text-primary hover:bg-primary/15"
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
