// ============================================================================
// FDS 2.1 — 客戶簡報（F-AI-009）
// Canva AI POST /v1/generations（canvaNativeDesign.ts）。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, CheckCircle2, ExternalLink, FileText, Link2, Loader2,
  Presentation as PresentationIcon, RefreshCcw, Save, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PresentationProductPicker } from '@/components/dashboard/PresentationProductPicker';
import { PresentationSearchCombobox } from '@/components/dashboard/PresentationSearchCombobox';
import type { SearchProduct } from '@/lib/productSearch';
import {
  canvaDisconnect, exchangeCanvaCode, fetchCanvaStatus,
  readCanvaOauthCallback, startCanvaConnect, clearCanvaOauthState, type CanvaStatus,
} from '@/lib/canvaPresentation';
import {
  clientContentDefault,
  clientPurposeDefault,
  loadPresentationClients,
  nextFieldValue,
  projectContentDefault,
  projectOptionHint,
  projectPurposeDefault,
  type PresentationClientOption,
  type PresentationProjectOption,
} from '@/lib/presentationClients';
import {
  buildOutlineFromBrief, createNativeCanvaDesign, fetchCanvaGenerationStatus, defaultBrief, exportCanvaSessionPdf,
  exportCanvaSessionPptx, listCanvaDesignExports, listCanvaDesignSessions,
  listCanvaSessionVersions, probeCanvaNative, proPdfHandoffPath, saveCanvaDraft,
  type CanvaDesignBrief, type CanvaDesignExportRow, type CanvaDesignSession,
  type CanvaSessionVersionRow,
} from '@/lib/canvaNativeDesign';

const MAX_ITEMS = 30;
const PRESENTATION_PATH = '/fds/pm/presentation';
const TITLE_MAX = 100;
const PURPOSE_MAX = 200;
const CONTENT_MAX = 1000;
const SIDEBAR_PREVIEW = 3;
const AI_DOC_HREF = 'https://github.com/chifung-BWSolution/furniture1000/blob/develop/docs/prd/FDS-2.1-Canva-AI生成.md';
const LANGUAGE_OPTIONS = ['繁體中文', '簡體中文', 'English', '中英對照'];
const STYLE_OPTIONS = ['專業、簡潔', '簡約現代', '高端精品', '活潑清晰'];
const WIZARD_STEPS = [
  {
    title: '簡報內容與設計要求',
    hint: '填寫標題、客戶、目的、語言、風格與原文。這些內容會交給 Canva AI。',
  },
  {
    title: '確認大綱',
    hint: '由上一步的欄位整理。可直接修改；每一段會成為一頁。',
  },
  {
    title: '帶入 FDS 產品',
    hint: '可選。點選產品卡片加入，每一件已選產品會成為自己的一頁。',
  },
  {
    title: 'AI 生成與匯出',
    hint: '請先連接 Canva。已有設計時用「新版本」另建，避免覆蓋 Canva 內的修改。',
  },
] as const;

type Status = 'idle' | 'creating' | 'exporting';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function optionsWithCurrent(options: string[], current?: string): string[] {
  const value = current?.trim();
  if (value && !options.includes(value)) return [value, ...options];
  return options;
}

function ConnectionHint({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150}>
      <HoverCardTrigger asChild onFocus={() => setOpen(true)} onClick={() => setOpen((value) => !value)}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-80 max-w-[calc(100vw-2rem)] text-xs leading-relaxed">
        {content}
      </HoverCardContent>
    </HoverCard>
  );
}

function CanvaMark({ className }: { className?: string }) {
  return <img src="/canva-logo.svg" alt="Canva" className={className} />;
}

function sessionTitle(session: CanvaDesignSession): string {
  const title = (session.brief as CanvaDesignBrief | null)?.title?.trim();
  return title || '未命名';
}

function sessionClient(session: CanvaDesignSession): string {
  return (session.brief as CanvaDesignBrief | null)?.client?.trim() || '—';
}

/** Canva thumbnail URLs expire about 15 minutes after they are issued. */
function sessionThumbnail(session: CanvaDesignSession): string | null {
  // An explicit null means the live metadata lookup failed. Never fall back
  // to an older signed URL embedded in the saved brief/report.
  if (session.thumbnail_url === null) return null;
  const extra = session as CanvaDesignSession & {
    thumbnail_url?: unknown;
    thumbnail?: unknown;
  };
  const brief = (session.brief ?? {}) as CanvaDesignBrief & {
    thumbnailUrl?: unknown;
    thumbnail_url?: unknown;
  };
  const report = session.populate_report ?? {};
  const candidates = [
    extra.thumbnail_url,
    extra.thumbnail,
    brief.thumbnailUrl,
    brief.thumbnail_url,
    report.thumbnail_url,
    report.thumbnail,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /^https:\/\//i.test(value)) return value;
  }
  return null;
}

function isCanvaDesign(session: CanvaDesignSession): boolean {
  return Boolean(session.canva_design_id || session.edit_url);
}

function DesignThumbnail({ url }: { url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && url !== failedUrl) {
    return <img src={url} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" onError={() => setFailedUrl(url)} />;
  }
  return (
    <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <PresentationIcon className="h-4 w-4" />
    </span>
  );
}

function designStatusLine(session: CanvaDesignSession): string {
  const pages = (session.brief as CanvaDesignBrief | null)?.pageCount;
  const exported = session.status === 'exported' || Boolean(session.export_download_url);
  const state = exported ? '已匯出 PPTX' : 'Canva 編輯中';
  return typeof pages === 'number' && pages > 0 ? `${pages} 頁・${state}` : state;
}

function formatRecentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const zone = 'Asia/Hong_Kong';
  const time = new Intl.DateTimeFormat('zh-HK', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const yesterday = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 86_400_000));
  if (dayKey === today) return `今天 ${time}`;
  if (dayKey === yesterday) return `昨天 ${time}`;
  const month = Number(dayKey.slice(5, 7));
  const day = Number(dayKey.slice(8, 10));
  return `${month}月${day}日 ${time}`;
}

function StepIndicator({
  step,
  onSelect,
}: {
  step: number;
  onSelect: (next: number) => void;
}) {
  return (
    <ol aria-label="簡報步驟" className="mb-6 grid gap-2 sm:grid-cols-4">
      {WIZARD_STEPS.map((item, index) => {
        const n = index + 1;
        const current = n === step;
        const done = n < step;
        return (
          <li key={item.title}>
            <button
              type="button"
              aria-current={current ? 'step' : undefined}
              onClick={() => onSelect(n)}
              className={`flex h-full w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left ${
                current
                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                  : done
                    ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30'
                    : 'border-border bg-background'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  current
                    ? 'bg-indigo-600 text-white'
                    : done
                      ? 'bg-emerald-600 text-white'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {n}
              </span>
              <span className={`text-xs font-medium leading-snug ${current ? 'text-foreground' : 'text-muted-foreground'}`}>
                {item.title}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label,
  required,
  hint,
  counter,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium text-foreground">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </Label>
        {counter ? <span className="text-xs tabular-nums text-muted-foreground">{counter}</span> : null}
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PresentationView() {
  const [pickerNonce, setPickerNonce] = useState(0);
  const [selected, setSelected] = useState<SearchProduct[]>([]);
  const [canva, setCanva] = useState<CanvaStatus | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [canvaLink, setCanvaLink] = useState<{ edit_url: string; title?: string } | null>(null);
  const oauthHandledRef = useRef(false);

  const [brief, setBrief] = useState<CanvaDesignBrief>(() => defaultBrief());
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const autoPurpose = useRef<string | null>(null);
  const autoContent = useRef<string | null>(null);
  const [clients, setClients] = useState<PresentationClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState('');
  const [wizardStep, setWizardStep] = useState(1);
  const [outline, setOutline] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CanvaDesignSession[]>([]);
  const [activeSession, setActiveSession] = useState<CanvaDesignSession | null>(null);
  const [versionNote, setVersionNote] = useState('');
  const [versionRows, setVersionRows] = useState<CanvaSessionVersionRow[]>([]);
  const [exportRows, setExportRows] = useState<CanvaDesignExportRow[]>([]);
  const [generationProbe, setGenerationProbe] = useState<Awaited<ReturnType<typeof probeCanvaNative>> | null>(null);
  const [generationPending, setGenerationPending] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [statusReadError, setStatusReadError] = useState('');
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const [showAllDesigns, setShowAllDesigns] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPresentationClients()
      .then((rows) => {
        if (!cancelled) setClients(rows);
      })
      .catch((err) => {
        if (!cancelled) setClientsError(err instanceof Error ? err.message : '載入客戶失敗');
      })
      .finally(() => {
        if (!cancelled) setClientsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    const [statusValue, role] = await Promise.all([
      fetchCanvaStatus(),
      supabase.rpc('bwf_has_role', { p_roles: ['admin', 'uploader'] }),
    ]);
    setCanva(statusValue);
    const allowed = Boolean(role.data);
    setCanImport(allowed);
    if (allowed) {
      const probe = await probeCanvaNative().catch(() => null);
      setGenerationProbe(probe);
    } else {
      setGenerationProbe(null);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const rows = await listCanvaDesignSessions(12);
      setSessions(rows);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSessions();
    }, 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSessions();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshSessions]);

  const generating = generationPending || activeSession?.status === 'creating';
  useEffect(() => {
    if (!sessionId || !generating) return;
    let cancelled = false;
    let timer: number;
    const check = async () => {
      try {
        const current = await fetchCanvaGenerationStatus(sessionId);
        if (cancelled) return;
        setActiveSession(current);
        setStatusReadError(current.status === 'creating' && Date.now() - Date.parse(current.updated_at) > 150_000
          ? '暫時未收到任務更新；請稍後重新查詢狀態，毋須再次生成。' : '');
        if (current.canva_design_id && current.edit_url) {
          setCanvaLink({ edit_url: current.edit_url, title: current.brief.title });
          setGenerationError('');
        }
        if ((!generationPending && current.status === 'failed') || current.canva_design_id) {
          setGenerationPending(false);
          setStatus('idle');
          void refreshSessions();
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setStatusReadError(`無法更新任務狀態：${errorText(err)}。正在重新查詢，毋須再次生成。`);
      }
      if (!cancelled) timer = window.setTimeout(check, 3000);
    };
    void check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sessionId, generating, generationPending, refreshSessions]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('code')) return;
    if (oauthHandledRef.current) return;
    oauthHandledRef.current = true;
    const cb = readCanvaOauthCallback();
    const code = url.searchParams.get('code')!;
    const clean = () => {
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      url.searchParams.delete('scope');
      url.searchParams.delete('error');
      window.history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ''));
    };
    if (!cb.valid || !cb.verifier) {
      toast.error('Canva 授權失敗', { description: 'state 驗證不符或授權被取消' });
      clearCanvaOauthState();
      clean();
      return;
    }
    (async () => {
      try {
        const redirectUri = `${window.location.origin}${PRESENTATION_PATH}`;
        const connected = await exchangeCanvaCode(code, cb.verifier, redirectUri);
        toast.success('Canva 已連接', { description: connected.account_name ? `帳戶：${connected.account_name}` : 'chifung.login' });
      } catch (err) {
        toast.error('Canva 授權失敗', { description: errorText(err) });
      } finally {
        clearCanvaOauthState();
        clean();
        refreshStatus();
      }
    })();
  }, [refreshStatus]);

  useEffect(() => {
    refreshStatus();
    refreshSessions();
  }, [refreshStatus, refreshSessions]);

  const disabled = status !== 'idle' || generating;
  const connected = canva?.connected ?? false;
  const canvaPathReady = Boolean(canva?.configured && canImport && connected);

  const nativeTitleOk = Boolean(brief.title.trim() || brief.client?.trim() || brief.project?.trim());
  const nativeContentOk = Boolean(brief.content?.trim() || outline.trim());
  const canCreateNative = nativeTitleOk && nativeContentOk && canvaPathReady;

  const syncOutline = useCallback(() => {
    const next = buildOutlineFromBrief({ ...brief, outline: undefined });
    setOutline(next);
    setBrief((b) => ({ ...b, outline: next }));
  }, [brief]);

  const saveDraft = useCallback(async () => {
    if (!canImport) return;
    setStatus('creating');
    try {
      const confirmed = outline.trim() || buildOutlineFromBrief(brief);
      const payload: CanvaDesignBrief = {
        ...brief,
        outline: confirmed,
        confirmedAt: new Date().toISOString(),
      };
      const { session_id } = await saveCanvaDraft(
        payload,
        selected.map((p) => p.id),
        sessionId ?? undefined,
      );
      setSessionId(session_id);
      toast.success('草稿已儲存');
      await refreshSessions();
    } catch (err) {
      toast.error('儲存失敗', { description: errorText(err) });
    } finally {
      setStatus('idle');
    }
  }, [brief, outline, selected, sessionId, canImport, refreshSessions]);

  const createNative = useCallback(async () => {
    if (!canCreateNative || disabled) return;
    if (activeSession?.canva_design_id) return;
    setStatus('creating');
    setGenerationPending(true);
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    setActiveSession(null);
    let taskSessionId: string | null = null;
    try {
      const confirmed = outline.trim() || buildOutlineFromBrief(brief);
      const payload: CanvaDesignBrief = {
        ...brief,
        title: brief.title.trim() || `${brief.client ?? ''} ${brief.project ?? ''}`.trim() || '客戶簡報',
        outline: confirmed,
        confirmedAt: new Date().toISOString(),
      };
      const { session_id } = await saveCanvaDraft(
        payload,
        selected.map((p) => p.id),
        sessionId ?? undefined,
      );
      setSessionId(session_id);
      taskSessionId = session_id;
      const session = await createNativeCanvaDesign(session_id);
      setActiveSession(session);
      if (session.edit_url) {
        setCanvaLink({ edit_url: session.edit_url, title: payload.title });
        toast.success('AI 已生成簡報', {
          description: 'AI 已生成，請在 Canva 微調後匯出。',
        });
      }
      await refreshSessions();
      await refreshStatus();
    } catch (err) {
      // A browser timeout is not evidence that Canva failed. Reconcile with the task.
      const current = taskSessionId ? await fetchCanvaGenerationStatus(taskSessionId).catch(() => null) : null;
      if (current) setActiveSession(current);
      if (current?.canva_design_id && current.edit_url) {
        setCanvaLink({ edit_url: current.edit_url, title: current.brief.title });
        setGenerationError('');
        return;
      }
      if (current?.status === 'creating') {
        setStatusReadError('生成請求連線已中斷，正在查詢 Canva 任務狀態，毋須再次生成。');
        return;
      }
      const msg = current?.error || errorText(err);
      setGenerationError(msg);
      if (msg.includes('design_already_exists') || msg.includes('design_exists') || msg.includes('已有 Canva 設計')) {
        toast.message('此草稿已有 Canva 設計', { description: '請用「新版本」另建設計，勿覆蓋 Canva 內修改。' });
      } else {
        toast.error('AI 生成失敗', { description: msg });
      }
    } finally {
      setGenerationPending(false);
      setStatus('idle');
    }
  }, [canCreateNative, disabled, activeSession, brief, outline, selected, sessionId, refreshSessions, refreshStatus]);

  const refreshSessionDetail = useCallback(async (sid: string) => {
    try {
      const [vers, exps] = await Promise.all([
        listCanvaSessionVersions(sid),
        listCanvaDesignExports(sid),
      ]);
      setVersionRows(vers);
      setExportRows(exps);
    } catch {
      setVersionRows([]);
      setExportRows([]);
    }
  }, []);

  const exportPptx = useCallback(async (sid: string) => {
    setStatus('exporting');
    try {
      const res = await exportCanvaSessionPptx(sid);
      if (res.export_download_url) {
        window.open(res.export_download_url, '_blank', 'noopener,noreferrer');
        toast.success('PPTX 匯出完成', { description: '請在 PowerPoint 驗證 Canva 最後修改是否可編輯。' });
      }
      await refreshSessions();
      await refreshSessionDetail(sid);
    } catch (err) {
      toast.error('匯出 PPTX 失敗', { description: errorText(err) });
    } finally {
      setStatus('idle');
    }
  }, [refreshSessions, refreshSessionDetail]);

  const exportPdf = useCallback(async (sid: string) => {
    setStatus('exporting');
    try {
      const res = await exportCanvaSessionPdf(sid);
      if (res.export_download_url) {
        window.open(res.export_download_url, '_blank', 'noopener,noreferrer');
        toast.success('PDF 匯出完成', { description: '附加格式；客戶簡報驗收仍以 PPTX 為準。' });
      }
      await refreshSessionDetail(sid);
    } catch (err) {
      toast.error('匯出 PDF 失敗', { description: errorText(err) });
    } finally {
      setStatus('idle');
    }
  }, [refreshSessionDetail]);

  const loadSession = (s: CanvaDesignSession) => {
    if (disabled) return;
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    autoPurpose.current = null;
    autoContent.current = null;
    setSessionId(s.id);
    setBrief({ ...defaultBrief(), ...(s.brief as CanvaDesignBrief) });
    setOutline(String((s.brief as CanvaDesignBrief).outline ?? ''));
    setVersionNote(s.version_note ?? '');
    setActiveSession(s);
    setWizardStep(isCanvaDesign(s) || s.status === 'creating' || s.status === 'failed' ? 4 : 1);
    if (s.edit_url) setCanvaLink({ edit_url: s.edit_url, title: (s.brief as CanvaDesignBrief).title });
    refreshSessionDetail(s.id);
  };

  const newVersion = async (parent: CanvaDesignSession) => {
    if (disabled) return;
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    autoPurpose.current = null;
    autoContent.current = null;
    setSessionId(null);
    setBrief({ ...(parent.brief as CanvaDesignBrief), confirmedAt: undefined });
    setOutline(String((parent.brief as CanvaDesignBrief).outline ?? ''));
    setActiveSession(null);
    try {
      const { session_id } = await saveCanvaDraft(
        parent.brief as CanvaDesignBrief,
        parent.product_ids ?? [],
        undefined,
        parent.id,
        versionNote.trim() || `自 v${parent.content_version ?? 1} 複製`,
      );
      setSessionId(session_id);
      setWizardStep(4);
      toast.message('已建立新版本草稿', { description: '確認後可再次建立 Canva 設計，不覆蓋舊設計。' });
      await refreshSessions();
      await refreshSessionDetail(session_id);
    } catch (err) {
      toast.error('無法建立新版本', { description: errorText(err) });
    }
  };

  const connect = async () => {
    try {
      const redirectUri = `${window.location.origin}${PRESENTATION_PATH}`;
      const authorizeUrl = await startCanvaConnect(redirectUri);
      window.location.href = authorizeUrl;
    } catch (err) {
      toast.error('無法啟動 Canva 授權', { description: errorText(err) });
    }
  };

  const disconnect = async () => {
    try {
      await canvaDisconnect();
      await refreshStatus();
      toast.message('已解除 Canva 連接');
    } catch (err) {
      toast.error('解除失敗', { description: errorText(err) });
    }
  };

  const clearForm = () => {
    if (disabled) return;
    setGenerationError('');
    setStatusReadError('');
    autoPurpose.current = null;
    autoContent.current = null;
    setBrief(defaultBrief());
    setOutline('');
    setSelected([]);
    setPickerNonce((nonce) => nonce + 1);
    setSessionId(null);
    setActiveSession(null);
    setCanvaLink(null);
    setVersionNote('');
    setVersionRows([]);
    setExportRows([]);
    setWizardStep(1);
  };

  const applyAuto = (purposeSuggestion: string, contentSuggestion: string) => {
    const current = briefRef.current;
    const purposeNext = nextFieldValue(current.purpose, purposeSuggestion, autoPurpose.current, PURPOSE_MAX);
    const contentNext = nextFieldValue(current.content, contentSuggestion, autoContent.current, CONTENT_MAX);
    autoPurpose.current = purposeNext.auto;
    autoContent.current = contentNext.auto;
    return { purpose: purposeNext.value, content: contentNext.value };
  };

  const selectClient = (client: PresentationClientOption) => {
    const filled = applyAuto(clientPurposeDefault(client), clientContentDefault(client));
    const projectStillThere = client.projects.some((project) => project.id === briefRef.current.projectId);
    setBrief({
      ...briefRef.current,
      client: client.name,
      clientId: client.id,
      projectId: projectStillThere ? briefRef.current.projectId : undefined,
      purpose: filled.purpose,
      content: filled.content,
    });
  };

  const selectProject = (project: PresentationProjectOption) => {
    const current = briefRef.current;
    const owner = clients.find((row) => row.projects.some((item) => item.id === project.id)) ?? null;
    const adoptClient = !current.client?.trim() && owner != null;
    const contactClient = adoptClient
      ? owner
      : clients.find((row) => row.id === current.clientId) ?? null;
    const filled = applyAuto(
      projectPurposeDefault(project),
      contactClient
        ? projectContentDefault(contactClient, project)
        : (project.note ? `客戶備註：${project.note}` : ''),
    );
    setBrief({
      ...current,
      client: adoptClient && owner ? owner.name : current.client,
      clientId: adoptClient && owner ? owner.id : current.clientId,
      project: project.name,
      projectId: project.id,
      purpose: filled.purpose,
      content: filled.content,
    });
  };

  const goToStep = useCallback((next: number) => {
    const target = Math.min(WIZARD_STEPS.length, Math.max(1, next));
    if (wizardStep === 1 && target > 1 && !outline.trim()) syncOutline();
    setWizardStep(target);
  }, [outline, syncOutline, wizardStep]);

  const openDesignRow = (session: CanvaDesignSession) => {
    loadSession(session);
    if (session.edit_url) {
      window.open(session.edit_url, '_blank', 'noopener,noreferrer');
    }
  };

  const titleCount = brief.title.length;
  const purposeCount = (brief.purpose ?? '').length;
  const contentCount = (brief.content ?? '').length;
  const selectedClient = clients.find((row) => row.id === brief.clientId) ?? null;
  const projectChoices = useMemo(() => {
    const rows = selectedClient
      ? selectedClient.projects.map((project) => ({ project, clientName: null as string | null }))
      : clients.flatMap((client) => client.projects.map((project) => ({ project, clientName: client.name })));
    const seen = new Set<string>();
    return rows.filter(({ project }) => {
      if (seen.has(project.id)) return false;
      seen.add(project.id);
      return true;
    });
  }, [clients, selectedClient]);
  const draftSessions = useMemo(() => sessions.filter((s) => !isCanvaDesign(s)), [sessions]);
  const designSessions = useMemo(() => sessions.filter(isCanvaDesign), [sessions]);
  const visibleDrafts = showAllDrafts ? draftSessions : draftSessions.slice(0, SIDEBAR_PREVIEW);
  const visibleDesigns = showAllDesigns ? designSessions : designSessions.slice(0, SIDEBAR_PREVIEW);
  const languageOptions = optionsWithCurrent(LANGUAGE_OPTIONS, brief.language);
  const styleOptions = optionsWithCurrent(STYLE_OPTIONS, brief.style);
  const showGenerationWarning = Boolean(canImport && generationProbe && !generationProbe.ok);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-none">
      <div className="mx-auto grid w-full max-w-none items-start gap-5 fds-page-padding lg:grid-cols-3">
        <div className="flex min-w-0 flex-col lg:col-span-2">
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <StepIndicator step={wizardStep} onSelect={goToStep} />
            <div className="mb-5">
              <h3 className="text-base font-bold text-foreground">{WIZARD_STEPS[wizardStep - 1].title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{WIZARD_STEPS[wizardStep - 1].hint}</p>
            </div>
            {wizardStep === 1 && (
            <div className="space-y-4">
              <Field label="簡報標題" required counter={`${titleCount}/${TITLE_MAX}`}>
                <Input
                  className="h-10 rounded-lg bg-background"
                  value={brief.title}
                  aria-required
                  maxLength={TITLE_MAX}
                  onChange={(e) => setBrief((b) => ({ ...b, title: e.target.value.slice(0, TITLE_MAX) }))}
                  placeholder="例：2026 Q3 方案匯報"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="客戶" hint="可搜尋現有客戶，或直接輸入新客戶">
                  <PresentationSearchCombobox
                    ariaLabel="客戶"
                    value={brief.client ?? ''}
                    placeholder="請輸入客戶名稱"
                    loading={clientsLoading}
                    emptyText={clientsError || '沒有相符客戶，可直接使用輸入的名稱'}
                    options={clients.map((client) => ({
                      id: client.id,
                      label: client.name,
                      hint: [client.contactPerson, client.projects.length ? `${client.projects.length} 個專案` : '']
                        .filter(Boolean)
                        .join(' · ') || null,
                    }))}
                    onText={(value) => setBrief((current) => ({
                      ...current,
                      client: value,
                      clientId: current.client === value ? current.clientId : undefined,
                    }))}
                    onPick={(option) => {
                      const client = clients.find((row) => row.id === option.id);
                      if (client) selectClient(client);
                    }}
                  />
                </Field>
                <Field
                  label="專案"
                  hint={brief.clientId ? '顯示此客戶的設計專案，也可直接輸入' : '可搜尋設計專案，或直接輸入'}
                >
                  <PresentationSearchCombobox
                    ariaLabel="專案"
                    value={brief.project ?? ''}
                    placeholder="請輸入專案名稱"
                    loading={clientsLoading}
                    emptyText={
                      selectedClient && selectedClient.projects.length === 0
                        ? '此客戶沒有已登記專案，可直接輸入'
                        : '沒有相符專案，可直接輸入'
                    }
                    options={projectChoices.map(({ project, clientName }) => ({
                      id: project.id,
                      label: project.name,
                      hint: [clientName, projectOptionHint(project)].filter(Boolean).join(' · ') || null,
                    }))}
                    onText={(value) => setBrief((current) => ({
                      ...current,
                      project: value,
                      projectId: current.project === value ? current.projectId : undefined,
                    }))}
                    onPick={(option) => {
                      const project = projectChoices.find((row) => row.project.id === option.id)?.project;
                      if (project) selectProject(project);
                    }}
                  />
                </Field>
              </div>
              <Field label="匯報目的" counter={`${purposeCount}/${PURPOSE_MAX}`}>
                <Textarea
                  className="min-h-[5.5rem] rounded-lg bg-background"
                  value={brief.purpose ?? ''}
                  maxLength={PURPOSE_MAX}
                  onChange={(e) => setBrief((b) => ({ ...b, purpose: e.target.value.slice(0, PURPOSE_MAX) }))}
                  placeholder="例：向客戶說明本季方案重點、報價範圍與下一步"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="語言">
                  <Select
                    value={brief.language || '繁體中文'}
                    onValueChange={(value) => setBrief((b) => ({ ...b, language: value }))}
                  >
                    <SelectTrigger className="h-10 rounded-lg bg-background">
                      <SelectValue placeholder="選擇語言" />
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="風格">
                  <Select
                    value={brief.style || '專業、簡潔'}
                    onValueChange={(value) => setBrief((b) => ({ ...b, style: value }))}
                  >
                    <SelectTrigger className="h-10 rounded-lg bg-background">
                      <SelectValue placeholder="選擇風格" />
                    </SelectTrigger>
                    <SelectContent>
                      {styleOptions.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="sm:w-1/2">
                <Field label="期望頁數" hint="建議 8–20 頁">
                  <Input
                    className="h-10 rounded-lg bg-background"
                    type="number"
                    min={4}
                    max={40}
                    value={brief.pageCount ?? ''}
                    onChange={(e) => setBrief((b) => ({ ...b, pageCount: Number(e.target.value) || undefined }))}
                    placeholder="12"
                  />
                </Field>
              </div>
              <Field label="匯報原文" counter={`${contentCount}/${CONTENT_MAX}`}>
                <Textarea
                  className="min-h-[8rem] rounded-lg bg-background"
                  value={brief.content ?? ''}
                  maxLength={CONTENT_MAX}
                  onChange={(e) => setBrief((b) => ({ ...b, content: e.target.value.slice(0, CONTENT_MAX) }))}
                  placeholder="可貼上客戶提供的匯報原文"
                />
              </Field>
            </div>
            )}
            {wizardStep === 2 && (
              <Textarea
                className="min-h-[8rem] rounded-lg bg-background font-mono text-xs"
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                placeholder="整理後的大綱；建立 Canva 前請確認"
              />
            )}
            {wizardStep === 3 && (
              <PresentationProductPicker
                key={pickerNonce}
                selected={selected}
                maxItems={MAX_ITEMS}
                onChange={setSelected}
              />
            )}
            {wizardStep === 4 && (
            <div className="space-y-4">
              <Field label="新版本備註">
                <Input
                  className="h-10 rounded-lg bg-background"
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder="例：客戶回饋後第二稿"
                />
              </Field>
              {activeSession?.canva_design_id && (
                <div>
                  <Button type="button" variant="outline" className="bg-background" disabled={disabled} onClick={() => newVersion(activeSession)}>
                    新版本
                  </Button>
                </div>
              )}
              {(generating || activeSession?.canva_design_id || activeSession?.status === 'failed' || generationError) && (
                <div role="status" aria-live="polite" className="space-y-1 text-sm">
                  <p className="font-medium">
                    {activeSession?.status === 'failed' ? 'Canva 生成失敗'
                      : activeSession?.canva_design_id ? 'Canva 簡報已完成'
                      : activeSession?.populate_report?.generation_job_id
                        ? activeSession.populate_report.generation_status === 'queued' ? 'Canva 任務排隊中' : 'Canva 已接收任務，正在生成簡報'
                        : generating ? '正在提交 Canva 生成任務' : '無法確認生成結果'}
                  </p>
                  {activeSession?.status === 'creating' && !activeSession.populate_report?.generation_job_id && (
                    <p className="text-muted-foreground">後端正在處理請求，尚未收到 Canva 任務編號。</p>
                  )}
                  {activeSession?.populate_report?.generation_job_id && (
                    <p className="break-all text-xs text-muted-foreground">
                      Canva 任務：{String(activeSession.populate_report.generation_job_id)} · 狀態：{({ accepted: '已接收', queued: '排隊中', in_progress: '生成中', success: '已完成', failed: '失敗' } as Record<string, string>)[String(activeSession.populate_report.generation_status)] ?? String(activeSession.populate_report.generation_status ?? '已接收')}
                    </p>
                  )}
                  {generating && <p className="text-xs text-muted-foreground">每 3 秒查詢任務狀態，毋須再次按「AI 生成」。</p>}
                  {(activeSession?.error || generationError) && !activeSession?.canva_design_id && (
                    <p className="break-words text-destructive">{activeSession?.error || generationError}</p>
                  )}
                  {statusReadError && <p className="break-words text-amber-700 dark:text-amber-300">{statusReadError}</p>}
                </div>
              )}
              {!canvaPathReady && canImport && (
                <p className="text-xs text-amber-700 dark:text-amber-300">請先連接 Canva 後再建立設計。</p>
              )}
              {canvaLink && (
                <a
                  href={canvaLink.edit_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 p-3 text-sm font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  <span className="truncate">在 Canva 編輯：{canvaLink.title ?? '設計'}</span>
                </a>
              )}
              {activeSession?.canva_design_id && (
                <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    請先在 Canva 保存修改，再匯出；連結約 24 小時有效。專業說明 PDF（R5.2）共用內容、獨立版面：
                    <a className="ml-1 underline" href={proPdfHandoffPath(brief)}>開啟專業 PDF 頁</a>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" disabled={disabled} onClick={() => exportPptx(activeSession.id)}>
                      {status === 'exporting' && <Loader2 className="h-4 w-4 animate-spin" />}
                      匯出 PPTX（驗收用）
                    </Button>
                    <Button type="button" variant="outline" className="bg-background" disabled={disabled} onClick={() => exportPdf(activeSession.id)}>
                      匯出 PDF（附加）
                    </Button>
                  </div>
                </div>
              )}
              {(versionRows.length > 0 || exportRows.length > 0) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {versionRows.length > 0 && (
                    <div className="rounded-xl border bg-background p-3 text-sm">
                      <p className="mb-2 font-medium">版本鏈</p>
                      <ul className="space-y-1 text-xs">
                        {versionRows.map((v) => (
                          <li key={v.id} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">v{v.content_version ?? '?'}{v.version_note ? ` · ${v.version_note}` : ''}</span>
                            <span className="shrink-0 text-muted-foreground">{v.status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {exportRows.length > 0 && (
                    <div className="rounded-xl border bg-background p-3 text-sm">
                      <p className="mb-2 font-medium">匯出紀錄</p>
                      <ul className="space-y-1 text-xs">
                        {exportRows.map((e) => {
                          const expired = e.url_expires_at && new Date(e.url_expires_at) < new Date();
                          return (
                            <li key={e.id} className="flex flex-wrap items-center gap-2">
                              <span className="uppercase">{e.format}</span>
                              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                              {e.download_url && !expired ? (
                                <a className="underline" href={e.download_url} target="_blank" rel="noreferrer">下載</a>
                              ) : (
                                <span className="text-muted-foreground">{e.error ?? '連結已過期'}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </section>

        </div>


        <aside className="min-w-0 space-y-4 lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:self-start lg:overflow-y-auto">
          <section id="canva-connection" className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-md ring-4 ring-indigo-50 dark:bg-indigo-950 dark:ring-indigo-500/20">
                <CanvaMark className="h-auto w-14" />
              </div>
              <h3 className="mt-3 text-base font-bold text-foreground">Canva 連接</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                公司帳戶 {canva?.account_name || 'chifung.login'}（admin / 傢俬組）
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                AI 生成需要帳戶具備 Canva AI 與 Magic Design。點數用完時會暫停生成。
              </p>
            </div>
            <div className="mt-4 space-y-2">
              {!canva && (
                <p className="text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                  偵測中…
                </p>
              )}
              {canva && (!canva.configured || !canImport) && (
                <ConnectionHint content={!canva.configured ? (
                  <p>請設定 CANVA_CLIENT_ID／CANVA_CLIENT_SECRET，並在 Canva 設定 redirect URI：{`${window.location.origin}${PRESENTATION_PATH}`}。 <a className="underline" href={AI_DOC_HREF} target="_blank" rel="noreferrer">查看設定文件</a></p>
                ) : '僅 admin／傢俬組可使用 Canva 簡報功能。'}>
                  <Button type="button" variant="outline" className="w-full">{!canva.configured ? '尚未配置' : '權限不足'}</Button>
                </ConnectionHint>
              )}
              {canva?.configured && canImport && !connected && (
                <Button type="button" className="w-full bg-indigo-600 text-white hover:bg-indigo-500" onClick={connect} disabled={disabled}>
                  <Link2 className="h-4 w-4" /> 連接 Canva
                </Button>
              )}
              {connected && (
                <div className="grid grid-cols-3 gap-2">
                  <ConnectionHint content={showGenerationWarning ? (
                    <p>{generationProbe?.message ?? '無法確認 Canva AI 生成權限。'}{generationProbe?.missing_scopes?.length ? ` 缺少 scope：${generationProbe.missing_scopes.join(', ')}。` : ''} <a className="underline" href={AI_DOC_HREF} target="_blank" rel="noreferrer">查看文件</a></p>
                  ) : generationProbe?.ok ? '已連接 Canva，可以 AI 生成簡報。' : '已連接 Canva，正在確認 AI 生成權限。'}>
                    <button type="button" className={`inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg border text-xs font-medium ${showGenerationWarning ? 'border-orange-400 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200' : 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {showGenerationWarning ? '需要設定' : '已連接'}
                    </button>
                  </ConnectionHint>
                  <Button type="button" variant="outline" className="h-9 bg-background px-1 text-xs" onClick={refreshStatus}>
                    <RefreshCcw className="h-3.5 w-3.5" />
                    重新檢查
                  </Button>
                  <Button type="button" variant="outline" className="h-9 bg-background px-1 text-xs" onClick={disconnect} disabled={disabled}>
                    <RefreshCcw className="h-3.5 w-3.5" />
                    解除連接
                  </Button>
                </div>
              )}

            </div>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-foreground">最近草稿</h3>
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                onClick={() => setShowAllDrafts((open) => !open)}
              >
                {showAllDrafts ? '收起' : '查看全部'}
              </button>
            </div>
            {draftSessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">尚無草稿</p>
            ) : (
              <ul className="space-y-2">
                {visibleDrafts.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => loadSession(s)}
                      className="flex w-full items-start gap-3 rounded-xl border border-transparent px-1 py-2 text-left hover:bg-muted/60"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{sessionTitle(s)}</span>
                          <Badge className="shrink-0 border-transparent bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/50 dark:text-orange-200">{s.status === 'creating' ? 'Canva 任務進行中' : s.status === 'failed' ? '生成失敗' : '草稿'}</Badge>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">客戶：{sessionClient(s)}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{formatRecentTime(s.updated_at || s.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-foreground">最近 Canva 設計</h3>
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                onClick={() => setShowAllDesigns((open) => !open)}
              >
                {showAllDesigns ? '收起' : '查看全部'}
              </button>
            </div>
            {designSessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">尚無 Canva 設計</p>
            ) : (
              <ul className="space-y-2">
                {visibleDesigns.map((s) => {
                  const thumb = sessionThumbnail(s);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => openDesignRow(s)}
                        className="flex w-full items-start gap-3 rounded-xl border border-transparent px-1 py-2 text-left hover:bg-muted/60"
                      >
                        <DesignThumbnail url={thumb} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{sessionTitle(s)}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{designStatusLine(s)}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{formatRecentTime(s.updated_at || s.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
      </div>
          <div className="z-20 shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_-12px_rgba(15,23,42,0.35)] sm:px-6">
            <Button
              type="button"
              variant="outline"
              className="bg-background"
              disabled={wizardStep === 1 || disabled}
              onClick={() => goToStep(wizardStep - 1)}
            >
              上一步
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="bg-background"
                disabled={disabled}
                onClick={clearForm}
              >
                <Trash2 className="h-4 w-4" />
                清空表單
              </Button>
              <Button
                type="button"
                variant="outline"
                className="bg-background"
                disabled={disabled || !canImport}
                onClick={saveDraft}
              >
                {status === 'creating' && !generationPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                儲存草稿
              </Button>
              {wizardStep < WIZARD_STEPS.length ? (
                <Button
                  type="button"
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                  disabled={disabled}
                  onClick={() => goToStep(wizardStep + 1)}
                >
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                  disabled={!canCreateNative || disabled || Boolean(activeSession?.canva_design_id)}
                  onClick={createNative}
                >
                  {generating ? 'Canva 任務進行中' : activeSession?.canva_design_id ? '已有 Canva 設計' : 'AI 生成簡報'}
                </Button>
              )}
            </div>
          </div>
    </div>
  );
}
