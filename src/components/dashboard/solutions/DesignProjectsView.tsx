import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Upload, Sparkles, GripVertical, Save, Trash2, Pencil,
  LayoutGrid, ImageIcon, ChevronDown, Check, Loader2,
} from 'lucide-react';
import {
  fetchProjects, fetchZones, fetchZoneProducts,
  createProject, saveProject, updateZoneProductStatus,
} from '@/lib/solutionsApi';
import { toast } from 'sonner';
import {
  ZONE_PRODUCT_STATUS_META, type ZoneProductStatus, type SchemeLabel,
  type DesignProject, type ProjectZone, type ZoneProduct,
} from '@/types/solutions';

const STATUS_OPTIONS: ZoneProductStatus[] = ['confirmed', 'discussing', 'pending'];

export function DesignProjectsView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [scheme, setScheme] = useState<SchemeLabel>('A');
  const [allZones, setAllZones] = useState<ProjectZone[]>([]);
  const [allZoneProducts, setAllZoneProducts] = useState<ZoneProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load project list once
  useEffect(() => {
    fetchProjects().then((rows) => {
      setProjects(rows);
      if (rows.length > 0) setActiveProjectId((cur) => cur || rows[0].id);
    }).finally(() => setProjectsLoaded(true));
  }, []);

  // --- write handlers ---
  const handleCreateProject = async () => {
    const name = window.prompt('輸入新專案名稱：');
    if (!name?.trim()) return;
    const res = await createProject({ name: name.trim() });
    if (res.ok && res.data) {
      setProjects((prev) => [res.data!, ...prev]);
      setActiveProjectId(res.data.id);
      toast.success('已建立專案', { description: res.data.name });
    } else {
      toast.error('建立失敗', { description: res.error });
    }
  };

  const handleSaveVersion = async () => {
    setIsSaving(true);
    const res = await saveProject(activeProjectId, { activeScheme: scheme });
    setIsSaving(false);
    res.ok
      ? toast.success('已儲存版本', { description: `方案 ${scheme}` })
      : toast.error('儲存失敗', { description: res.error });
  };

  const handleSetProductStatus = async (zoneProductId: string, status: ZoneProductStatus) => {
    // optimistic update
    setAllZoneProducts((prev) => prev.map((zp) => zp.id === zoneProductId ? { ...zp, status } : zp));
    const res = await updateZoneProductStatus(zoneProductId, status);
    if (!res.ok) toast.error('更新失敗', { description: res.error });
  };

  // Load zones + products when active project changes
  useEffect(() => {
    if (!activeProjectId) return;
    setIsLoading(true);
    Promise.all([fetchZones(activeProjectId), fetchZoneProducts(activeProjectId)])
      .then(([z, zp]) => { setAllZones(z); setAllZoneProducts(zp); })
      .finally(() => setIsLoading(false));
  }, [activeProjectId]);

  const project = projects.find((p) => p.id === activeProjectId);
  const zones = allZones;
  // zone_id NULL = 設計籃；其餘為已分配到分區的產品
  const zoneProducts = allZoneProducts.filter((zp) => zp.zoneId && zp.scheme === scheme);
  const basket = allZoneProducts.filter((zp) => !zp.zoneId);

  if (!project) {
    if (!projectsLoaded) {
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <LayoutGrid className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold">尚無設計專案</h2>
          <p className="mt-1 font-body text-sm text-muted-foreground">建立第一個專案以開始規劃分區與產品方案</p>
        </div>
        <button
          onClick={handleCreateProject}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> 建立新專案
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Project switcher */}
          <div className="relative">
            <select
              value={activeProjectId}
              onChange={(e) => setActiveProjectId(e.target.value)}
              className="h-9 appearance-none rounded-lg border border-border bg-card pl-3 pr-9 font-display text-sm font-semibold text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {/* Scheme tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {(['A', 'B'] as SchemeLabel[]).map((s) => (
              <button
                key={s}
                onClick={() => setScheme(s)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  scheme === s ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                方案 {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveVersion}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 儲存版本
          </button>
          <button className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90">
            <Sparkles className="h-3.5 w-3.5" /> AI 建議分區與產品組合
          </button>
          <button
            onClick={handleCreateProject}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> 建立新專案
          </button>
        </div>
      </div>

      {/* Main split: floor plan (left) + design basket (right) */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Floor plan area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-auto p-6">
          <div className="mb-3 flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-primary" />
            <h2 className="font-display text-sm font-bold">平面圖分區</h2>
            <span className="font-mono-data text-[11px] text-muted-foreground">
              {zones.length} 個分區 · AI 自動建議
            </span>
          </div>

          {/* Floor plan canvas with draggable zones */}
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/20">
            {/* upload hint overlay */}
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5 shadow-sm backdrop-blur">
              <Upload className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-medium text-muted-foreground">
                拖拉上傳平面圖（PDF / JPG / PNG）
              </span>
            </div>
            {/* zone boxes */}
            {zones.map((z) => (
              <div
                key={z.id}
                className="group absolute rounded-lg border-2 border-primary/40 bg-primary/5 transition-colors hover:border-primary hover:bg-primary/10"
                style={{ left: `${z.bounds.x}%`, top: `${z.bounds.y}%`, width: `${z.bounds.w}%`, height: `${z.bounds.h}%` }}
              >
                <div className="flex items-center justify-between gap-1 px-2 py-1">
                  <span className="flex items-center gap-1.5 truncate font-display text-[11px] font-bold text-primary">
                    {z.code && <span className="rounded bg-primary/15 px-1 py-0.5 font-mono-data text-[9px]">{z.code}</span>}
                    {z.name}
                  </span>
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button className="rounded p-0.5 text-primary/70 hover:bg-primary/15 hover:text-primary"><Pencil className="h-3 w-3" /></button>
                    <button className="rounded p-0.5 text-rose-400/70 hover:bg-rose-500/15 hover:text-rose-500"><Trash2 className="h-3 w-3" /></button>
                  </span>
                </div>
                {z.aiSuggested && (
                  <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-primary/15 px-1 py-0.5 text-[8px] font-medium text-primary">
                    <Sparkles className="h-2.5 w-2.5" /> AI
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
            上傳平面圖後 AI 自動建議分區，支援拖拉調整範圍、重新命名、刪除。
          </p>
        </div>

        {/* Design basket */}
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-sidebar">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-bold">設計籃</h3>
            </div>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono-data text-[11px] font-semibold text-primary">
              {basket.length}
            </span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {basket.map((item) => (
              <div
                key={item.id}
                draggable
                className="group flex cursor-grab items-center gap-2.5 rounded-lg border border-border bg-card p-2 transition-shadow hover:shadow-sm active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                <img src={item.productImageUrl} alt={item.productTitle} loading="lazy" className="h-11 w-11 shrink-0 rounded-md object-cover bg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-[12.5px] font-medium text-foreground">{item.productTitle}</p>
                  <p className="font-mono-data text-[11px] text-primary">${item.salePrice.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border/60 p-3">
            <p className="text-center text-[10.5px] text-muted-foreground/70">
              拖拉產品至左側分區即可分配
            </p>
          </div>
        </aside>
      </div>

      {/* Product allocation table */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="flex items-center justify-between px-6 py-2.5">
          <h3 className="font-display text-sm font-bold">產品分配表（方案 {scheme}）</h3>
          <button className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Check className="h-3.5 w-3.5" /> 批量更新狀態
          </button>
        </div>
        <div className="max-h-[230px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-2 text-left font-medium"><input type="checkbox" className="rounded border-border" /></th>
                <th className="px-3 py-2 text-left font-medium">產品</th>
                <th className="px-3 py-2 text-left font-medium">分區</th>
                <th className="px-3 py-2 text-right font-medium">售價</th>
                <th className="px-3 py-2 text-center font-medium">數量</th>
                <th className="px-3 py-2 text-left font-medium">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {zoneProducts.map((zp) => {
                const zoneName = zones.find((z) => z.id === zp.zoneId)?.name ?? '未分配';
                const meta = ZONE_PRODUCT_STATUS_META[zp.status];
                return (
                  <tr key={zp.id} className="hover:bg-muted/30">
                    <td className="px-6 py-2"><input type="checkbox" className="rounded border-border" /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <img src={zp.productImageUrl} alt={zp.productTitle} loading="lazy" className="h-8 w-8 rounded object-cover bg-muted" />
                        <span className="font-body text-[13px] text-foreground">{zp.productTitle}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{zoneName}</td>
                    <td className="px-3 py-2 text-right font-mono-data text-primary">${zp.salePrice.toLocaleString()}</td>
                    <td className="px-3 py-2 text-center text-muted-foreground">{zp.quantity}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {STATUS_OPTIONS.map((s) => (
                          <button
                            key={s}
                            onClick={() => handleSetProductStatus(zp.id, s)}
                            className={cn(
                              'cursor-pointer rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-all',
                              s === zp.status ? ZONE_PRODUCT_STATUS_META[s].className : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground'
                            )}
                          >
                            {ZONE_PRODUCT_STATUS_META[s].label}
                          </button>
                        ))}
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
