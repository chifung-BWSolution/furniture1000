import { runPresentationQueue } from '@/lib/presentationQueue';
import { Progress } from '@/components/ui/progress';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpDown, ChevronUp, LoaderCircle, Pencil, Sparkles, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { LoadingImage } from '@/components/ui/loading-image';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { generateQuoteReferenceImage, quotePhotoErrorText, QUOTE_PHOTO_GENERATE_MODELS, type QuotePhotoGenerateModel } from '@/lib/quotePhotoLibrary';
import type { SearchProduct } from '@/lib/productSearch';
import { generatePresentationCopy, generatePresentationRoomCopy } from '@/lib/presentationCopy';
import { floorPlanZoneColor } from './FloorPlanZoneCanvas';
import { cn } from '@/lib/utils';
import {
  draftFor,
  imageLooksCutout,
  type PresentationProductDraft,
  type PresentationZoneDraft,
} from '@/lib/presentationOutlineModel';

const COMPANY_INTRO_MAX = 500;
const ROOM_NOTE_MAX = 300;
const inflightCopy = new Set<string>();

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ProductCopyModal({
  product,
  drafts,
  zones,
  productZone,
  sampleModel,
  disabled,
  sampling,
  onClose,
  onDraft,
  onZone,
  onSampleModel,
  onSelectImage,
}: {
  product: SearchProduct | null;
  drafts: Record<string, PresentationProductDraft>;
  zones: PresentationZoneDraft[];
  productZone: Record<string, string>;
  sampleModel: QuotePhotoGenerateModel;
  disabled: boolean;
  sampling: boolean;
  onClose: () => void;
  onDraft: (productId: string, patch: Partial<PresentationProductDraft>) => void;
  onZone: (productId: string, zoneId: string) => void;
  onSampleModel: (model: QuotePhotoGenerateModel) => void;
  onSelectImage: (productId: string, url: string) => void;
}) {
  const draft = product ? draftFor(product, drafts) : null;
  const images = product
    ? Array.from(new Set([product.image_url, ...(product.image_urls ?? [])].filter((url): url is string => Boolean(url && /^https?:\/\//i.test(url)))))
    : [];
  return (
    <Modal
      open={product !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      size="lg"
      title="編輯內容"
      description={draft?.displayName || product?.title || '未命名產品'}
      icon={<Pencil className="h-4 w-4" />}
    >
      {product && draft ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="展示名稱"><Input value={draft.displayName} disabled={disabled} onChange={(event) => onDraft(product.id, { displayName: event.target.value })} /></Field>
            <Field label="型號"><Input value={draft.model} disabled={disabled} onChange={(event) => onDraft(product.id, { model: event.target.value })} /></Field>
          </div>
          {images.length > 1 ? (
            <Field label="產品圖片">
              <Select value={draft.imageUrl} onValueChange={(url) => onSelectImage(product.id, url)} disabled={disabled || sampling}>
                <SelectTrigger><SelectValue placeholder="選擇產品圖片" /></SelectTrigger>
                <SelectContent>{images.map((url, index) => <SelectItem key={url} value={url}>圖片 {index + 1}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="描述"><Textarea className="min-h-20" value={draft.description} disabled={disabled} onChange={(event) => onDraft(product.id, { description: event.target.value })} /></Field>
          <Field label="賣點"><Textarea className="min-h-16" value={draft.sellingPoints} disabled={disabled} onChange={(event) => onDraft(product.id, { sellingPoints: event.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="市場價"><Input value={draft.marketPrice} disabled={disabled} onChange={(event) => onDraft(product.id, { marketPrice: event.target.value })} /></Field>
            <Field label="項目優惠價"><Input value={draft.projectPrice} disabled={disabled} onChange={(event) => onDraft(product.id, { projectPrice: event.target.value })} /></Field>
          </div>
          <Field label="所屬分區">
            <Select value={productZone[product.id] || ''} onValueChange={(value) => onZone(product.id, value)} disabled={disabled}>
              <SelectTrigger><SelectValue placeholder="選擇分區" /></SelectTrigger>
              <SelectContent>{zones.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name || '未命名分區'}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="示例圖模型">
            <Select value={sampleModel} onValueChange={(value) => onSampleModel(value as QuotePhotoGenerateModel)} disabled={disabled || sampling}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{QUOTE_PHOTO_GENERATE_MODELS.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {draft.sampleImageUrl ? <p className="text-xs text-muted-foreground">示例圖僅供參考，不會寫回產品原圖。</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}

export function PresentationOutlineStep({
  title,
  client,
  companyIntro,
  qualifications,
  services,
  includeFloor,
  floorReferenceUrl,
  onProcessing,
  zones,
  products,
  productZone,
  drafts,
  disabled: parentDisabled,
  onTitle,
  onClient,
  onCompanyIntro,
  onQualifications,
  onServices,
  onZoneName,
  onZonePatch,
  onReorder,
  onDraft,
  onZone,
  cases,
  onCase,
}: {
  title: string;
  client: string;
  companyIntro: string;
  qualifications: string;
  services: string;
  includeFloor: boolean;
  floorReferenceUrl?: string;
  onProcessing?: (delta: number) => void;
  zones: PresentationZoneDraft[];
  products: SearchProduct[];
  productZone: Record<string, string>;
  drafts: Record<string, PresentationProductDraft>;
  disabled: boolean;
  onTitle: (value: string) => void;
  onClient: (value: string) => void;
  onCompanyIntro: (value: string) => void;
  onQualifications: (value: string) => void;
  onServices: (value: string) => void;
  onZoneName: (id: string, name: string) => void;
  onZonePatch: (id: string, patch: Partial<PresentationZoneDraft>) => void;
  onReorder: (zones: PresentationZoneDraft[]) => void;
  onDraft: (productId: string, patch: Partial<PresentationProductDraft>) => void;
  onZone: (productId: string, zoneId: string) => void;
  cases: { id: string; title: string; body: string }[];
  onCase: (id: string, value: { title: string; body: string }) => void;
}) {
  const [samplingId, setSamplingId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<Record<string, 'running' | 'ready' | 'failed'>>({});
  const [activeId, setActiveId] = useState(zones[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [beautifyProgress, setBeautifyProgress] = useState({ done: 0, total: 1, label: '準備美化' });
  const styleAnchor = useRef<string | null>(null);
  const disabled = parentDisabled || batchRunning;
  const startedCopy = useRef(new Set<string>());
  const onDraftRef = useRef(onDraft);
  const draftsRef = useRef(drafts);
  onDraftRef.current = onDraft;
  draftsRef.current = drafts;
  const [sampleModel, setSampleModel] = useState<QuotePhotoGenerateModel>('gemini');
  const imageSelections = useRef<Record<string, string>>({});

  async function runCopy(product: SearchProduct, silent = false) {
    if (inflightCopy.has(product.id)) return;
    inflightCopy.add(product.id);
    setCopyState((current) => ({ ...current, [product.id]: 'running' }));
    try {
      onDraftRef.current(product.id, await generatePresentationCopy(product));
      setCopyState((current) => ({ ...current, [product.id]: 'ready' }));
    } catch (error) {
      setCopyState((current) => ({ ...current, [product.id]: 'failed' }));
      if (!silent) toast.error(error instanceof Error ? error.message : 'AI 初稿生成失敗', { id: `copy-${product.id}` });
    } finally {
      inflightCopy.delete(product.id);
    }
  }

  useEffect(() => {
    const queue: SearchProduct[] = [];
    for (const product of products) {
      const draft = draftFor(product, draftsRef.current);
      if (draft.description.trim() || draft.sellingPoints.trim()) {
        startedCopy.current.add(product.id);
        setCopyState((current) => current[product.id] === 'ready' ? current : { ...current, [product.id]: 'ready' });
        continue;
      }
      if (startedCopy.current.has(product.id)) continue;
      startedCopy.current.add(product.id);
      queue.push(product);
    }
    let index = 0;
    let running = 0;
    const pump = () => {
      while (running < 2 && index < queue.length) {
        const product = queue[index++];
        running += 1;
        void runCopy(product, true).finally(() => {
          running -= 1;
          pump();
        });
      }
    };
    pump();
  }, [products]);

  async function selectImage(productId: string, url: string) {
    imageSelections.current[productId] = url;
    onDraft(productId, { imageUrl: url, sampleImageUrl: '', noBackground: true });
    const cutout = await imageLooksCutout(url).catch(() => true);
    if (imageSelections.current[productId] === url) onDraft(productId, { noBackground: cutout });
  }

  async function generateSample(product: SearchProduct, silent = false): Promise<boolean> {
    const draft = draftFor(product, draftsRef.current);
    const reference = draft.imageUrl.trim();
    if (!reference) { if (!silent) toast.error('這件產品沒有可參考的圖片'); return false; }
    const zone = zones.find((item) => item.id === productZone[product.id]);
    const floor = zone?.imageUrl || floorReferenceUrl;
    const anchor = styleAnchor.current;
    setSamplingId(product.id);
    try {
      const asset = await generateQuoteReferenceImage({
        purpose: 'presentation_product', model: sampleModel, aspectRatio: '4:3',
        referenceUrls: [reference, floor, anchor].filter((url): url is string => Boolean(url)),
        prompt: `統一提案攝影風格：自然淺橡木地板、暖白牆面、柔和側窗日光、低飽和中性色、乾淨留白、真實室內攝影。固定相近視線高度與三分之四視角，產品完整入鏡，外觀材質顏色保持原樣。圖片不要加入文字、標語、水印或商標，文案由簡報文字欄呈現。${floor ? '第二張是分區平面圖，只參考房間、門窗和家具擺位。' : ''}${anchor ? '最後一張是全份簡報風格基準，統一地板、色溫、光線和攝影質感，不複製其他產品。' : ''} 分區：${zone?.name ?? ''}。產品：${draft.displayName} ${draft.model}。僅供提案參考。`,
      });
      if (draftFor(product, draftsRef.current).imageUrl !== draft.imageUrl) return false;
      onDraftRef.current(product.id, { sampleImageUrl: asset.url, noBackground: true });
      if (!styleAnchor.current) styleAnchor.current = asset.url;
      if (!silent) toast.success('已生成統一風格示例圖');
      return true;
    } catch (error) {
      if (!silent) toast.error('示例圖生成失敗', { description: quotePhotoErrorText(error) });
      return false;
    } finally { setSamplingId(null); }
  }

  async function correctAll() {
    if (batchRunning || samplingId || !active) return;
    const targetZone = active;
    const targetProducts = [...activeProducts];
    setBatchRunning(true);
    onProcessing?.(1);
    styleAnchor.current = null;
    const total = targetProducts.length * 2 + 1;
    let done = 0;
    let success = 0;
    setBeautifyProgress({ done, total, label: `準備美化房間：${targetZone.name}` });
    const step = (label: string) => setBeautifyProgress({ done, total, label });
    try {
      const updateCopy = async (product: SearchProduct) => {
        step(`更新產品文案：${product.title || '產品'}`);
        try {
          onDraftRef.current(product.id, await generatePresentationCopy(product));
          setCopyState(current => ({ ...current, [product.id]: 'ready' }));
          success++;
        } catch { /* Preserve existing copy. */ }
        finally { done++; step('正在美化當前房間的圖片與文案'); }
      };
      const updateRoom = async () => {
        try { onZonePatch(targetZone.id, await generatePresentationRoomCopy(targetZone.name, targetProducts)); success++; }
        catch { /* Preserve existing room copy. */ }
        finally { done++; step('正在美化當前房間的圖片與文案'); }
      };
      const updateImage = async (product: SearchProduct) => {
        step(`統一圖片風格：${product.title || '產品'}`);
        try { if (await generateSample(product, true)) success++; }
        finally { done++; step('正在美化當前房間的圖片與文案'); }
      };
      const updateImages = async () => {
        const remaining = [...targetProducts];
        // Establish a shared style reference before starting parallel images.
        while (remaining.length && !styleAnchor.current) await updateImage(remaining.shift()!);
        await runPresentationQueue(remaining, 2, updateImage);
      };
      await Promise.all([
        runPresentationQueue(targetProducts, 2, updateCopy),
        updateRoom(),
        updateImages(),
      ]);
      step('美化完成');
      toast.message('一鍵美化完成', { description: `成功 ${success}／${total} 項；失敗項目保留原內容。請檢查並儲存草稿。` });
    } finally { setBatchRunning(false); onProcessing?.(-1); }
  }

  const active = zones.find((zone) => zone.id === activeId) ?? zones[0];
  const activeProducts = active ? products.filter((product) => productZone[product.id] === active.id) : [];

  const dropZone = (targetId: string) => {
    if (!ordering || !dragId || dragId === targetId) return;
    const next = [...zones];
    const from = next.findIndex((zone) => zone.id === dragId);
    const to = next.findIndex((zone) => zone.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
    setDragId(null);
  };

  return (
    <div className="relative space-y-4" aria-busy={batchRunning}>
      {batchRunning ? (
        <div className="absolute inset-0 z-30 rounded-2xl bg-background/80 backdrop-blur-sm">
          <div className="sticky top-24 mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-lg" role="status" aria-live="polite">
            <div className="flex items-center gap-2 font-semibold"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />正在美化圖片與文案</div>
            <p className="text-sm text-muted-foreground">{beautifyProgress.label}</p>
            <Progress value={Math.round(beautifyProgress.done / Math.max(1, beautifyProgress.total) * 100)} aria-label="美化進度" />
            <p className="text-right text-xs tabular-nums text-muted-foreground">{beautifyProgress.done} / {beautifyProgress.total} 項 · {Math.round(beautifyProgress.done / Math.max(1, beautifyProgress.total) * 100)}%</p>
            <p className="text-xs text-muted-foreground">圖片生成需要一些時間，請保留此頁面。</p>
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-border dark:bg-card">
          <p className="text-sm font-semibold text-foreground">封面資訊</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="項目名稱">
              <Input className="h-10 rounded-lg bg-background" value={title} disabled={disabled} onChange={(event) => onTitle(event.target.value)} />
            </Field>
            <Field label="客戶">
              <Input className="h-10 rounded-lg bg-background" value={client} placeholder="請輸入客戶名稱" disabled={disabled} onChange={(event) => onClient(event.target.value)} />
            </Field>
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-border dark:bg-card">
          <p className="text-sm font-semibold text-foreground">公司介紹</p>
          <div className="relative mt-3">
            <Textarea
              className="min-h-28 rounded-lg bg-background pb-7"
              maxLength={COMPANY_INTRO_MAX}
              placeholder="請輸入公司介紹，這段內容將會出現在簡報的公司簡介頁面。"
              value={companyIntro}
              disabled={disabled}
              onChange={(event) => onCompanyIntro(event.target.value.slice(0, COMPANY_INTRO_MAX))}
            />
            <span className="pointer-events-none absolute bottom-2 right-3 text-xs tabular-nums text-muted-foreground">{companyIntro.length}/{COMPANY_INTRO_MAX}</span>
          </div>
          {qualifications.trim() || services.trim() ? (
            <div className="mt-3 space-y-3">
              {qualifications.trim() ? (
                <Field label="公司資質">
                  <Textarea className="min-h-20 rounded-lg bg-background" value={qualifications} disabled={disabled} onChange={(event) => onQualifications(event.target.value)} />
                </Field>
              ) : null}
              {services.trim() ? (
                <Field label="服務介紹">
                  <Textarea className="min-h-20 rounded-lg bg-background" value={services} disabled={disabled} onChange={(event) => onServices(event.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {includeFloor ? (
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-border dark:bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">項目平面圖（{zones.length} 個區域）</p>
              <p className="mt-0.5 text-xs text-muted-foreground">顯示區域將按順序生成簡報頁面，您可以在下方逐一檢視與修改。</p>
            </div>
            <Button type="button" variant="outline" className="h-8 bg-white text-xs dark:bg-background" aria-pressed={ordering} disabled={disabled || zones.length < 2} onClick={() => setOrdering((value) => !value)}>
              <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
              {ordering ? '完成排序' : '調整順序'}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                draggable={ordering && !disabled}
                onDragStart={() => setDragId(zone.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => { if (ordering) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); dropZone(zone.id); }}
                onClick={() => { setActiveId(zone.id); setCollapsed(false); }}
                className={cn(
                  'inline-flex h-8 items-center rounded-full px-3 text-xs font-medium',
                  active?.id === zone.id ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-foreground dark:border-border dark:bg-card',
                  ordering && 'cursor-grab',
                )}
              >
                {zone.name || '未命名分區'}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {active ? (
        <section className="rounded-2xl border border-slate-200/90 bg-white dark:border-border dark:bg-card">
          <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setCollapsed((value) => !value)}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-white" style={{ background: floorPlanZoneColor(Math.max(0, zones.findIndex((zone) => zone.id === active.id))) }}>{Math.max(1, zones.findIndex((zone) => zone.id === active.id) + 1)}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{active.name || '未命名分區'}</span>
            <span className="text-xs text-muted-foreground">已選 {activeProducts.length} 件產品</span>
            <ChevronUp className={cn('h-4 w-4 text-muted-foreground transition-transform', collapsed && 'rotate-180')} aria-hidden />
          </button>
          {!collapsed ? (
            <div className="space-y-4 border-t px-4 py-4">
              <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">對應平面圖區域</p>
                  {active.imageUrl ? (
                    <div className="relative mt-2">
                      <LoadingImage src={active.imageUrl} alt={`${active.name}平面圖`} className="h-40 w-full rounded-lg border bg-muted/20" imgClassName="object-contain" />
                      <Button type="button" variant="secondary" className="absolute bottom-2 left-1/2 h-8 -translate-x-1/2 bg-white/95 text-xs" onClick={() => setPreview({ url: active.imageUrl!, title: active.name || '平面圖' })}>
                        <ZoomIn className="h-3.5 w-3.5" aria-hidden />
                        放大查看
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 flex h-40 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">尚未有這個分區的截圖</p>
                  )}
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-semibold">房間設定</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="分區名稱">
                      <Input className="h-10 rounded-lg bg-background" value={active.name} disabled={disabled} onChange={(event) => onZoneName(active.id, event.target.value)} />
                    </Field>
                    <Field label="章節標題（顯示於首頁）">
                      <Input className="h-10 rounded-lg bg-background" value={active.chapterTitle ?? active.name} disabled={disabled} onChange={(event) => onZonePatch(active.id, { chapterTitle: event.target.value })} />
                    </Field>
                  </div>
                  <Field label="房間描述（選填）">
                    <div className="relative">
                      <Textarea
                        className="min-h-24 rounded-lg bg-background pb-7"
                        maxLength={ROOM_NOTE_MAX}
                        placeholder="請輸入此空間的設計重點、風格或功能說明。"
                        value={active.roomNote ?? ''}
                        disabled={disabled}
                        onChange={(event) => onZonePatch(active.id, { roomNote: event.target.value.slice(0, ROOM_NOTE_MAX) })}
                      />
                      <span className="pointer-events-none absolute bottom-2 right-3 text-xs tabular-nums text-muted-foreground">{(active.roomNote ?? '').length}/{ROOM_NOTE_MAX}</span>
                    </div>
                  </Field>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold">已選產品（{activeProducts.length}）</p>
                <Button type="button" variant="outline" disabled={disabled || samplingId !== null || !active} onClick={() => void correctAll()}>{batchRunning ? '正在美化圖片與文案…' : '一鍵美化當前房間'}</Button>
                <p className="text-xs text-muted-foreground">統一木色與柔和日光，參考所屬分區平面圖，保留產品外觀。</p>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {activeProducts.map((product) => {
                    const draft = draftFor(product, drafts);
                    const shown = draft.sampleImageUrl || draft.imageUrl;
                    const copy = copyState[product.id];
                    const copyReady = copy === 'ready' || Boolean(draft.description.trim() || draft.sellingPoints.trim());
                    const copyLabel = copy === 'running' ? '文案生成中' : copy === 'failed' && !copyReady ? '文案未生成' : copyReady ? '文案已生成' : '文案待生成';
                    return (
                      <div key={product.id} className="relative rounded-xl border border-slate-200 p-3 pt-8 dark:border-border">
                        <span className={cn(
                          'absolute right-3 top-2.5 inline-flex items-center gap-1 text-[11px] font-medium',
                          copy === 'running' ? 'text-indigo-600' : copy === 'failed' && !copyReady ? 'text-red-600' : copyReady ? 'text-emerald-600' : 'text-muted-foreground',
                        )}>
                          {copy === 'running' ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
                          {copyLabel}
                        </span>
                        <div className="flex gap-3">
                          {shown ? <LoadingImage src={shown} alt="" className="h-16 w-24 shrink-0 rounded-md bg-muted/20" imgClassName="object-contain" /> : <div className="h-16 w-24 shrink-0 rounded-md bg-muted/30" />}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{draft.displayName || product.title || '未命名產品'}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">型號　{draft.model || '—'}</p>
                            <p className="truncate text-xs text-muted-foreground">所屬分區　{active.name || '未命名分區'}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" variant="outline" className="h-8 bg-background px-2 text-xs" disabled={disabled} onClick={() => setEditingId(product.id)}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            編輯內容
                          </Button>
                          <Button type="button" variant="outline" className="h-8 bg-background px-2 text-xs" disabled={disabled || copy === 'running'} onClick={() => void runCopy(product)}>
                            {copy === 'running' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            AI 產生文稿
                          </Button>
                          <Button type="button" variant="outline" className="h-8 bg-background px-2 text-xs" disabled={disabled || samplingId !== null} onClick={() => void generateSample(product)}>
                            {samplingId === product.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                            修正圖片
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {products.some((product) => !zones.some((zone) => zone.id === productZone[product.id])) ? (
        <section className="space-y-3 rounded-xl border p-4">
          <p className="text-sm font-semibold">未分區</p>
          {products.filter((product) => !zones.some((zone) => zone.id === productZone[product.id])).map((product) => (
            <div key={product.id} className="space-y-2">
              <p className="text-sm">{draftFor(product, drafts).displayName || product.title || '未命名產品'}</p>
              <Select value="" onValueChange={(value) => onZone(product.id, value)} disabled={disabled || zones.length === 0}>
                <SelectTrigger><SelectValue placeholder="選擇分區" /></SelectTrigger>
                <SelectContent>{zones.map((zone) => <SelectItem key={zone.id} value={zone.id}>{zone.name || '未命名分區'}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          {zones.length === 0 ? <p className="text-sm text-destructive">請先返回第一步建立分區。</p> : null}
        </section>
      ) : null}

      {cases.map((item) => (
        <section key={item.id} className="space-y-3 rounded-xl border p-4">
          <p className="text-sm font-semibold">參考案例</p>
          <Field label="案例標題"><Input value={item.title} disabled={disabled} onChange={(event) => onCase(item.id, { title: event.target.value, body: item.body })} /></Field>
          <Field label="案例內容"><Textarea value={item.body} disabled={disabled} onChange={(event) => onCase(item.id, { title: item.title, body: event.target.value })} /></Field>
        </section>
      ))}
      <ProductCopyModal
        product={products.find((item) => item.id === editingId) ?? null}
        drafts={drafts}
        zones={zones}
        productZone={productZone}
        sampleModel={sampleModel}
        disabled={disabled}
        sampling={samplingId !== null}
        onClose={() => setEditingId(null)}
        onDraft={onDraft}
        onZone={onZone}
        onSampleModel={setSampleModel}
        onSelectImage={(productId, url) => void selectImage(productId, url)}
      />
      <ImageLightbox
        open={preview !== null}
        onClose={() => setPreview(null)}
        images={preview ? [preview.url] : []}
        title={preview?.title}
        simple
        thumbWidth={320}
      />
    </div>
  );
}
