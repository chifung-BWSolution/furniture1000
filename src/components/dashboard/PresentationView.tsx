// ============================================================================
// FDS 2.1 — 客戶簡報（F-AI-009）
// Canva 原生 POST /v1/designs（canvaNativeDesign.ts）。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, CheckCircle2, ExternalLink, Info, Link2, Loader2,
  Presentation as PresentationIcon, RefreshCcw, Save, Search, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { SearchProduct, SearchResult } from '@/lib/productSearch';
import { searchProducts } from '@/lib/productSearch';
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

const PAGE_SIZE = 50;
const MAX_ITEMS = 30;
const PRESENTATION_PATH = '/fds/pm/presentation';
const PURPOSE_MAX = 200;
const CONTENT_MAX = 1000;
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

function SlideStack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 104" className={className} aria-hidden>
      <rect x="34" y="16" width="78" height="52" rx="10" className="fill-indigo-200 dark:fill-indigo-400/35" transform="rotate(8 73 42)" />
      <rect x="22" y="22" width="78" height="52" rx="10" className="fill-violet-300 dark:fill-violet-400/45" transform="rotate(-7 61 48)" />
      <rect x="16" y="30" width="84" height="58" rx="12" className="fill-white stroke-indigo-200 dark:fill-slate-900 dark:stroke-indigo-300/40" strokeWidth="1.5" />
      <rect x="28" y="44" width="34" height="7" rx="3.5" className="fill-indigo-500" />
      <rect x="28" y="58" width="58" height="4" rx="2" className="fill-indigo-200 dark:fill-indigo-300/50" />
      <rect x="28" y="68" width="46" height="4" rx="2" className="fill-violet-200 dark:fill-violet-300/40" />
    </svg>
  );
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
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
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

  const runSearch = useCallback(async () => {
    setSearching(true);
    try {
      const res = await searchProducts(
        {
          query, factory: '', level1: '', level2: '', colors: [], materialTags: [],
          priceMin: '', priceMax: '', lMin: '', lMax: '', wMin: '', wMax: '', hMin: '', hMax: '',
          inStock: false, scope: 'all', sort: 'relevance',
        },
        0,
        PAGE_SIZE,
      );
      setResult(res);
    } catch (err) {
      toast.error('搜索失敗', { description: errorText(err) });
    } finally {
      setSearching(false);
    }
  }, [query]);

  const toggle = (p: SearchProduct) => {
    setSelected((current) => {
      if (current.some((i) => i.id === p.id)) return current.filter((i) => i.id !== p.id);
      if (current.length >= MAX_ITEMS) {
        toast.message(`最多 ${MAX_ITEMS} 件`, { description: '簡報不宜過長' });
        return current;
      }
      return [...current, p];
    });
  };

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
    setQuery('');
    setResult(null);
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

  const openCanvaShortcut = () => {
    if (canvaLink?.edit_url) {
      window.open(canvaLink.edit_url, '_blank', 'noopener,noreferrer');
      return;
    }
    document.getElementById('canva-connection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const searchResults = result?.items ?? [];
  const selectedIds = useMemo(() => new Set(selected.map((i) => i.id)), [selected]);
  const purposeCount = (brief.purpose ?? '').length;
  const contentCount = (brief.content ?? '').length;
  const languageOptions = optionsWithCurrent(LANGUAGE_OPTIONS, brief.language);
  const styleOptions = optionsWithCurrent(STYLE_OPTIONS, brief.style);
  const showAutofillWarning = Boolean(canImport && autofillProbe && !autofillProbe.ok);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 text-foreground dark:bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 md:px-6 md:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 self-start rounded-xl border-border bg-white px-4 shadow-sm hover:bg-slate-50 dark:bg-card dark:hover:bg-accent sm:self-center"
              onClick={openCanvaShortcut}
            >
              <CanvaMark className="h-4 w-4" />
              Canva 簡報
            </Button>
          </div>

          <section
            id="canva-connection"
            className="scroll-mt-4 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-white shadow-sm dark:border-indigo-500/20 dark:from-indigo-950/50 dark:via-violet-950/35 dark:to-card"
          >
            <div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-6">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white shadow-md ring-4 ring-white/80 dark:bg-indigo-950 dark:ring-indigo-500/20">
                <CanvaMark className="h-11 w-11" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-foreground">Canva 連接</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  公司帳戶 chifung.login（admin／傢俬組）。T-902 Autofill 需 Pro／Teams 方案、品牌模板 ID，以及
                  brandtemplate／asset scopes。
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!canva && (
                    <span className="text-sm text-muted-foreground">
                      <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                      偵測中…
                    </span>
                  )}
                  {canva && !canva.configured && (
                    <p className="text-sm text-muted-foreground">
                      請在 Edge secrets 設定 CANVA_CLIENT_ID／CANVA_CLIENT_SECRET，redirect URI：
                      <code className="ml-1 rounded bg-background/80 px-1">{`<域名>${PRESENTATION_PATH}`}</code>
                    </p>
                  )}
                  {canva?.configured && !canImport && (
                    <p className="text-sm text-muted-foreground">僅 admin／傢俬組可使用 Canva 簡報功能。</p>
                  )}
                  {canva?.configured && canImport && !connected && (
                    <Button type="button" onClick={connect} disabled={disabled} className="bg-indigo-600 text-white hover:bg-indigo-500">
                      <Link2 className="h-4 w-4" /> 連接 Canva
                    </Button>
                  )}
                  {connected && (
                    <>
                      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500 bg-white px-3 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" />
                        已連接{canva?.account_name ? `：${canva.account_name}` : ''}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg bg-white dark:bg-card"
                        onClick={refreshStatus}
                      >
                        <RefreshCcw className="h-4 w-4" />
                        重新檢查
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg bg-white dark:bg-card"
                        onClick={disconnect}
                        disabled={disabled}
                      >
                        <RefreshCcw className="h-4 w-4" />
                        解除連接
                      </Button>
                    </>
                  )}
                  {canImport && autofillProbe?.ok && (
                    <span className="text-sm text-emerald-700 dark:text-emerald-300">Autofill 已就緒（品牌模板已配置）。</span>
                  )}
                </div>
              </div>
              <SlideStack className="hidden h-24 w-28 shrink-0 lg:block" />
            </div>
          </section>

          {showAutofillWarning && (
            <div className="flex flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-orange-950 sm:flex-row sm:items-center dark:border-orange-500/30 dark:bg-orange-950/40 dark:text-orange-100">
              <Info className="h-5 w-5 shrink-0 text-orange-500" />
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  {autofillProbe?.message ??
                    'Autofill 未就緒：請設定 CANVA_BRAND_TEMPLATE_ID、確認 Canva Pro+，並重新 OAuth。'}
                </p>
                {autofillProbe?.missing_scopes?.length ? (
                  <p className="mt-1 text-xs text-orange-800/80 dark:text-orange-200/80">
                    缺少 scope：{autofillProbe.missing_scopes.join(', ')}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 bg-white text-orange-950 hover:bg-orange-100 dark:bg-card dark:text-orange-100 dark:hover:bg-orange-950"
                asChild
              >
                <a href={AUTOFILL_DOC_HREF} target="_blank" rel="noreferrer">查看文件</a>
              </Button>
            </div>
          )}

          <StepCard
            n={1}
            title="匯報內容與設計要求"
            hint="可不選產品；提交前請確認大綱。建立時會以品牌模板 Autofill 填入封面、大綱與產品圖文（若已配置模板）。"
          >
            <div className="space-y-4">
              <Field label="簡報標題" required>
                <Input
                  className="h-10 rounded-lg bg-background"
                  value={brief.title}
                  aria-required
                  onChange={(e) => setBrief((b) => ({ ...b, title: e.target.value }))}
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
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-2">
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
                  <div className="sm:col-span-2">
                  <Field label="期望頁數" hint="建議 8–20 頁">
                    <Input
                      className="h-10 max-w-xs rounded-lg bg-background"
                      type="number"
                      min={4}
                      max={40}
                      value={brief.pageCount ?? ''}
                      onChange={(e) => setBrief((b) => ({ ...b, pageCount: Number(e.target.value) || undefined }))}
                      placeholder="12"
                    />
                  </Field>
                  </div>
                </div>
                <Field label="匯報原文" counter={`${contentCount}/${CONTENT_MAX}`}>
                  <Textarea
                    className="min-h-[10.5rem] rounded-lg bg-background lg:min-h-[11.5rem]"
                    value={brief.content ?? ''}
                    maxLength={CONTENT_MAX}
                    onChange={(e) => setBrief((b) => ({ ...b, content: e.target.value.slice(0, CONTENT_MAX) }))}
                    placeholder="可貼上客戶提供的匯報原文"
                  />
                </Field>
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
            hint={`可選。已選 ${selected.length} / ${MAX_ITEMS} 件，建立時一併交給 Autofill。`}
          >
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  className="h-10 rounded-lg bg-background"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="搜尋產品…"
                />
                <Button type="button" variant="outline" className="h-10 bg-background" onClick={runSearch} disabled={searching}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-background p-2">
                {searchResults.length === 0 && (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">搜尋後在這裡勾選產品</p>
                )}
                {searchResults.slice(0, 20).map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent p-2 text-sm hover:bg-muted/60">
                    <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggle(p)} />
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  </label>
                ))}
              </div>
            </div>
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
              <Button
                type="button"
                className="bg-indigo-600 text-white hover:bg-indigo-500"
                disabled={!canCreateNative || disabled}
                onClick={createNative}
              >
                {status === 'creating' && <Loader2 className="h-4 w-4 animate-spin" />}
                建立並填入 Canva 簡報
              </Button>
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

          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <h3 className="mb-4 text-base font-bold text-foreground">最近草稿與設計</h3>
            <div className="space-y-2">
              {sessions.length === 0 && (
                <p className="text-sm text-muted-foreground">尚無紀錄；儲存草稿或建立設計後會出現於此。</p>
              )}
              {sessions.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-background p-2 text-sm">
                  <Badge variant="outline">{s.status}</Badge>
                  {s.generation_mode && (
                    <Badge variant="secondary" className="text-xs">{s.generation_mode}</Badge>
                  )}
                  {s.content_version != null && (
                    <Badge variant="outline" className="text-xs tabular-nums">v{s.content_version}</Badge>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {(s.brief as CanvaDesignBrief).title || '未命名'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => loadSession(s)}>載入</Button>
                  {s.edit_url && (
                    <Button type="button" size="sm" variant="ghost" asChild>
                      <a href={s.edit_url} target="_blank" rel="noreferrer">Canva</a>
                    </Button>
                  )}
                  {s.status === 'ready' && (
                    <Button type="button" size="sm" variant="outline" onClick={() => exportPptx(s.id)}>匯出 PPTX</Button>
                  )}
                  {s.canva_design_id && (
                    <Button type="button" size="sm" variant="outline" onClick={() => newVersion(s)}>新版本</Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.45)] backdrop-blur dark:bg-card/95 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="bg-white dark:bg-background"
            disabled={disabled}
            onClick={clearForm}
          >
            <Trash2 className="h-4 w-4" />
            清空表單
          </Button>
          <Button
            type="button"
            variant="outline"
            className="bg-white dark:bg-background"
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
    </div>
  );
}
