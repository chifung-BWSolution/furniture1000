// ============================================================================
// FDS 2.1 Day 9 — 簡報生成（F-AI-009，T-902）
// PM 專屬入口：選產品（fds_search_products，成本按角色遮蔽）→ 固定模板整理
// → pptxgenjs 生成 PPTX（可編輯，直接下載）→ 勾選「匯入 Canva」時經 edge
// generate-canva-presentation 用 Design Imports 轉成可編輯 Canva 設計。
// Canva 授權（chifung.login）走 OAuth PKCE：code 落在本頁 query，exchange 後清掉。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, CheckCircle2, Link2, Loader2, Plus, Presentation as PresentationIcon,
  RefreshCcw, Search, Unlink, X,
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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

const PAGE_SIZE = 50;
const MAX_ITEMS = 30;
const PRESENTATION_PATH = '/fds/pm/presentation';

type Status = 'idle' | 'generating' | 'importing';

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
  const [importCanva, setImportCanva] = useState(true);
  const [canva, setCanva] = useState<CanvaStatus | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [canvaLink, setCanvaLink] = useState<{ edit_url: string; title?: string } | null>(null);
  const oauthHandledRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    const [statusValue, role] = await Promise.all([
      fetchCanvaStatus(),
      supabase.rpc('bwf_has_role', { p_roles: ['admin', 'uploader'] }),
    ]);
    setCanva(statusValue);
    setCanImport(Boolean(role.data));
  }, []);

  // OAuth 回調：?code=…&state=… exchange 後把 query 從網址清掉
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

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // 取消勾選 / 移除時把 meta 歸零重算標題
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

  // 初次載入列出產品目錄
  useEffect(() => { runSearch(); }, [runSearch]);

  const toggle = (p: SearchProduct) => {
    setSelected((current) => {
      if (current.some((i) => i.id === p.id)) return current.filter((i) => i.id !== p.id);
      if (current.length >= MAX_ITEMS) {
        toast.message(`最多 ${MAX_ITEMS} 件`, { description: '簡報超過 30 頁不利列印與 Canva 匯入' });
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

  const generate = useCallback(async () => {
    if (!canGenerate || disabled) return;
    const nameBase = meta.title.trim();
    setStatus('generating');
    setCanvaLink(null);
    try {
      const dateLabel = meta.dateLabel.trim() ||
        `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`;
      const doc = buildPresentationDoc({ ...meta, dateLabel }, selected);
      const blob = await buildPresentationBlob(doc);

      // 1) 永遠先交付可編輯 PPTX（驗收標準）
      const fileName = `${safeFileName(nameBase)}.pptx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      // 2) 選擇性：Canva Design Imports
      if (importCanva && canvaPathReady) {
        setStatus('importing');
        const base64 = await blobToBase64(blob);
        const imported = await importPptxToCanva(
          fileName,
          base64,
          selected.map((p) => p.id),
        );
        if (imported.edit_url) {
          setCanvaLink({ edit_url: imported.edit_url, title: imported.title });
          toast.success('已匯入 Canva', { description: '在 Canva 內可直接編輯設計' });
        }
      }
      toast.success('簡報已生成並下載', { description: fileName });
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
      <div>
        <h2 className="text-xl font-semibold">簡報生成</h2>
        <p className="text-sm text-muted-foreground">
          選產品 → 整理內容 → 生成可編輯 PPTX；可一併匯入 Canva（chifung.login）繼續設計。
        </p>
      </div>

      {/* ── Canva 連接卡 ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PresentationIcon className="h-4 w-4" /> Canva 連接
          </CardTitle>
          <CardDescription>
            匯入通路使用公司共用帳戶 chifung.login（限公司管理員／傢俬組）。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {!canva && <span className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-3.5 w-3.5" />偵測中…</span>}
          {canva && !canva.configured && (
            <div className="text-sm text-muted-foreground">
              尚未配置：請在 Supabase Edge secrets 設定 <code className="rounded bg-muted px-1">CANVA_CLIENT_ID</code> 與{' '}
              <code className="rounded bg-muted px-1">CANVA_CLIENT_SECRET</code>（用 chifung.login 在 canva.dev 註冊 Connect API App，
              redirect URI 加上 <code className="rounded bg-muted px-1">{`<域名>${PRESENTATION_PATH}`}</code>）。
            </div>
          )}
          {canva?.configured && !canImport && (
            <div className="text-sm text-muted-foreground">Canva 匯入只開放給公司管理員與傢俬組（現有角色不適用）。仍可生成 PPTX。</div>
          )}
          {canva?.configured && canImport && !connected && (
            <>
              <Button onClick={connect} disabled={disabled}>
                <Link2 className="mr-2 h-4 w-4" /> 連接 Canva（chifung.login）
              </Button>
              <span className="text-sm text-muted-foreground">授權只求 design:content:write，生成 PPTX 不需要登入 Canva。</span>
            </>
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
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* ── 搜尋 ───────────────────────────────────────────────────── */}
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
            {result && (
              <p className="text-xs text-muted-foreground">顯示首 {searchResults.length} 個結果（共 {result.total}）</p>
            )}
          </CardContent>
        </Card>

        {/* ── 右欄：設定手冊 ────────────────────────────────────────────── */}
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
                <Label>副標題（公司／專案）</Label>
                <Input value={meta.subtitle} onChange={(e) => setMeta((m) => ({ ...m, subtitle: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>日期</Label>
                <Input
                  value={meta.dateLabel}
                  placeholder="自動（2026年10月）"
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
                <Label htmlFor="import-canva" className="text-sm">同時匯入 Canva</Label>
              </div>
            </div>

            <Button className="w-full" disabled={!canGenerate || disabled} onClick={generate}>
              {status === 'generating' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {status === 'importing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {status === 'importing' ? '匯入 Canva 中…' : `生成 PPTX 並下載（共 ${selected.length} 件）`}
            </Button>
            <p className="text-xs text-muted-foreground">
              <Plus className="mr-0.5 inline h-3 w-3" />若勾了「同時匯入 Canva」，完成後會回到可編輯 Canva 連結。
            </p>

            {canvaLink && (
              <a
                href={canvaLink.edit_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-50/60 p-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
              >
                <Link2 className="h-4 w-4 shrink-0" />
                <span className="truncate">在 Canva 內打開：{canvaLink.title ?? '設計'}</span>
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
