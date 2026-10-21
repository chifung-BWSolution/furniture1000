// ============================================================================
// FDS 2.1 — 客戶簡報（F-AI-009）
// Canva 原生 POST /v1/designs（canvaNativeDesign.ts）。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, CheckCircle2, ExternalLink, FileText, Info, Link2, Loader2,
  Presentation as PresentationIcon, RefreshCcw, Save, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PresentationProductPicker } from '@/components/dashboard/PresentationProductPicker';
import type { SearchProduct } from '@/lib/productSearch';
import { CANVA_AUTOFILL_DOC_PATH } from '@/lib/canvaBrandTemplate';
import {
  canvaDisconnect, exchangeCanvaCode, fetchCanvaStatus,
  readCanvaOauthCallback, startCanvaConnect, clearCanvaOauthState, type CanvaStatus,
} from '@/lib/canvaPresentation';
import {
  buildOutlineFromBrief, createNativeCanvaDesign, defaultBrief, exportCanvaSessionPdf,
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
const AUTOFILL_DOC_HREF = `https://github.com/chifung-BWSolution/furniture1000/blob/develop/${CANVA_AUTOFILL_DOC_PATH}`;
const LANGUAGE_OPTIONS = ['繁體中文', '簡體中文', 'English', '中英對照'];
const STYLE_OPTIONS = ['專業、簡潔', '簡約現代', '高端精品', '活潑清晰'];

type Status = 'idle' | 'creating' | 'exporting';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function optionsWithCurrent(options: string[], current?: string): string[] {
  const value = current?.trim();
  if (value && !options.includes(value)) return [value, ...options];
  return options;
}

function CanvaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#7D2AE8" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#00C4CC" strokeWidth="2.4" />
      <path
        d="M21.2 11.4a6.4 6.4 0 1 0 .2 9.3"
        fill="none"
        stroke="#fff"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function sessionTitle(session: CanvaDesignSession): string {
  const title = (session.brief as CanvaDesignBrief | null)?.title?.trim();
  return title || '未命名';
}

function sessionClient(session: CanvaDesignSession): string {
  return (session.brief as CanvaDesignBrief | null)?.client?.trim() || '—';
}

/** Only a real stored https URL. There is no thumbnail column today. */
function sessionThumbnail(session: CanvaDesignSession): string | null {
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

function StepCard({
  n,
  title,
  hint,
  children,
  id,
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
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
  const outlineRef = useRef<HTMLDivElement>(null);

  const [brief, setBrief] = useState<CanvaDesignBrief>(() => defaultBrief());
  const [outline, setOutline] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CanvaDesignSession[]>([]);
  const [activeSession, setActiveSession] = useState<CanvaDesignSession | null>(null);
  const [versionNote, setVersionNote] = useState('');
  const [versionRows, setVersionRows] = useState<CanvaSessionVersionRow[]>([]);
  const [exportRows, setExportRows] = useState<CanvaDesignExportRow[]>([]);
  const [autofillProbe, setAutofillProbe] = useState<Awaited<ReturnType<typeof probeCanvaNative>> | null>(null);
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const [showAllDesigns, setShowAllDesigns] = useState(false);

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
      setAutofillProbe(probe);
    } else {
      setAutofillProbe(null);
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

  const disabled = status !== 'idle';
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
    setStatus('creating');
    setActiveSession(null);
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
      const session = await createNativeCanvaDesign(session_id);
      setActiveSession(session);
      if (session.edit_url) {
        setCanvaLink({ edit_url: session.edit_url, title: payload.title });
        const mode = session.generation_mode ?? 'blank';
        toast.success('已建立 Canva 簡報', {
          description:
            mode === 'autofill'
              ? '大綱與產品資料已填入品牌模板；請在 Canva 內微調版面後匯出 PPTX。'
              : '未啟用 Autofill（請設定 CANVA_BRAND_TEMPLATE_ID 並重新授權）；目前為空白 presentation。',
        });
      }
      await refreshSessions();
      await refreshStatus();
    } catch (err) {
      const msg = errorText(err);
      if (msg.includes('design_already_exists') || msg.includes('design_exists')) {
        toast.message('此草稿已有 Canva 設計', { description: '請用「新版本」另建設計，勿覆蓋 Canva 內修改。' });
      } else {
        toast.error('建立 Canva 設計失敗', { description: msg });
      }
    } finally {
      setStatus('idle');
    }
  }, [canCreateNative, disabled, brief, outline, selected, sessionId, refreshSessions, refreshStatus]);

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
    setSessionId(s.id);
    setBrief({ ...defaultBrief(), ...(s.brief as CanvaDesignBrief) });
    setOutline(String((s.brief as CanvaDesignBrief).outline ?? ''));
    setVersionNote(s.version_note ?? '');
    setActiveSession(s);
    if (s.edit_url) setCanvaLink({ edit_url: s.edit_url, title: (s.brief as CanvaDesignBrief).title });
    refreshSessionDetail(s.id);
  };

  const newVersion = async (parent: CanvaDesignSession) => {
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
  };

  const generateOutline = () => {
    syncOutline();
    outlineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openDesignRow = (session: CanvaDesignSession) => {
    loadSession(session);
    if (session.edit_url) {
      window.open(session.edit_url, '_blank', 'noopener,noreferrer');
    }
  };

  const titleCount = brief.title.length;
  const purposeCount = (brief.purpose ?? '').length;
  const contentCount = (brief.content ?? '').length;
  const draftSessions = useMemo(() => sessions.filter((s) => !isCanvaDesign(s)), [sessions]);
  const designSessions = useMemo(() => sessions.filter(isCanvaDesign), [sessions]);
  const visibleDrafts = showAllDrafts ? draftSessions : draftSessions.slice(0, SIDEBAR_PREVIEW);
  const visibleDesigns = showAllDesigns ? designSessions : designSessions.slice(0, SIDEBAR_PREVIEW);
  const languageOptions = optionsWithCurrent(LANGUAGE_OPTIONS, brief.language);
  const styleOptions = optionsWithCurrent(STYLE_OPTIONS, brief.style);
  const showAutofillWarning = Boolean(canImport && autofillProbe && !autofillProbe.ok);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto grid w-full max-w-7xl items-start gap-5 px-4 py-5 md:px-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/30">
              <PresentationIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">客戶簡報（Canva）</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                F-AI-009：內容確認 → Autofill → Canva 編輯 → 匯出 PPTX 驗收（T-903 版本 / 匯出紀錄）
              </p>
            </div>
          </div>

          <StepCard
            n={1}
            title="簡報內容與設計要求"
            hint="可不選產品；提交前請確認大綱。建立時會以品牌模板 Autofill 填入封面、大綱與產品圖文（若已配置模板）。"
          >
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
                <Field label="客戶">
                  <Input
                    className="h-10 rounded-lg bg-background"
                    value={brief.client ?? ''}
                    onChange={(e) => setBrief((b) => ({ ...b, client: e.target.value }))}
                    placeholder="請輸入客戶名稱"
                  />
                </Field>
                <Field label="專案">
                  <Input
                    className="h-10 rounded-lg bg-background"
                    value={brief.project ?? ''}
                    onChange={(e) => setBrief((b) => ({ ...b, project: e.target.value }))}
                    placeholder="請輸入專案名稱"
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
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
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
                  {status === 'creating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  儲存草稿
                </Button>
                <Button
                  type="button"
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                  disabled={disabled}
                  onClick={generateOutline}
                >
                  生成簡報大綱
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </StepCard>

          <div ref={outlineRef}>
            <StepCard
              n={2}
              title="確認大綱"
              hint="由上方欄位整理。可直接修改；建立 Canva 設計時會用這份大綱。"
            >
              <Textarea
                className="min-h-[8rem] rounded-lg bg-background font-mono text-xs"
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                placeholder="整理後的大綱；建立 Canva 前請確認"
              />
            </StepCard>
          </div>

          <StepCard
            n={3}
            title="帶入 FDS 產品"
            hint="可選。點選產品卡片加入，建立時把已選產品交給 Autofill。"
          >
            <PresentationProductPicker
              key={pickerNonce}
              selected={selected}
              maxItems={MAX_ITEMS}
              onChange={setSelected}
            />
          </StepCard>

          <StepCard
            n={4}
            title="建立 Canva 設計並匯出"
            hint="請先連接 Canva。已有設計時用「新版本」另建，避免覆蓋 Canva 內的修改。"
          >
            <div className="space-y-4">
              <Field label="新版本備註">
                <Input
                  className="h-10 rounded-lg bg-background"
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder="例：客戶回饋後第二稿"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                  disabled={!canCreateNative || disabled}
                  onClick={createNative}
                >
                  {status === 'creating' && <Loader2 className="h-4 w-4 animate-spin" />}
                  建立並填入 Canva 簡報
                </Button>
                {activeSession?.canva_design_id && (
                  <Button type="button" variant="outline" className="bg-background" disabled={disabled} onClick={() => newVersion(activeSession)}>
                    新版本
                  </Button>
                )}
              </div>
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
          </StepCard>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:self-start lg:overflow-y-auto">
          <section id="canva-connection" className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-md ring-4 ring-indigo-50 dark:bg-indigo-950 dark:ring-indigo-500/20">
                <CanvaMark className="h-11 w-11" />
              </div>
              <h3 className="mt-3 text-base font-bold text-foreground">Canva 連接</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                公司帳戶 {canva?.account_name || 'chifung.login'}（admin / 傢俬組）
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Autofill 需 Canva Pro／Teams，以及品牌模板與 brandtemplate／asset scopes。
              </p>
            </div>
            <div className="mt-4 space-y-2">
              {!canva && (
                <p className="text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                  偵測中…
                </p>
              )}
              {canva && !canva.configured && (
                <p className="text-xs text-muted-foreground">
                  請在 Edge secrets 設定 CANVA_CLIENT_ID／CANVA_CLIENT_SECRET，redirect URI：
                  <code className="ml-1 rounded bg-muted px-1">{`<域名>${PRESENTATION_PATH}`}</code>
                </p>
              )}
              {canva?.configured && !canImport && (
                <p className="text-sm text-muted-foreground">僅 admin／傢俬組可使用 Canva 簡報功能。</p>
              )}
              {canva?.configured && canImport && !connected && (
                <Button type="button" className="w-full bg-indigo-600 text-white hover:bg-indigo-500" onClick={connect} disabled={disabled}>
                  <Link2 className="h-4 w-4" /> 連接 Canva
                </Button>
              )}
              {connected && (
                <div className="grid grid-cols-3 gap-2">
                  <span className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-emerald-500 bg-emerald-50 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    已連接
                  </span>
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
              {canImport && autofillProbe?.ok && (
                <p className="text-center text-xs text-emerald-700 dark:text-emerald-300">Autofill 已就緒（品牌模板已配置）。</p>
              )}
              {showAutofillWarning && (
                <div className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
                  <p className="flex gap-1.5">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
                    <span>
                      {autofillProbe?.message ??
                        'Autofill 未就緒：請設定 CANVA_BRAND_TEMPLATE_ID、確認 Canva Pro+，並重新 OAuth。'}
                      {autofillProbe?.missing_scopes?.length ? ` 缺少 scope：${autofillProbe.missing_scopes.join(', ')}。` : ''}
                      {' '}
                      <a className="underline" href={AUTOFILL_DOC_HREF} target="_blank" rel="noreferrer">查看文件</a>
                    </span>
                  </p>
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
                          <Badge className="shrink-0 border-transparent bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/50 dark:text-orange-200">草稿</Badge>
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
                        {thumb ? (
                          <img src={thumb} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
                        ) : (
                          <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <PresentationIcon className="h-4 w-4" />
                          </span>
                        )}
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
  );
}
