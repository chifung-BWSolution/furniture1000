import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Upload, Sparkles, GripVertical, Save, Trash2, Pencil,
  LayoutGrid, ImageIcon, ChevronDown, Check, Loader2, X, CornerUpLeft, Wand2,
} from 'lucide-react';
import {
  fetchProjects, fetchZones, fetchZoneProducts,
  createProject, saveProject, updateZoneProductStatus, bulkUpdateZoneProductStatus,
  assignZoneProductToZone, unassignZoneProduct, updateProjectFloorPlan,
  createZone, updateZone, deleteZone,
} from '@/lib/solutionsApi';
import { generateFloorPlanDataUrl, defaultZoneSeeds, isGeneratedFloorPlan } from '@/lib/floorPlanGenerator';
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [floorPlan, setFloorPlan] = useState<string | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggingIdRef = useRef<string | null>(null);

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

  // --- generate a floor plan from the project's zones (seeding zones if none) ---
  const handleGenerateFloorPlan = async () => {
    if (!activeProjectId || isGenerating) return;
    setIsGenerating(true);
    try {
      let zonesForPlan = allZones;

      // No zones yet → create the default AI-suggested set first.
      if (zonesForPlan.length === 0) {
        const seeds = defaultZoneSeeds();
        const created: ProjectZone[] = [];
        for (let i = 0; i < seeds.length; i++) {
          const s = seeds[i];
          const res = await createZone({
            projectId: activeProjectId,
            name: s.name,
            code: s.code,
            bounds: s.bounds,
            aiSuggested: true,
            sortOrder: i,
          });
          if (!res.ok || !res.data) throw new Error(res.error || '建立分區失敗');
          created.push(res.data);
        }
        zonesForPlan = created;
        setAllZones(created);
      }

      const dataUrl = generateFloorPlanDataUrl(zonesForPlan, project?.name);
      setFloorPlan(dataUrl);
      const res = await updateProjectFloorPlan(activeProjectId, dataUrl, 'image/svg+xml');
      if (res.ok) {
        setProjects((prev) => prev.map((p) =>
          p.id === activeProjectId ? { ...p, floorPlanUrl: dataUrl, floorPlanType: 'image/svg+xml' } : p));
        toast.success('已生成平面圖', { description: `${zonesForPlan.length} 個分區` });
      } else {
        toast.message('平面圖已顯示，但未寫入資料庫', { description: res.error });
      }
    } catch (e) {
      toast.error('生成平面圖失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsGenerating(false);
    }
  };

  // --- zone rename / delete ---
  const handleRenameZone = async (zone: ProjectZone) => {
    const name = window.prompt('分區名稱：', zone.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === zone.name) return;
    setAllZones((prev) => prev.map((z) => z.id === zone.id ? { ...z, name: trimmed } : z));
    const res = await updateZone(zone.id, { name: trimmed });
    if (!res.ok) toast.error('重新命名失敗', { description: res.error });
  };

  const handleDeleteZone = async (zone: ProjectZone) => {
    if (!window.confirm(`確定刪除分區「${zone.name}」？該區產品會移回設計籃。`)) return;
    setAllZones((prev) => prev.filter((z) => z.id !== zone.id));
    setAllZoneProducts((prev) => prev.map((zp) => zp.zoneId === zone.id ? { ...zp, zoneId: null } : zp));
    const res = await deleteZone(zone.id);
    res.ok ? toast.success('已刪除分區') : toast.error('刪除失敗', { description: res.error });
  };

  // --- floor plan upload ---
  const handleFloorPlanFile = async (file: File) => {
    const okType = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!okType) { toast.error('檔案格式不支援', { description: '請上傳 PDF / JPG / PNG' }); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setFloorPlan(dataUrl);
      toast.success('平面圖已上傳', { description: file.name });
      if (activeProjectId) {
        // persist (data URL kept short for demo; large files may exceed column — best-effort)
        const res = await updateProjectFloorPlan(activeProjectId, dataUrl, file.type || 'image');
        if (!res.ok) toast.message('平面圖已顯示，但未寫入資料庫', { description: res.error });
      }
    };
    reader.readAsDataURL(file);
  };

  // --- drag & drop: basket → zone ---
  const handleDropOnZone = async (zoneId: string) => {
    const id = draggingIdRef.current;
    draggingIdRef.current = null;
    setDragOverZoneId(null);
    if (!id) return;
    // assign to zone under the currently active scheme so it shows in the table
    setAllZoneProducts((prev) => prev.map((zp) => zp.id === id ? { ...zp, zoneId, scheme } : zp));
    const res = await assignZoneProductToZone(id, zoneId, scheme);
    res.ok
      ? toast.success('已分配到分區')
      : toast.message('已分配（畫面）', { description: res.error });
  };

  const handleMoveToBasket = async (zoneProductId: string) => {
    setAllZoneProducts((prev) => prev.map((zp) => zp.id === zoneProductId ? { ...zp, zoneId: null } : zp));
    const res = await unassignZoneProduct(zoneProductId);
    if (!res.ok) toast.message('已移回設計籃（畫面）', { description: res.error });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkConfirm = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { toast.message('請先勾選產品'); return; }
    setAllZoneProducts((prev) => prev.map((zp) => ids.includes(zp.id) ? { ...zp, status: 'confirmed' } : zp));
    setSelectedIds(new Set());
    const res = await bulkUpdateZoneProductStatus(ids, 'confirmed');
    res.ok
      ? toast.success(`已將 ${ids.length} 件標為已確定`)
      : toast.error('批量更新失敗', { description: res.error });
  };

  // Load zones + products when active project changes
  useEffect(() => {
    if (!activeProjectId) return;
    setIsLoading(true);
    setSelectedIds(new Set());
    Promise.all([fetchZones(activeProjectId), fetchZoneProducts(activeProjectId)])
      .then(([z, zp]) => { setAllZones(z); setAllZoneProducts(zp); })
      .finally(() => setIsLoading(false));
  }, [activeProjectId]);

  // reflect the active project's stored floor plan
  useEffect(() => {
    const p = projects.find((x) => x.id === activeProjectId);
    setFloorPlan(p?.floorPlanUrl ?? null);
  }, [activeProjectId, projects]);

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
          <button
            onClick={handleGenerateFloorPlan}
            disabled={isGenerating}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI 建議分區與產品組合
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
            <button
              onClick={handleGenerateFloorPlan}
              disabled={isGenerating}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {zones.length === 0 ? '生成平面圖與分區' : '生成平面圖'}
            </button>
          </div>

          {/* hidden file input for floor plan upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFloorPlanFile(f); e.target.value = ''; }}
          />

          {/* Floor plan canvas with draggable zones — grows to fill the section */}
          <div
            className="relative w-full flex-1 min-h-[460px] overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/20"
            onDragOver={(e) => { if (!draggingIdRef.current) e.preventDefault(); }}
            onDrop={(e) => {
              // file drop for floor plan (only when not dragging a product)
              if (draggingIdRef.current) return;
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFloorPlanFile(f);
            }}
          >
            {/* uploaded floor plan image */}
            {floorPlan && !floorPlan.startsWith('data:application/pdf') && (
              <img
                src={floorPlan}
                alt="平面圖"
                className={cn(
                  'absolute inset-0 h-full w-full',
                  // generated SVG stretches to fill so it aligns 1:1 with zone boxes;
                  // uploaded images keep their aspect ratio
                  isGeneratedFloorPlan(floorPlan) ? 'object-fill' : 'object-contain'
                )}
              />
            )}
            {floorPlan && floorPlan.startsWith('data:application/pdf') && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                已上傳 PDF 平面圖
              </div>
            )}

            {/* upload + generate hint overlay — only when no floor plan yet */}
            {!floorPlan && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5 shadow-sm backdrop-blur transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Upload className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    點擊或拖拉上傳平面圖（PDF / JPG / PNG）
                  </span>
                </button>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                  <span className="h-px w-8 bg-border" /> 或 <span className="h-px w-8 bg-border" />
                </div>
                <button
                  onClick={handleGenerateFloorPlan}
                  disabled={isGenerating}
                  className="flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-primary/80 px-4 py-2 text-[11px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {zones.length === 0 ? '生成平面圖與分區' : '依分區生成平面圖'}
                </button>
              </div>
            )}
            {/* replace button when a floor plan exists */}
            {floorPlan && (
              <div className="absolute right-3 top-3 z-10 flex gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground shadow-sm backdrop-blur hover:text-primary"
                >
                  <Upload className="h-3 w-3" /> 更換
                </button>
                <button
                  onClick={() => { setFloorPlan(null); if (activeProjectId) updateProjectFloorPlan(activeProjectId, '', ''); }}
                  className="flex items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[10.5px] font-medium text-rose-500 shadow-sm backdrop-blur hover:bg-rose-500/10"
                >
                  <X className="h-3 w-3" /> 移除
                </button>
              </div>
            )}

            {/* zone boxes — drop targets for basket products */}
            {zones.map((z) => (
              <div
                key={z.id}
                onDragOver={(e) => { if (draggingIdRef.current) { e.preventDefault(); setDragOverZoneId(z.id); } }}
                onDragLeave={() => setDragOverZoneId((cur) => cur === z.id ? null : cur)}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnZone(z.id); }}
                className={cn(
                  'group absolute rounded-lg border-2 transition-colors',
                  dragOverZoneId === z.id
                    ? 'border-primary bg-primary/20 ring-2 ring-primary/30'
                    : 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10'
                )}
                style={{ left: `${z.bounds.x}%`, top: `${z.bounds.y}%`, width: `${z.bounds.w}%`, height: `${z.bounds.h}%` }}
              >
                <div className="flex items-center justify-between gap-1 px-2 py-1">
                  <span className="flex items-center gap-1.5 truncate font-display text-[11px] font-bold text-primary">
                    {z.code && <span className="rounded bg-primary/15 px-1 py-0.5 font-mono-data text-[9px]">{z.code}</span>}
                    {z.name}
                  </span>
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRenameZone(z); }}
                      className="rounded p-0.5 text-primary/70 hover:bg-primary/15 hover:text-primary"
                    ><Pencil className="h-3 w-3" /></button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteZone(z); }}
                      className="rounded p-0.5 text-rose-400/70 hover:bg-rose-500/15 hover:text-rose-500"
                    ><Trash2 className="h-3 w-3" /></button>
                  </span>
                </div>
                {/* products assigned to this zone (current scheme) */}
                <div className="flex flex-wrap gap-1 px-2">
                  {zoneProducts.filter((zp) => zp.zoneId === z.id).map((zp) => (
                    <span key={zp.id} className="flex items-center gap-1 rounded bg-card/80 px-1.5 py-0.5 text-[9.5px] font-medium text-foreground shadow-sm">
                      {zp.productTitle}
                    </span>
                  ))}
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
            上傳平面圖後 AI 自動建議分區，支援拖拉調整範圍、重新命名、刪除。將右側設計籃產品拖入分區即可分配。
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
                onDragStart={() => { draggingIdRef.current = item.id; }}
                onDragEnd={() => { draggingIdRef.current = null; setDragOverZoneId(null); }}
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
            {basket.length === 0 && (
              <p className="py-8 text-center text-[11px] text-muted-foreground/60">
                設計籃已清空，所有產品皆已分配到分區
              </p>
            )}
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
          <button
            onClick={handleBulkConfirm}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> 批量標為已確定{selectedIds.size > 0 ? `（${selectedIds.size}）` : ''}
          </button>
        </div>
        <div className="max-h-[230px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-2 text-left font-medium">
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={zoneProducts.length > 0 && zoneProducts.every((zp) => selectedIds.has(zp.id))}
                    onChange={(e) => setSelectedIds(e.target.checked ? new Set(zoneProducts.map((zp) => zp.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">產品</th>
                <th className="px-3 py-2 text-left font-medium">分區</th>
                <th className="px-3 py-2 text-right font-medium">售價</th>
                <th className="px-3 py-2 text-center font-medium">數量</th>
                <th className="px-3 py-2 text-left font-medium">狀態</th>
                <th className="px-3 py-2 text-center font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {zoneProducts.map((zp) => {
                const zoneName = zones.find((z) => z.id === zp.zoneId)?.name ?? '未分配';
                return (
                  <tr key={zp.id} className="hover:bg-muted/30">
                    <td className="px-6 py-2">
                      <input
                        type="checkbox"
                        className="rounded border-border"
                        checked={selectedIds.has(zp.id)}
                        onChange={() => toggleSelect(zp.id)}
                      />
                    </td>
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
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleMoveToBasket(zp.id)}
                        title="移回設計籃"
                        className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                      >
                        <CornerUpLeft className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {zoneProducts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-[12px] text-muted-foreground/60">
                    方案 {scheme} 尚未分配產品 — 將右側設計籃的產品拖入左側分區
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
