import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Crop,
  ImagePlus,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  QUOTE_PHOTO_ACCEPT,
  QUOTE_PHOTO_LIBRARY_LIMIT,
  quotePhotoErrorText,
  quotePhotoObjectUrl,
  quotePhotoShortTitle,
  uploadQuotePhotoAsset,
  type QuotePhotoAsset,
  type QuotePhotoRef,
} from '@/lib/quotePhotoLibrary';
import { QuotePhotoGenerateDialog, type GenerateChoice } from '@/components/dashboard/QuotePhotoGenerateDialog';
import {
  AI_REFERENCE_LABEL,
  CAPTION_MAX,
  GRID_MIN_PHOTOS,
  MAX_LAYOUT_GROUPS,
  MAX_LAYOUT_PHOTOS,
  PDF_CONTENT_WIDTH_MM,
  PHOTO_RATIOS,
  PHOTO_RATIO_LABELS,
  PHOTO_TEMPLATES,
  countPlacements,
  defaultPlacement,
  groupGeometry,
  imageRect,
  ratioValue,
  slotIdsFor,
  switchTemplate,
  templateById,
  templateGeometry,
  type PhotoLayoutGroup,
  type PhotoPlacement,
  type PhotoRatio,
  type PhotoSlotRect,
  type PhotoTemplateId,
} from '@/lib/quotePhotoLayouts';
import { PhotoLayoutBlock, PhotoLayoutCaption, type LayoutPhotoSource } from '@/components/dashboard/QuotePhotoLayoutView';

/**
 * 報價單圖片排版（照 QMS 的 QuotePhotoLayoutEditor 一比一移植）。
 *
 * 左：預設佈局（21 個模板，可按張數篩選）；中：排版畫布（拖放對調、點擊裁剪）；
 * 右：圖片素材（拖入上載、從圖片庫加入）。按「套用到報價單」才回寫。
 */

/** 矮模板共用一個縮圖盒，頁面級模板保留自己的比例。 */
const PRESET_THUMB_ASPECT = `${PDF_CONTENT_WIDTH_MM} / ${Math.max(
  ...PHOTO_TEMPLATES.map((template) => templateGeometry(template.id, 6).heightMm).filter((height) => height <= 130),
)}`;
const LOW_RES_PX = 1000;
const DRAG_TYPE = 'application/x-fds-photo';

type DragPayload = { kind: 'asset'; assetId: string } | { kind: 'slot'; slotId: string };
type NaturalSize = { w: number; h: number };
type CountFilter = 'all' | '1' | '2' | '3' | '4+';

const COUNT_FILTERS: Array<{ id: CountFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: '1', label: '1 張' },
  { id: '2', label: '2 張' },
  { id: '3', label: '3 張' },
  { id: '4+', label: '4 張以上' },
];

function matchesCount(count: number, filter: CountFilter) {
  if (filter === 'all') return true;
  if (filter === '4+') return count >= 4;
  return count === Number(filter);
}

function nearestRatio(size: NaturalSize | undefined) {
  if (!size) return null;
  const value = size.w / size.h;
  return PHOTO_RATIOS.reduce((best, ratio) =>
    Math.abs(ratioValue(ratio) - value) < Math.abs(ratioValue(best) - value) ? ratio : best,
  );
}

function readDrag(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

export function PhotoConfirmButton({
  title,
  description,
  confirmLabel = '確定',
  onConfirm,
  disabled,
  className,
  ariaLabel,
  children,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" className={className} aria-label={ariaLabel} disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words leading-6">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words leading-6">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TemplateThumb({ templateId, samples }: { templateId: PhotoTemplateId; samples: string[] }) {
  const geometry = templateGeometry(templateId, 6);
  const slots = geometry.slots;
  const aspect = geometry.heightMm > 130 ? `${PDF_CONTENT_WIDTH_MM} / ${geometry.heightMm}` : PRESET_THUMB_ASPECT;
  return (
    <div className="flex w-full items-center" style={{ aspectRatio: aspect }}>
      <PhotoLayoutBlock
        geometry={geometry}
        placements={[]}
        photoFor={() => undefined}
        className="w-full overflow-hidden rounded-md"
        renderSlot={(slot) => {
          const index = Math.max(0, slots.findIndex((entry) => entry.id === slot.id));
          const src = samples[index % (samples.length || 1)];
          return src ? (
            <LoadingImage src={src} alt="" className="absolute inset-0 h-full w-full" />
          ) : (
            <span className="absolute inset-0 block bg-gradient-to-br from-muted via-muted/70 to-muted-foreground/20" />
          );
        }}
        textFor={() => (
          <div className="flex h-full flex-col justify-center gap-1.5 px-1">
            <span className="h-1.5 w-3/4 rounded bg-foreground/20" />
            <span className="h-1.5 w-full rounded bg-foreground/10" />
            <span className="h-1.5 w-2/3 rounded bg-foreground/10" />
          </div>
        )}
      />
    </div>
  );
}

function useStageWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** 單一槽位的裁剪對話框；只有按已放圖片才會開。 */
function CropDialog({
  slot,
  blockHeightMm,
  placement,
  photo,
  caption,
  onApply,
  onCancel,
}: {
  slot: PhotoSlotRect;
  blockHeightMm: number;
  placement: PhotoPlacement;
  photo: LayoutPhotoSource;
  caption: 'shown' | 'hidden' | null;
  onApply: (next: PhotoPlacement) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(placement);
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const { ref, width: stageWidth } = useStageWidth();
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const stageHeight = 340;
  const cover = draft.fitMode === 'cover';

  useEffect(() => {
    const image = new Image();
    image.onload = () => setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    image.src = photo.previewUrl;
  }, [photo.previewUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const slotAspect = (slot.w * PDF_CONTENT_WIDTH_MM) / (slot.h * blockHeightMm);
  const aspect = cover ? ratioValue(draft.ratio) : slotAspect;
  const margin = 32;
  const frameW = Math.max(40, Math.min(stageWidth - margin * 2, (stageHeight - margin * 2) * aspect));
  const frameH = frameW / aspect;
  const frameX = (stageWidth - frameW) / 2;
  const frameY = (stageHeight - frameH) / 2;
  const base = natural ? Math.max(frameW / natural.w, frameH / natural.h) : 1;
  const imageW = natural ? natural.w * base * draft.scale : frameW;
  const imageH = natural ? natural.h * base * draft.scale : frameH;
  const imageLeft = draft.offsetX * (frameW - imageW);
  const imageTop = draft.offsetY * (frameH - imageH);
  const hidden = cover && natural ? Math.abs(natural.w / natural.h - aspect) > 0.01 || draft.scale > 1 : false;
  const lowRes = natural ? Math.max(natural.w, natural.h) < LOW_RES_PX : false;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!cover || showOriginal) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, offsetX: draft.offsetX, offsetY: draft.offsetY };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    const spanX = frameW - imageW;
    const spanY = frameH - imageH;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    setDraft((current) => ({
      ...current,
      offsetX: spanX < -0.5 ? clamp(start.offsetX + (event.clientX - start.x) / spanX) : current.offsetX,
      offsetY: spanY < -0.5 ? clamp(start.offsetY + (event.clientY - start.y) / spanY) : current.offsetY,
    }));
  }

  function setScale(next: number) {
    setDraft((current) => ({ ...current, scale: Math.min(3, Math.max(1, Math.round(next * 100) / 100)) }));
  }

  const imageBox = { left: imageLeft, top: imageTop, width: imageW, height: imageH };

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title="裁剪圖片"
      description={photo.title}
      size="3xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft({ ...draft, ratio: slot.ratio, fitMode: 'contain', scale: 1, offsetX: 0.5, offsetY: 0.5 })}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              重設
            </Button>
            <Button type="button" variant="outline" aria-pressed={showOriginal} onClick={() => setShowOriginal((value) => !value)}>
              {showOriginal ? '返回裁剪' : '原圖對照'}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button type="button" onClick={() => onApply(draft)}>
              套用裁剪
            </Button>
          </div>
        </div>
      }
    >
      <div>
            <div
              ref={ref}
              className={`relative w-full touch-none select-none overflow-hidden rounded-xl bg-slate-900 ${
                cover && !showOriginal ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
              style={{ height: stageHeight }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              {stageWidth > 0 && showOriginal ? (
                <img src={photo.previewUrl} alt={photo.title} draggable={false} className="absolute inset-0 h-full w-full object-contain" />
              ) : null}
              {stageWidth > 0 && !showOriginal && cover ? (
                <>
                  <img
                    src={photo.previewUrl}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="absolute max-w-none opacity-35"
                    style={{ ...imageBox, left: frameX + imageLeft, top: frameY + imageTop }}
                  />
                  <div
                    className="absolute overflow-hidden ring-2 ring-white"
                    style={{ left: frameX, top: frameY, width: frameW, height: frameH }}
                  >
                    <img src={photo.previewUrl} alt={photo.title} draggable={false} className="absolute max-w-none" style={imageBox} />
                  </div>
                </>
              ) : null}
              {stageWidth > 0 && !showOriginal && !cover ? (
                <div
                  className="absolute bg-slate-50 ring-2 ring-white"
                  style={{ left: frameX, top: frameY, width: frameW, height: frameH }}
                >
                  <img src={photo.previewUrl} alt={photo.title} draggable={false} className="h-full w-full object-contain" />
                </div>
              ) : null}
              <span className="absolute left-3 top-3 rounded-md bg-slate-950/70 px-2 py-1 text-xs font-semibold text-white">
                {showOriginal ? '原圖' : cover ? `裁剪 ${draft.ratio}・拖動調整位置` : '完整顯示'}
              </span>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">顯示方式</p>
                <div className="mt-1.5 inline-flex rounded-xl border border-border bg-muted/40 p-1">
                  {(['contain', 'cover'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={draft.fitMode === mode}
                      onClick={() => setDraft((current) => ({ ...current, fitMode: mode }))}
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                        draft.fitMode === mode ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'
                      }`}
                    >
                      {mode === 'contain' ? '完整顯示' : '裁滿'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">裁剪比例</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {PHOTO_RATIOS.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      disabled={!cover}
                      aria-pressed={draft.ratio === ratio}
                      title={PHOTO_RATIO_LABELS[ratio]}
                      onClick={() => setDraft((current) => ({ ...current, ratio, offsetX: 0.5, offsetY: 0.5 }))}
                      className={`rounded-lg border px-2.5 py-1 text-sm font-semibold disabled:opacity-40 ${
                        draft.ratio === ratio ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground/80'
                      }`}
                    >
                      {ratio}
                      {ratio === slot.ratio ? <span className="ml-1 text-xs font-normal text-muted-foreground">建議</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold text-muted-foreground">縮放</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="縮小"
                    disabled={!cover || draft.scale <= 1}
                    onClick={() => setScale(draft.scale - 0.1)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <input
                    type="range"
                    min={100}
                    max={300}
                    step={5}
                    value={Math.round(draft.scale * 100)}
                    disabled={!cover}
                    aria-label="縮放比例"
                    onChange={(event) => setScale(Number(event.target.value) / 100)}
                    className="h-2 min-w-0 flex-1 accent-primary"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="放大"
                    disabled={!cover || draft.scale >= 3}
                    onClick={() => setScale(draft.scale + 0.1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <span className="w-12 text-right text-sm font-semibold tabular-nums text-foreground">
                    {Math.round(draft.scale * 100)}%
                  </span>
                </div>
              </div>
            </div>
            {caption ? (
              <label className="mt-4 block text-xs font-semibold text-muted-foreground">
                圖片說明
                <input
                  value={draft.caption ?? ''}
                  maxLength={CAPTION_MAX}
                  placeholder="例如：大堂入口現況"
                  onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground"
                />
                <span className="mt-1 block font-normal text-muted-foreground/80">
                  {caption === 'shown'
                    ? `印在圖片下方，最多 ${CAPTION_MAX} 字。`
                    : '這一組未開啟「顯示圖片說明」，開啟後才會印出。'}
                </span>
              </label>
            ) : null}
            <div className="mt-3 space-y-1">
              {hidden ? <p className="text-xs text-amber-700">超出框外的部分不會印在報價單上。</p> : null}
              {lowRes ? (
                <p className="text-xs text-amber-700">
                  這張圖不夠清晰（{natural?.w}×{natural?.h}），印出來可能會糊。
                </p>
              ) : null}
              {!cover ? <p className="text-xs text-muted-foreground">完整顯示會保留整張圖片，空白的地方不會裁掉內容。</p> : null}
            </div>
      </div>
    </Modal>
  );
}

export function QuotePhotoLayoutEditor({
  layouts,
  groupId,
  assets,
  productPhotos = [],
  photos,
  canManage,
  onUploaded,
  onSave,
  onClose,
}: {
  /** 現有全部佈局（存檔時用它拼回完整清單）。 */
  layouts: PhotoLayoutGroup[];
  /** null＝新增一組，排在最後。 */
  groupId: string | null;
  /** 圖片庫（上載後由 onUploaded 通知上層更新快取）。 */
  assets: QuotePhotoAsset[];
  /** 報價明細的產品圖：預設就放進素材區，不用每次去圖片庫找。 */
  productPhotos?: { id: string; title: string; url: string }[];
  /** 這張報價已選的圖片，用來餵素材區。 */
  photos: QuotePhotoRef[];
  canManage: boolean;
  onUploaded?: (asset: QuotePhotoAsset) => void;
  onSave: (groups: PhotoLayoutGroup[], usedAssets: QuotePhotoAsset[]) => void;
  onClose: () => void;
}) {
  const existing = groupId ? layouts.find((group) => group.id === groupId) : undefined;
  const [initial] = useState<PhotoLayoutGroup | null>(existing ?? null);
  const [group, setGroup] = useState<PhotoLayoutGroup>(
    () => existing ?? { id: crypto.randomUUID(), templateId: 'L03', placements: [] },
  );
  const [chosen, setChosen] = useState(Boolean(existing));
  const [library, setLibrary] = useState<QuotePhotoAsset[]>(assets);
  const [tray, setTray] = useState<string[]>(() => {
    // 產品圖排最前：新開排版時直接可以拖進槽位。
    const ids = productPhotos.map((photo) => photo.id);
    for (const photo of photos) if (!ids.includes(photo.assetId)) ids.push(photo.assetId);
    for (const placement of existing?.placements ?? []) if (!ids.includes(placement.assetId)) ids.push(placement.assetId);
    return ids;
  });
  const [filter, setFilter] = useState<CountFilter>('all');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [cropSlot, setCropSlot] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{ slotId: string; assetId: string } | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'empty' | null>(null);
  const [uploading, setUploading] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryPicked, setLibraryPicked] = useState<string[]>([]);
  const [trayDrop, setTrayDrop] = useState(false);
  const [sizes, setSizes] = useState<Record<string, NaturalSize>>({});
  const [generateOpen, setGenerateOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sources = useMemo(() => {
    const map = new Map<
      string,
      LayoutPhotoSource & { asset?: QuotePhotoAsset; product?: boolean; generated?: boolean }
    >();
    for (const photo of productPhotos) {
      if (photo.url) map.set(photo.id, { title: photo.title || '產品圖', previewUrl: photo.url, product: true });
    }
    for (const photo of photos) {
      if (!photo.assetId) continue;
      const url = quotePhotoObjectUrl(photo.objectPath);
      if (url) map.set(photo.assetId, { title: photo.title || '圖片', previewUrl: url });
    }
    for (const asset of library) {
      map.set(asset.id, {
        ...asset,
        title: asset.title || '圖片',
        previewUrl: asset.url,
        generated: asset.isGenerated,
      });
    }
    return map;
  }, [library, photos, productPhotos]);
  const photoFor = (assetId: string) => sources.get(assetId);

  const geometry = groupGeometry(group);
  const slotIds = slotIdsFor(group);
  const placementAt = (slotId: string) => group.placements.find((placement) => placement.slotId === slotId);
  const placedIds = new Set(group.placements.map((placement) => placement.assetId));
  const othersCount = countPlacements(layouts.filter((entry) => entry.id !== group.id));
  const emptySlots = slotIds.filter((slotId) => !placementAt(slotId)).length;
  const dirty = JSON.stringify(group) !== JSON.stringify(initial);
  const selectedPlacement = selectedSlot ? placementAt(selectedSlot) : undefined;
  const trayIds = useMemo(() => {
    const ids = [...tray];
    for (const placement of group.placements) if (!ids.includes(placement.assetId)) ids.push(placement.assetId);
    return ids.filter((id) => sources.has(id));
  }, [tray, group.placements, sources]);

  function requestClose() {
    if (cropSlot || pendingReplace || confirm) return;
    if (dirty) setConfirm('close');
    else onClose();
  }

  function chooseTemplate(templateId: PhotoTemplateId) {
    if (!chosen) {
      // 第一次選佈局：把素材區（產品圖優先）直接填入未用的槽位。
      const gridSlots = templateId === 'L12' ? 6 : undefined;
      const slots = templateGeometry(templateId, gridSlots).slots;
      const queue = trayIds.slice(0, Math.max(0, MAX_LAYOUT_PHOTOS - othersCount));
      const placements = slots.slice(0, queue.length).map((slot, index) => defaultPlacement(slot, queue[index]));
      setGroup((current) => ({ ...current, templateId, gridSlots, placements }));
      setChosen(true);
      if (placements.length > 0) toast.success(`已放入 ${placements.length} 張圖片，可拖動調整。`);
      return;
    }
    if (templateId === group.templateId) return;
    const { group: next, displaced } = switchTemplate(group, templateId);
    setGroup(next);
    setSelectedSlot(null);
    if (displaced.length > 0) toast.info(`${displaced.length} 張圖片放不下新佈局，已留在素材區。`);
  }

  function place(slotId: string, assetId: string) {
    const slot = geometry.slots.find((entry) => entry.id === slotId);
    if (!slot) return;
    const occupied = placementAt(slotId);
    if (!occupied && othersCount + group.placements.length >= MAX_LAYOUT_PHOTOS) {
      toast.error(`一張報價最多 ${MAX_LAYOUT_PHOTOS} 張圖片`);
      return;
    }
    setGroup((current) => ({
      ...current,
      placements: [...current.placements.filter((entry) => entry.slotId !== slotId), defaultPlacement(slot, assetId)],
    }));
    setSelectedSlot(slotId);
  }

  function requestPlace(slotId: string, assetId: string) {
    if (!chosen) {
      toast.info('請先選擇一個佈局。');
      return;
    }
    const occupied = placementAt(slotId);
    if (occupied?.assetId === assetId) return;
    if (occupied) setPendingReplace({ slotId, assetId });
    else place(slotId, assetId);
  }

  function placeIntoNext(assetId: string) {
    const target = selectedSlot && !placementAt(selectedSlot) ? selectedSlot : slotIds.find((slotId) => !placementAt(slotId));
    if (target) requestPlace(target, assetId);
    else if (selectedSlot) requestPlace(selectedSlot, assetId);
    else toast.info('每個位置都已有圖片。請先在畫布點選要換掉的那一格。');
  }

  function swap(from: string, to: string) {
    if (from === to) return;
    const a = placementAt(from);
    if (!a) return;
    const b = placementAt(to);
    const slotFor = (id: string) => geometry.slots.find((slot) => slot.id === id)!;
    const moved = (placement: PhotoPlacement, slotId: string): PhotoPlacement => {
      const slot = slotFor(slotId);
      return placement.ratio === slot.ratio
        ? { ...placement, slotId }
        : { ...defaultPlacement(slot, placement.assetId), title: placement.title, caption: placement.caption };
    };
    setGroup((current) => ({
      ...current,
      placements: [
        ...current.placements.filter((entry) => entry.slotId !== from && entry.slotId !== to),
        moved(a, to),
        ...(b ? [moved(b, from)] : []),
      ],
    }));
    setSelectedSlot(to);
  }

  function updatePlacement(slotId: string, patch: Partial<PhotoPlacement>) {
    setGroup((current) => ({
      ...current,
      placements: current.placements.map((entry) => (entry.slotId === slotId ? { ...entry, ...patch } : entry)),
    }));
  }

  function setRatio(ratio: PhotoRatio | 'contain') {
    if (!selectedSlot || !selectedPlacement) return;
    if (ratio === 'contain') updatePlacement(selectedSlot, { fitMode: 'contain', scale: 1, offsetX: 0.5, offsetY: 0.5 });
    else updatePlacement(selectedSlot, { fitMode: 'cover', ratio, scale: 1, offsetX: 0.5, offsetY: 0.5 });
  }

  function setGridSlots(count: number) {
    setGroup((current) => {
      const ordered = slotIdsFor(current)
        .map((slotId) => current.placements.find((entry) => entry.slotId === slotId))
        .filter((entry): entry is PhotoPlacement => Boolean(entry));
      const slots = templateGeometry('L12', count).slots;
      return {
        ...current,
        gridSlots: count,
        placements: ordered.slice(0, count).map((entry, index) => ({ ...entry, slotId: slots[index].id })),
      };
    });
  }

  /** 新加入的圖片：先進素材區，已選佈局就順手填未用的槽位。 */
  function fillIntoSlots(added: string[]) {
    if (added.length === 0) return;
    setTray((current) => [...current, ...added.filter((id) => !current.includes(id))]);
    if (!chosen) return;
    setGroup((current) => {
      const slots = templateGeometry(current.templateId, current.gridSlots).slots;
      let room = MAX_LAYOUT_PHOTOS - othersCount - current.placements.length;
      const placements = [...current.placements];
      const queue = [...added];
      for (const slot of slots) {
        if (room <= 0 || queue.length === 0) break;
        if (placements.some((entry) => entry.slotId === slot.id)) continue;
        placements.push(defaultPlacement(slot, queue.shift()!));
        room -= 1;
      }
      return { ...current, placements };
    });
  }

  async function upload(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (!canManage) {
      toast.error(quotePhotoErrorText(new Error('quote_photo_permission_denied')));
      return;
    }
    setUploading(files.length);
    const added: string[] = [];
    for (const file of files) {
      if (library.length + added.length >= QUOTE_PHOTO_LIBRARY_LIMIT) {
        toast.error(quotePhotoErrorText(new Error('quote_photo_library_limit')));
        break;
      }
      try {
        const asset = await uploadQuotePhotoAsset(file);
        added.push(asset.id);
        setLibrary((current) => [...current, asset]);
        onUploaded?.(asset);
      } catch (error) {
        toast.error(`${file.name}：${quotePhotoErrorText(error)}`);
      } finally {
        setUploading((count) => Math.max(0, count - 1));
      }
    }
    setUploading(0);
    if (added.length === 0) return;
    // 上載後即時放入素材區；已有佈局就順手填空槽。
    fillIntoSlots(added);
    toast.success(`已上載 ${added.length} 張圖片`);
  }

  /** 參考圖片候選：只限報價明細帶來的產品圖，AI 按產品圖把產品放進場景。 */
  const generateChoices = useMemo<GenerateChoice[]>(
    () =>
      productPhotos.flatMap((photo) => {
        const url = (photo.url || '').trim();
        return url ? [{ id: photo.id, title: photo.title || '產品圖', previewUrl: url, referenceUrl: url }] : [];
      }),
    [productPhotos],
  );

  /** AI 生成完成：加入素材區，已選佈局就順手填空槽。 */
  function onGenerated(asset: QuotePhotoAsset) {
    setLibrary((current) => (current.some((row) => row.id === asset.id) ? current : [...current, asset]));
    onUploaded?.(asset);
    fillIntoSlots([asset.id]);
  }

  function apply() {
    setConfirm(null);
    if (group.placements.length === 0) {
      if (!existing) {
        toast.error('請最少放入一張圖片才套用。');
        return;
      }
      onSave(layouts.filter((entry) => entry.id !== group.id), []);
      return;
    }
    const groups = existing ? layouts.map((entry) => (entry.id === group.id ? group : entry)) : [...layouts, group];
    const used = new Set(group.placements.map((placement) => placement.assetId));
    onSave(
      groups,
      library.filter((asset) => used.has(asset.id)),
    );
  }

  function onApplyClick() {
    if (group.placements.length === 0) {
      apply();
      return;
    }
    if (emptySlots > 0) setConfirm('empty');
    else apply();
  }

  const cropTarget = cropSlot ? geometry.slots.find((slot) => slot.id === cropSlot) : undefined;
  const cropPlacement = cropSlot ? placementAt(cropSlot) : undefined;
  const cropPhoto = cropPlacement ? photoFor(cropPlacement.assetId) : undefined;

  const renderCanvasSlot = (slot: PhotoSlotRect, placement: PhotoPlacement | undefined, content: ReactNode) => {
    const index = slotIds.indexOf(slot.id) + 1;
    const selected = selectedSlot === slot.id;
    const photo = placement ? photoFor(placement.assetId) : undefined;
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={placement ? `位置 ${index}：${photo?.title ?? '圖片'}，按一下可裁剪` : `位置 ${index}：還沒有圖片，按一下可選取`}
        draggable={Boolean(placement)}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: 'slot', slotId: slot.id } satisfies DragPayload));
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
          event.preventDefault();
          setDropSlot(slot.id);
        }}
        onDragLeave={() => setDropSlot((current) => (current === slot.id ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          setDropSlot(null);
          const payload = readDrag(event);
          if (payload?.kind === 'slot') swap(payload.slotId, slot.id);
          if (payload?.kind === 'asset') requestPlace(slot.id, payload.assetId);
        }}
        onClick={() => {
          setSelectedSlot(slot.id);
          if (placement) setCropSlot(slot.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          setSelectedSlot(slot.id);
          if (placement) setCropSlot(slot.id);
        }}
        className={`group absolute inset-0 outline-none ${placement ? 'cursor-pointer' : 'cursor-default'} ${
          selected ? 'ring-2 ring-primary ring-offset-1' : ''
        } ${dropSlot === slot.id ? 'ring-2 ring-amber-500' : ''} focus-visible:ring-2 focus-visible:ring-primary`}
      >
        {content ?? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 border-2 border-dashed border-border bg-muted/40 p-1 text-center text-xs text-muted-foreground">
            <ImagePlus className="h-4 w-4" aria-hidden />
            <span>拖入照片</span>
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 text-xs font-semibold text-white">{index}</span>
        {placement ? (
          <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-card/90 px-1.5 py-0.5 text-xs font-semibold text-foreground opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Crop className="h-3 w-3" aria-hidden />
            {placement.fitMode === 'cover' ? placement.ratio : '完整'}
          </span>
        ) : null}
        {placement ? (
          <span
            className="absolute right-1 top-1"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <PhotoConfirmButton
              className="h-7 w-7 rounded-md bg-card/95 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              ariaLabel={`移出位置 ${index}`}
              title="移出這個位置"
              confirmLabel="移出"
              description={`把「${quotePhotoShortTitle(photo?.title ?? '圖片')}」從位置 ${index} 移出。圖片會留在旁邊的素材區，按「套用到報價單」後才會更新。`}
              onConfirm={() => {
                setGroup((current) => ({
                  ...current,
                  placements: current.placements.filter((entry) => entry.slotId !== slot.id),
                }));
              }}
            >
              <X className="h-3.5 w-3.5" />
            </PhotoConfirmButton>
          </span>
        ) : null}
      </div>
    );
  };

  const libraryChoices = library.filter((asset) => !trayIds.includes(asset.id));
  const samples = library.slice(0, 3).map((asset) => asset.url);

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      variant="fullscreen"
      title="報價單圖片排版"
      description="先選佈局，再放入圖片並按需要裁剪，最後套用到報價單。"
      /* fullscreen 預設是透明底白字（給燈箱用）；排版編輯器要正常白色頁面。 */
      className="bg-background text-foreground"
      headerClassName="border-b border-border/80 bg-background text-foreground"
      bodyClassName="p-0 sm:p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-muted/30 p-4 lg:overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">這張圖怎樣顯示</span>
            <button
              type="button"
              disabled={!selectedPlacement}
              aria-pressed={selectedPlacement?.fitMode === 'contain'}
              onClick={() => setRatio('contain')}
              className={`rounded-lg border px-2.5 py-1 text-sm font-semibold disabled:opacity-40 ${
                selectedPlacement?.fitMode === 'contain'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-foreground/80'
              }`}
            >
              完整顯示
            </button>
            {PHOTO_RATIOS.map((ratio) => {
              const active = selectedPlacement?.fitMode === 'cover' && selectedPlacement.ratio === ratio;
              return (
                <button
                  key={ratio}
                  type="button"
                  disabled={!selectedPlacement}
                  aria-pressed={active}
                  title={PHOTO_RATIO_LABELS[ratio]}
                  onClick={() => setRatio(ratio)}
                  className={`rounded-lg border px-2.5 py-1 text-sm font-semibold disabled:opacity-40 ${
                    active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground/80'
                  }`}
                >
                  {ratio}
                </button>
              );
            })}
            {!selectedPlacement ? <span className="ml-1 text-xs text-muted-foreground">先在畫布選取一張圖片</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            佈局 {layouts.length + (existing ? 0 : 1)} / {MAX_LAYOUT_GROUPS}・圖片 {othersCount + group.placements.length} /{' '}
            {MAX_LAYOUT_PHOTOS}
          </p>
        </div>

        <div className="grid min-w-0 items-start gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,20rem)]">
          {/* 預設佈局 */}
          <section
            className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3 lg:max-h-full lg:min-h-0 lg:overflow-hidden"
            aria-labelledby="photo-layout-presets"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="photo-layout-presets" className="text-sm font-bold text-foreground">
                預設佈局
              </h3>
              <div className="flex flex-wrap gap-1">
                {COUNT_FILTERS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={filter === entry.id}
                    onClick={() => setFilter(entry.id)}
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      filter === entry.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-3">
                {PHOTO_TEMPLATES.filter((template) => matchesCount(template.count, filter)).map((template) => {
                  const active = chosen && group.templateId === template.id;
                  return (
                    <li key={template.id} className="flex">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => chooseTemplate(template.id)}
                        className={`relative flex w-full flex-1 flex-col rounded-lg border p-1.5 text-left transition ${
                          active
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border hover:border-primary/40'
                        }`}
                      >
                        <TemplateThumb templateId={template.id} samples={samples} />
                        <span className="mt-auto block truncate pt-1.5 text-xs font-semibold text-foreground">{template.name}</span>
                        <span className="block text-xs text-muted-foreground">{template.countLabel}</span>
                        {active ? (
                          <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* 排版畫布 */}
          <div className="min-w-0 lg:max-h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
            <section className="rounded-xl border border-border bg-card p-3" aria-labelledby="photo-layout-canvas">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="photo-layout-canvas" className="text-sm font-bold text-foreground">
                  排版畫布
                  {chosen ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {templateById(group.templateId).name}
                    </span>
                  ) : null}
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  {chosen && group.templateId !== 'L05' ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={Boolean(group.captions)}
                        aria-label="顯示圖片說明"
                        onCheckedChange={(next) => setGroup((current) => ({ ...current, captions: next || undefined }))}
                      />
                      顯示圖片說明
                    </label>
                  ) : null}
                  {chosen && group.templateId === 'L12' ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      格數
                      <Select value={String(group.gridSlots ?? 6)} onValueChange={(value) => setGridSlots(Number(value))}>
                        <SelectTrigger className="h-8 w-[4.5rem] text-sm" aria-label="格數">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: MAX_LAYOUT_PHOTOS - GRID_MIN_PHOTOS + 1 }, (_, index) => index + GRID_MIN_PHOTOS)
                            .filter((count) => count >= group.placements.length)
                            .map((count) => (
                              <SelectItem key={count} value={String(count)}>
                                {count}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">拖動圖片可以對調位置；按一下圖片可以裁剪。</p>
              <div className="mt-3">
                {chosen ? (
                  <PhotoLayoutBlock
                    geometry={geometry}
                    placements={group.placements}
                    photoFor={photoFor}
                    className="rounded-md"
                    renderSlot={renderCanvasSlot}
                    textFor={(placement) =>
                      placement?.title || placement?.caption ? (
                        <PhotoLayoutCaption placement={placement} />
                      ) : (
                        <p className="text-xs text-muted-foreground">在下面填寫標題和說明</p>
                      )
                    }
                  />
                ) : (
                  <div className="flex aspect-[178/80] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-sm text-muted-foreground">
                    <ImagePlus className="h-5 w-5" aria-hidden />
                    先在左邊選擇一個佈局
                  </div>
                )}
              </div>
              {chosen && group.captions && group.templateId !== 'L05' ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {slotIds.map((slotId, index) => {
                    const placement = placementAt(slotId);
                    return (
                      <label key={slotId} className="text-xs font-semibold text-muted-foreground">
                        圖 {index + 1} 說明
                        <input
                          value={placement?.caption ?? ''}
                          maxLength={CAPTION_MAX}
                          disabled={!placement}
                          placeholder={placement ? '例如：大堂入口現況' : '這個位置還沒有圖片'}
                          onChange={(event) => updatePlacement(slotId, { caption: event.target.value })}
                          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground disabled:bg-muted/50"
                        />
                      </label>
                    );
                  })}
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    每張最多 {CAPTION_MAX} 字，印在圖片下方兩行內；留空只留白。
                  </p>
                </div>
              ) : null}
              {chosen && group.templateId === 'L05' ? (
                <div className="mt-3 grid gap-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    標題
                    <input
                      value={placementAt('s1')?.title ?? ''}
                      maxLength={80}
                      disabled={!placementAt('s1')}
                      onChange={(event) => updatePlacement('s1', { title: event.target.value })}
                      className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground disabled:bg-muted/50"
                    />
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground">
                    說明
                    <textarea
                      value={placementAt('s1')?.caption ?? ''}
                      maxLength={240}
                      rows={3}
                      disabled={!placementAt('s1')}
                      onChange={(event) => updatePlacement('s1', { caption: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground disabled:bg-muted/50"
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">標題和說明印在圖片右邊；留空只留白。</p>
                </div>
              ) : null}
            </section>
          </div>

          {/* 圖片素材 */}
          <section
            className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-3 ${
              trayDrop ? 'border-primary ring-2 ring-primary/20' : 'border-border'
            }`}
            aria-labelledby="photo-layout-tray"
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes('Files')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setTrayDrop(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setTrayDrop(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return;
              event.preventDefault();
              setTrayDrop(false);
              void upload(event.dataTransfer.files);
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 id="photo-layout-tray" className="min-w-0 text-sm font-bold text-foreground">
                圖片素材
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  已放 {othersCount + group.placements.length} / {MAX_LAYOUT_PHOTOS}
                </span>
              </h3>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => {
                    setLibraryPicked([]);
                    setLibraryOpen(true);
                  }}
                >
                  從圖片庫加入
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-2.5 text-xs"
                  disabled={!canManage || library.length >= QUOTE_PHOTO_LIBRARY_LIMIT}
                  title={
                    canManage
                      ? '按描述生成一張參考圖'
                      : '只有管理員或上載員可以生成圖片'
                  }
                  onClick={() => setGenerateOpen(true)}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
                  AI 生成
                </Button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {productPhotos.length > 0
                ? `報價的 ${productPhotos.length} 張產品圖已預設加入。`
                : 'JPG、PNG 或 WebP，每張最多 15 MB。'}
              把圖片拖到畫布上的位置，或按「放入」。
            </p>

            {trayIds.length === 0 ? null : (
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 max-lg:max-h-80">
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  {trayIds.map((assetId) => {
                    const photo = photoFor(assetId)!;
                    const size = sizes[assetId];
                    const ratio = nearestRatio(size);
                    const lowRes = size ? Math.max(size.w, size.h) < LOW_RES_PX : false;
                    const used = placedIds.has(assetId);
                    return (
                      <li
                        key={assetId}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: 'asset', assetId } satisfies DragPayload));
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        className="flex min-w-0 cursor-grab items-center gap-2 rounded-lg border border-border bg-card p-1.5 active:cursor-grabbing"
                      >
                        <LoadingImage
                          src={photo.previewUrl}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded-md"
                          onLoad={(event) => {
                            const image = event.currentTarget;
                            setSizes((current) =>
                              current[assetId] ? current : { ...current, [assetId]: { w: image.naturalWidth, h: image.naturalHeight } },
                            );
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground" title={photo.title}>
                            {photo.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {size ? `${size.w}×${size.h}` : '讀取中'}
                            {ratio ? `・約 ${ratio}` : ''}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span
                              className={`rounded px-1.5 text-xs font-semibold ${
                                used ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {used ? '已放入' : '未使用'}
                            </span>
                            {photo.product ? (
                              <span className="rounded bg-amber-50 px-1.5 text-xs font-semibold text-amber-700">產品圖</span>
                            ) : null}
                            {photo.generated ? (
                              <span
                                className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 text-xs font-semibold text-foreground/70"
                                title={AI_REFERENCE_LABEL}
                              >
                                <Sparkles className="h-3 w-3" aria-hidden />
                                AI 參考圖
                              </span>
                            ) : null}
                            {lowRes ? (
                              <span className="inline-flex items-center gap-0.5 text-xs text-amber-700" title="這張圖不夠清晰，印出來可能會糊">
                                <AlertTriangle className="h-3 w-3" aria-hidden />
                                解析度低
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 shrink-0 px-2 text-xs"
                          aria-label={`放入「${photo.title}」`}
                          onClick={() => placeIntoNext(assetId)}
                        >
                          放入
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept={QUOTE_PHOTO_ACCEPT}
              multiple
              className="sr-only"
              aria-label="選擇圖片上載"
              onChange={(event) => {
                void upload(event.target.files);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading > 0 || !canManage}
              onClick={() => fileRef.current?.click()}
              className={`${trayIds.length === 0 ? 'mt-auto' : 'mt-3'} flex h-32 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 text-center text-xs disabled:opacity-60 ${
                trayDrop
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/60 hover:text-primary'
              }`}
            >
              {uploading > 0 ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
              {canManage
                ? trayIds.length === 0
                  ? '點擊或拖放圖片到這裡上載，或從圖片庫加入。'
                  : '點擊或拖放圖片到這裡上載'
                : '只有管理員或上載員可以新增圖片'}
            </button>
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 bg-card px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {!chosen ? '尚未選擇版面' : emptySlots > 0 ? `還有 ${emptySlots} 個空位` : '每個位置都已放入圖片'}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            取消
          </Button>
          <Button type="button" disabled={!chosen || (group.placements.length === 0 && !existing)} onClick={onApplyClick}>
            {existing && group.placements.length === 0 ? '從報價移除' : '套用到報價單'}
          </Button>
        </div>
      </div>
      </div>

      {cropTarget && cropPlacement && cropPhoto ? (
        <CropDialog
          slot={imageRect(cropTarget, geometry)}
          blockHeightMm={geometry.heightMm}
          placement={cropPlacement}
          photo={cropPhoto}
          caption={group.templateId === 'L05' ? null : group.captions ? 'shown' : 'hidden'}
          onCancel={() => setCropSlot(null)}
          onApply={(next) => {
            updatePlacement(cropTarget.id, next);
            setCropSlot(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingReplace !== null}
        title="取代這個位置的圖片？"
        description="這個位置已有圖片。放入後，原本那張會留在旁邊的素材區，不會從圖片庫刪除。"
        confirmLabel="取代"
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => {
          if (pendingReplace) place(pendingReplace.slotId, pendingReplace.assetId);
          setPendingReplace(null);
        }}
      />

      <ConfirmDialog
        open={confirm === 'empty'}
        title="還有空位，仍要套用？"
        description={`這個版面還有 ${emptySlots} 個空位，報價單上會留白。`}
        confirmLabel="仍要套用"
        onCancel={() => setConfirm(null)}
        onConfirm={apply}
      />

      <ConfirmDialog
        open={confirm === 'close'}
        title="放棄未套用的改動？"
        description="離開後，這次排版的改動不會保存到報價單。"
        confirmLabel="放棄改動"
        onCancel={() => setConfirm(null)}
        onConfirm={onClose}
      />

      {libraryOpen ? (
        <Modal
          open
          onOpenChange={(next) => {
            if (!next) setLibraryOpen(false);
          }}
          title="從圖片庫加入"
          description="點選已上載的圖片，再加入素材區。也可以在這裡上載新圖片。"
          size="4xl"
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                className="mr-auto"
                disabled={uploading > 0 || !canManage}
                onClick={() => fileRef.current?.click()}
              >
                {uploading > 0 ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1.5 h-4 w-4" />}
                上載新圖片
              </Button>
              <Button type="button" variant="outline" onClick={() => setLibraryOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                disabled={libraryPicked.length === 0}
                onClick={() => {
                  setTray((current) => [...current, ...libraryPicked.filter((id) => !current.includes(id))]);
                  setLibraryPicked([]);
                  setLibraryOpen(false);
                }}
              >
                加入所選{libraryPicked.length > 0 ? `（${libraryPicked.length}）` : ''}
              </Button>
            </>
          }
        >
                {libraryChoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">圖片庫沒有其他圖片。可先上載，再加入素材區。</p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {libraryChoices.map((asset) => {
                      const selected = libraryPicked.includes(asset.id);
                      return (
                        <li key={asset.id}>
                          <button
                            type="button"
                            title={asset.title}
                            aria-pressed={selected}
                            aria-label={`${selected ? '取消選取' : '選取'}「${asset.title}」`}
                            onClick={() =>
                              setLibraryPicked((current) =>
                                current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id],
                              )
                            }
                            className={`relative block w-full overflow-hidden rounded-lg border bg-card ${
                              selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <LoadingImage src={asset.url} alt="" className="aspect-square w-full" />
                            {selected ? (
                              <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
        </Modal>
      ) : null}

      {generateOpen ? (
        <QuotePhotoGenerateDialog
          open
          onClose={() => setGenerateOpen(false)}
          choices={generateChoices}
          libraryCount={library.length}
          onGenerated={onGenerated}
        />
      ) : null}
    </Modal>
  );
}
