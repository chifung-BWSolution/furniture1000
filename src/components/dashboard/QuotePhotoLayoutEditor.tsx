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
  QUOTE_PHOTO_MANUAL_LIMIT,
  listQuotePhotoAssets,
  quotePhotoErrorText,
  quotePhotoObjectUrl,
  quotePhotoShortTitle,
  uploadQuotePhotoAsset,
  type QuotePhotoAsset,
  type QuotePhotoRef,
} from '@/lib/quotePhotoLibrary';
import { QuotePhotoGenerateDialog, type GenerateChoice, type QuotePhotoZone } from '@/components/dashboard/QuotePhotoGenerateDialog';
import { usePasteFiles } from '@/hooks/use-paste-files';
import { QUOTE_ZONE_SCOPE_MESSAGES } from '@/lib/quoteZoneScope';
import type { QuoteLocale } from '@/lib/quotationLocale';
import { photoLayoutCopy } from '@/lib/quoteSurfaceCopy';
import { supabase } from '@/lib/supabase';
import {
  AI_REFERENCE_LABEL,
  CAPTION_MAX,
  GRID_MIN_PHOTOS,
  MAX_LAYOUT_GROUPS,
  MAX_LAYOUT_PHOTOS,
  PDF_CONTENT_WIDTH_MM,
  PHOTO_RATIOS,
  PHOTO_TEMPLATES,
  photoRatioLabel,
  photoTemplateText,
  countPlacements,
  defaultPlacement,
  groupGeometry,
  imageRect,
  ratioValue,
  slotIdsFor,
  switchTemplate,
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

const COUNT_FILTERS: CountFilter[] = ['all', '1', '2', '3', '4+'];

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
  cancelLabel = '取消',
  onConfirm,
  disabled,
  className,
  ariaLabel,
  children,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
        <AlertDialogHeader icon={<AlertTriangle aria-hidden />} iconSize="sm">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words leading-6">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
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
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader icon={<AlertTriangle aria-hidden />} iconSize="sm">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words leading-6">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
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
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [node]);
  return { ref: setNode, width };
}

/** 單一槽位的裁剪對話框；只有按已放圖片才會開。 */
function CropDialog({
  slot,
  blockHeightMm,
  placement,
  photo,
  caption,
  locale = 'zh',
  onApply,
  onCancel,
}: {
  slot: PhotoSlotRect;
  blockHeightMm: number;
  placement: PhotoPlacement;
  photo: LayoutPhotoSource;
  caption: 'shown' | 'hidden' | null;
  locale?: QuoteLocale;
  onApply: (next: PhotoPlacement) => void;
  onCancel: () => void;
}) {
  const copy = photoLayoutCopy(locale);
  const [draft, setDraft] = useState(placement);
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const { ref, width: stageWidth } = useStageWidth();
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const stageHeight = 340;
  const cover = draft.fitMode === 'cover';

  useEffect(() => {
    setImageFailed(false);
    setNatural(null);
    const image = new Image();
    image.onload = () => setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    image.onerror = () => setImageFailed(true);
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
      title={copy.cropTitle}
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
              {copy.reset}
            </Button>
            <Button type="button" variant="outline" aria-pressed={showOriginal} onClick={() => setShowOriginal((value) => !value)}>
              {showOriginal ? copy.backToCrop : copy.compare}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {copy.cancel}
            </Button>
            <Button type="button" onClick={() => onApply(draft)}>
              {copy.applyCrop}
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
              {imageFailed ? (
                <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white">
                  {copy.imageFailed}
                </p>
              ) : null}
              {!imageFailed && showOriginal ? (
                <img src={photo.previewUrl} alt={photo.title} draggable={false} className="absolute inset-0 h-full w-full object-contain" onError={() => setImageFailed(true)} />
              ) : null}
              {!imageFailed && !showOriginal && cover && stageWidth > 0 ? (
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
              {!imageFailed && !showOriginal && !cover ? (
                <div
                  className="absolute bg-slate-50 ring-2 ring-white"
                  style={
                    stageWidth > 0
                      ? { left: frameX, top: frameY, width: frameW, height: frameH }
                      : { left: 16, top: 16, right: 16, bottom: 16 }
                  }
                >
                  <img src={photo.previewUrl} alt={photo.title} draggable={false} className="h-full w-full object-contain" onError={() => setImageFailed(true)} />
                </div>
              ) : null}
              <span className="absolute left-3 top-3 rounded-md bg-slate-950/70 px-2 py-1 text-xs font-semibold text-white">
                {showOriginal ? copy.original : cover ? copy.cropHint(draft.ratio) : copy.contain}
              </span>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{copy.display}</p>
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
                      {mode === 'contain' ? copy.contain : copy.cover}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{copy.cropRatio}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {PHOTO_RATIOS.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      disabled={!cover}
                      aria-pressed={draft.ratio === ratio}
                      title={photoRatioLabel(ratio, locale)}
                      onClick={() => setDraft((current) => ({ ...current, ratio, offsetX: 0.5, offsetY: 0.5 }))}
                      className={`rounded-lg border px-2.5 py-1 text-sm font-semibold disabled:opacity-40 ${
                        draft.ratio === ratio ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground/80'
                      }`}
                    >
                      {ratio}
                      {ratio === slot.ratio ? <span className="ml-1 text-xs font-normal text-muted-foreground">{copy.suggested}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold text-muted-foreground">{copy.zoom}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={copy.zoomOut}
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
                    aria-label={copy.zoomLevel}
                    onChange={(event) => setScale(Number(event.target.value) / 100)}
                    className="h-2 min-w-0 flex-1 accent-primary"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={copy.zoomIn}
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
                {copy.caption}
                <input
                  value={draft.caption ?? ''}
                  maxLength={CAPTION_MAX}
                  placeholder={copy.captionExample}
                  onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground"
                />
                <span className="mt-1 block font-normal text-muted-foreground/80">
                  {caption === 'shown' ? copy.captionPrint(CAPTION_MAX) : copy.captionOff}
                </span>
              </label>
            ) : null}
            <div className="mt-3 space-y-1">
              {hidden ? <p className="text-xs text-amber-700">{copy.cropOverflow}</p> : null}
              {lowRes && natural ? (
                <p className="text-xs text-amber-700">
                  {copy.softPrint(natural.w, natural.h)}
                </p>
              ) : null}
            </div>
      </div>
    </Modal>
  );
}

/** 父層的圖片庫可能比這個視窗晚到；只補還沒有的，不蓋掉剛上載或剛生成的。 */
function mergeQuotePhotoLibrary(current: QuotePhotoAsset[], incoming: QuotePhotoAsset[]): QuotePhotoAsset[] {
  if (incoming.length === 0) return current;
  const known = new Set(current.map((asset) => asset.id));
  const extra = incoming.filter((asset) => !known.has(asset.id));
  return extra.length === 0 ? current : [...current, ...extra];
}

export function QuotePhotoLayoutEditor({
  layouts,
  groupId,
  assets,
  productPhotos = [],
  photoZones = [],
  quoteUuid = null,
  photos,
  canManage,
  locale = 'zh',
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
  /** 平面圖分區。有分區時，AI 描述改由分區和裡面的傢俬生成。 */
  photoZones?: QuotePhotoZone[];
  /** FDS-13：所屬報價；分區示範圖生成時交給 Edge 重查範圍。 */
  quoteUuid?: string | null;
  /** 這張報價已選的圖片，用來餵素材區。 */
  photos: QuotePhotoRef[];
  canManage: boolean;
  locale?: QuoteLocale;
  onUploaded?: (asset: QuotePhotoAsset) => void;
  onSave: (groups: PhotoLayoutGroup[], usedAssets: QuotePhotoAsset[]) => void;
  onClose: () => void;
}) {
  const copy = photoLayoutCopy(locale);
  const existing = groupId ? layouts.find((group) => group.id === groupId) : undefined;
  const [initial] = useState<PhotoLayoutGroup | null>(existing ?? null);
  const [group, setGroup] = useState<PhotoLayoutGroup>(
    () => existing ?? { id: crypto.randomUUID(), templateId: 'L03', placements: [] },
  );
  const [chosen, setChosen] = useState(Boolean(existing));
  const [library, setLibrary] = useState<QuotePhotoAsset[]>(assets);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryNote, setLibraryNote] = useState<string | null>(null);
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
  /** FDS-13：非 BWF 正式報價（快速報價／客戶方案／DP-／設計專案）不提供分區示範圖生成。 */
  const [zoneScopeBlocked, setZoneScopeBlocked] = useState<string | null>(null);

  /** Ctrl+V 貼上圖片：直接上載並放入素材區，跟拖放／選檔一樣。 */
  usePasteFiles({
    enabled: canManage && !libraryOpen && !generateOpen && !pendingReplace,
    multiple: true,
    accept: (file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name),
    onFiles: (files) => {
      void upload(files);
    },
  });

  useEffect(() => {
    let cancelled = false;
    if (!quoteUuid) {
      setZoneScopeBlocked(null);
      return;
    }
    void supabase.rpc('fds_quote_zone_scope', { p_quote_uuid: quoteUuid }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        // 未部署或查詢失敗時保留按鈕；伺服器仍會在生成時再拒絕。
        setZoneScopeBlocked(null);
        return;
      }
      const row = data && typeof data === 'object' ? data as { allowed?: boolean; reason?: string } : null;
      if (row?.allowed === true) {
        setZoneScopeBlocked(null);
        return;
      }
      setZoneScopeBlocked(
        row?.reason === 'design_project'
          ? QUOTE_ZONE_SCOPE_MESSAGES.design_project
          : QUOTE_ZONE_SCOPE_MESSAGES.not_formal_quote,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [quoteUuid]);
  const fileRef = useRef<HTMLInputElement>(null);

  // 從報價內容「上傳圖片」進來時，父層是開窗後才去讀圖片庫，初始 assets 常常是空的。
  // 這裡自己再讀一次，並接住父層稍後送到的清單，避免「有時進去找不到圖」。
  useEffect(() => {
    setLibrary((current) => mergeQuotePhotoLibrary(current, assets));
  }, [assets]);

  useEffect(() => {
    let cancelled = false;
    void listQuotePhotoAssets().then((result) => {
      if (cancelled) return;
      if (result.missingTable) {
        setLibraryNote(quotePhotoErrorText(new Error('quote_photo_library_unavailable')));
      } else if (result.error) {
        setLibraryNote(copy.libraryNote);
      } else {
        setLibrary((current) => mergeQuotePhotoLibrary(current, result.assets));
        setLibraryNote(null);
      }
      setLibraryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = useMemo(() => {
    const map = new Map<
      string,
      LayoutPhotoSource & { asset?: QuotePhotoAsset; product?: boolean; generated?: boolean }
    >();
    for (const photo of productPhotos) {
      if (photo.url) map.set(photo.id, { title: photo.title || copy.productPhoto, previewUrl: photo.url, product: true });
    }
    for (const photo of photos) {
      if (!photo.assetId) continue;
      const url = quotePhotoObjectUrl(photo.objectPath);
      if (url) map.set(photo.assetId, { title: photo.title || copy.photo, previewUrl: url });
    }
    for (const asset of library) {
      map.set(asset.id, {
        ...asset,
        title: asset.title || copy.photo,
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
      const gridSlots = templateId === 'L12' ? 6 : undefined;
      setGroup((current) => ({ ...current, templateId, gridSlots, placements: [] }));
      setChosen(true);
      return;
    }
    if (templateId === group.templateId) return;
    const { group: next, displaced } = switchTemplate(group, templateId);
    setGroup(next);
    setSelectedSlot(null);
    if (displaced.length > 0) toast.info(copy.displaced(displaced.length));
  }

  function place(slotId: string, assetId: string) {
    const slot = geometry.slots.find((entry) => entry.id === slotId);
    if (!slot) return;
    const occupied = placementAt(slotId);
    if (!occupied && othersCount + group.placements.length >= MAX_LAYOUT_PHOTOS) {
      toast.error(copy.maxPhotos(MAX_LAYOUT_PHOTOS));
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
      toast.info(copy.chooseLayoutFirst);
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
    else toast.info(copy.slotsFull);
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

  /** 新圖片只加入素材區，由使用者選擇是否放進佈局。 */
  function addToTray(added: string[]) {
    setTray((current) => [...current, ...added.filter((id) => !current.includes(id))]);
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
    // 只計手動上載的圖；AI 生成圖不佔配額。
    const manualInLibrary = library.filter((asset) => !asset.isGenerated).length;
    for (const file of files) {
      if (manualInLibrary + added.length >= QUOTE_PHOTO_MANUAL_LIMIT) {
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
    // 上載後放入素材區。
    addToTray(added);
    toast.success(copy.uploaded(added.length));
  }

  /** 參考圖片候選：只限報價明細帶來的產品圖，AI 按產品圖把產品放進場景。 */
  const generateChoices = useMemo<GenerateChoice[]>(
    () =>
      productPhotos.flatMap((photo) => {
        const url = (photo.url || '').trim();
        return url ? [{ id: photo.id, title: photo.title || copy.productPhoto, previewUrl: url, referenceUrl: url }] : [];
      }),
    [productPhotos],
  );

  /** AI 生成完成：加入素材區。 */
  function onGenerated(asset: QuotePhotoAsset) {
    setLibrary((current) => (current.some((row) => row.id === asset.id) ? current : [...current, asset]));
    onUploaded?.(asset);
    addToTray([asset.id]);
  }

  function apply() {
    setConfirm(null);
    if (group.placements.length === 0) {
      if (!existing) {
        toast.error(copy.needOne);
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
        aria-label={copy.slotLabel(index, placement ? (photo?.title ?? copy.photo) : null)}
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
            <span>{copy.dropPhoto}</span>
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 text-xs font-semibold text-white">{index}</span>
        {placement ? (
          <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-card/90 px-1.5 py-0.5 text-xs font-semibold text-foreground opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Crop className="h-3 w-3" aria-hidden />
            {placement.fitMode === 'cover' ? placement.ratio : copy.contain}
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
              ariaLabel={copy.removeSlot(index)}
              title={copy.removeSlotTitle}
              confirmLabel={copy.removeSlotConfirm}
              cancelLabel={copy.cancel}
              description={copy.removeSlotDescription(quotePhotoShortTitle(photo?.title ?? copy.photo), index)}
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
      title={copy.title}
      /* fullscreen 預設是透明底白字（給燈箱用）；排版編輯器要正常白色頁面。 */
      className="bg-background text-foreground"
      headerClassName="border-b border-border/80 bg-background text-foreground"
      bodyClassName="p-0 sm:p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-muted/30 p-4 xl:overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">{copy.howShown}</span>
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
              {copy.contain}
            </button>
            {PHOTO_RATIOS.map((ratio) => {
              const active = selectedPlacement?.fitMode === 'cover' && selectedPlacement.ratio === ratio;
              return (
                <button
                  key={ratio}
                  type="button"
                  disabled={!selectedPlacement}
                  aria-pressed={active}
                  title={photoRatioLabel(ratio, locale)}
                  onClick={() => setRatio(ratio)}
                  className={`rounded-lg border px-2.5 py-1 text-sm font-semibold disabled:opacity-40 ${
                    active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground/80'
                  }`}
                >
                  {ratio}
                </button>
              );
            })}
            {!selectedPlacement ? <span className="ml-1 text-xs text-muted-foreground">{copy.pickFirst}</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {copy.layoutProgress(layouts.length + (existing ? 0 : 1), MAX_LAYOUT_GROUPS, othersCount + group.placements.length, MAX_LAYOUT_PHOTOS)}
          </p>
        </div>

        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:min-h-0 xl:flex-1 xl:items-stretch xl:grid-rows-1 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,25rem)]">
          {/* 預設佈局 */}
          <section
            className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3 xl:max-h-full xl:min-h-0 xl:overflow-hidden"
            aria-labelledby="photo-layout-presets"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="photo-layout-presets" className="text-sm font-bold text-foreground">
                {copy.presets}
              </h3>
              <div className="flex flex-wrap gap-1">
                {COUNT_FILTERS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={filter === entry}
                    onClick={() => setFilter(entry)}
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      filter === entry ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {copy.filters[entry]}
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
                        <span className="mt-auto block truncate pt-1.5 text-xs font-semibold text-foreground">{photoTemplateText(template.id, locale).name}</span>
                        <span className="block text-xs text-muted-foreground">{photoTemplateText(template.id, locale).countLabel}</span>
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
          <div className="min-w-0 xl:max-h-full xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain">
            <section className="rounded-xl border border-border bg-card p-3" aria-labelledby="photo-layout-canvas">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="photo-layout-canvas" className="text-sm font-bold text-foreground">
                  {copy.canvas}
                  {chosen ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {photoTemplateText(group.templateId, locale).name}
                    </span>
                  ) : null}
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  {chosen && group.templateId !== 'L05' ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={Boolean(group.captions)}
                        aria-label={copy.showCaptions}
                        onCheckedChange={(next) => setGroup((current) => ({ ...current, captions: next || undefined }))}
                      />
                      {copy.showCaptions}
                    </label>
                  ) : null}
                  {chosen && group.templateId === 'L12' ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {copy.slots}
                      <Select value={String(group.gridSlots ?? 6)} onValueChange={(value) => setGridSlots(Number(value))}>
                        <SelectTrigger className="h-8 w-[4.5rem] text-sm" aria-label={copy.slots}>
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
                        <p className="text-xs text-muted-foreground">{copy.fillTitle}</p>
                      )
                    }
                  />
                ) : (
                  <div className="flex aspect-[178/80] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-sm text-muted-foreground">
                    <ImagePlus className="h-5 w-5" aria-hidden />
                    {copy.chooseLayout}
                  </div>
                )}
              </div>
              {chosen && group.captions && group.templateId !== 'L05' ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {slotIds.map((slotId, index) => {
                    const placement = placementAt(slotId);
                    return (
                      <label key={slotId} className="text-xs font-semibold text-muted-foreground">
                        {copy.captionOf(index + 1)}
                        <input
                          value={placement?.caption ?? ''}
                          maxLength={CAPTION_MAX}
                          disabled={!placement}
                          placeholder={placement ? copy.captionPlaceholder : copy.emptySlot}
                          onChange={(event) => updatePlacement(slotId, { caption: event.target.value })}
                          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground disabled:bg-muted/50"
                        />
                      </label>
                    );
                  })}
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {copy.captionHint(CAPTION_MAX)}
                  </p>
                </div>
              ) : null}
              {chosen && group.templateId === 'L05' ? (
                <div className="mt-3 grid gap-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {copy.sideTitle}
                    <input
                      value={placementAt('s1')?.title ?? ''}
                      maxLength={80}
                      disabled={!placementAt('s1')}
                      onChange={(event) => updatePlacement('s1', { title: event.target.value })}
                      className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground disabled:bg-muted/50"
                    />
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground">
                    {copy.sideCaption}
                    <textarea
                      value={placementAt('s1')?.caption ?? ''}
                      maxLength={240}
                      rows={3}
                      disabled={!placementAt('s1')}
                      onChange={(event) => updatePlacement('s1', { caption: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground disabled:bg-muted/50"
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">{copy.sideHint}</p>
                </div>
              ) : null}
            </section>
          </div>

          {/* 圖片素材 */}
          <section
            className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-3 xl:max-h-full ${
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
                {copy.tray}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {copy.placed(othersCount + group.placements.length, MAX_LAYOUT_PHOTOS)}
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
                  {copy.fromLibrary}
                </Button>
                {zoneScopeBlocked ? (
                  <span className="max-w-[260px] text-right text-xs text-muted-foreground">{zoneScopeBlocked}</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-2.5 text-xs"
                    disabled={!canManage}
                    title={canManage ? undefined : copy.aiDenied}
                    onClick={() => setGenerateOpen(true)}
                  >
                    <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
                    {copy.ai}
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {productPhotos.length > 0
                ? copy.productReady(productPhotos.length)
                : copy.uploadHint}
            </p>

            {trayIds.length === 0 ? null : (
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 max-xl:max-h-80">
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
                            {size ? `${size.w}×${size.h}` : copy.loadingSize}
                            {ratio ? copy.aboutRatio(ratio) : ''}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span
                              className={`rounded px-1.5 text-xs font-semibold ${
                                used ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {used ? copy.used : copy.unused}
                            </span>
                            {photo.product ? (
                              <span className="rounded bg-amber-50 px-1.5 text-xs font-semibold text-amber-700">{copy.product}</span>
                            ) : null}
                            {photo.generated ? (
                              <span
                                className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 text-xs font-semibold text-foreground/70"
                                title={AI_REFERENCE_LABEL}
                              >
                                <Sparkles className="h-3 w-3" aria-hidden />
                                {copy.aiRef}
                              </span>
                            ) : null}
                            {lowRes ? (
                              <span className="inline-flex items-center gap-0.5 text-xs text-amber-700" title={copy.lowResTitle}>
                                <AlertTriangle className="h-3 w-3" aria-hidden />
                                {copy.lowRes}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 shrink-0 px-2 text-xs"
                          aria-label={copy.placeNamed(photo.title)}
                          onClick={() => placeIntoNext(assetId)}
                        >
                          {copy.place}
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
              aria-label={copy.chooseUpload}
              onChange={(event) => {
                void upload(event.target.files);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading > 0 || !canManage || library.filter((asset) => !asset.isGenerated).length >= QUOTE_PHOTO_MANUAL_LIMIT}
              onClick={() => fileRef.current?.click()}
              className={`${trayIds.length === 0 ? 'mt-auto' : 'mt-3'} flex h-32 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 text-center text-xs disabled:opacity-60 ${
                trayDrop
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/60 hover:text-primary'
              }`}
            >
              {uploading > 0 ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
              {canManage
                ? library.filter((asset) => !asset.isGenerated).length >= QUOTE_PHOTO_MANUAL_LIMIT
                  ? copy.uploadLimit(QUOTE_PHOTO_MANUAL_LIMIT)
                  : trayIds.length === 0
                    ? copy.dropEmpty
                    : copy.dropMore
                : copy.uploadDenied}
            </button>
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 bg-card px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {!chosen ? copy.noLayout : emptySlots > 0 ? copy.emptySlots(emptySlots) : copy.full}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {copy.cancel}
          </Button>
          <Button type="button" disabled={!chosen || (group.placements.length === 0 && !existing)} onClick={onApplyClick}>
            {existing && group.placements.length === 0 ? copy.removeFromQuote : copy.apply}
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
          locale={locale}
          onCancel={() => setCropSlot(null)}
          onApply={(next) => {
            updatePlacement(cropTarget.id, next);
            setCropSlot(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingReplace !== null}
        title={copy.replaceTitle}
        description={copy.replaceDescription}
        confirmLabel={copy.replace}
        cancelLabel={copy.cancel}
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => {
          if (pendingReplace) place(pendingReplace.slotId, pendingReplace.assetId);
          setPendingReplace(null);
        }}
      />

      <ConfirmDialog
        open={confirm === 'empty'}
        title={copy.emptyTitle}
        description={copy.emptyDescription(emptySlots)}
        confirmLabel={copy.applyAnyway}
        cancelLabel={copy.cancel}
        onCancel={() => setConfirm(null)}
        onConfirm={apply}
      />

      <ConfirmDialog
        open={confirm === 'close'}
        title={copy.discardTitle}
        description={copy.discardDescription}
        confirmLabel={copy.discard}
        cancelLabel={copy.cancel}
        onCancel={() => setConfirm(null)}
        onConfirm={onClose}
      />

      {libraryOpen ? (
        <Modal
          open
          onOpenChange={(next) => {
            if (!next) setLibraryOpen(false);
          }}
          title={copy.libraryTitle}
          description={copy.libraryDescription}
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
                {copy.uploadNew}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLibraryOpen(false)}>
                {copy.cancel}
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
                {copy.addSelected(libraryPicked.length)}
              </Button>
            </>
          }
        >
                {!libraryReady && libraryChoices.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                    {copy.libraryLoading}
                  </p>
                ) : libraryChoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {libraryNote ?? copy.libraryEmpty}
                  </p>
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
                            aria-label={`${selected ? copy.unselect : copy.select} “${asset.title}”`}
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
          zones={photoZones}
          quoteUuid={quoteUuid}
          onGenerated={onGenerated}
        />
      ) : null}
    </Modal>
  );
}
