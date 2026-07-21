import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Upload, Search, Map as MapIcon, ChevronRight, ChevronDown, ChevronUp,
  Loader2, Sparkles, Building2, Calendar, Sofa,
} from 'lucide-react';
import {
  createProject,
  createZone,
  fetchProjects,
  updateProjectFloorPlan,
} from '@/lib/solutionsApi';
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
import { supabase } from '@/lib/supabase';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import { compareQuoteVersion } from '@/lib/quoteVersions';

type QuotePreviewRow = {
  id: string;
  quote_id: string;
  version: string;
  status: string;
  created_at: string;
  modified_date?: string | null;
  bwf_pitching_id?: string | null;
  project_data?: {
    formData?: {
      clientName?: string;
      clientContactName?: string;
      company?: string;
      customerType?: string;
      projectName?: string;
    };
    clientInfo?: { name?: string; contactName?: string };
  };
};

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

function inferQuoteProjectType(text: string): ProjectEngineeringType {
  const value = text.toLowerCase();
  if (/學校|小學|中學|大學|幼稚園|school|college|university|education/.test(value)) {
    return 'school';
  }
  if (/醫院|診所|醫療|牙科|clinic|hospital|health/.test(value)) {
    return 'clinic';
  }
  if (/酒店|旅館|會所|接待|hotel|hospitality|lounge/.test(value)) {
    return 'hotel';
  }
  if (/辦公|企業|銀行|金融|office|corporate|company|professional/.test(value)) {
    return 'office';
  }
  return 'other';
}

async function fetchQuotePreviewProjects(
  existingProjects: DesignProject[],
): Promise<DesignProject[]> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select(
      'id,quote_id,version,status,created_at,modified_date,project_data,bwf_pitching_id',
    )
    .order('created_at', { ascending: false })
    .limit(80);
  if (error || !data) return [];

  const latestByQuote = new Map<string, QuotePreviewRow>();
  for (const row of data as QuotePreviewRow[]) {
    const current = latestByQuote.get(row.quote_id);
    if (!current || compareQuoteVersion(row.version, current.version) > 0) {
      latestByQuote.set(row.quote_id, row);
    }
  }
  const linkedQuoteIds = new Set(
    existingProjects
      .map((project) =>
        String(project.meta?.quoteId || project.meta?.pitchingCode || '').trim(),
      )
      .filter(Boolean),
  );
  const candidates = [...latestByQuote.values()]
    .filter((quote) => !linkedQuoteIds.has(quote.quote_id))
    .slice(0, 8);
  const pitchingIds = [
    ...new Set(
      candidates
        .map((quote) => quote.bwf_pitching_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const pitchings = pitchingIds.length
    ? await fetchPmsPitchings({ ids: pitchingIds, limit: pitchingIds.length })
    : [];
  const pitchingById = new Map<string, PmsPitchingListItem>(
    pitchings.map((pitching) => [pitching.id, pitching]),
  );

  return candidates.map((quote) => {
    const pitching = quote.bwf_pitching_id
      ? pitchingById.get(quote.bwf_pitching_id)
      : null;
    const form = quote.project_data?.formData;
    const client = quote.project_data?.clientInfo;
    const displayName =
      (pitching && pitchingDisplayTitle(pitching)) ||
      form?.projectName?.trim() ||
      form?.clientName?.trim() ||
      client?.name?.trim() ||
      quote.quote_id;
    const company =
      pitching?.customer_name?.trim() ||
      form?.company?.trim() ||
      form?.clientName?.trim() ||
      client?.name?.trim() ||
      null;
    const contact =
      form?.clientContactName?.trim() ||
      client?.contactName?.trim() ||
      null;
    const type = inferQuoteProjectType(
      [
        displayName,
        company,
        pitching?.customer_type,
        pitching?.service_type,
        form?.customerType,
      ]
        .filter(Boolean)
        .join(' '),
    );
    return {
      id: `quote-preview:${quote.id}`,
      name: `${displayName} 傢俬方案`,
      clientName: contact,
      clientCompany: company,
      floorPlanUrl: null,
      floorPlanType: null,
      status: 'in_progress',
      activeScheme: 'A',
      progress: 0,
      createdBy: null,
      creatorStaffId: null,
      editorStaffId: null,
      createdAt: quote.created_at,
      updatedAt: quote.modified_date || quote.created_at,
      meta: {
        projectType: type,
        roomCounts: defaultRoomCounts(type),
        quoteId: quote.quote_id,
        pitchingCode: pitching?.pitching_code || quote.quote_id,
        source: 'quote-list-readonly',
      },
    } satisfies DesignProject;
  });
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
  const [floorPreview, setFloorPreview] = useState<string | null>(null);
  const [floorType, setFloorType] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProjects()
      .then(async (rows) => {
        const quotePreviews = await fetchQuotePreviewProjects(rows);
        setProjects([...rows, ...quotePreviews]);
      })
      .finally(() => setLoading(false));
  }, []);

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

  const onPickFloor = (file: File | null) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)|application\/pdf$/i.test(file.type) && !/\.(jpe?g|png|webp|pdf)$/i.test(file.name)) {
      toast.error('請上傳 PDF / JPG / PNG');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFloorPreview(String(reader.result || ''));
      setFloorType(file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error('請輸入專案名稱');
      return;
    }
    setCreating(true);
    try {
      const roomCounts = defaultRoomCounts(form.projectType);
      const res = await createProject({
        name: form.name.trim(),
        clientName: form.clientName.trim() || undefined,
        clientCompany: form.clientCompany.trim() || undefined,
        floorPlanUrl: floorPreview,
        floorPlanType: floorType,
        meta: {
          projectType: form.projectType,
          existingPartition: 'none',
          roomCounts,
        },
      });
      if (!res.ok || !res.data) {
        toast.error('建立失敗', { description: res.error });
        return;
      }
      const project = res.data;

      // Auto-suggest zones by engineering type (辦公室／學校／診所…)
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

      if (!floorPreview && createdZones.length > 0) {
        const generated = generateFloorPlanDataUrl(createdZones);
        await updateProjectFloorPlan(project.id, generated, 'image/svg+xml');
        project.floorPlanUrl = generated;
        project.floorPlanType = 'image/svg+xml';
      } else if (floorPreview) {
        await updateProjectFloorPlan(project.id, floorPreview, floorType || 'image/jpeg');
      }

      project.meta = {
        projectType: form.projectType,
        existingPartition: 'none',
        roomCounts,
      };
      setProjects((prev) => [project, ...prev]);
      toast.success('已建立專案並產生分區建議', {
        description: `${projectTypeLabel(form.projectType)} · ${createdZones.map((z) => z.code || z.name).join('、') || project.name}`,
      });
      setShowCreate(false);
      setForm({ name: '', clientCompany: '', clientName: '', projectType: 'office' });
      setFloorPreview(null);
      setFloorType(null);
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
              const quotePreview = p.meta?.source === 'quote-list-readonly';
              return (
              <article
                key={p.id}
                className={cn(
                  'overflow-hidden rounded-2xl border bg-card shadow-sm transition-all',
                  expanded ? 'border-primary/40 shadow-md' : 'border-border',
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpandedProjectId(expanded ? null : p.id)}
                  className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted/20"
                  aria-expanded={expanded}
                >
                  <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
                    {p.floorPlanUrl ? (
                      <img src={p.floorPlanUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <MapIcon className="h-6 w-6 text-muted-foreground/50" />
                    )}
                  </div>
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
                      {quotePreview ? (
                        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-body text-xs text-sky-700 dark:text-sky-300">
                          來自報價一覽 · 唯讀
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
                    {quotePreview ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        已按客戶及提案類型套用房間建議
                      </p>
                    ) : (
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
                    )}
                  </div>
                  {expanded ? (
                    <ChevronUp className="h-5 w-5 shrink-0 text-primary" />
                  ) : (
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
                {expanded ? (
                  <>
                    <ProjectPartitionPanel
                      project={p}
                      readOnly={quotePreview}
                      onProjectMetaChange={(projectId, meta) =>
                        setProjects((prev) =>
                          prev.map((row) =>
                            row.id === projectId ? { ...row, meta } : row,
                          ),
                        )
                      }
                    />
                    {quotePreview ? (
                      <div className="border-t border-border bg-card px-5 py-4 text-sm text-muted-foreground">
                        此方案由報價一覽唯讀產生；不會修改原報價資料。
                      </div>
                    ) : (
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
                    )}
                  </>
                ) : null}
              </article>
            );})}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl md:p-8">
            <h3 className="font-display text-xl font-bold">建立新專案</h3>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              上傳平面圖（PDF/JPG）後，系統會自動產生分區建議（如 B1 老闆區、M1 會議室）
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
                  onChange={(e) => onPickFloor(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center hover:border-primary/40"
                >
                  {floorPreview && floorType?.startsWith('image/') ? (
                    <img src={floorPreview} alt="平面圖預覽" className="max-h-40 rounded-lg object-contain" />
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="font-body text-xs text-muted-foreground">
                        {floorPreview ? '已選擇檔案（PDF）' : '點擊上傳 PDF / JPG'}
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
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-border px-4 py-2 font-body text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={handleCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                建立並進入分區
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
