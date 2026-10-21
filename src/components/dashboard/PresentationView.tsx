// ============================================================================
// FDS 2.1 — 客戶簡報（F-AI-009）
// T-901 PoC：Canva 原生 POST /v1/designs（canvaNativeDesign.ts），非 Design Imports。
// 舊版「選產品 → PptxGenJS → 匯入 Canva」保留於「舊版」分頁，不作驗收。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ExternalLink, Link2, Loader2, Plus,
  Presentation as PresentationIcon, RefreshCcw, Search, Unlink, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { SearchProduct, SearchResult, SearchScope } from '@/lib/productSearch';
import { moneyLabel, searchProducts } from '@/lib/productSearch';
import {
  buildPresentationDoc, defaultMetaFromProducts, type PresentationMeta,
} from '@/lib/presentation';
import { buildPresentationBlob, safeFileName } from '@/lib/presentationPptx';
import {
  blobToBase64, canvaDisconnect, exchangeCanvaCode, fetchCanvaStatus, importPptxToCanva,
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

type Status = 'idle' | 'generating' | 'importing' | 'creating' | 'exporting';
type ViewMode = 'native' | 'legacy';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pricePreview(p: SearchProduct): string | null {
  const discount = moneyLabel(p.middle_price, 'HK$');
  if (discount) return discount;
  const original = moneyLabel(p.sale_price, 'HK$');
  return original ?? null;
}

export function PresentationView() {
  const [viewMode, setViewMode] = useState<ViewMode>('native');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchProduct[]>([]);
  const [meta, setMeta] = useState<PresentationMeta>({
    title: '',
    subtitle: '',
    dateLabel: '',
    showPrices: true,
  });
  const [importCanva, setImportCanva] = useState(false);
  const [canva, setCanva] = useState<CanvaStatus | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [canvaLink, setCanvaLink] = useState<{ edit_url: string; title?: string } | null>(null);
  const oauthHandledRef = useRef(false);

  const [brief, setBrief] = useState<CanvaDesignBrief>(() => defaultBrief());
  const [outline, setOutline] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CanvaDesignSession[]>([]);
  const [activeSession, setActiveSession] = useState<CanvaDesignSession | null>(null);
  const [productsOpen, setProductsOpen] = useState(false);
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

  useEffect(() => {
    setMeta((m) => {
      if (selected.length === 0 && !m.title) return m;
      if (m.title && m.title !== '傢俬選品簡報' && !m.title.endsWith('產品簡報')) return m;
      return { ...m, ...defaultMetaFromProducts(selected, m.showPrices) };
    });
  }, [selected]);

  const runSearch = useCallback(async () => {
    setSearching(true);
    try {
      const res = await searchProducts(
        {
          query, factory: '', level1: '', level2: '', colors: [], materialTags: [],
          priceMin: '', priceMax: '', lMin: '', lMax: '', wMin: '', wMax: '', hMin: '', hMax: '',
          inStock: false, scope, sort: 'relevance',
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
  }, [query, scope]);

  useEffect(() => {
    if (viewMode === 'legacy') runSearch();
  }, [runSearch, viewMode]);

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

  const move = (index: number, dir: -1 | 1) => {
    setSelected((current) => {
      const next = [...current];
      const target = index + dir;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const disabled = status !== 'idle';
  const canGenerate = selected.length > 0 && !!meta.title.trim();
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

  const generateLegacy = useCallback(async () => {
    if (!canGenerate || disabled) return;
    const nameBase = meta.title.trim();
    setStatus('generating');
    setCanvaLink(null);
    try {
      const dateLabel = meta.dateLabel.trim() ||
        `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`;
      const doc = buildPresentationDoc({ ...meta, dateLabel }, selected);
      const blob = await buildPresentationBlob(doc);
      const fileName = `${safeFileName(nameBase)}.pptx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      if (importCanva && canvaPathReady) {
        setStatus('importing');
        const base64 = await blobToBase64(blob);
        const imported = await importPptxToCanva(fileName, base64, selected.map((p) => p.id));
        if (imported.edit_url) {
          setCanvaLink({ edit_url: imported.edit_url, title: imported.title });
          toast.success('已匯入 Canva（舊版通路）');
        }
      }
      toast.success('PPTX 已下載（舊版本機模板）');
    } catch (err) {
      toast.error('生成失敗', { description: errorText(err) });
    } finally {
      setStatus('idle');
    }
  }, [canGenerate, disabled, meta, selected, importCanva, canvaPathReady]);

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

  const searchResults = result?.items ?? [];
  const selectedIds = useMemo(() => new Set(selected.map((i) => i.id)), [selected]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">客戶簡報（Canva）</h2>
          <p className="text-sm text-muted-foreground">
            F-AI-009：內容確認 → Autofill → Canva 編輯 → 匯出 PPTX 驗收（T-903 版本／匯出紀錄）。
          </p>
        </div>
        <div className="flex rounded-lg border p-0.5">
          <Button
            variant={viewMode === 'native' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('native')}
          >
            Canva 簡報
          </Button>
          <Button
            variant={viewMode === 'legacy' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('legacy')}
          >
            舊版產品 PPTX
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PresentationIcon className="h-4 w-4" /> Canva 連接
          </CardTitle>
          <CardDescription>
            公司帳戶 chifung.login（admin／傢俬組）。T-902 Autofill 需 Pro／Teams 方案、品牌模板 ID，以及
            brandtemplate／asset scopes（見 repo{' '}
            <code className="rounded bg-muted px-1">docs/prd/FDS-2.1-Canva品牌模板Autofill.md</code>）。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {!canva && <span className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />偵測中…</span>}
          {canva && !canva.configured && (
            <div className="text-sm text-muted-foreground">
              請在 Edge secrets 設定 CANVA_CLIENT_ID／CANVA_CLIENT_SECRET，redirect URI：
              <code className="rounded bg-muted px-1">{`<域名>${PRESENTATION_PATH}`}</code>
            </div>
          )}
          {canva?.configured && !canImport && (
            <div className="text-sm text-muted-foreground">僅 admin／傢俬組可使用 Canva 簡報功能。</div>
          )}
          {canva?.configured && canImport && !connected && (
            <Button onClick={connect} disabled={disabled}>
              <Link2 className="mr-2 h-4 w-4" /> 連接 Canva
            </Button>
          )}
          {connected && (
            <>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                已連接{canva?.account_name ? `：${canva.account_name}` : ''}
              </Badge>
              <Button variant="ghost" size="sm" onClick={refreshStatus}>
                <RefreshCcw className="mr-1 h-3.5 w-3.5" /> 重新檢查
              </Button>
              <Button variant="ghost" size="sm" onClick={disconnect} disabled={disabled}>
                <Unlink className="mr-1 h-3.5 w-3.5" /> 解除連接
              </Button>
            </>
          )}
          {canImport && autofillProbe && (
            <div className="w-full text-sm text-muted-foreground">
              {autofillProbe.ok ? (
                <span className="text-emerald-700">Autofill 已就緒（品牌模板已配置）。</span>
              ) : (
                <span className="text-amber-800">
                  {autofillProbe.message ??
                    'Autofill 未就緒：請設定 CANVA_BRAND_TEMPLATE_ID、確認 Canva Pro+，並重新 OAuth。'}
                  {autofillProbe.missing_scopes?.length ? (
                    <span className="block text-xs">缺少 scope：{autofillProbe.missing_scopes.join(', ')}</span>
                  ) : null}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {viewMode === 'native' && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">1. 匯報內容與設計要求</CardTitle>
              <CardDescription>
                可不選產品；提交前請確認大綱。建立時會以品牌模板 Autofill 填入封面、大綱與產品圖文（若已配置模板）。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1">
                  <Label>簡報標題</Label>
                  <Input
                    value={brief.title}
                    onChange={(e) => setBrief((b) => ({ ...b, title: e.target.value }))}
                    placeholder="例：2026 Q3 方案匯報"
                  />
                </div>
                <div className="space-y-1">
                  <Label>客戶</Label>
                  <Input value={brief.client ?? ''} onChange={(e) => setBrief((b) => ({ ...b, client: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>專案</Label>
                  <Input value={brief.project ?? ''} onChange={(e) => setBrief((b) => ({ ...b, project: e.target.value }))} />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <Label>匯報目的</Label>
                  <Input value={brief.purpose ?? ''} onChange={(e) => setBrief((b) => ({ ...b, purpose: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>語言</Label>
                  <Input value={brief.language ?? ''} onChange={(e) => setBrief((b) => ({ ...b, language: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>風格</Label>
                  <Input value={brief.style ?? ''} onChange={(e) => setBrief((b) => ({ ...b, style: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>期望頁數</Label>
                  <Input
                    type="number"
                    min={4}
                    max={40}
                    value={brief.pageCount ?? ''}
                    onChange={(e) => setBrief((b) => ({ ...b, pageCount: Number(e.target.value) || undefined }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>匯報原文（可貼上客戶提供內容）</Label>
                <Textarea
                  className="min-h-[8rem]"
                  value={brief.content ?? ''}
                  onChange={(e) => setBrief((b) => ({ ...b, content: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label>確認大綱</Label>
                  <Button type="button" variant="outline" size="sm" onClick={syncOutline}>
                    從上方欄位整理
                  </Button>
                </div>
                <Textarea
                  className="min-h-[6rem] font-mono text-xs"
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  placeholder="整理後的大綱；建立 Canva 前請確認"
                />
              </div>

              <Collapsible open={productsOpen} onOpenChange={setProductsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between">
                    可選：帶入 FDS 產品（{selected.length}）
                    <ChevronDown className={cn('h-4 w-4 transition-transform', productsOpen && 'rotate-180')} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2 rounded-lg border p-3">
                  <div className="flex gap-2">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                      placeholder="搜尋產品…"
                    />
                    <Button onClick={runSearch} disabled={searching}>
                      {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {searchResults.slice(0, 20).map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded border p-2 text-sm">
                        <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggle(p)} />
                        <span className="truncate flex-1">{p.title}</span>
                      </label>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="space-y-1">
                <Label className="text-xs">新版本備註（建立新版本時使用）</Label>
                <Input
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder="例：客戶回饋後第二稿"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={disabled || !canImport} onClick={saveDraft}>
                  儲存草稿
                </Button>
                <Button className="flex-1 sm:flex-none" disabled={!canCreateNative || disabled} onClick={createNative}>
                  {status === 'creating' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  建立並填入 Canva 簡報
                </Button>
              </div>
              {!canvaPathReady && canImport && (
                <p className="text-xs text-amber-700">請先連接 Canva 後再建立設計。</p>
              )}
              {canvaLink && (
                <a
                  href={canvaLink.edit_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-50/60 p-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  <span className="truncate">在 Canva 編輯：{canvaLink.title ?? '設計'}</span>
                </a>
              )}
              {activeSession?.canva_design_id && (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    請先在 Canva 保存修改，再匯出；連結約 24 小時有效。專業說明 PDF（R5.2）共用內容、獨立版面：
                    <a className="ml-1 underline" href={proPdfHandoffPath(brief)}>開啟專業 PDF 頁</a>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={disabled} onClick={() => exportPptx(activeSession.id)}>
                      {status === 'exporting' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      匯出 PPTX（驗收用）
                    </Button>
                    <Button variant="outline" disabled={disabled} onClick={() => exportPdf(activeSession.id)}>
                      匯出 PDF（附加）
                    </Button>
                  </div>
                </div>
              )}

              {(versionRows.length > 0 || exportRows.length > 0) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {versionRows.length > 0 && (
                    <div className="rounded-lg border p-3 text-sm">
                      <p className="mb-2 font-medium">版本鏈</p>
                      <ul className="space-y-1 text-xs">
                        {versionRows.map((v) => (
                          <li key={v.id} className="flex justify-between gap-2">
                            <span>v{v.content_version ?? '?'}{v.version_note ? ` · ${v.version_note}` : ''}</span>
                            <span className="text-muted-foreground">{v.status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {exportRows.length > 0 && (
                    <div className="rounded-lg border p-3 text-sm">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">最近草稿與設計</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessions.length === 0 && (
                <p className="text-sm text-muted-foreground">尚無紀錄；儲存草稿或建立設計後會出現於此。</p>
              )}
              {sessions.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
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
                  <Button size="sm" variant="ghost" onClick={() => loadSession(s)}>載入</Button>
                  {s.edit_url && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={s.edit_url} target="_blank" rel="noreferrer">Canva</a>
                    </Button>
                  )}
                  {s.status === 'ready' && (
                    <Button size="sm" variant="outline" onClick={() => exportPptx(s.id)}>匯出 PPTX</Button>
                  )}
                  {s.canva_design_id && (
                    <Button size="sm" variant="outline" onClick={() => newVersion(s)}>新版本</Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {viewMode === 'legacy' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm text-amber-900">
          此分頁為舊版本機 PPTX ＋ Design Imports，<strong>不符合</strong> F-AI-009 驗收；僅供過渡參考。
        </div>
      )}

      {viewMode === 'legacy' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Card className="order-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">1. 選產品（{selected.length}/{MAX_ITEMS}）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="名稱／型號／供應商…"
                />
                <Button onClick={runSearch} disabled={searching}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
                <Select value={scope} onValueChange={(v) => setScope(v as SearchScope)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部產品</SelectItem>
                    <SelectItem value="catalog">產品目錄</SelectItem>
                    <SelectItem value="shopify">已上架</SelectItem>
                    <SelectItem value="quoted">有供應商報價</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-[26rem] space-y-1.5 overflow-y-auto rounded-lg border p-2">
                {searchResults.length === 0 && !searching && (
                  <p className="p-6 text-center text-sm text-muted-foreground">沒有找到產品</p>
                )}
                {searchResults.map((p) => {
                  const picked = selectedIds.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-2 text-sm transition-colors',
                        picked ? 'border-blue-500/50 bg-blue-50/60' : 'border-transparent hover:bg-muted/50',
                      )}
                    >
                      <Checkbox checked={picked} onCheckedChange={() => toggle(p)} />
                      <span className="h-11 w-14 shrink-0 overflow-hidden rounded bg-muted">
                        <LoadingImage
                          src={p.image_url ? productThumbUrl(p.image_url, 192) : null}
                          alt={p.title}
                          className="h-full w-full object-contain"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[p.model, p.factory_name].filter(Boolean).join(' ｜ ')}
                        </span>
                      </span>
                      {moneyLabel(p.middle_price, 'HK$') && (
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {moneyLabel(p.middle_price, 'HK$')}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="order-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">2. 已選產品 · 標題 · 版式</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-2">
                {selected.length === 0 && (
                  <p className="p-6 text-center text-sm text-muted-foreground">在左邊勾選產品</p>
                )}
                {selected.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                    <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    {pricePreview(p) && (
                      <span className="text-xs font-semibold tabular-nums">{pricePreview(p)}</span>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === selected.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggle(p)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1">
                  <Label>簡報標題</Label>
                  <Input value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>副標題</Label>
                  <Input value={meta.subtitle} onChange={(e) => setMeta((m) => ({ ...m, subtitle: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>日期</Label>
                  <Input
                    value={meta.dateLabel}
                    placeholder="自動"
                    onChange={(e) => setMeta((m) => ({ ...m, dateLabel: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <Switch id="show-prices" checked={meta.showPrices} onCheckedChange={(v) => setMeta((m) => ({ ...m, showPrices: v }))} />
                  <Label htmlFor="show-prices" className="text-sm">顯示折扣價</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="import-canva" checked={importCanva} onCheckedChange={setImportCanva} />
                  <Label htmlFor="import-canva" className="text-sm">Design Imports 匯入 Canva</Label>
                </div>
              </div>
              <Button className="w-full" disabled={!canGenerate || disabled} onClick={generateLegacy}>
                {status === 'generating' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {status === 'importing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                下載本機 PPTX（舊版）
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
