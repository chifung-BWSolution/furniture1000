import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import {
  ChevronLeft, Heart, Image as ImageIcon, Loader2, Maximize2, Move, Package, RotateCcw, Search, Share2, ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingImage } from '@/components/ui/loading-image';
import { ProductImageGalleryLightbox } from '@/components/dashboard/ProductImageGallery';
import { GlbViewport, type ViewportTool } from '@/components/dashboard/GlbViewport';
import { productThumbUrl } from '@/lib/imageThumb';
import { multiColorToChineseDisplay } from '@/constants/color-map';
import { signedModelUrl, fetchModelFlags, type ModelFlags, type ProductModelFile } from '@/lib/productModels';
import {
  EMPTY_SEARCH_FILTERS, searchProducts, sizeLabel, type ProductDetail, type SearchProduct,
} from '@/lib/productSearch';

const MISSING = '未提供';
const MAX_COMPARE = 4;

function shown(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : MISSING;
}

function splitTitle(title: string): { primary: string; secondary: string | null } {
  const match = title.match(/^(.*[\u3400-\u9fff])\s+([A-Za-z0-9][\w .,&/'’\-]*[A-Za-z])\s*$/);
  if (!match) return { primary: title, secondary: null };
  const secondary = match[2].trim();
  if (secondary.length < 3) return { primary: title, secondary: null };
  return { primary: match[1].trim(), secondary };
}

function bytesLabel(bytes: number | null): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Card = {
  id: string;
  title: string;
  model?: string;
  sku?: string;
  image?: string;
  size: string | null;
  material?: string;
  color?: string;
  stock?: boolean;
  factory?: string;
  category?: string;
};

function cardOf(product: Pick<SearchProduct, 'id' | 'title' | 'model' | 'sku' | 'image_url' | 'material' | 'color' | 'in_stock' | 'factory_name' | 'category' | 'dimension_l_mm' | 'dimension_w_mm' | 'dimension_h_mm'> & { images?: string[] }): Card {
  return {
    id: product.id,
    title: product.title,
    model: product.model,
    sku: product.sku,
    image: product.image_url || product.images?.[0],
    size: sizeLabel(product),
    material: product.material,
    color: product.color ? multiColorToChineseDisplay(product.color) : undefined,
    stock: product.in_stock,
    factory: product.factory_name,
    category: product.category,
  };
}

const COMPARE_FIELDS: { key: string; label: string; value: (card: Card, flags: ModelFlags) => string }[] = [
  { key: 'model', label: '型號', value: (card) => shown(card.model) },
  { key: 'sku', label: 'SKU', value: (card) => shown(card.sku) },
  { key: 'size', label: '尺寸 (mm)', value: (card) => shown(card.size) },
  { key: 'material', label: '材質', value: (card) => shown(card.material) },
  { key: 'color', label: '顏色', value: (card) => shown(card.color) },
  { key: 'stock', label: '現貨', value: (card) => (card.stock == null ? MISSING : card.stock ? '是' : '否') },
  { key: 'factory', label: '廠家', value: (card) => shown(card.factory) },
  { key: 'config', label: '配置', value: () => MISSING },
  {
    key: 'modelFile',
    label: '3D 模型',
    value: (card, flags) => (flags[card.id]?.['3d'] ? '可預覽' : '未建立'),
  },
  {
    key: 'suFile',
    label: 'SU 模型',
    value: (card, flags) => (flags[card.id]?.su ? '可下載' : '未建立'),
  },
];

export function ProductWorkbench({
  detail,
  loved,
  onClose,
  onToggleFavorite,
  onOpenProduct,
  actions,
  quotes,
  documents,
  modelFiles,
}: {
  detail: ProductDetail;
  loved: boolean;
  onClose: () => void;
  onToggleFavorite: (next: boolean) => Promise<boolean>;
  onOpenProduct: (productId: string) => void;
  actions: (openAr: () => void) => ReactNode;
  quotes: ReactNode | null;
  documents: ReactNode;
  modelFiles: ProductModelFile[];
}) {
  const [params] = useSearchParams();
  const arPage = params.get('ar') === '1';
  const names = splitTitle(detail.title);
  const category = detail.level2_category || detail.category || detail.level1_category || '未分類';
  const glb = modelFiles.find((file) => file.format === 'glb') ?? null;
  const [viewerOn, setViewerOn] = useState(false);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [glbError, setGlbError] = useState<string | null>(null);
  const [glbProgress, setGlbProgress] = useState('即將載入 3D');
  const [glbRatio, setGlbRatio] = useState<number | null>(0);
  const [glbReady, setGlbReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [stage, setStage] = useState<'3d' | 'image' | 'scene' | 'ar'>('3d');
  const [tool, setTool] = useState<ViewportTool>('rotate');
  const [wireframe, setWireframe] = useState(false);
  const [showMaterial, setShowMaterial] = useState(true);
  const [showSize, setShowSize] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [activeImage, setActiveImage] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [arOpen, setArOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [tab, setTab] = useState<'desc' | 'spec' | 'material' | 'scene' | 'docs' | 'quotes'>('desc');
  const [siblings, setSiblings] = useState<SearchProduct[]>([]);
  const [extra, setExtra] = useState<SearchProduct[]>([]);
  const [selected, setSelected] = useState<string[]>([detail.id]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [hideSame, setHideSame] = useState(false);
  const [flags, setFlags] = useState<ModelFlags>({});
  const [addQuery, setAddQuery] = useState('');
  const [addHits, setAddHits] = useState<SearchProduct[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected([detail.id]);
    setExtra([]);
    setActiveImage(0);
    setStage('3d');
    setViewerOn(false);
    setGlbUrl(null);
    setGlbReady(false);
    setGlbRatio(0);
    setGlbProgress('即將載入 3D');
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setViewerOn(true));
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [detail.id]);

  const glbPath = glb?.storage_path ?? null;
  const glbBytes = glb?.size_bytes ?? null;
  useEffect(() => {
    if (!viewerOn || !glbPath) {
      if (!glbPath) {
        setGlbUrl(null);
        setGlbError(null);
        setGlbReady(false);
      }
      return;
    }
    const storagePath = glbPath;
    const knownBytes = glbBytes;
    let cancelled = false;
    const objectUrls: string[] = [];
    const controller = new AbortController();
    setGlbUrl(null);
    setGlbReady(false);
    setGlbError(null);
    setGlbRatio(0);
    setGlbProgress('準備模型');
    (async () => {
      const signed = await signedModelUrl(storagePath);
      if (cancelled) return;
      setGlbProgress('下載模型');
      const response = await fetch(signed, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('模型下載失敗');
      const total = Number(response.headers.get('content-length')) || knownBytes || 0;
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.byteLength;
        if (!cancelled) setGlbRatio(total > 0 ? Math.min(0.98, loaded / total) : null);
      }
      if (cancelled) return;
      const blob = new Blob(parts, { type: 'model/gltf-binary' });
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      setGlbRatio(1);
      setGlbProgress('建立預覽');
      setGlbUrl(objectUrl);
    })().catch((err: unknown) => {
      if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
      setGlbError(err instanceof Error ? err.message : '無法開啟模型');
    });
    return () => {
      cancelled = true;
      controller.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [viewerOn, glbPath, glbBytes, retry]);

  useEffect(() => {
    const query = names.primary.trim();
    if (query.length < 2) {
      setSiblings([]);
      return;
    }
    let cancelled = false;
    const filters = {
      ...EMPTY_SEARCH_FILTERS,
      query,
      level1: detail.level1_category || '',
      level2: detail.level2_category || '',
    };
    searchProducts(filters, 0, 12)
      .then(async (first) => {
        const rows = first.items.filter((item) => item.id !== detail.id);
        if (rows.length > 0 || !detail.level2_category) return rows;
        const wider = await searchProducts({ ...filters, level1: '', level2: '' }, 0, 12);
        return wider.items.filter((item) => item.id !== detail.id);
      })
      .then((rows) => {
        if (!cancelled) setSiblings(rows.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setSiblings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id, detail.level1_category, detail.level2_category, names.primary]);

  useEffect(() => {
    if (!arOpen && stage !== 'ar') return;
    const link = `${window.location.origin}${window.location.pathname}?ar=1`;
    QRCode.toDataURL(link, { margin: 1, width: 280 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [arOpen, stage]);

  useEffect(() => {
    if (!compareOpen) return;
    let cancelled = false;
    fetchModelFlags(selected)
      .then((next) => {
        if (!cancelled) setFlags(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [compareOpen, selected]);

  const current = cardOf(detail);
  const cards = useMemo(() => {
    const seen = new Set<string>([detail.id]);
    const rest: Card[] = [];
    for (const item of [...extra, ...siblings]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rest.push(cardOf(item));
    }
    return [current, ...rest];
  }, [current, detail.id, extra, siblings]);

  const selectedCards = selected
    .map((id) => cards.find((card) => card.id === id))
    .filter((card): card is Card => card != null);

  const toggle = (id: string) => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((item) => item !== id);
      if (cur.length >= MAX_COMPARE) {
        toast(`最多比較 ${MAX_COMPARE} 款`);
        return cur;
      }
      return [...cur, id];
    });
  };

  const specRows: [string, string][] = [
    ['型號', shown(detail.model)],
    ['SKU', shown(detail.sku)],
    ['品牌', shown(detail.factory_name)],
    ['系列', shown(detail.level2_category || detail.category)],
    ['尺寸 (mm)', shown(sizeLabel(detail))],
    ['材質', shown(detail.material)],
    ['顏色', shown(detail.color ? multiColorToChineseDisplay(detail.color) : null)],
    ['現貨', detail.in_stock == null ? MISSING : detail.in_stock ? '是' : '否'],
  ];

  const chips = featureChips(detail, names.primary);
  const sizeText = sizeLabel(detail);
  const arLink = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}?ar=1`;

  if (arPage) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#f4f6fb] text-slate-900">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold">{detail.title}</p>
          <p className="mt-1 text-xs text-slate-500">
            這是設計參考預覽。沒有 USDZ，所以 iPhone 不會打開 Quick Look；Android 也不會跳到 Scene Viewer。
            定位和尺寸只供選型參考，不是 1:1 工程精度。
          </p>
        </div>
        <div className="relative min-h-0 flex-1">
          {glbUrl && !glbError ? (
            <GlbViewport
              url={glbUrl}
              tool="rotate"
              wireframe={false}
              showMaterial
              resetKey={0}
              onProgress={setGlbProgress}
              onReady={() => setGlbReady(true)}
              onFailed={setGlbError}
            />
          ) : (
            <ImageStage detail={detail} activeImage={0} onZoom={() => undefined} emptyLabel={glb && !glbError ? undefined : glbError || '暫無 3D 模型'} />
          )}
          {glb && !glbReady && !glbError && <ModelLoadBar ratio={glbRatio} label={glbProgress} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f4f6fb] text-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
          <button type="button" className="hover:text-slate-900" onClick={onClose}>產品模型</button>
          <span className="px-1.5">/</span>
          <span>{category}</span>
          <span className="px-1.5">/</span>
          <span className="text-slate-800">{names.primary}</span>
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-8 text-slate-600" onClick={onClose}>
          <ChevronLeft className="mr-1 h-4 w-4" /> 返回列表
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-slate-600"
          onClick={() => {
            const next = !loved;
            onToggleFavorite(next).catch(() => undefined);
          }}
        >
          <Heart className={cn('mr-1 h-3.5 w-3.5', loved && 'fill-rose-500 text-rose-500')} />
          {loved ? '已加入常用' : '加入常用'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-slate-600"
          onClick={() => {
            void navigator.clipboard.writeText(window.location.href).then(
              () => toast.success('已複製連結'),
              () => toast.error('複製失敗'),
            );
          }}
        >
          <Share2 className="mr-1 h-3.5 w-3.5" /> 分享
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {(
                [
                  ['3d', '3D 預覽'],
                  ['image', '圖片'],
                  ['scene', '場景'],
                  ['ar', 'AR 預覽'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    'rounded-full px-3 py-1 text-xs',
                    stage === id ? 'bg-[#5b4dff] text-white' : 'bg-slate-100 text-slate-600',
                  )}
                  onClick={() => setStage(id)}
                >
                  {label}
                </button>
              ))}
              <div className="ml-auto flex gap-1">
                {(
                  [
                    ['wire', '線框', wireframe],
                    ['material', '材質', showMaterial],
                    ['size', '尺寸', showSize],
                  ] as const
                ).map(([id, label, on]) => (
                  <button
                    key={id}
                    type="button"
                    className={cn('rounded-md px-2 py-1 text-xs', on ? 'bg-slate-900 text-white' : 'text-slate-500')}
                    onClick={() => {
                      if (id === 'wire') setWireframe((v) => !v);
                      if (id === 'material') setShowMaterial((v) => !v);
                      if (id === 'size') setShowSize((v) => !v);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div ref={stageRef} className="flex gap-3">
              <div className="flex max-h-[52vh] w-16 shrink-0 flex-col gap-2 overflow-y-auto">
                {detail.images.map((src, index) => (
                  <button
                    key={src}
                    type="button"
                    className={cn(
                      'h-14 w-14 overflow-hidden rounded-md border bg-slate-50',
                      index === activeImage ? 'border-[#5b4dff]' : 'border-slate-200',
                    )}
                    onClick={() => {
                      setActiveImage(index);
                      setStage('image');
                    }}
                  >
                    <LoadingImage src={productThumbUrl(src)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
              <div className="relative h-[52vh] min-h-[360px] min-w-0 flex-1 overflow-hidden rounded-lg bg-[#f7f8fb]">
                {stage === '3d' && glbUrl && !glbError && (
                  <GlbViewport
                    url={glbUrl}
                    tool={tool}
                    wireframe={wireframe}
                    showMaterial={showMaterial}
                    resetKey={resetKey}
                    onProgress={setGlbProgress}
                    onReady={() => setGlbReady(true)}
                    onFailed={setGlbError}
                  />
                )}
                {stage === '3d' && (!glb || glbError) && (
                  <ImageStage
                    detail={detail}
                    activeImage={activeImage}
                    onZoom={() => setZoomed(true)}
                    emptyLabel={glb ? '模型載入失敗' : '暫無 3D 模型'}
                  />
                )}
                {stage === '3d' && glb && !glbUrl && !glbError && (
                  <ImageStage detail={detail} activeImage={activeImage} onZoom={() => setZoomed(true)} />
                )}
                {stage === '3d' && glb && !glbReady && !glbError && <ModelLoadBar ratio={glbRatio} label={glbProgress} />}
                {stage === 'image' && (
                  <ImageStage detail={detail} activeImage={activeImage} onZoom={() => setZoomed(true)} />
                )}
                {stage === 'scene' && (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                    未提供場景圖
                  </div>
                )}
                {stage === 'ar' && <ArPanel title={detail.title} link={arLink} qr={qr} />}
                {glbError && stage === '3d' && (
                  <button
                    type="button"
                    className="absolute bottom-3 left-3 rounded-md bg-white px-2 py-1 text-xs text-[#5b4dff] shadow"
                    onClick={() => setRetry((n) => n + 1)}
                  >
                    重試
                  </button>
                )}
                {showSize && stage === '3d' && (
                  <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs text-slate-600 shadow">
                    {sizeText ? `${sizeText} mm` : MISSING} · 官方規格，不是模型量度
                  </p>
                )}
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded-md bg-white/90 p-1.5 text-slate-600 shadow"
                  aria-label="全螢幕"
                  onClick={() => void stageRef.current?.requestFullscreen?.()}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {(
                [
                  ['rotate', '旋轉', RotateCcw],
                  ['pan', '平移', Move],
                  ['zoom', '縮放', ZoomIn],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    'inline-flex items-center rounded-full px-3 py-1.5 text-xs',
                    tool === id ? 'bg-[#5b4dff] text-white' : 'bg-slate-100 text-slate-600',
                  )}
                  onClick={() => setTool(id)}
                >
                  <Icon className="mr-1 h-3.5 w-3.5" /> {label}
                </button>
              ))}
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600"
                onClick={() => setResetKey((n) => n + 1)}
              >
                重置視角
              </button>
            </div>
          </section>

          <aside className="rounded-xl border border-slate-200 bg-white p-4">
            <h1 className="text-xl font-semibold leading-snug">{names.primary}</h1>
            {names.secondary && <p className="mt-1 text-sm text-slate-500">{names.secondary}</p>}
            <dl className="mt-4 grid grid-cols-[5.5rem_1fr] gap-y-2 text-sm">
              {specRows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className={value === MISSING ? 'text-slate-400' : ''}>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">{actions(() => setArOpen(true))}</div>
            <p className="mt-3 text-xs text-slate-500">
              {glb
                ? `GLB · ${glb.source === 'generated' ? 'AI 生成' : '上載'} · ${bytesLabel(glb.size_bytes) ?? MISSING} · ${glb.created_at.slice(0, 16).replace('T', ' ')}`
                : '未提供 GLB。生成 3D 後才可以預覽和下載。'}
            </p>
          </aside>
        </div>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-4 border-b border-slate-100 text-sm">
              {(
                [
                  ['desc', '產品描述'],
                  ['spec', '技術規格'],
                  ['material', '材質與顏色'],
                  ['scene', '應用場景'],
                  ['docs', '相關文件'],
                  ...(quotes ? [['quotes', '供應商報價'] as const] : []),
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={cn('pb-2', tab === id ? 'border-b-2 border-[#5b4dff] text-[#5b4dff]' : 'text-slate-500')}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="pt-4 text-sm leading-6 text-slate-700">
              {tab === 'desc' && <p className="whitespace-pre-line">{shown(detail.description)}</p>}
              {tab === 'spec' && <p className="whitespace-pre-line">{shown(detail.specifications)}</p>}
              {tab === 'material' && (
                <p>
                  材質：{shown(detail.material)}
                  <br />
                  顏色：{shown(detail.color ? multiColorToChineseDisplay(detail.color) : null)}
                </p>
              )}
              {tab === 'scene' && <p className="text-slate-400">未提供場景說明</p>}
              {tab === 'docs' && documents}
              {tab === 'quotes' && quotes}
            </div>
            {chips.length > 0 && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {chips.map((chip) => (
                  <div key={chip.title} className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-sm font-medium">{chip.title}</p>
                    <p className="text-xs text-slate-500">{chip.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">同型號比較</h2>
              <span className="text-xs text-slate-500">已選 {selected.length}/{MAX_COMPARE}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">預設用產品名稱找同分類候選。系列不是由 SKU 前綴猜出來的。</p>
            <div className="mt-3 flex gap-2">
              <Input
                value={addQuery}
                placeholder="手動加入其他產品"
                className="h-8 border-slate-200 bg-white text-xs"
                onChange={(event) => setAddQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  const query = addQuery.trim();
                  if (query.length < 2) {
                    toast('請至少輸入兩個字');
                    return;
                  }
                  void searchProducts({ ...EMPTY_SEARCH_FILTERS, query }, 0, 6)
                    .then((res) => setAddHits(res.items.filter((item) => item.id !== detail.id)))
                    .catch((err: unknown) => toast.error('搜索失敗', { description: err instanceof Error ? err.message : '' }));
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={() => {
                  const query = addQuery.trim();
                  if (query.length < 2) {
                    toast('請至少輸入兩個字');
                    return;
                  }
                  void searchProducts({ ...EMPTY_SEARCH_FILTERS, query }, 0, 6)
                    .then((res) => setAddHits(res.items.filter((item) => item.id !== detail.id)))
                    .catch((err: unknown) => toast.error('搜索失敗', { description: err instanceof Error ? err.message : '' }));
                }}
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </div>
            {addHits.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {addHits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="text-left text-[#5b4dff] hover:underline"
                      onClick={() => {
                        setExtra((cur) => (cur.some((item) => item.id === hit.id) ? cur : [hit, ...cur]));
                        toggle(hit.id);
                        setAddHits([]);
                        setAddQuery('');
                      }}
                    >
                      {(hit.model || hit.sku || '未提供型號') + ' · ' + hit.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {cards.length <= 1 ? (
              <p className="mt-4 text-xs text-slate-400">沒有找到同名候選。可以用上方搜尋手動加入。</p>
            ) : (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {cards.map((card) => {
                  const on = selected.includes(card.id);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={cn(
                        'w-36 shrink-0 rounded-lg border p-2 text-left',
                        on ? 'border-[#5b4dff] bg-[#f5f4ff]' : 'border-slate-200',
                      )}
                      onClick={() => toggle(card.id)}
                    >
                      <div className="flex items-start justify-between">
                        <Checkbox checked={on} className="pointer-events-none" />
                      </div>
                      <div className="mt-1 h-16 overflow-hidden rounded bg-slate-50">
                        {card.image ? (
                          <LoadingImage src={productThumbUrl(card.image)} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <Package className="mx-auto mt-4 h-6 w-6 text-slate-300" />
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs font-medium">{card.model || card.sku || MISSING}</p>
                      <p className="truncate text-[11px] text-slate-500">{card.size ? `${card.size}` : MISSING}</p>
                      <p className="truncate text-[11px] text-slate-500">{shown(card.color)}</p>
                    </button>
                  );
                })}
              </div>
            )}
            <Button
              type="button"
              className="mt-3 h-8 w-full bg-[#5b4dff] hover:bg-[#4d40e6]"
              disabled={selected.length < 2}
              onClick={() => setCompareOpen(true)}
            >
              比較選中產品
            </Button>
          </section>
        </div>
      </div>

      <Dialog open={arOpen} onOpenChange={setArOpen}>
        <DialogContent className="bg-white text-slate-900">
          <DialogHeader>
            <DialogTitle>手機 AR 預覽</DialogTitle>
            <DialogDescription className="text-slate-500">
              {detail.title}。用手機掃描後打開同一件產品。這一版沒有 USDZ，iPhone 不會進 Quick Look，Android 也不會進 Scene Viewer，手機會看到可旋轉的 3D。尺寸只供設計參考。
            </DialogDescription>
          </DialogHeader>
          <ArPanel title={detail.title} link={arLink} qr={qr} />
        </DialogContent>
      </Dialog>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl bg-white text-slate-900">
          <DialogHeader>
            <DialogTitle>規格比較</DialogTitle>
            <DialogDescription className="text-slate-500">空值是未提供，不會當成 0。不同的欄位以淺色標出。</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Checkbox checked={hideSame} onCheckedChange={(value) => setHideSame(value === true)} />
            隱藏相同項目
          </label>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="sticky left-0 bg-white px-2 py-2 font-medium">項目</th>
                  {selectedCards.map((card, index) => (
                    <th key={card.id} className="min-w-36 px-2 py-2 font-medium">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{card.model || card.sku || MISSING}</span>
                        {index === 0 && <span className="text-[10px] text-[#5b4dff]">基準</span>}
                      </div>
                      <div className="mt-1 flex gap-2 font-normal text-[#5b4dff]">
                        {index > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelected((cur) => [card.id, ...cur.filter((id) => id !== card.id)])}
                          >
                            設為基準
                          </button>
                        )}
                        <button type="button" onClick={() => toggle(card.id)}>移除</button>
                        <button
                          type="button"
                          onClick={() => {
                            setCompareOpen(false);
                            if (card.id !== detail.id) onOpenProduct(card.id);
                          }}
                        >
                          查看
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_FIELDS.map((field) => {
                  const values = selectedCards.map((card) => field.value(card, flags));
                  const same = values.every((value) => value === values[0]);
                  if (hideSame && same) return null;
                  return (
                    <tr key={field.key} className="border-b border-slate-100">
                      <th className="sticky left-0 bg-white px-2 py-2 text-left font-normal text-slate-500">{field.label}</th>
                      {values.map((value, index) => (
                        <td key={selectedCards[index].id} className={cn('px-2 py-2', !same && 'bg-amber-50')}>
                          {value}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {zoomed && detail.images.length > 0
        ? createPortal(
            <ProductImageGalleryLightbox urls={detail.images} title={detail.title} startIndex={activeImage} onClose={() => setZoomed(false)} />,
            document.body,
          )
        : null}
    </div>
  );
}

function ModelLoadBar({ ratio, label }: { ratio: number | null; label: string }) {
  const percent = ratio == null ? null : Math.round(ratio * 100);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-end bg-[#f7f8fb]/55">
      <div className="w-full px-8 pb-8">
        <div className="mx-auto max-w-sm">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
            <span>{label}</span>
            <span>{percent == null ? '' : `${percent}%`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-label={label}>
            <div
              className={cn('h-full rounded-full bg-[#5b4dff] transition-[width] duration-150', percent == null && 'w-1/3 animate-pulse')}
              style={percent == null ? undefined : { width: `${Math.max(percent, 4)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageStage({
  detail,
  activeImage,
  onZoom,
  emptyLabel,
}: {
  detail: ProductDetail;
  activeImage: number;
  onZoom: () => void;
  emptyLabel?: string;
}) {
  const src = detail.images[activeImage];
  if (!src) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-sm text-slate-400">
        <ImageIcon className="mb-2 h-8 w-8" />
        {emptyLabel || '未提供圖片'}
      </div>
    );
  }
  return (
    <button type="button" className="relative h-full w-full" onClick={onZoom}>
      <LoadingImage src={src} alt={detail.title} hd className="h-full w-full object-contain" />
      {emptyLabel && (
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2 py-1 text-xs text-slate-600 shadow">{emptyLabel}</span>
      )}
    </button>
  );
}

function ArPanel({ title, link, qr }: { title: string; link: string; qr: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {qr ? <img src={qr} alt={`${title} 的 AR 連結`} className="h-44 w-44 rounded-md bg-white" /> : <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-slate-500">
        適用於手機瀏覽器裡的可旋轉預覽。沒有 USDZ，不相容 Quick Look。模型若未校準，不會標成 1:1。
      </p>
      <p className="max-w-sm break-all text-[11px] text-slate-400">{link}</p>
    </div>
  );
}

function featureChips(detail: ProductDetail, title: string): { title: string; detail: string }[] {
  const text = [title, detail.material, detail.description, detail.specifications].filter(Boolean).join(' ');
  const chips: { title: string; detail: string }[] = [];
  if (/現代|簡約/.test(text)) chips.push({ title: '簡約現代設計', detail: '以產品描述中的風格用詞整理' });
  if (/線盒|走線/.test(text)) chips.push({ title: '多功能線盒', detail: '產品名稱或描述提到走線' });
  const size = sizeLabel(detail);
  if (size) chips.push({ title: '外觀尺寸', detail: `${size} mm` });
  if (/E0|環保|低甲醛/.test(text)) chips.push({ title: '環保材質', detail: shown(detail.material) });
  return chips.slice(0, 4);
}
