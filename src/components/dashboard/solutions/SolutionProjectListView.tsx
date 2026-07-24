import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus,
  Upload,
  Search,
  Map as MapIcon,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Building2,
  Calendar,
  Sofa,
  FileText,
} from 'lucide-react';
import {
  createProject,
  createZone,
  fetchProjects,
  saveProject,
  updateProjectFloorPlan,
} from '@/lib/solutionsApi';
import {
  uploadProjectFloorPlanFile,
  uploadProjectFloorPlanPreview,
} from '@/lib/imageStorage';
import { renderPdfPageToJpegBlob } from '@/lib/floorPlanPdf';
import { generateFloorPlanDataUrl } from '@/lib/floorPlanGenerator';
import {
  PROJECT_TYPE_OPTIONS,
  defaultRoomCounts,
  projectTypeLabel,
  zoneSeedsFromRoomCounts,
  type ProjectEngineeringType,
} from '@/lib/projectPartitionTemplates';
import { writeSolutionFocusProjectId } from '@/lib/solutionProjectFocus';
import { useAppStore } from '@/hooks/use-app-store';
import { toast } from 'sonner';
import type { DesignProject } from '@/types/solutions';
import { ProjectPartitionPanel } from './ProjectPartitionPanel';
import { FloorPlanViewerModal } from './FloorPlanViewerModal';

const STATUS_FILTERS = [
  { id: 'all', label: '全部狀態' },
  { id: 'draft', label: '草稿' },
  { id: 'in_progress', label: '進行中' },
  { id: 'confirmed', label: '已確認' },
] as const;

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function statusLabel(status: string) {
  if (status === 'confirmed') return '已確認';
  if (status === 'in_progress') return '進行中';
  return '草稿';
}

function isPdfFloorPlan(url: string | null | undefined, type: string | null | undefined) {
  const value = (url || '').toLowerCase();
  const mime = (type || '').toLowerCase();
  return (
    mime.includes('pdf') ||
    value.startsWith('data:application/pdf') ||
    /\.pdf(\?|#|$)/i.test(value)
  );
}

function isDisplayableFloorImage(
  url: string | null | undefined,
  type: string | null | undefined,
) {
  if (!url) return false;
  if (isPdfFloorPlan(url, type)) return false;
  const mime = (type || '').toLowerCase();
  return (
    mime.startsWith('image/') ||
    url.startsWith('data:image/') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  );
}

function floorPlanPreviewOf(project: DesignProject): string | null {
  const preview = project.meta?.floorPlanPreviewUrl;
  return typeof preview === 'string' && preview.trim() ? preview.trim() : null;
}

function FloorPlanThumb({
  url,
  type,
  previewUrl,
  fileName,
}: {
  url: string | null;
  type: string | null;
  previewUrl?: string | null;
  fileName?: string;
}) {
  if (previewUrl) {
    return (
      <div className="relative h-full w-full">
        <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        {url && isPdfFloorPlan(url, type) ? (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 py-0.5 text-[9px] font-semibold text-white">
            PDF
          </span>
        ) : null}
      </div>
    );
  }
  if (url && isPdfFloorPlan(url, type)) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-rose-500/5 px-1 text-rose-700">
        <FileText className="h-5 w-5" />
        <span className="truncate text-[10px] font-semibold">PDF</span>
        {fileName ? (
          <span className="max-w-full truncate text-[9px] text-muted-foreground">
            {fileName}
          </span>
        ) : null}
      </div>
    );
  }
  if (url && isDisplayableFloorImage(url, type)) {
    return <img src={url} alt="" className="h-full w-full object-cover" />;
  }
  return <MapIcon className="h-6 w-6 text-muted-foreground/50" />;
}

export function SolutionProjectListView() {
  const store = useAppStore();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]['id']>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    clientCompany: '',
    clientName: '',
    projectType: 'office' as ProjectEngineeringType,
  });
  const [floorFile, setFloorFile] = useState<File | null>(null);
  const [floorPreview, setFloorPreview] = useState<string | null>(null);
  const [viewerProject, setViewerProject] = useState<DesignProject | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewBackfillAttempted = useRef(new Set<string>());

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      if (floorPreview?.startsWith('blob:')) URL.revokeObjectURL(floorPreview);
    };
  }, [floorPreview]);

  // Backfill JPEG previews for existing PDF floor plans so list thumbnails work.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const project of projects) {
        if (cancelled) return;
        if (previewBackfillAttempted.current.has(project.id)) continue;
        if (!project.floorPlanUrl) continue;
        if (!isPdfFloorPlan(project.floorPlanUrl, project.floorPlanType)) continue;
        if (floorPlanPreviewOf(project)) {
          previewBackfillAttempted.current.add(project.id);
          continue;
        }
        previewBackfillAttempted.current.add(project.id);
        try {
          const rendered = await renderPdfPageToJpegBlob(
            project.floorPlanUrl,
            1,
            { scale: 1.25, quality: 0.84 },
          );
          const previewUrl = await uploadProjectFloorPlanPreview(
            project.id,
            rendered.blob,
          );
          const meta = {
            ...project.meta,
            floorPlanPreviewUrl: previewUrl,
          };
          const saved = await saveProject(project.id, { meta });
          if (!saved.ok || cancelled) continue;
          setProjects((prev) =>
            prev.map((row) =>
              row.id === project.id ? { ...row, meta } : row,
            ),
          );
        } catch {
          // Keep PDF badge if preview generation fails (e.g. CORS / corrupt file).
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return projects.filter((p) => {
      if (status !== 'all' && (p.status || 'draft') !== status) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.clientCompany || '').toLowerCase().includes(q) ||
        (p.clientName || '').toLowerCase().includes(q)
      );
    });
  }, [projects, keyword, status]);

  const enterDesignProject = (project: DesignProject) => {
    writeSolutionFocusProjectId(project.id);
    store.setCurrentView('design-projects');
  };

  const resetCreateForm = () => {
    setForm({
      name: '',
      clientCompany: '',
      clientName: '',
      projectType: 'office',
    });
    if (floorPreview?.startsWith('blob:')) URL.revokeObjectURL(floorPreview);
    setFloorFile(null);
    setFloorPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onPickFloor = async (file: File | null) => {
    if (!file) return;
    if (
      !/^image\/(jpeg|png|webp)|application\/pdf$/i.test(file.type) &&
      !/\.(jpe?g|png|webp|pdf)$/i.test(file.name)
    ) {
      toast.error('請上傳 PDF / JPG / PNG');
      return;
    }
    if (floorPreview?.startsWith('blob:')) URL.revokeObjectURL(floorPreview);
    setFloorFile(file);
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)) {
      setFloorPreview(URL.createObjectURL(file));
      return;
    }
    try {
      const rendered = await renderPdfPageToJpegBlob(file, 1, {
        scale: 1.2,
        quality: 0.85,
      });
      setFloorPreview(URL.createObjectURL(rendered.blob));
    } catch {
      setFloorPreview(null);
      toast.message('已選擇 PDF', {
        description: '建立專案後會轉成可檢視圖片',
      });
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error('請輸入專案名稱');
      return;
    }
    setCreating(true);
    try {
      const roomCounts = defaultRoomCounts(form.projectType);
      const baseMeta = {
        projectType: form.projectType,
        existingPartition: 'none' as const,
        roomCounts,
        customRooms: [] as DesignProject['meta']['customRooms'],
      };
      const res = await createProject({
        name: form.name.trim(),
        clientName: form.clientName.trim() || undefined,
        clientCompany: form.clientCompany.trim() || undefined,
        floorPlanUrl: null,
        floorPlanType: null,
        meta: baseMeta,
      });
      if (!res.ok || !res.data) {
        toast.error('建立失敗', { description: res.error });
        return;
      }
      const project = res.data;

      const seeds = zoneSeedsFromRoomCounts(form.projectType, roomCounts);
      const createdZones = [];
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const z = await createZone({
          projectId: project.id,
          name: s.name,
          code: s.code,
          bounds: s.bounds,
          aiSuggested: true,
          sortOrder: i,
        });
        if (z.ok && z.data) createdZones.push(z.data);
      }

      let nextMeta: DesignProject['meta'] = { ...baseMeta };
      if (floorFile) {
        try {
          const uploaded = await uploadProjectFloorPlanFile(project.id, floorFile);
          const floorSaved = await updateProjectFloorPlan(
            project.id,
            uploaded.url,
            uploaded.mimeType,
          );
          if (!floorSaved.ok) {
            toast.error('平面圖儲存失敗', { description: floorSaved.error });
          } else {
            project.floorPlanUrl = uploaded.url;
            project.floorPlanType = uploaded.mimeType;
            nextMeta = {
              ...nextMeta,
              floorPlanFileName: uploaded.fileName,
            };
            if (uploaded.mimeType.includes('pdf')) {
              try {
                const rendered = await renderPdfPageToJpegBlob(floorFile, 1, {
                  scale: 1.35,
                  quality: 0.86,
                });
                const previewUrl = await uploadProjectFloorPlanPreview(
                  project.id,
                  rendered.blob,
                );
                nextMeta = {
                  ...nextMeta,
                  floorPlanPreviewUrl: previewUrl,
                };
                previewBackfillAttempted.current.add(project.id);
              } catch {
                // PDF file is still saved; preview can be backfilled later.
              }
            }
            await saveProject(project.id, { meta: nextMeta });
          }
        } catch (error) {
          toast.error('平面圖上傳失敗', {
            description:
              error instanceof Error ? error.message : '請稍後再試',
          });
        }
      } else if (createdZones.length > 0) {
        const generated = generateFloorPlanDataUrl(createdZones);
        const floorSaved = await updateProjectFloorPlan(
          project.id,
          generated,
          'image/svg+xml',
        );
        if (floorSaved.ok) {
          project.floorPlanUrl = generated;
          project.floorPlanType = 'image/svg+xml';
        }
      }

      project.meta = nextMeta;
      setProjects((prev) => [project, ...prev]);
      toast.success('已建立專案並儲存至資料庫', {
        description: `${projectTypeLabel(form.projectType)} · ${createdZones.map((z) => z.code || z.name).join('、') || project.name}`,
      });
      setShowCreate(false);
      resetCreateForm();
      setExpandedProjectId(project.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">方案列表</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              依工程類型建立專案；展開每個方案設定「間隔／功能房間」，再進入設計專案配置傢俬
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-body text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            建立新專案
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋專案、客戶公司或聯絡人…"
              className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatus(f.id)}
                className={cn(
                  'rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors',
                  status === f.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <MapIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 font-display text-base font-semibold">尚無傢俬方案</p>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              建立新專案並上傳平面圖，即可開始分區與產品配置
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((p) => {
              const expanded = expandedProjectId === p.id;
              return (
                <article
                  key={p.id}
                  className={cn(
                    'overflow-hidden rounded-2xl border bg-card shadow-sm transition-all',
                    expanded ? 'border-primary/40 shadow-md' : 'border-border',
                  )}
                >
                  <div className="flex w-full items-center gap-4 p-4">
                    <button
                      type="button"
                      disabled={!p.floorPlanUrl}
                      onClick={() => setViewerProject(p)}
                      className="relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 disabled:cursor-default"
                      title={p.floorPlanUrl ? '點擊檢視平面圖' : '尚未上傳平面圖'}
                    >
                      <FloorPlanThumb
                        url={p.floorPlanUrl}
                        type={p.floorPlanType}
                        previewUrl={floorPlanPreviewOf(p)}
                        fileName={
                          typeof p.meta?.floorPlanFileName === 'string'
                            ? p.meta.floorPlanFileName
                            : undefined
                        }
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedProjectId(expanded ? null : p.id)}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left hover:opacity-95"
                      aria-expanded={expanded}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate font-display text-base font-bold">{p.name}</h2>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-body text-xs font-medium text-primary">
                            {statusLabel(p.status || 'draft')}
                          </span>
                          {p.meta?.projectType ? (
                            <span className="rounded-full border border-border px-2 py-0.5 font-body text-xs text-muted-foreground">
                              {projectTypeLabel(p.meta.projectType)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {[p.clientCompany, p.clientName].filter(Boolean).join(' · ') || '未填客戶'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {fmtDate(p.updatedAt || p.createdAt)}
                          </span>
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary/70"
                              style={{ width: `${Math.min(100, Math.max(0, p.progress || 0))}%` }}
                            />
                          </div>
                          <span className="font-mono-data text-xs text-muted-foreground">
                            {p.progress || 0}% 已確認
                          </span>
                        </div>
                      </div>
                      {expanded ? (
                        <ChevronUp className="h-5 w-5 shrink-0 text-primary" />
                      ) : (
                        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                  {expanded ? (
                    <>
                      <ProjectPartitionPanel
                        project={p}
                        onProjectMetaChange={(projectId, meta) =>
                          setProjects((prev) =>
                            prev.map((row) =>
                              row.id === projectId ? { ...row, meta } : row,
                            ),
                          )
                        }
                        onProjectFloorPlanChange={(projectId, floorPlanUrl, floorPlanType) =>
                          setProjects((prev) =>
                            prev.map((row) =>
                              row.id === projectId
                                ? { ...row, floorPlanUrl, floorPlanType }
                                : row,
                            ),
                          )
                        }
                      />
                      <div className="flex justify-end border-t border-border bg-card px-5 py-4">
                        <button
                          type="button"
                          onClick={() => enterDesignProject(p)}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                        >
                          <Sofa className="h-4 w-4" />
                          進入設計專案配置產品
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl md:p-8">
            <h3 className="font-display text-xl font-bold">建立新專案</h3>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              上傳平面圖（PDF/JPG）後，系統會自動產生分區建議（如 B1 老闆區、M1 會議室）。所有資料會儲存至資料庫。
            </p>

            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-1 block font-body text-xs font-medium text-muted-foreground">專案名稱 *</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例如：尖沙咀精品酒店大堂"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <div>
                <span className="mb-1 block font-body text-xs font-medium text-muted-foreground">工程類型 *</span>
                <div className="flex flex-wrap gap-1.5">
                  {PROJECT_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, projectType: opt.id }))}
                      className={cn(
                        'rounded-full border px-3 py-1.5 font-body text-xs font-medium',
                        form.projectType === opt.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground',
                      )}
                      title={opt.hint}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-body text-xs font-medium text-muted-foreground">客戶公司</span>
                  <input
                    value={form.clientCompany}
                    onChange={(e) => setForm((f) => ({ ...f, clientCompany: e.target.value }))}
                    placeholder="公司名稱"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-body text-xs font-medium text-muted-foreground">聯絡人</span>
                  <input
                    value={form.clientName}
                    onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                    placeholder="客戶聯絡人"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>

              <div>
                <span className="mb-1 block font-body text-xs font-medium text-muted-foreground">平面圖（選填）</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => void onPickFloor(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center hover:border-primary/40"
                >
                  {floorPreview ? (
                    <>
                      <img src={floorPreview} alt="平面圖預覽" className="max-h-40 rounded-lg object-contain" />
                      {floorFile ? (
                        <span className="font-body text-xs text-muted-foreground">
                          {floorFile.name}
                          {/\.pdf$/i.test(floorFile.name) ? ' · 已轉成可預覽圖片' : ''}
                        </span>
                      ) : null}
                    </>
                  ) : floorFile ? (
                    <>
                      <FileText className="h-6 w-6 text-rose-600" />
                      <span className="font-body text-xs font-medium text-foreground">
                        已選擇：{floorFile.name}
                      </span>
                      <span className="font-body text-xs text-muted-foreground">
                        建立後會轉成可檢視圖片
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="font-body text-xs text-muted-foreground">
                        點擊上傳 PDF / JPG
                      </span>
                    </>
                  )}
                </button>
                <p className="mt-1.5 flex items-center gap-1 font-body text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  未上傳時亦會以 AI 建議分區並產生示意平面圖
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
                className="rounded-lg border border-border px-4 py-2 font-body text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                建立並進入分區
              </button>
            </div>
          </div>
        </div>
      )}

      <FloorPlanViewerModal
        open={Boolean(viewerProject?.floorPlanUrl)}
        title={viewerProject?.name || '平面圖'}
        url={viewerProject?.floorPlanUrl || null}
        type={viewerProject?.floorPlanType || null}
        previewUrl={
          viewerProject ? floorPlanPreviewOf(viewerProject) : null
        }
        onClose={() => setViewerProject(null)}
      />
    </div>
  );
}
