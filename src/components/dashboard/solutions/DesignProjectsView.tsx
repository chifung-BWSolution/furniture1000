import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Plus, Loader2, Search, Check, CheckCircle2, Trash2, X, LayoutGrid, UserRound, Tag,
  ImagePlus, PenLine, ZoomIn, Save, Link2, RefreshCw, MessageSquare, Layers,
  Factory, ChevronDown,
} from 'lucide-react';
import {
  fetchProjects, fetchZones, fetchZoneProducts, fetchActiveShopifyProducts,
  fetchProductsDisplayMeta, createZoneProduct, deleteZoneProductWithProgress,
  persistDesignProjectFurniture, saveProject, updateZoneProductNotes,
  type ProductDisplayMeta,
} from '@/lib/solutionsApi';
import {
  dedupeFactoryNames,
  normalizeFactoryDisplayName,
} from '@/lib/factoryNames';
import { formatProductDimensionsMm } from '@/lib/productDimensions';
import { ProductImageUploadModal } from './ProductImageUploadModal';
import { useAppStore } from '@/hooks/use-app-store';
import {
  buildDesignProjectPath,
  parseDesignProjectPathname,
} from '@/lib/designProjectRoutes';
import { consumeSolutionFocusProjectId } from '@/lib/solutionProjectFocus';
import { resolveDesignProjectPmLabels } from '@/lib/solutionProjectPm';
import {
  applyRoomLabelOverrides,
  inferProjectType,
  normalizeRoomLabelOverrides,
  normalizeRoomOrder,
  projectTypeLabel,
  roomsForProjectType,
  zoneSeedsFromRoomCounts,
  type ProjectEngineeringType,
  type RoomTypeTemplate,
} from '@/lib/projectPartitionTemplates';
import {
  syncProjectZones,
  zonesOutOfSyncWithSeeds,
} from '@/lib/syncProjectZones';
import { uploadFileToStorage } from '@/lib/imageStorage';
import { remarksPlainText } from '@/lib/remarksContent';
import { toast } from 'sonner';
import {
  ZONE_PRODUCT_STATUS_META,
  type CustomRoomType,
  type DesignProject,
  type ProjectZone,
  type ZoneProduct,
  type SearchProduct,
  type ZoneProductStatus,
  type ZoneFurnitureDivision,
} from '@/types/solutions';
import {
  removeClientFeedbackFromNotes,
  reviewLabelZh,
  serializeStaffNotesAndFeedback,
  splitStaffNotesAndFeedback,
} from '@/lib/zoneProductClientFeedback';
import {
  fetchProductCategoryPairs,
  type ProductCategoryPair,
} from '@/lib/productCategoryOptions';
import {
  FloorPlanThumb,
  FloorPlanViewerModal,
  floorPlanPreviewOf,
} from './FloorPlanViewerModal';
import { publishDesignProjectStickyChrome } from '@/lib/designProjectStickyChrome';

/** Staff-editable notes only (strip client feedback + unwrap rich-text JSON). */
function staffNotesValue(notes: string | null | undefined): string {
  const { staffNotes } = splitStaffNotesAndFeedback(notes);
  if (!staffNotes.trim()) return '';
  if (staffNotes.trim().startsWith('[')) return remarksPlainText(staffNotes);
  return staffNotes;
}

function mergeStaffNotesKeepingFeedback(
  previousNotes: string | null | undefined,
  nextStaffNotes: string,
): string {
  const { feedback } = splitStaffNotesAndFeedback(previousNotes);
  return serializeStaffNotesAndFeedback(nextStaffNotes, feedback);
}

function fmtFeedbackTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} (UTC+8)`;
}
function isCustomZoneProduct(item: ZoneProduct): boolean {
  return !item.productId;
}

function ProductImageLightbox({
  src,
  title,
  onClose,
}: {
  src: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title}圖片預覽` : '產品圖片預覽'}
    >
      <img
        src={src}
        alt={title || '產品圖片'}
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        aria-label="關閉預覽"
      >
        <X className="h-5 w-5" />
      </button>
      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-[13px] text-white/80">
        點擊空白處或按 Esc 關閉
      </p>
    </div>
  );
}

function normalizeCustomRooms(value: unknown): CustomRoomType[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const key = String(row.key || '').trim();
      const label = String(row.label || '').trim();
      const codePrefix = String(row.codePrefix || '').trim() || 'CR';
      if (!key || !label) return null;
      return { key, label, codePrefix };
    })
    .filter((item): item is CustomRoomType => Boolean(item));
}

function zoneBaseName(name: string): string {
  return (
    name
      .trim()
      .replace(/\s+\d+$/, '')
      .replace(/[（(]\d+[）)]$/, '')
      .trim() || '其他間隔'
  );
}

function zoneGroupDomId(label: string): string {
  return `design-zone-group-${encodeURIComponent(label)}`;
}

function newDivisionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `div_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeZoneAreasSqft(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, string> = {};
  for (const [zoneId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!zoneId) continue;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) continue;
    next[zoneId] = String(raw).trim() === '' ? '' : String(num);
  }
  return next;
}

function normalizeFurnitureDivisions(
  value: unknown,
): Record<string, ZoneFurnitureDivision[]> {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, ZoneFurnitureDivision[]> = {};
  for (const [zoneId, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!zoneId || !Array.isArray(rows)) continue;
    next[zoneId] = rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const item = row as Record<string, unknown>;
        const id = String(item.id || '').trim();
        const level1 = String(item.level1 || '').trim();
        const level2 = String(item.level2 || '').trim();
        const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
        if (!id || !level1) return null;
        const productIds = Array.isArray(item.productIds)
          ? item.productIds.map((pid) => String(pid || '').trim()).filter(Boolean)
          : [];
        const next: ZoneFurnitureDivision = {
          id,
          level1,
          level2,
          quantity,
          productIds,
        };
        return next;
      })
      .filter((row): row is ZoneFurnitureDivision => Boolean(row));
  }
  return next;
}

function normalizeOptionalZoneProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function withOptionalFlags(
  products: ZoneProduct[],
  optionalIds: Iterable<string>,
): ZoneProduct[] {
  const optionalSet = new Set(
    [...optionalIds].map((id) => String(id || '').trim()).filter(Boolean),
  );
  return products.map((product) => ({
    ...product,
    isOptional: optionalSet.has(product.id),
  }));
}

function zoneProductPieceCount(item: ZoneProduct): number {
  return Math.max(1, Math.floor(Number(item.quantity) || 1));
}

/** Line total for zone 小計 / project 總計 — 可選 products contribute 0. */
function zoneProductBillableTotal(item: ZoneProduct): number {
  if (item.isOptional) return 0;
  return Number(item.salePrice || 0) * zoneProductPieceCount(item);
}

function plannedFurnitureTotalForZones(
  zoneIds: string[],
  divisions: Record<string, ZoneFurnitureDivision[]>,
): number {
  let total = 0;
  for (const zoneId of zoneIds) {
    for (const row of divisions[zoneId] || []) {
      total += Math.max(0, Math.floor(Number(row.quantity) || 0));
    }
  }
  return total;
}

function furnitureDivisionLabel(division: ZoneFurnitureDivision): string {
  return division.level2
    ? `${division.level1} > ${division.level2}`
    : division.level1;
}

/** Display: 「入口及前臺大堂 × 總數 9件傢俬」 */
function formatPlannedFurnitureTotalLabel(plannedTotal: number): string {
  return `× 總數 ${plannedTotal}件傢俬`;
}

/**
 * Divisions where non-optional piece count exceeds the planned quantity.
 * Excess lines must be marked 可選 (or removed) before save.
 */
function collectDivisionExcessWarnings(
  zones: ProjectZone[],
  products: ZoneProduct[],
  divisionsByZone: Record<string, ZoneFurnitureDivision[]>,
): string[] {
  const warnings: string[] = [];
  for (const zone of zones) {
    const divisions = divisionsByZone[zone.id] || [];
    if (divisions.length === 0) continue;
    const items = products.filter((product) => product.zoneId === zone.id);
    const assignedIds = new Set(
      divisions.flatMap((row) => row.productIds || []),
    );

    for (const division of divisions) {
      const planned = Math.max(1, Math.floor(Number(division.quantity) || 1));
      const nonOptionalCount = items
        .filter(
          (item) =>
            (division.productIds || []).includes(item.id) && !item.isOptional,
        )
        .reduce((sum, item) => sum + zoneProductPieceCount(item), 0);
      if (nonOptionalCount <= planned) continue;
      const excess = nonOptionalCount - planned;
      warnings.push(
        `「${zone.name}」${furnitureDivisionLabel(division)}：計劃 ${planned} 件，非可選已有 ${nonOptionalCount} 件（多 ${excess} 件請轉為可選）`,
      );
    }

    const unassignedNonOptional = items
      .filter((item) => !assignedIds.has(item.id) && !item.isOptional)
      .reduce((sum, item) => sum + zoneProductPieceCount(item), 0);
    if (unassignedNonOptional > 0) {
      warnings.push(
        `「${zone.name}」未劃分：有 ${unassignedNonOptional} 件非可選產品超出劃分計劃，請劃分或轉為可選`,
      );
    }
  }
  return warnings;
}

function parseSqftInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

/** Convert local sqft string map → meta numbers for design_projects.meta. */
function zoneAreasSqftMetaFromState(
  nextSqft: Record<string, string>,
): Record<string, number> {
  const zoneAreasSqftMeta: Record<string, number> = {};
  for (const [zoneId, raw] of Object.entries(nextSqft)) {
    const parsed = parseSqftInput(raw);
    if (parsed == null) continue;
    zoneAreasSqftMeta[zoneId] = parsed;
  }
  return zoneAreasSqftMeta;
}

/** Original thumb was 56px (h-14); ~2.6× ≈ 146px after +30% on the 200% size. */
const PRODUCT_IMAGE_MIN_PX = 146;
const PRODUCT_IMAGE_MAX_PX = 286;

/** Keep product image square: ≥200% of old thumb, grow with content, cap for overflow. */
function useProductImageSquareSize() {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(PRODUCT_IMAGE_MIN_PX);

  useEffect(() => {
    const node = contentRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      const contentH = Math.ceil(node.getBoundingClientRect().height);
      const viewportCap = Math.floor(window.innerWidth * 0.32);
      const maxSide = Math.max(
        PRODUCT_IMAGE_MIN_PX,
        Math.min(PRODUCT_IMAGE_MAX_PX, viewportCap),
      );
      const next = Math.max(
        PRODUCT_IMAGE_MIN_PX,
        Math.min(contentH || PRODUCT_IMAGE_MIN_PX, maxSide),
      );
      setSize((current) => (current === next ? current : next));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return { contentRef, size };
}

function dimInputValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(Math.round(value));
}

function parseDimInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num);
}

function ZoneProductRow({
  item,
  zoneId,
  custom,
  titleLabel,
  catalogMeta,
  uploading,
  deletingProductId,
  deletingFeedbackKey,
  onOpenUpload,
  onPreview,
  onOpenPicker,
  onSetQuantity,
  onSetStatus,
  onRemove,
  onToggleOptional,
  onSetTitle,
  onSetSalePrice,
  onSetDimensions,
  onSetNotes,
  onDeleteFeedback,
}: {
  item: ZoneProduct;
  zoneId: string;
  custom: boolean;
  titleLabel: string;
  catalogMeta?: ProductDisplayMeta | null;
  uploading: boolean;
  deletingProductId: string | null;
  deletingFeedbackKey: string | null;
  onOpenUpload: (item: ZoneProduct) => void;
  onPreview: (src: string, title: string) => void;
  onOpenPicker: (zoneId: string, itemId: string) => void;
  onSetQuantity: (item: ZoneProduct, quantity: number) => void;
  onSetStatus: (id: string, status: ZoneProductStatus) => void;
  onRemove: (item: ZoneProduct) => void;
  onToggleOptional: (item: ZoneProduct) => void;
  onSetTitle: (item: ZoneProduct, value: string) => void;
  onSetSalePrice: (item: ZoneProduct, value: number) => void;
  onSetDimensions: (
    item: ZoneProduct,
    patch: {
      dimensionLMm: number | null;
      dimensionWMm: number | null;
      dimensionHMm: number | null;
    },
  ) => void;
  onSetNotes: (item: ZoneProduct, value: string) => void;
  onDeleteFeedback: (item: ZoneProduct, index: number) => void;
}) {
  const { contentRef, size } = useProductImageSquareSize();
  const feedback = splitStaffNotesAndFeedback(item.notes).feedback;
  // Once any project-local dim is saved, stop falling back to catalog (so clears stick).
  const hasProjectDims =
    item.dimensionLMm != null ||
    item.dimensionWMm != null ||
    item.dimensionHMm != null;
  const effectiveL = hasProjectDims
    ? (item.dimensionLMm ?? null)
    : (catalogMeta?.dimensionLMm ?? null);
  const effectiveW = hasProjectDims
    ? (item.dimensionWMm ?? null)
    : (catalogMeta?.dimensionWMm ?? null);
  const effectiveH = hasProjectDims
    ? (item.dimensionHMm ?? null)
    : (catalogMeta?.dimensionHMm ?? null);
  const factoryName = (catalogMeta?.factoryName || '').trim();
  const canUploadImage = custom || !item.productImageUrl;

  const commitDimAxis = (
    axis: 'dimensionLMm' | 'dimensionWMm' | 'dimensionHMm',
    raw: string,
  ) => {
    const nextValue = parseDimInput(raw);
    // First edit snapshots the other axes from catalog so project-local row is complete.
    onSetDimensions(item, {
      dimensionLMm: axis === 'dimensionLMm' ? nextValue : effectiveL,
      dimensionWMm: axis === 'dimensionWMm' ? nextValue : effectiveW,
      dimensionHMm: axis === 'dimensionHMm' ? nextValue : effectiveH,
    });
  };

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-stretch gap-4">
        <div
          className="relative shrink-0 self-start"
          style={{ width: size, height: size }}
        >
          {item.productImageUrl ? (
            <button
              type="button"
              onClick={() => onPreview(item.productImageUrl, titleLabel)}
              className="group relative h-full w-full overflow-hidden rounded-xl bg-muted ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title="點擊放大圖片"
              aria-label={`${titleLabel}圖片預覽`}
            >
              <img
                src={item.productImageUrl}
                alt=""
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
                <ZoomIn className="h-5 w-5" />
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={uploading || !canUploadImage}
              onClick={() => onOpenUpload(item)}
              className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-60"
              title="上傳產品圖片"
              aria-label="上傳產品圖片"
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ImagePlus className="h-6 w-6" />
              )}
            </button>
          )}
          {custom && item.productImageUrl ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => onOpenUpload(item)}
              className="absolute bottom-1.5 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border/80 bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur hover:bg-background disabled:opacity-60"
            >
              {uploading ? '上傳中…' : '更換圖片'}
            </button>
          ) : null}
        </div>

        <div
          className="flex min-w-0 flex-1 flex-col justify-start"
          style={{ minHeight: size }}
        >
          <div ref={contentRef} className="space-y-2.5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              {custom ? (
                <input
                  type="text"
                  value={item.productTitle || ''}
                  onChange={(event) => onSetTitle(item, event.target.value)}
                  placeholder="輸入產品名稱…"
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-base font-medium outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                  aria-label="產品名稱"
                />
              ) : (
                <p className="text-base font-medium leading-snug">
                  {item.productTitle}
                </p>
              )}
              {factoryName ? (
                <span className="inline-flex max-w-full items-center rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground">
                  <span className="truncate" title={factoryName}>
                    {factoryName}
                  </span>
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-start gap-2">
              <button
                type="button"
                onClick={() => onOpenPicker(item.zoneId || zoneId, item.id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 text-[14px] font-medium text-primary hover:bg-primary/15"
                title="更換此產品的名稱、圖片與價錢"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                更換產品
              </button>
              <div className="inline-flex items-center overflow-hidden rounded-lg border border-border bg-background">
                <button
                  type="button"
                  onClick={() => onSetQuantity(item, item.quantity - 1)}
                  disabled={item.quantity <= 1}
                  className="flex h-9 w-9 items-center justify-center text-[17px] text-muted-foreground hover:bg-muted disabled:opacity-35"
                  aria-label="數量減一"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={item.quantity}
                  onChange={(event) =>
                    onSetQuantity(item, Number(event.target.value))
                  }
                  className="h-9 w-12 border-x border-border bg-background text-center font-mono-data text-[15px] font-semibold outline-none"
                  aria-label={`${titleLabel}數量`}
                />
                <button
                  type="button"
                  onClick={() => onSetQuantity(item, item.quantity + 1)}
                  className="flex h-9 w-9 items-center justify-center text-[17px] text-muted-foreground hover:bg-muted"
                  aria-label="數量加一"
                >
                  +
                </button>
              </div>
              <select
                value={item.status}
                onChange={(e) =>
                  onSetStatus(item.id, e.target.value as ZoneProductStatus)
                }
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[15px] font-medium',
                  ZONE_PRODUCT_STATUS_META[item.status]?.className,
                )}
              >
                <option value="pending">未確定</option>
                <option value="discussing">待討論</option>
                <option value="confirmed">已確定</option>
              </select>
              <div className="flex flex-col items-stretch gap-1.5">
                <button
                  type="button"
                  disabled={deletingProductId === item.id}
                  onClick={() => onRemove(item)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-[15px] font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
                  title="從間隔移除產品"
                >
                  {deletingProductId === item.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  刪除
                </button>
                <label
                  className="inline-flex cursor-pointer items-center justify-center gap-1.5 px-1 py-1 text-[15px] text-muted-foreground"
                  title={
                    item.isOptional
                      ? '取消可選：價錢將重新計入總計'
                      : '標記為可選：價錢不計入總計，產品仍顯示'
                  }
                >
                  <Checkbox
                    checked={Boolean(item.isOptional)}
                    onCheckedChange={() => onToggleOptional(item)}
                    className="border-foreground/60 data-[state=checked]:border-primary"
                    aria-label={`${titleLabel}可選`}
                  />
                  <span>可選</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="shrink-0 text-[15px] font-medium text-muted-foreground">
                尺寸
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={dimInputValue(effectiveL)}
                onChange={(event) =>
                  commitDimAxis('dimensionLMm', event.target.value)
                }
                placeholder="—"
                className="h-8 w-[4.5rem] rounded-md border border-border bg-background px-2 text-right font-mono-data text-[14px] text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                aria-label={`${titleLabel}長度 W`}
                title="長 (W) mm — 僅存於此設計專案"
              />
              <span className="font-mono-data text-[13px] text-muted-foreground">
                (W) x
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={dimInputValue(effectiveW)}
                onChange={(event) =>
                  commitDimAxis('dimensionWMm', event.target.value)
                }
                placeholder="—"
                className="h-8 w-[4.5rem] rounded-md border border-border bg-background px-2 text-right font-mono-data text-[14px] text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                aria-label={`${titleLabel}闊度 D`}
                title="闊 (D) mm — 僅存於此設計專案"
              />
              <span className="font-mono-data text-[13px] text-muted-foreground">
                (D) x
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={dimInputValue(effectiveH)}
                onChange={(event) =>
                  commitDimAxis('dimensionHMm', event.target.value)
                }
                placeholder="—"
                className="h-8 w-[4.5rem] rounded-md border border-border bg-background px-2 text-right font-mono-data text-[14px] text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                aria-label={`${titleLabel}高度 H`}
                title="高 (H) mm — 僅存於此設計專案"
              />
              <span className="font-mono-data text-[13px] text-muted-foreground">
                (H) (mm)
              </span>
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 text-[15px] text-foreground">
              {custom ? (
                <>
                  <span className="text-foreground">單價 $</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={Number(item.salePrice || 0)}
                    onChange={(event) =>
                      onSetSalePrice(item, Number(event.target.value))
                    }
                    className="h-8 w-28 rounded-lg border border-border bg-background px-2 font-mono-data text-[15px] text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                    aria-label="單價"
                  />
                  <span className="font-mono-data text-foreground">
                    × {item.quantity} = 小計 $
                    {(
                      Number(item.salePrice || 0) * item.quantity
                    ).toLocaleString()}
                    {item.isOptional ? '（可選，不計入總計）' : ''}
                  </span>
                </>
              ) : (
                <p className="font-mono-data text-[15px] text-foreground">
                  單價 ${Number(item.salePrice || 0).toLocaleString()} ×{' '}
                  {item.quantity}
                  {' = '}
                  小計 $
                  {(
                    Number(item.salePrice || 0) * item.quantity
                  ).toLocaleString()}
                  {item.isOptional ? '（可選，不計入總計）' : ''}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="mt-2 shrink-0 text-[15px] font-medium text-muted-foreground">
                備註
              </span>
              <textarea
                value={staffNotesValue(item.notes)}
                onChange={(event) => onSetNotes(item, event.target.value)}
                rows={3}
                placeholder="輸入意見或補充說明…"
                className="min-h-[72px] min-w-0 flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-[15px] leading-relaxed outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                aria-label={`${titleLabel}備註`}
              />
            </div>
            {feedback.length > 0 ? (
              <div className="space-y-2">
                {feedback.map((row, feedbackIndex) => {
                  const feedbackKey = `${item.id}:${feedbackIndex}`;
                  return (
                    <div
                      key={`${item.id}-feedback-${feedbackIndex}-${row.at}`}
                      className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[13px] font-medium text-amber-800 dark:text-amber-200">
                          客戶意見 · {reviewLabelZh(row.review)}
                          {' · '}
                          {fmtFeedbackTime(row.at)}
                          {row.author ? ` · ${row.author}` : ''}
                        </p>
                        <button
                          type="button"
                          disabled={deletingFeedbackKey === feedbackKey}
                          onClick={() =>
                            onDeleteFeedback(item, feedbackIndex)
                          }
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-500/30 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-500/10 disabled:opacity-50"
                          title="刪除此客戶意見"
                        >
                          {deletingFeedbackKey === feedbackKey ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          刪除
                        </button>
                      </div>
                      {row.text ? (
                        <p className="mt-1 whitespace-pre-wrap text-[15px] text-foreground">
                          {row.text}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Map saved roomOrder keys → display labels for 設計專案 group sequencing. */
function roomOrderLabels(
  projectType: ProjectEngineeringType | string,
  customRooms: CustomRoomType[],
  roomOrder: string[],
  labelOverrides?: Record<string, string> | null,
): string[] {
  const templates = applyRoomLabelOverrides(
    roomsForProjectType(projectType as ProjectEngineeringType),
    labelOverrides,
  );
  const byKey = new Map<string, string>();
  for (const room of templates) byKey.set(room.key, room.label);
  for (const room of customRooms) byKey.set(room.key, room.label);
  const labels: string[] = [];
  for (const key of roomOrder) {
    const label = byKey.get(key);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function DesignProjectsView() {
  const appStore = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const routeProjectId = useMemo(() => {
    const parsed = parseDesignProjectPathname(location.pathname);
    return parsed?.kind === 'project' ? parsed.projectId : '';
  }, [location.pathname]);
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(routeProjectId);
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pmNames, setPmNames] = useState<Record<string, string>>({});

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerZoneId, setPickerZoneId] = useState<string | null>(null);
  /** When set, product picker replaces this zone_product instead of adding. */
  const [replacingZoneProductId, setReplacingZoneProductId] = useState<
    string | null
  >(null);
  /** Assign newly added products to this furniture division (if any). */
  const [pickerDivisionId, setPickerDivisionId] = useState<string | null>(null);
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  /** Catalog dims / factory keyed by products.id for zone product rows. */
  const [productMetaById, setProductMetaById] = useState<
    Record<string, ProductDisplayMeta>
  >({});
  const [keyword, setKeyword] = useState('');
  const [productLevel1, setProductLevel1] = useState('');
  const [productLevel2, setProductLevel2] = useState('');
  /** Canonical factory name selected in 選擇產品 filter; empty = all. */
  const [factoryFilter, setFactoryFilter] = useState('');
  const [factoryFilterOpen, setFactoryFilterOpen] = useState(false);
  const [factoryQuery, setFactoryQuery] = useState('');
  const factoryFilterRef = useRef<HTMLDivElement | null>(null);
  const [zoneAreasSqft, setZoneAreasSqft] = useState<Record<string, string>>(
    {},
  );
  const [furnitureDivisions, setFurnitureDivisions] = useState<
    Record<string, ZoneFurnitureDivision[]>
  >({});
  const [divisionModalZoneId, setDivisionModalZoneId] = useState<string | null>(
    null,
  );
  const [divisionLevel1, setDivisionLevel1] = useState('');
  const [divisionLevel2, setDivisionLevel2] = useState('');
  const [divisionQty, setDivisionQty] = useState(1);
  const [categoryPairs, setCategoryPairs] = useState<ProductCategoryPair[]>([]);
  const [confirmingProject, setConfirmingProject] = useState(false);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [creatingBlankZoneId, setCreatingBlankZoneId] = useState<string | null>(null);
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null);
  const [savingFurniture, setSavingFurniture] = useState(false);
  const [furnitureDirty, setFurnitureDirty] = useState(false);
  const [deletingFeedbackKey, setDeletingFeedbackKey] = useState<string | null>(
    null,
  );
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(
    null,
  );
  const [floorPlanViewerOpen, setFloorPlanViewerOpen] = useState(false);
  const [imageUploadItem, setImageUploadItem] = useState<ZoneProduct | null>(
    null,
  );
  const furnitureDirtyRef = useRef(false);

  useEffect(() => {
    furnitureDirtyRef.current = furnitureDirty;
  }, [furnitureDirty]);

  const selectProject = useCallback(
    (projectId: string, opts?: { force?: boolean }) => {
      const nextId = (projectId || '').trim();
      if (!nextId || nextId === activeProjectId) return;
      if (
        !opts?.force &&
        furnitureDirtyRef.current &&
        !window.confirm('目前傢俬配置尚未儲存，確定切換專案？')
      ) {
        return;
      }
      setActiveProjectId(nextId);
      setFurnitureDirty(false);
      // Push URL in the same turn so the follow-URL effect never sees a
      // stale pathname and snaps selection back to the previous project.
      navigate(buildDesignProjectPath(nextId));
    },
    [activeProjectId, navigate],
  );

  useEffect(() => {
    const focusId = consumeSolutionFocusProjectId();
    const urlId = routeProjectId;
    let cancelled = false;
    fetchProjects()
      .then((rows) => {
        if (cancelled) return;
        setProjects(rows);
        // Unblock zone loading immediately — PM labels can resolve in background.
        if (urlId && rows.some((r) => r.id === urlId)) {
          setActiveProjectId(urlId);
        } else if (focusId && rows.some((r) => r.id === focusId)) {
          setActiveProjectId(focusId);
        } else if (urlId && rows.length > 0) {
          toast.error('找不到此設計專案連結，已改為顯示可存取的專案');
          setActiveProjectId(rows[0].id);
        } else if (rows.length > 0) {
          setActiveProjectId((cur) =>
            cur && rows.some((r) => r.id === cur) ? cur : rows[0].id,
          );
        }
        setProjectsLoaded(true);
        void resolveDesignProjectPmLabels(rows).then((labels) => {
          if (!cancelled) setPmNames(labels);
        });
      })
      .catch(() => {
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // Only on mount — URL changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track pathname changes so we only adopt URL → selection on real navigation
  // (shared link / back-forward), never when only activeProjectId just changed.
  const prevPathnameRef = useRef(location.pathname);
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;

  // Follow browser URL (shared link / back-forward) after projects are loaded.
  useEffect(() => {
    if (!projectsLoaded) return;
    const pathnameChanged = prevPathnameRef.current !== location.pathname;
    prevPathnameRef.current = location.pathname;
    if (!pathnameChanged) return;

    const parsed = parseDesignProjectPathname(location.pathname);
    if (parsed?.kind !== 'project') return;
    if (parsed.projectId === activeProjectIdRef.current) return;
    if (!projects.some((project) => project.id === parsed.projectId)) {
      if (projects.length > 0) {
        toast.error('找不到此設計專案連結');
        selectProject(projects[0].id, { force: true });
      }
      return;
    }
    if (
      furnitureDirtyRef.current &&
      !window.confirm('目前傢俬配置尚未儲存，確定切換專案？')
    ) {
      navigate(buildDesignProjectPath(activeProjectIdRef.current), {
        replace: true,
      });
      return;
    }
    setActiveProjectId(parsed.projectId);
    setFurnitureDirty(false);
  }, [location.pathname, navigate, projects, projectsLoaded, selectProject]);

  // Keep address bar on the active project's shareable URL (initial entry /
  // focus handoff). Dropdown switches navigate inside selectProject.
  useEffect(() => {
    if (!projectsLoaded || !activeProjectId) return;
    const target = buildDesignProjectPath(activeProjectId);
    if (location.pathname === target) return;
    const parsed = parseDesignProjectPathname(location.pathname);
    // Push history when switching between projects; replace when entering the view.
    navigate(target, { replace: parsed?.kind !== 'project' });
  }, [activeProjectId, location.pathname, navigate, projectsLoaded]);

  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  /** Bump to ignore stale async reloadZones results (prevents load flicker loops). */
  const reloadGenRef = useRef(0);
  /** Heal sync once per project id per mount (avoids sync↔reload loops). */
  const healedProjectIdsRef = useRef(new Set<string>());

  const reloadZones = useCallback(async (projectId: string) => {
    const gen = ++reloadGenRef.current;
    setLoading(true);
    setZones([]);
    setZoneProducts([]);
    try {
      const projectRow =
        projectsRef.current.find((p) => p.id === projectId) || null;
      const [z, zp] = await Promise.all([
        fetchZones(projectId),
        fetchZoneProducts(projectId),
      ]);
      if (gen !== reloadGenRef.current) return;

      // Paint first — never block the spinner on sequential zone sync.
      const optionalIds = normalizeOptionalZoneProductIds(
        projectRow?.meta?.optionalZoneProductIds,
      );
      setZones(z);
      setZoneProducts(withOptionalFlags(zp, optionalIds));
      setFurnitureDirty(false);
      setLoading(false);

      // Projects that already have furniture are trusted; structure sync belongs
      // to 方案列表「儲存」. Heal only empty / not-yet-configured projects.
      if (z.length > 0 && zp.length > 0) return z;

      const meta = projectRow?.meta;
      const roomCounts = meta?.roomCounts;
      if (!roomCounts || typeof roomCounts !== 'object') return z;

      const projectType = (meta?.projectType ||
        inferProjectType(
          projectRow?.name || '',
          projectRow?.clientCompany,
        )) as ProjectEngineeringType;
      const customRooms = normalizeCustomRooms(meta?.customRooms);
      const hasSavedOrder = Array.isArray(meta?.roomOrder);
      const roomOrder = normalizeRoomOrder(meta?.roomOrder);
      const labelOverrides = normalizeRoomLabelOverrides(
        meta?.roomLabelOverrides,
      );
      const desired = zoneSeedsFromRoomCounts(
        projectType,
        roomCounts as Record<string, number>,
        customRooms as RoomTypeTemplate[],
        hasSavedOrder ? roomOrder : null,
        labelOverrides,
      );
      const alreadyHealed = healedProjectIdsRef.current.has(projectId);
      if (
        !hasSavedOrder ||
        alreadyHealed ||
        desired.length === 0 ||
        !zonesOutOfSyncWithSeeds(desired, z)
      ) {
        return z;
      }

      healedProjectIdsRef.current.add(projectId);
      const synced = await syncProjectZones({
        projectId,
        desired,
        zones: z,
        zoneProducts: zp,
        pruneEmpty: true,
        dropOrphanZones: true,
      });
      if (gen !== reloadGenRef.current) return z;
      if (synced.ok && synced.data) {
        const nextProducts = await fetchZoneProducts(projectId);
        if (gen !== reloadGenRef.current) return synced.data;
        setZones(synced.data);
        setZoneProducts(withOptionalFlags(nextProducts, optionalIds));
        toast.success('已同步房間清單', {
          description: '已與方案列表的房間類型及數量對齊',
        });
        return synced.data;
      }
      healedProjectIdsRef.current.delete(projectId);
      toast.error('同步房間失敗', {
        description: synced.error || '請到方案列表重新按「儲存」',
      });
      return z;
    } catch {
      if (gen === reloadGenRef.current) setLoading(false);
      return [];
    }
  }, []);

  useEffect(() => {
    if (!activeProjectId || !projectsLoaded) return;
    setFloorPlanViewerOpen(false);
    void reloadZones(activeProjectId);
  }, [activeProjectId, projectsLoaded, reloadZones]);

  const patchProduct = useCallback(
    (productId: string, patch: Partial<ZoneProduct>) => {
      setZoneProducts((current) =>
        current.map((product) =>
          product.id === productId ? { ...product, ...patch } : product,
        ),
      );
      setFurnitureDirty(true);
    },
    [],
  );

  const project = projects.find((p) => p.id === activeProjectId) || null;
  const projectType =
    project?.meta?.projectType ||
    inferProjectType(project?.name || '', project?.clientCompany);

  useEffect(() => {
    if (!project) {
      setZoneAreasSqft({});
      setFurnitureDivisions({});
      return;
    }
    setZoneAreasSqft(normalizeZoneAreasSqft(project.meta?.zoneAreasSqft));
    setFurnitureDivisions(
      normalizeFurnitureDivisions(project.meta?.furnitureDivisions),
    );
    // Hydrate planning fields when switching projects only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const persistPlanningMeta = useCallback(
    (
      nextSqft: Record<string, string>,
      nextDivisions: Record<string, ZoneFurnitureDivision[]>,
    ) => {
      if (!project) return;
      // Keep planning fields on the in-memory project so「儲存方案」can write them,
      // but avoid doing this on every sqft keystroke (causes TopBar sticky republish jump).
      setProjects((current) =>
        current.map((row) =>
          row.id === project.id
            ? {
                ...row,
                meta: {
                  ...row.meta,
                  zoneAreasSqft: zoneAreasSqftMetaFromState(nextSqft),
                  furnitureDivisions: nextDivisions,
                },
              }
            : row,
        ),
      );
      setFurnitureDirty(true);
    },
    [project],
  );
  const zoneGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        label: string;
        zones: ProjectZone[];
        minSort: number;
      }
    >();
    // Zones are already sorted by sort_order from fetchZones; preserve that
    // so「方案列表」drag order shows the same sequence here.
    const sortedZones = [...zones].sort(
      (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0),
    );
    for (const zone of sortedZones) {
      const label = zoneBaseName(zone.name);
      const key = label;
      const group = groups.get(key) || {
        key,
        label,
        zones: [],
        minSort: zone.sortOrder || 0,
      };
      group.zones.push(zone);
      group.minSort = Math.min(group.minSort, zone.sortOrder || 0);
      groups.set(key, group);
    }
    const list = [...groups.values()];
    // Prefer explicit meta.roomOrder (方案列表「儲存」) over zone sort_order alone.
    // Only show room types that still exist on 方案列表.
    const savedOrder = normalizeRoomOrder(project?.meta?.roomOrder);
    if (savedOrder.length > 0) {
      const labelRank = roomOrderLabels(
        projectType,
        normalizeCustomRooms(project?.meta?.customRooms),
        savedOrder,
        normalizeRoomLabelOverrides(project?.meta?.roomLabelOverrides),
      );
      const allowed = new Set(labelRank);
      const rank = new Map(labelRank.map((label, index) => [label, index]));
      return list
        .filter((group) => allowed.has(group.label))
        .sort((a, b) => {
          const aRank = rank.has(a.label) ? rank.get(a.label)! : 1000 + a.minSort;
          const bRank = rank.has(b.label) ? rank.get(b.label)! : 1000 + b.minSort;
          if (aRank !== bRank) return aRank - bRank;
          return a.minSort - b.minSort;
        });
    }
    return list.sort((a, b) => a.minSort - b.minSort);
  }, [
    project?.meta?.customRooms,
    project?.meta?.roomLabelOverrides,
    project?.meta?.roomOrder,
    projectType,
    zones,
  ]);

  const scrollToZoneGroup = useCallback((label: string) => {
    const target = document.getElementById(zoneGroupDomId(label));
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const partitionStickySentinelRef = useRef<HTMLDivElement | null>(null);
  const [partitionHeaderPinned, setPartitionHeaderPinned] = useState(false);
  const saveFurnitureRef = useRef<() => void>(() => {});
  const openFloorPlanRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Avoid observing while the list is a spinner — loading toggles used to
    // reconnect the observer and flip TopBar sticky height (page jump).
    if (loading) return;
    const node = partitionStickySentinelRef.current;
    const root = pageScrollRef.current;
    if (!node || !root || typeof IntersectionObserver === 'undefined') {
      setPartitionHeaderPinned(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Pin TopBar chrome once the in-page「間隔清單」block scrolls above the list.
        const nextPinned =
          !entry.isIntersecting &&
          entry.boundingClientRect.top < root.getBoundingClientRect().top;
        setPartitionHeaderPinned((current) =>
          current === nextPinned ? current : nextPinned,
        );
      },
      { root, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [project?.id, loading, zoneGroups.length]);

  useEffect(
    () => () => {
      publishDesignProjectStickyChrome(null);
    },
    [],
  );

  const furnitureGrandTotal = useMemo(
    () =>
      zoneProducts.reduce(
        (sum, item) => sum + zoneProductBillableTotal(item),
        0,
      ),
    [zoneProducts],
  );

  const mergeProductMetaFromSearch = useCallback((rows: SearchProduct[]) => {
    if (rows.length === 0) return;
    setProductMetaById((current) => {
      let changed = false;
      const next = { ...current };
      for (const row of rows) {
        const id = String(row.id || '').trim();
        if (!id) continue;
        const meta: ProductDisplayMeta = {
          dimensionLMm: row.dimensionLMm ?? null,
          dimensionWMm: row.dimensionWMm ?? null,
          dimensionHMm: row.dimensionHMm ?? null,
          factoryName: (row.factoryName || '').trim(),
        };
        const prev = next[id];
        if (
          !prev ||
          prev.dimensionLMm !== meta.dimensionLMm ||
          prev.dimensionWMm !== meta.dimensionWMm ||
          prev.dimensionHMm !== meta.dimensionHMm ||
          prev.factoryName !== meta.factoryName
        ) {
          next[id] = meta;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  useEffect(() => {
    const ids = [
      ...new Set(
        zoneProducts
          .map((item) => String(item.productId || '').trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) return;
    let cancelled = false;
    void fetchProductsDisplayMeta(ids).then((meta) => {
      if (cancelled || Object.keys(meta).length === 0) return;
      setProductMetaById((current) => ({ ...current, ...meta }));
    });
    return () => {
      cancelled = true;
    };
  }, [zoneProducts]);

  const closePicker = () => {
    setPickerOpen(false);
    setReplacingZoneProductId(null);
    setPickerDivisionId(null);
    setFactoryFilter('');
    setFactoryFilterOpen(false);
    setFactoryQuery('');
  };

  const openPicker = async (
    zoneId?: string | null,
    replaceZoneProductId?: string | null,
    opts?: { level1?: string; level2?: string; divisionId?: string | null },
  ) => {
    setPickerZoneId(zoneId ?? null);
    setReplacingZoneProductId(replaceZoneProductId ?? null);
    setPickerDivisionId(opts?.divisionId ?? null);
    setProductLevel1(opts?.level1 ?? '');
    setProductLevel2(opts?.level2 ?? '');
    setKeyword('');
    setFactoryFilter('');
    setFactoryFilterOpen(false);
    setFactoryQuery('');
    setPickerOpen(true);
    if (products.length === 0) {
      setProductsLoading(true);
      fetchActiveShopifyProducts(1000)
        .then((rows) => {
          setProducts(rows);
          mergeProductMetaFromSearch(rows);
        })
        .finally(() => setProductsLoading(false));
    }
  };

  const openDivisionModal = async (zoneId: string) => {
    setDivisionModalZoneId(zoneId);
    setDivisionLevel1('');
    setDivisionLevel2('');
    setDivisionQty(1);
    if (categoryPairs.length === 0) {
      const pairs = await fetchProductCategoryPairs();
      setCategoryPairs(pairs);
    }
    if (products.length === 0) {
      setProductsLoading(true);
      fetchActiveShopifyProducts(1000)
        .then((rows) => {
          setProducts(rows);
          mergeProductMetaFromSearch(rows);
        })
        .finally(() => setProductsLoading(false));
    }
  };

  const confirmDivisionModal = () => {
    if (!divisionModalZoneId) return;
    const level1 = divisionLevel1.trim();
    if (!level1) {
      toast.error('請選擇一級分類');
      return;
    }
    const qty = Math.max(1, Math.min(9999, Math.floor(divisionQty || 1)));
    const division: ZoneFurnitureDivision = {
      id: newDivisionId(),
      level1,
      level2: divisionLevel2.trim(),
      quantity: qty,
      productIds: [],
    };
    const next = {
      ...furnitureDivisions,
      [divisionModalZoneId]: [
        ...(furnitureDivisions[divisionModalZoneId] || []),
        division,
      ],
    };
    setFurnitureDivisions(next);
    persistPlanningMeta(zoneAreasSqft, next);
    setDivisionModalZoneId(null);
    toast.success('已加入傢俬劃分', {
      description: `${level1}${division.level2 ? ` > ${division.level2}` : ''} · ${qty} 件（記得按儲存方案）`,
    });
  };

  const removeDivision = (zoneId: string, divisionId: string) => {
    const target = (furnitureDivisions[zoneId] || []).find(
      (row) => row.id === divisionId,
    );
    if (!target) return;
    if (
      !window.confirm(
        `確定刪除劃分「${target.level1}${target.level2 ? ` > ${target.level2}` : ''}」？劃分下的產品會改為未劃分。`,
      )
    ) {
      return;
    }
    const next = {
      ...furnitureDivisions,
      [zoneId]: (furnitureDivisions[zoneId] || []).filter(
        (row) => row.id !== divisionId,
      ),
    };
    setFurnitureDivisions(next);
    persistPlanningMeta(zoneAreasSqft, next);
    setFurnitureDirty(true);
  };

  const setZoneSqft = (zoneId: string, value: string) => {
    const cleaned = value.replace(/[^\d.]/g, '');
    const parts = cleaned.split('.');
    const normalized =
      parts.length <= 1
        ? cleaned
        : `${parts[0]}.${parts.slice(1).join('').replace(/\./g, '')}`;
    // Local state only while typing — sync into project.meta on blur / save.
    setZoneAreasSqft((current) => ({ ...current, [zoneId]: normalized }));
    setFurnitureDirty(true);
  };

  const flushZoneSqftToProjectMeta = useCallback(() => {
    if (!project) return;
    setProjects((current) =>
      current.map((row) =>
        row.id === project.id
          ? {
              ...row,
              meta: {
                ...row.meta,
                zoneAreasSqft: zoneAreasSqftMetaFromState(zoneAreasSqft),
                furnitureDivisions,
              },
            }
          : row,
      ),
    );
  }, [furnitureDivisions, project, zoneAreasSqft]);

  const replaceZoneProduct = (product: SearchProduct) => {
    if (!replacingZoneProductId) return;
    const current = zoneProducts.find(
      (item) => item.id === replacingZoneProductId,
    );
    if (!current) {
      toast.error('找不到要更換的產品');
      return;
    }
    mergeProductMetaFromSearch([product]);
    patchProduct(replacingZoneProductId, {
      productId: product.id,
      productTitle: product.title,
      productImageUrl: product.imageUrl || '',
      salePrice: Number(product.salePrice) || 0,
      // Snapshot catalog dims into this project row (never writes products table).
      dimensionLMm: product.dimensionLMm ?? null,
      dimensionWMm: product.dimensionWMm ?? null,
      dimensionHMm: product.dimensionHMm ?? null,
    });
    toast.success('已更換產品', {
      description: `${current.productTitle || '未命名產品'} → ${product.title}（記得按儲存）`,
    });
    closePicker();
  };

  const addProductToZone = async (product: SearchProduct) => {
    if (replacingZoneProductId) {
      replaceZoneProduct(product);
      return;
    }
    mergeProductMetaFromSearch([product]);
    if (!activeProjectId) return;
    const zoneId = pickerZoneId || zones[0]?.id || null;
    if (!zoneId) {
      toast.error('請先設定間隔數量');
      return;
    }
    const res = await createZoneProduct({
      projectId: activeProjectId,
      zoneId,
      productId: product.id,
      productTitle: product.title,
      productImageUrl: product.imageUrl,
      salePrice: product.salePrice,
      scheme: project?.activeScheme || 'A',
      quantity: 1,
      status: 'pending',
      dimensionLMm: product.dimensionLMm ?? null,
      dimensionWMm: product.dimensionWMm ?? null,
      dimensionHMm: product.dimensionHMm ?? null,
    });
    if (res.ok && res.data) {
      setZoneProducts((prev) => [...prev, res.data!]);
      if (pickerDivisionId) {
        const next = {
          ...furnitureDivisions,
          [zoneId]: (furnitureDivisions[zoneId] || []).map((row) =>
            row.id === pickerDivisionId
              ? {
                  ...row,
                  productIds: [...(row.productIds || []), res.data!.id],
                }
              : row,
          ),
        };
        setFurnitureDivisions(next);
        persistPlanningMeta(zoneAreasSqft, next);
      } else {
        setFurnitureDirty(true);
      }
      toast.success('已加入間隔', {
        description: `${product.title} → ${zones.find((z) => z.id === zoneId)?.name || '間隔'}（記得按儲存）`,
      });
    } else {
      toast.error('加入失敗', { description: res.error });
    }
  };

  const setStatus = (id: string, status: ZoneProductStatus) => {
    patchProduct(id, { status });
  };

  const removeProduct = async (item: ZoneProduct) => {
    if (!activeProjectId || deletingProductId) return;
    if (
      !window.confirm(
        `確定從此間隔移除「${item.productTitle || '未命名產品'}」？`,
      )
    )
      return;
    setDeletingProductId(item.id);
    const result = await deleteZoneProductWithProgress(
      item.id,
      activeProjectId,
    );
    setDeletingProductId(null);
    if (!result.ok) {
      toast.error('刪除產品失敗', { description: result.error });
      return;
    }
    setZoneProducts((current) =>
      current.filter((product) => product.id !== item.id),
    );
    if (item.zoneId && (furnitureDivisions[item.zoneId] || []).length > 0) {
      const next = {
        ...furnitureDivisions,
        [item.zoneId]: (furnitureDivisions[item.zoneId] || []).map((row) => ({
          ...row,
          productIds: (row.productIds || []).filter((pid) => pid !== item.id),
        })),
      };
      setFurnitureDivisions(next);
      persistPlanningMeta(zoneAreasSqft, next);
    } else {
      setFurnitureDirty(true);
    }
    toast.success('已從間隔移除產品', {
      description: item.productTitle || '未命名產品',
    });
  };

  const setNotes = (item: ZoneProduct, value: string) => {
    patchProduct(item.id, {
      notes: mergeStaffNotesKeepingFeedback(item.notes, value),
    });
  };

  const deleteClientFeedback = async (
    item: ZoneProduct,
    feedbackIndex: number,
  ) => {
    const feedbackKey = `${item.id}:${feedbackIndex}`;
    if (deletingFeedbackKey) return;
    if (!window.confirm('確定刪除此客戶意見？')) return;
    const nextNotes = removeClientFeedbackFromNotes(item.notes, feedbackIndex);
    setDeletingFeedbackKey(feedbackKey);
    const previous = item.notes;
    patchProduct(item.id, { notes: nextNotes });
    const result = await updateZoneProductNotes(item.id, nextNotes);
    setDeletingFeedbackKey(null);
    if (!result.ok) {
      patchProduct(item.id, { notes: previous });
      toast.error('刪除客戶意見失敗', { description: result.error });
      return;
    }
    setFurnitureDirty(true);
    toast.success('已刪除客戶意見');
  };

  const addBlankProduct = async (
    zoneId: string,
    divisionId?: string | null,
  ) => {
    if (!activeProjectId || creatingBlankZoneId) return;
    const busyKey = divisionId ? `${zoneId}:${divisionId}` : zoneId;
    setCreatingBlankZoneId(busyKey);
    const result = await createZoneProduct({
      projectId: activeProjectId,
      zoneId,
      productId: null,
      productTitle: '',
      productImageUrl: '',
      salePrice: 0,
      notes: '',
      scheme: project?.activeScheme || 'A',
      quantity: 1,
      status: 'pending',
    });
    setCreatingBlankZoneId(null);
    if (!result.ok || !result.data) {
      toast.error('新增欄位失敗', { description: result.error });
      return;
    }
    setZoneProducts((prev) => [...prev, result.data!]);
    if (divisionId) {
      const next = {
        ...furnitureDivisions,
        [zoneId]: (furnitureDivisions[zoneId] || []).map((row) =>
          row.id === divisionId
            ? {
                ...row,
                productIds: [...(row.productIds || []), result.data!.id],
              }
            : row,
        ),
      };
      setFurnitureDivisions(next);
      persistPlanningMeta(zoneAreasSqft, next);
    } else {
      setFurnitureDirty(true);
    }
    toast.success('已新增空白產品欄位', {
      description: '請填寫後按上方「儲存」寫入專案',
    });
  };

  const setProductTitle = (item: ZoneProduct, value: string) => {
    patchProduct(item.id, { productTitle: value });
  };

  const setSalePrice = (item: ZoneProduct, value: number) => {
    const salePrice = Math.max(0, Number.isFinite(value) ? value : 0);
    patchProduct(item.id, { salePrice });
  };

  const setDimensions = (
    item: ZoneProduct,
    patch: {
      dimensionLMm: number | null;
      dimensionWMm: number | null;
      dimensionHMm: number | null;
    },
  ) => {
    patchProduct(item.id, {
      dimensionLMm: patch.dimensionLMm,
      dimensionWMm: patch.dimensionWMm,
      dimensionHMm: patch.dimensionHMm,
    });
  };

  const uploadProductImage = async (item: ZoneProduct, file: File | null) => {
    if (!file) return;
    // Blank / custom rows, or catalog rows missing an image.
    if (!isCustomZoneProduct(item) && item.productImageUrl) return;
    setUploadingImageId(item.id);
    try {
      // Upload to Storage first; DB + design_projects.meta flush on「儲存」.
      const url = await uploadFileToStorage(file, item.id, 'zone');
      patchProduct(item.id, { productImageUrl: url });
      setImageUploadItem(null);
      toast.success('產品圖片已上傳', {
        description: '請按「儲存方案」寫入專案資料',
      });
    } catch (error) {
      toast.error('上傳圖片失敗', {
        description: error instanceof Error ? error.message : '請稍後再試',
      });
      throw error;
    } finally {
      setUploadingImageId(null);
    }
  };

  const setQuantity = (item: ZoneProduct, value: number) => {
    const quantity = Math.max(1, Math.min(9999, Math.floor(value || 1)));
    patchProduct(item.id, { quantity });
  };

  const toggleOptional = (item: ZoneProduct) => {
    patchProduct(item.id, { isOptional: !item.isOptional });
  };

  const saveFurniture = async () => {
    if (!project || savingFurniture) return;
    if (typeof document !== 'undefined') {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    }
    const excessWarnings = collectDivisionExcessWarnings(
      zones,
      zoneProducts,
      furnitureDivisions,
    );
    if (excessWarnings.length > 0) {
      toast.error('部份二級分類傢俬數量過多', {
        description:
          excessWarnings.slice(0, 4).join('；') +
          (excessWarnings.length > 4
            ? `；…另有 ${excessWarnings.length - 4} 項`
            : '') +
          '。請將超出計劃的產品轉為「可選」後再儲存。',
        duration: 8000,
      });
      return;
    }
    setSavingFurniture(true);
    try {
      // Allow controlled inputs to flush latest keystrokes into state.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const optionalZoneProductIds = zoneProducts
        .filter((product) => product.isOptional)
        .map((product) => product.id);
      const projectWithPlanning = {
        ...project,
        meta: {
          ...project.meta,
          zoneAreasSqft: zoneAreasSqftMetaFromState(zoneAreasSqft),
          furnitureDivisions,
          optionalZoneProductIds,
          furnitureSnapshot: project.meta?.furnitureSnapshot,
        },
      };
      const result = await persistDesignProjectFurniture({
        project: projectWithPlanning,
        zones,
        products: zoneProducts,
      });
      if (!result.ok || !result.data) {
        toast.error('儲存失敗', { description: result.error });
        return;
      }
      setZoneProducts(
        withOptionalFlags(result.data.products, optionalZoneProductIds),
      );
      setProjects((current) =>
        current.map((row) =>
          row.id === project.id
            ? {
                ...row,
                meta: {
                  ...row.meta,
                  zoneAreasSqft: zoneAreasSqftMetaFromState(zoneAreasSqft),
                  furnitureDivisions,
                  optionalZoneProductIds,
                  furnitureSnapshot: result.data!.snapshot,
                },
              }
            : row,
        ),
      );
      setFurnitureDirty(false);
      toast.success('已儲存方案', {
        description: `${result.data.snapshot.zoneCount} 個間隔 · ${result.data.snapshot.productCount} 件產品已寫入 design_projects`,
      });
    } finally {
      setSavingFurniture(false);
    }
  };

  const submitProject = async () => {
    if (!project || confirmingProject) return;
    const selectedProducts = zoneProducts.filter((product) => product.zoneId);
    if (zones.length === 0 || selectedProducts.length === 0) {
      toast.error('請先設定間隔並加入產品');
      return;
    }
    const excessWarnings = collectDivisionExcessWarnings(
      zones,
      zoneProducts,
      furnitureDivisions,
    );
    if (excessWarnings.length > 0) {
      toast.error('部份二級分類傢俬數量過多', {
        description:
          excessWarnings.slice(0, 4).join('；') +
          (excessWarnings.length > 4
            ? `；…另有 ${excessWarnings.length - 4} 項`
            : '') +
          '。請將超出計劃的產品轉為「可選」後再提交。',
        duration: 8000,
      });
      return;
    }
    setConfirmingProject(true);
    if (furnitureDirty) {
      const optionalZoneProductIds = zoneProducts
        .filter((product) => product.isOptional)
        .map((product) => product.id);
      const flushed = await persistDesignProjectFurniture({
        project: {
          ...project,
          meta: {
            ...project.meta,
            zoneAreasSqft: zoneAreasSqftMetaFromState(zoneAreasSqft),
            furnitureDivisions,
            optionalZoneProductIds,
          },
        },
        zones,
        products: zoneProducts,
      });
      if (!flushed.ok || !flushed.data) {
        setConfirmingProject(false);
        toast.error('提交前儲存失敗', { description: flushed.error });
        return;
      }
      setZoneProducts(
        withOptionalFlags(flushed.data.products, optionalZoneProductIds),
      );
      setProjects((current) =>
        current.map((row) =>
          row.id === project.id
            ? {
                ...row,
                meta: {
                  ...row.meta,
                  zoneAreasSqft: zoneAreasSqftMetaFromState(zoneAreasSqft),
                  furnitureDivisions,
                  optionalZoneProductIds,
                  furnitureSnapshot: flushed.data!.snapshot,
                },
              }
            : row,
        ),
      );
      setFurnitureDirty(false);
    }
    const result = await saveProject(project.id, {
      status: 'confirmed',
      progress: 100,
    });
    setConfirmingProject(false);
    if (!result.ok) {
      toast.error('提交方案失敗', { description: result.error });
      return;
    }
    setProjects((current) =>
      current.map((row) =>
        row.id === project.id
          ? { ...row, status: 'confirmed', progress: 100 }
          : row,
      ),
    );
    toast.success('方案已提交', {
      description: `${zones.length} 個間隔 · ${selectedProducts.length} 件產品；已標示為已確認`,
    });
    appStore.setCurrentView('confirmed-projects');
  };

  saveFurnitureRef.current = () => {
    void saveFurniture();
  };
  openFloorPlanRef.current = () => {
    if (!project?.floorPlanUrl) {
      toast.error('尚未上傳平面圖');
      return;
    }
    setFloorPlanViewerOpen(true);
  };

  useEffect(() => {
    if (!project?.id) {
      publishDesignProjectStickyChrome(null);
      return;
    }
    publishDesignProjectStickyChrome({
      active: partitionHeaderPinned,
      zoneGroups: zoneGroups.map((group) => ({
        key: group.key,
        label: group.label,
        count: group.zones.length,
        plannedTotal: plannedFurnitureTotalForZones(
          group.zones.map((zone) => zone.id),
          furnitureDivisions,
        ),
      })),
      saving: savingFurniture,
      hasFloorPlan: Boolean(project.floorPlanUrl),
      onSave: () => saveFurnitureRef.current(),
      onViewFloorPlan: () => openFloorPlanRef.current(),
      onJump: (label) => scrollToZoneGroup(label),
    });
    // Depend on stable project fields only — not the whole `project` object
    // (sqft keystrokes used to rewrite project.meta and republish TopBar every char).
  }, [
    furnitureDivisions,
    partitionHeaderPinned,
    project?.floorPlanUrl,
    project?.id,
    savingFurniture,
    scrollToZoneGroup,
    zoneGroups,
  ]);

  const factoryOptions = useMemo(
    () => dedupeFactoryNames(products.map((product) => product.factoryName || '')),
    [products],
  );

  const filteredFactoryOptions = useMemo(() => {
    const q = factoryQuery.trim().toLowerCase();
    if (!q) return factoryOptions;
    return factoryOptions.filter((name) => name.toLowerCase().includes(q));
  }, [factoryOptions, factoryQuery]);

  useEffect(() => {
    if (!factoryFilterOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const node = factoryFilterRef.current;
      if (!node) return;
      if (event.target instanceof Node && !node.contains(event.target)) {
        setFactoryFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [factoryFilterOpen]);

  const filteredProducts = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const selectedFactory = normalizeFactoryDisplayName(factoryFilter);
    return products.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
      if (productLevel1 && p.level1Category !== productLevel1) return false;
      if (productLevel2 && p.level2Category !== productLevel2) return false;
      if (
        selectedFactory &&
        normalizeFactoryDisplayName(p.factoryName) !== selectedFactory
      ) {
        return false;
      }
      return true;
    });
  }, [products, keyword, productLevel1, productLevel2, factoryFilter]);

  const productLevel1Options = useMemo(
    () =>
      [...new Set(products.map((product) => product.level1Category).filter(Boolean))] as string[],
    [products],
  );
  const productLevel2Options = useMemo(
    () =>
      [
        ...new Set(
          products
            .filter(
              (product) =>
                product.level1Category === productLevel1 &&
                product.level2Category,
            )
            .map((product) => product.level2Category as string),
        ),
      ],
    [productLevel1, products],
  );

  const divisionLevel1Options = useMemo(() => {
    const fromPairs = categoryPairs.map((pair) => pair.level1);
    const fromProducts = products
      .map((product) => product.level1Category)
      .filter(Boolean) as string[];
    return [...new Set([...fromPairs, ...fromProducts])];
  }, [categoryPairs, products]);

  const divisionLevel2Options = useMemo(() => {
    if (!divisionLevel1) return [] as string[];
    const fromPairs = categoryPairs
      .filter((pair) => pair.level1 === divisionLevel1 && pair.level2)
      .map((pair) => pair.level2);
    const fromProducts = products
      .filter(
        (product) =>
          product.level1Category === divisionLevel1 && product.level2Category,
      )
      .map((product) => product.level2Category as string);
    return [...new Set([...fromPairs, ...fromProducts])];
  }, [categoryPairs, divisionLevel1, products]);

  if (!project) {
    if (!projectsLoaded) {
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <LayoutGrid className="h-10 w-10 text-muted-foreground/40" />
        <h2 className="font-display text-lg font-bold">尚無設計專案</h2>
        <p className="text-sm text-muted-foreground">請先到「方案列表」建立專案並上傳平面圖</p>
      </div>
    );
  }

  const floorPlanPreviewUrl = floorPlanPreviewOf(project);
  const hasFloorPlan = Boolean(project.floorPlanUrl);

  return (
    <div ref={pageScrollRef} className="h-full overflow-y-auto bg-background">
      {/* Header */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3.5 py-4 md:flex-row md:items-center md:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-2xl font-bold tracking-tight">
                設計專案
              </h1>
              <span className="text-sm font-medium text-muted-foreground">
                （客戶專區 &gt; 報價方案）
              </span>
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
              <select
                value={activeProjectId}
                onChange={(e) => selectProject(e.target.value)}
                className="h-10 min-w-[280px] max-w-xl flex-1 truncate rounded-lg border border-border bg-card px-3 font-display text-sm font-semibold"
                aria-label="選擇設計專案"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {activeProjectId ? (
                <button
                  type="button"
                  onClick={() => {
                    const path = buildDesignProjectPath(activeProjectId);
                    const url = `${window.location.origin}${path}`;
                    void navigator.clipboard.writeText(url).then(
                      () => toast.success('已複製專案連結'),
                      () => toast.error('無法複製連結', { description: url }),
                    );
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
                  title="複製此專案的獨立連結"
                >
                  <Link2 className="h-4 w-4" />
                  複製連結
                </button>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            disabled={!hasFloorPlan}
            onClick={() => setFloorPlanViewerOpen(true)}
            className="relative mx-auto flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm transition hover:border-primary/40 hover:shadow-md disabled:cursor-default disabled:opacity-70 md:mx-0"
            title={hasFloorPlan ? '點擊檢視平面圖' : '尚未上傳平面圖'}
            aria-label={hasFloorPlan ? '檢視專案平面圖縮圖' : '尚未上傳平面圖'}
          >
            <FloorPlanThumb
              url={project.floorPlanUrl}
              type={project.floorPlanType}
              previewUrl={floorPlanPreviewUrl}
              fileName={
                typeof project.meta?.floorPlanFileName === 'string'
                  ? project.meta.floorPlanFileName
                  : undefined
              }
            />
          </button>

          <div className="grid w-full shrink-0 gap-2 rounded-xl border border-border bg-card px-4 py-3 md:w-[320px]">
            <div className="flex items-center gap-2 text-[15px]">
              <Tag className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-muted-foreground">專案分類</span>
              <span className="ml-auto font-semibold text-foreground">
                {projectTypeLabel(projectType)}
              </span>
            </div>
            <div className="flex items-center gap-2 border-t border-border/70 pt-2 text-[15px]">
              <UserRound className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">項目經理</span>
              <span className="ml-auto font-semibold text-foreground">
                {pmNames[project.id] || '正在讀取…'}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!hasFloorPlan}
                onClick={() => setFloorPlanViewerOpen(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-[15px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                title={hasFloorPlan ? '檢視平面圖' : '尚未上傳平面圖'}
              >
                <ZoomIn className="h-4 w-4" />
                檢視平面圖
              </button>
              <button
                type="button"
                onClick={() => void saveFurniture()}
                disabled={savingFurniture || loading}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {savingFurniture ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                儲存方案
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] space-y-6 px-3.5 py-8 md:px-5 md:py-10">
        {(() => {
          const reply = project.meta?.clientQuoteReply;
          if (!reply || typeof reply !== 'object') return null;
          const note = typeof reply.note === 'string' ? reply.note.trim() : '';
          const decision =
            reply.decision === 'approved'
              ? '確認整張報價'
              : reply.decision === 'rejected'
                ? '拒絕整張報價'
                : '僅回覆意見';
          const submittedAt =
            typeof reply.submittedAt === 'string' ? reply.submittedAt : '';
          const submittedLabel = submittedAt
            ? new Intl.DateTimeFormat('zh-HK', {
                timeZone: 'Asia/Hong_Kong',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }).format(new Date(submittedAt))
            : '';
          return (
            <section className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 font-display text-lg font-bold">
                  <MessageSquare className="h-5 w-5 text-sky-600" />
                  客戶回覆
                </h2>
                {submittedLabel ? (
                  <span className="font-mono-data text-[13px] text-muted-foreground">
                    {submittedLabel}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[15px] font-semibold text-foreground">
                決定：{decision}
              </p>
              {note ? (
                <p className="mt-2 whitespace-pre-wrap rounded-xl border border-border bg-card px-4 py-3 text-[15px] text-foreground">
                  {note}
                </p>
              ) : (
                <p className="mt-2 text-[15px] text-muted-foreground">
                  （客戶未輸入文字意見）
                </p>
              )}
            </section>
          );
        })()}

        {/* Text zone list + furniture */}
        <section className="space-y-3">
          <div ref={partitionStickySentinelRef}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold">間隔清單與傢俬配置</h2>
              <div className="flex flex-wrap items-center gap-2">
                {furnitureDirty ? (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[13px] font-medium text-amber-700">
                    尚未儲存
                  </span>
                ) : null}
                <span className="font-mono-data text-[15px] text-muted-foreground">
                  {zones.length} 個間隔 · {zoneProducts.filter((z) => z.zoneId).length} 件產品
                </span>
              </div>
            </div>
            {!loading && zoneGroups.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
                <span className="mr-1 text-[15px] font-semibold text-muted-foreground">
                  間隔數量
                </span>
                {zoneGroups.map((group) => {
                  const plannedTotal = plannedFurnitureTotalForZones(
                    group.zones.map((zone) => zone.id),
                    furnitureDivisions,
                  );
                  return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => scrollToZoneGroup(group.label)}
                    className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-[15px] transition-colors hover:border-primary/50 hover:bg-primary/10"
                    title={`跳至「${group.label}」`}
                  >
                    <span className="font-semibold text-foreground">
                      {group.label}
                    </span>
                    <span className="text-muted-foreground">
                      ：{group.zones.length}
                    </span>
                    {plannedTotal > 0 ? (
                      <span className="text-muted-foreground">
                        {' '}
                        {formatPlannedFurnitureTotalLabel(plannedTotal)}
                      </span>
                    ) : null}
                  </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : zones.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              請到「方案列表」展開此專案並設定間隔／功能房間
            </div>
          ) : (
            <div className="space-y-7">
            {zoneGroups.map((group) => {
              const groupPlannedTotal = plannedFurnitureTotalForZones(
                group.zones.map((zone) => zone.id),
                furnitureDivisions,
              );
              const isSingleZoneGroup = group.zones.length === 1;
              return (
              <section
                key={group.key}
                id={zoneGroupDomId(group.label)}
                className="scroll-mt-28 space-y-3"
              >
                {!isSingleZoneGroup ? (
                  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2.5">
                    <div>
                      <h3 className="font-display text-lg font-bold">
                        {group.label}
                        {groupPlannedTotal > 0 ? (
                          <span className="ml-2 text-[15px] font-semibold text-muted-foreground">
                            {formatPlannedFurnitureTotalLabel(groupPlannedTotal)}
                          </span>
                        ) : null}
                      </h3>
                      <p className="mt-0.5 text-[15px] text-muted-foreground">
                        {group.zones.length} 個{group.label}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-3">
                {group.zones.map((zone) => {
              const items = zoneProducts.filter((zp) => zp.zoneId === zone.id);
              const divisions = furnitureDivisions[zone.id] || [];
              const assignedIds = new Set(
                divisions.flatMap((row) => row.productIds || []),
              );
              const unassignedItems = items.filter(
                (item) => !assignedIds.has(item.id),
              );
              const zonePlannedTotal = plannedFurnitureTotalForZones(
                [zone.id],
                furnitureDivisions,
              );
              const renderProductRows = (rows: ZoneProduct[]) =>
                rows.map((item) => (
                  <ZoneProductRow
                    key={item.id}
                    item={item}
                    zoneId={zone.id}
                    custom={isCustomZoneProduct(item)}
                    titleLabel={item.productTitle || '未命名產品'}
                    catalogMeta={
                      item.productId
                        ? productMetaById[item.productId] || null
                        : null
                    }
                    uploading={uploadingImageId === item.id}
                    deletingProductId={deletingProductId}
                    deletingFeedbackKey={deletingFeedbackKey}
                    onOpenUpload={(row) => setImageUploadItem(row)}
                    onPreview={(src, title) => setLightbox({ src, title })}
                    onOpenPicker={(zId, itemId) => void openPicker(zId, itemId)}
                    onSetQuantity={setQuantity}
                    onSetStatus={setStatus}
                    onRemove={(row) => {
                      void removeProduct(row);
                    }}
                    onToggleOptional={toggleOptional}
                    onSetTitle={setProductTitle}
                    onSetSalePrice={setSalePrice}
                    onSetDimensions={setDimensions}
                    onSetNotes={setNotes}
                    onDeleteFeedback={(row, index) => {
                      void deleteClientFeedback(row, index);
                    }}
                  />
                ));
              const displayPlannedTotal = isSingleZoneGroup
                ? groupPlannedTotal
                : zonePlannedTotal;
              const zoneToolbar = (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                    <h3 className="font-display text-base font-bold md:text-lg">
                      {isSingleZoneGroup ? group.label : zone.name}
                      {displayPlannedTotal > 0 ? (
                        <span className="ml-2 text-[15px] font-semibold text-muted-foreground">
                          {formatPlannedFurnitureTotalLabel(displayPlannedTotal)}
                        </span>
                      ) : (
                        <span className="ml-2 text-[15px] font-normal text-muted-foreground">
                          {items.reduce(
                            (sum, item) => sum + zoneProductPieceCount(item),
                            0,
                          )}{' '}
                          件傢俬
                        </span>
                      )}
                    </h3>
                    <label className="inline-flex items-center gap-1.5 text-[15px] text-muted-foreground">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={zoneAreasSqft[zone.id] ?? ''}
                        onChange={(event) =>
                          setZoneSqft(zone.id, event.target.value)
                        }
                        onBlur={() => flushZoneSqftToProjectMeta()}
                        placeholder="0"
                        className="h-9 w-24 rounded-lg border border-border bg-background px-2.5 text-right font-mono-data text-[15px] text-foreground"
                        aria-label={`${zone.name} 平方尺`}
                      />
                      <span>平方尺 sqft</span>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openDivisionModal(zone.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[15px] font-medium text-foreground hover:bg-muted"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      傢俬劃分
                    </button>
                    {divisions.length === 0 ? (
                      <>
                        <button
                          type="button"
                          disabled={creatingBlankZoneId === zone.id}
                          onClick={() => void addBlankProduct(zone.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[15px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
                        >
                          {creatingBlankZoneId === zone.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PenLine className="h-3.5 w-3.5" />
                          )}
                          新欄位
                        </button>
                        <button
                          type="button"
                          onClick={() => void openPicker(zone.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[15px] font-medium text-primary hover:bg-primary/15"
                        >
                          <Plus className="h-3 w-3" /> 加入產品
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
              return (
                <div
                  key={zone.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  {zoneToolbar}
                  {divisions.length === 0 && items.length === 0 ? (
                    <p className="px-5 py-6 text-[15px] text-muted-foreground">
                      尚未配置傢俬 — 可先按「傢俬劃分」規劃類型，或按「新欄位／加入產品」直接加入
                    </p>
                  ) : (
                    <>
                      {divisions.length > 0 ? (
                        <div className="divide-y divide-border/70">
                          {divisions.map((division) => {
                            const divisionItems = items.filter((item) =>
                              (division.productIds || []).includes(item.id),
                            );
                            const addedCount = divisionItems.reduce(
                              (sum, item) => sum + zoneProductPieceCount(item),
                              0,
                            );
                            const shortage =
                              addedCount < Math.max(1, division.quantity || 1);
                            const label = division.level2
                              ? `${division.level1} > ${division.level2}`
                              : division.level1;
                            return (
                              <div key={division.id}>
                                <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/15 px-5 py-3">
                                  <div className="min-w-0">
                                    <p className="font-display text-[15px] font-bold text-foreground">
                                      {label}
                                    </p>
                                    <p className="text-[14px] text-muted-foreground">
                                      {division.quantity} 件傢俬
                                      {addedCount > 0
                                        ? ` · 已加入 ${addedCount}`
                                        : ''}
                                    </p>
                                  </div>
                                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                                    {shortage ? (
                                      <p className="text-[13px] font-semibold text-rose-600">
                                        產品數量與計劃不符，請加入產品
                                      </p>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void openPicker(zone.id, null, {
                                          level1: division.level1,
                                          level2: division.level2 || '',
                                          divisionId: division.id,
                                        })
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[14px] font-medium text-primary hover:bg-primary/15"
                                    >
                                      <Plus className="h-3 w-3" /> 加入產品
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        creatingBlankZoneId ===
                                        `${zone.id}:${division.id}`
                                      }
                                      onClick={() =>
                                        void addBlankProduct(
                                          zone.id,
                                          division.id,
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[14px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
                                    >
                                      {creatingBlankZoneId ===
                                      `${zone.id}:${division.id}` ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <PenLine className="h-3.5 w-3.5" />
                                      )}
                                      新欄位
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeDivision(zone.id, division.id)
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-[13px] font-medium text-rose-600 hover:bg-rose-500/10"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      刪除劃分
                                    </button>
                                  </div>
                                </div>
                                {divisionItems.length === 0 ? (
                                  <p className="px-5 py-4 text-[14px] text-muted-foreground">
                                    尚未在此劃分加入產品 — 按「加入產品」或「新欄位」（預設已選 {label}）
                                  </p>
                                ) : (
                                  <ul className="divide-y divide-border/70">
                                    {renderProductRows(divisionItems)}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                          {unassignedItems.length > 0 ? (
                            <div>
                              <div className="bg-muted/15 px-5 py-3">
                                <p className="font-display text-[15px] font-bold text-foreground">
                                  未劃分
                                </p>
                                <p className="text-[14px] text-muted-foreground">
                                  {unassignedItems.length} 件傢俬
                                </p>
                              </div>
                              <ul className="divide-y divide-border/70">
                                {renderProductRows(unassignedItems)}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <ul className="divide-y divide-border/70">
                          {renderProductRows(items)}
                        </ul>
                      )}
                      <div className="flex justify-end border-t border-border bg-muted/20 px-5 py-3.5">
                        <p className="font-mono-data text-[15px] font-bold text-foreground">
                          小計：$
                          {items
                            .reduce(
                              (sum, item) =>
                                sum + zoneProductBillableTotal(item),
                              0,
                            )
                            .toLocaleString()}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              );
                })}
                </div>
              </section>
              );
            })}
            </div>
          )}

          {!loading && zones.length > 0 ? (
            <div className="flex flex-col items-end gap-3 pt-2">
              <p className="font-mono-data text-base font-bold text-foreground">
                總計 : HKD ${furnitureGrandTotal.toLocaleString()}
              </p>
              <button
                type="button"
                onClick={() => void submitProject()}
                disabled={confirmingProject || savingFurniture}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {confirmingProject ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                提交方案
              </button>
            </div>
          ) : null}
        </section>

      </div>

      {/* Furniture division modal */}
      {divisionModalZoneId ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center sm:p-6">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="font-display text-lg font-bold">傢俬劃分</h3>
                <p className="mt-1 text-[15px] text-muted-foreground">
                  {zones.find((zone) => zone.id === divisionModalZoneId)?.name ||
                    '間隔'}
                  — 選擇一級／二級分類與數量
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDivisionModalZoneId(null)}
                className="rounded-md p-1.5 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="mb-2 text-[13px] font-semibold text-muted-foreground">
                  一級分類
                </p>
                <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                  {divisionLevel1Options.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {productsLoading ? '載入分類中…' : '暫無分類資料'}
                    </p>
                  ) : (
                    divisionLevel1Options.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => {
                          setDivisionLevel1(category);
                          setDivisionLevel2('');
                        }}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[14px]',
                          divisionLevel1 === category
                            ? 'border-primary/50 bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {category}
                      </button>
                    ))
                  )}
                </div>
              </div>
              {divisionLevel1 ? (
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-muted-foreground">
                    二級分類
                  </p>
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => setDivisionLevel2('')}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[14px]',
                        !divisionLevel2
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      不指定
                    </button>
                    {divisionLevel2Options.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setDivisionLevel2(category)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[14px]',
                          divisionLevel2 === category
                            ? 'border-primary/50 bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div>
                <p className="mb-2 text-[13px] font-semibold text-muted-foreground">
                  數量
                </p>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDivisionQty((current) => Math.max(1, current - 1))
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={divisionQty}
                    onChange={(event) =>
                      setDivisionQty(
                        Math.max(
                          1,
                          Math.min(9999, Math.floor(Number(event.target.value) || 1)),
                        ),
                      )
                    }
                    className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-center font-mono-data"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDivisionQty((current) => Math.min(9999, current + 1))
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border"
                  >
                    +
                  </button>
                  <span className="text-[15px] text-muted-foreground">件</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setDivisionModalZoneId(null)}
                className="rounded-lg border border-border px-4 py-2 text-[15px] font-medium hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDivisionModal}
                className="rounded-lg bg-primary px-4 py-2 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Product picker modal */}
      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center sm:p-6">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="font-display text-base font-bold">選擇產品</h3>
                <p className="text-[15px] text-muted-foreground">
                  {replacingZoneProductId ? (
                    <>
                      更換：
                      {zoneProducts.find((item) => item.id === replacingZoneProductId)
                        ?.productTitle || '目前產品'}
                    </>
                  ) : (
                    <>
                      加入至：
                      {pickerZoneId
                        ? zones.find((z) => z.id === pickerZoneId)?.name ||
                          '指定間隔'
                        : zones[0]?.name || '第一個間隔'}
                    </>
                  )}
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {replacingZoneProductId
                    ? '點選產品後會替換目前項目的名稱、圖片與價錢（數量／備註／狀態保留）'
                    : '只顯示目前可供選購並已有售價的產品'}
                </p>
              </div>
              <button
                type="button"
                onClick={closePicker}
                className="rounded-md p-1.5 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-stretch gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜尋產品…"
                    className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
                  />
                </div>
                <div className="relative shrink-0" ref={factoryFilterRef}>
                  <button
                    type="button"
                    onClick={() => setFactoryFilterOpen((open) => !open)}
                    className={cn(
                      'inline-flex h-full min-h-[38px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium',
                      factoryFilter
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                    aria-expanded={factoryFilterOpen}
                    aria-haspopup="listbox"
                    title="以廠家篩選產品"
                  >
                    <Factory className="h-4 w-4 shrink-0" />
                    <span className="max-w-[9rem] truncate">
                      {factoryFilter || '篩選廠家'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  </button>
                  {factoryFilter ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFactoryFilter('');
                        setFactoryQuery('');
                      }}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
                      title="清除廠家篩選"
                      aria-label="清除廠家篩選"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                  {factoryFilterOpen ? (
                    <div className="absolute right-0 top-full z-50 mt-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                      <div className="border-b border-border p-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            value={factoryQuery}
                            onChange={(event) => {
                              setFactoryQuery(event.target.value);
                            }}
                            placeholder="輸入廠家名稱搜尋…"
                            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-[13px]"
                            autoFocus
                          />
                        </div>
                      </div>
                      {/* ~10 factory rows visible; scroll continuously for the rest */}
                      <div
                        className="max-h-[22.5rem] overflow-y-auto overscroll-contain p-1.5"
                        role="listbox"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setFactoryFilter('');
                            setFactoryFilterOpen(false);
                            setFactoryQuery('');
                          }}
                          className={cn(
                            'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px]',
                            !factoryFilter
                              ? 'bg-primary/10 font-semibold text-primary'
                              : 'text-foreground hover:bg-muted',
                          )}
                        >
                          <span>全部廠家</span>
                          {!factoryFilter ? <Check className="h-3.5 w-3.5" /> : null}
                        </button>
                        {filteredFactoryOptions.length === 0 ? (
                          <p className="px-2.5 py-3 text-[13px] text-muted-foreground">
                            找不到廠家
                          </p>
                        ) : (
                          filteredFactoryOptions.map((name) => {
                            const selected = factoryFilter === name;
                            return (
                              <button
                                key={name}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => {
                                  setFactoryFilter(name);
                                  setFactoryFilterOpen(false);
                                  setFactoryQuery('');
                                }}
                                className={cn(
                                  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]',
                                  selected
                                    ? 'bg-primary/10 font-semibold text-primary'
                                    : 'text-foreground hover:bg-muted',
                                )}
                              >
                                <span className="truncate">{name}</span>
                                {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                              </button>
                            );
                          })
                        )}
                      </div>
                      {filteredFactoryOptions.length > 10 ? (
                        <div className="border-t border-border px-2.5 py-1.5">
                          <p className="font-mono-data text-[11px] text-muted-foreground">
                            共 {filteredFactoryOptions.length} 家 · 向下捲動查看全部
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {!replacingZoneProductId ? (
              <div className="flex flex-wrap gap-1.5">
                <select
                  value={pickerZoneId || zones[0]?.id || ''}
                  onChange={(e) => setPickerZoneId(e.target.value || null)}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-[15px]"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[13px] font-semibold text-muted-foreground">
                  一級分類
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setProductLevel1('');
                    setProductLevel2('');
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[15px]',
                    !productLevel1
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  全部
                </button>
                {productLevel1Options.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      setProductLevel1(category);
                      setProductLevel2('');
                    }}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[15px]',
                      productLevel1 === category
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {category}
                  </button>
                ))}
              </div>
              {productLevel1 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[13px] font-semibold text-muted-foreground">
                    二級分類
                  </span>
                  <button
                    type="button"
                    onClick={() => setProductLevel2('')}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[15px]',
                      !productLevel2
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    全部
                  </button>
                  {productLevel2Options.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setProductLevel2(category)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[15px]',
                        productLevel2 === category
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {productsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {filteredProducts.map((p) => {
                    const dims = formatProductDimensionsMm(
                      p.dimensionLMm,
                      p.dimensionWMm,
                      p.dimensionHMm,
                    );
                    const factoryLabel = normalizeFactoryDisplayName(p.factoryName);
                    return (
                      <div
                        key={p.id}
                        className="overflow-hidden rounded-xl border border-border bg-background"
                      >
                        <div className="aspect-[4/3] bg-muted">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <div className="space-y-1.5 p-2.5">
                          <p className="line-clamp-2 text-[15px] font-medium">{p.title}</p>
                          {factoryLabel ? (
                            <span className="inline-flex max-w-full items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
                              <span className="truncate" title={factoryLabel}>
                                {factoryLabel}
                              </span>
                            </span>
                          ) : null}
                          {dims ? (
                            <p className="font-mono-data text-[13px] text-muted-foreground">
                              {dims}
                            </p>
                          ) : null}
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono-data text-[15px] font-bold text-primary">
                              ${p.salePrice.toLocaleString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => void addProductToZone(p)}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[15px] font-medium text-primary hover:bg-primary/15"
                            >
                              {replacingZoneProductId ? (
                                <>
                                  <RefreshCw className="h-3 w-3" /> 更換
                                </>
                              ) : (
                                <>
                                  <Check className="h-3 w-3" /> 加入
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!productsLoading && filteredProducts.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">找不到產品</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <ProductImageLightbox
          src={lightbox.src}
          title={lightbox.title}
          onClose={() => setLightbox(null)}
        />
      ) : null}

      <ProductImageUploadModal
        open={Boolean(imageUploadItem)}
        title="上傳圖片"
        previewUrl={imageUploadItem?.productImageUrl || undefined}
        busy={Boolean(
          imageUploadItem && uploadingImageId === imageUploadItem.id,
        )}
        onClose={() => {
          if (uploadingImageId) return;
          setImageUploadItem(null);
        }}
        onSelectFile={async (file) => {
          if (!imageUploadItem) return;
          const latest =
            zoneProducts.find((row) => row.id === imageUploadItem.id) ||
            imageUploadItem;
          await uploadProductImage(latest, file);
        }}
      />

      <FloorPlanViewerModal
        open={floorPlanViewerOpen}
        title={project.name}
        url={project.floorPlanUrl}
        type={project.floorPlanType}
        previewUrl={floorPlanPreviewUrl}
        onClose={() => setFloorPlanViewerOpen(false)}
      />
    </div>
  );
}
