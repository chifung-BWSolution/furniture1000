import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Plus, Loader2, Search, Check, CheckCircle2, Trash2, X, LayoutGrid, UserRound, Tag,
  ImagePlus, PenLine, ZoomIn, Save, Link2, RefreshCw,
} from 'lucide-react';
import {
  fetchProjects, fetchZones, fetchZoneProducts, fetchActiveShopifyProducts,
  createZoneProduct, deleteZoneProductWithProgress,
  persistDesignProjectFurniture, saveProject, updateZoneProductNotes,
} from '@/lib/solutionsApi';
import { useAppStore } from '@/hooks/use-app-store';
import {
  buildDesignProjectPath,
  parseDesignProjectPathname,
} from '@/lib/designProjectRoutes';
import { consumeSolutionFocusProjectId } from '@/lib/solutionProjectFocus';
import { resolveDesignProjectPmLabels } from '@/lib/solutionProjectPm';
import {
  inferProjectType,
  normalizeRoomOrder,
  projectTypeLabel,
  roomsForProjectType,
  zoneSeedsFromRoomCounts,
  type ProjectEngineeringType,
  type RoomTypeTemplate,
} from '@/lib/projectPartitionTemplates';
import {
  syncProjectZones,
  zonesMissingFromSeeds,
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
} from '@/types/solutions';
import {
  removeClientFeedbackFromNotes,
  reviewLabelZh,
  serializeStaffNotesAndFeedback,
  splitStaffNotesAndFeedback,
} from '@/lib/zoneProductClientFeedback';
import {
  FloorPlanThumb,
  FloorPlanViewerModal,
  floorPlanPreviewOf,
} from './FloorPlanViewerModal';

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

/** Original thumb was 56px (h-14); 200% = 112px minimum square. */
const PRODUCT_IMAGE_MIN_PX = 112;
const PRODUCT_IMAGE_MAX_PX = 220;

/** Keep product image square: ≥200% of old thumb, grow with content, cap for overflow. */
function useProductImageSquareSize() {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(PRODUCT_IMAGE_MIN_PX);

  useEffect(() => {
    const node = contentRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      const contentH = Math.ceil(node.getBoundingClientRect().height);
      const viewportCap = Math.floor(window.innerWidth * 0.28);
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

function ZoneProductRow({
  item,
  zoneId,
  custom,
  titleLabel,
  uploading,
  deletingProductId,
  deletingFeedbackKey,
  imageInputRefs,
  onUploadImage,
  onPreview,
  onOpenPicker,
  onSetQuantity,
  onSetStatus,
  onRemove,
  onSetTitle,
  onSetSalePrice,
  onSetNotes,
  onDeleteFeedback,
}: {
  item: ZoneProduct;
  zoneId: string;
  custom: boolean;
  titleLabel: string;
  uploading: boolean;
  deletingProductId: string | null;
  deletingFeedbackKey: string | null;
  imageInputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  onUploadImage: (item: ZoneProduct, file: File | null) => void;
  onPreview: (src: string, title: string) => void;
  onOpenPicker: (zoneId: string, itemId: string) => void;
  onSetQuantity: (item: ZoneProduct, quantity: number) => void;
  onSetStatus: (id: string, status: ZoneProductStatus) => void;
  onRemove: (item: ZoneProduct) => void;
  onSetTitle: (item: ZoneProduct, value: string) => void;
  onSetSalePrice: (item: ZoneProduct, value: number) => void;
  onSetNotes: (item: ZoneProduct, value: string) => void;
  onDeleteFeedback: (item: ZoneProduct, index: number) => void;
}) {
  const { contentRef, size } = useProductImageSquareSize();
  const feedback = splitStaffNotesAndFeedback(item.notes).feedback;

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-4">
        <div
          className="relative shrink-0"
          style={{ width: size, height: size }}
        >
          <input
            ref={(node) => {
              imageInputRefs.current[item.id] = node;
            }}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              onUploadImage(item, file);
            }}
          />
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
          ) : custom ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => imageInputRefs.current[item.id]?.click()}
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
          ) : (
            <div className="h-full w-full rounded-xl bg-muted" />
          )}
          {custom && item.productImageUrl ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => imageInputRefs.current[item.id]?.click()}
              className="absolute bottom-1.5 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border/80 bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur hover:bg-background disabled:opacity-60"
            >
              {uploading ? '上傳中…' : '更換圖片'}
            </button>
          ) : null}
        </div>

        <div ref={contentRef} className="min-w-0 flex-1 space-y-2.5">
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
              {custom ? (
                <div className="flex flex-wrap items-center gap-2 text-[15px]">
                  <span className="text-muted-foreground">單價 $</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={Number(item.salePrice || 0)}
                    onChange={(event) =>
                      onSetSalePrice(item, Number(event.target.value))
                    }
                    className="h-9 w-28 rounded-lg border border-border bg-background px-2 font-mono-data text-[15px] text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                    aria-label="單價"
                  />
                  <span className="font-mono-data text-primary">
                    × {item.quantity} = 小計 $
                    {(
                      Number(item.salePrice || 0) * item.quantity
                    ).toLocaleString()}
                  </span>
                </div>
              ) : (
                <p className="font-mono-data text-[15px] text-primary">
                  單價 ${Number(item.salePrice || 0).toLocaleString()} ×{' '}
                  {item.quantity}
                  {' = '}
                  小計 $
                  {(
                    Number(item.salePrice || 0) * item.quantity
                  ).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
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
              <button
                type="button"
                disabled={deletingProductId === item.id}
                onClick={() => onRemove(item)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-[15px] font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
                title="從間隔移除產品"
              >
                {deletingProductId === item.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                刪除
              </button>
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
    </li>
  );
}

/** Map saved roomOrder keys → display labels for 設計專案 group sequencing. */
function roomOrderLabels(
  projectType: ProjectEngineeringType | string,
  customRooms: CustomRoomType[],
  roomOrder: string[],
): string[] {
  const templates = roomsForProjectType(projectType as ProjectEngineeringType);
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
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [productLevel1, setProductLevel1] = useState('');
  const [productLevel2, setProductLevel2] = useState('');
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
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
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
    },
    [activeProjectId],
  );

  useEffect(() => {
    const focusId = consumeSolutionFocusProjectId();
    const urlId = routeProjectId;
    fetchProjects()
      .then(async (rows) => {
        setProjects(rows);
        setPmNames(await resolveDesignProjectPmLabels(rows));
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
      })
      .finally(() => setProjectsLoaded(true));
    // Only on mount — URL changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow browser URL (shared link / back-forward) after projects are loaded.
  useEffect(() => {
    if (!projectsLoaded) return;
    const parsed = parseDesignProjectPathname(location.pathname);
    if (parsed?.kind !== 'project') return;
    if (parsed.projectId === activeProjectId) return;
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
      navigate(buildDesignProjectPath(activeProjectId), { replace: true });
      return;
    }
    setActiveProjectId(parsed.projectId);
    setFurnitureDirty(false);
  }, [
    activeProjectId,
    location.pathname,
    navigate,
    projects,
    projectsLoaded,
    selectProject,
  ]);

  // Keep address bar on the active project's shareable URL.
  useEffect(() => {
    if (!projectsLoaded || !activeProjectId) return;
    const target = buildDesignProjectPath(activeProjectId);
    if (location.pathname === target) return;
    const parsed = parseDesignProjectPathname(location.pathname);
    // Push history when switching between projects; replace when entering the view.
    navigate(target, { replace: parsed?.kind !== 'project' });
  }, [activeProjectId, location.pathname, navigate, projectsLoaded]);

  const reloadZones = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const projectRow =
        projects.find((p) => p.id === projectId) || null;
      const [z, zp] = await Promise.all([
        fetchZones(projectId),
        fetchZoneProducts(projectId),
      ]);

      // Heal incomplete project_zones from saved meta.roomCounts.
      // Older saves could skip custom Chinese rooms that shared code "CR1".
      const meta = projectRow?.meta;
      const roomCounts = meta?.roomCounts;
      let nextZones = z;
      if (roomCounts && typeof roomCounts === 'object') {
        const projectType = (meta?.projectType ||
          inferProjectType(
            projectRow?.name || '',
            projectRow?.clientCompany,
          )) as ProjectEngineeringType;
        const customRooms = normalizeCustomRooms(meta?.customRooms);
        const hasSavedOrder = Array.isArray(meta?.roomOrder);
        const roomOrder = normalizeRoomOrder(meta?.roomOrder);
        const desired = zoneSeedsFromRoomCounts(
          projectType,
          roomCounts as Record<string, number>,
          customRooms as RoomTypeTemplate[],
          // Honor saved roomOrder (even empty); only fall back to all rooms when never saved.
          hasSavedOrder ? roomOrder : null,
        );
        if (zonesMissingFromSeeds(desired, z)) {
          const synced = await syncProjectZones({
            projectId,
            desired,
            zones: z,
            zoneProducts: zp,
            // Only create missing rooms here; pruning stays on 方案列表「儲存」.
            pruneEmpty: false,
          });
          if (synced.ok && synced.data) {
            nextZones = synced.data;
            toast.success('已同步房間清單', {
              description: '已依方案列表的房間類型及數量補齊間隔',
            });
          } else if (!synced.ok) {
            toast.error('同步房間失敗', {
              description: synced.error || '請到方案列表重新按「儲存」',
            });
          }
        }
      }

      setZones(nextZones);
      setZoneProducts(zp);
      setFurnitureDirty(false);
      return nextZones;
    } finally {
      setLoading(false);
    }
  }, [projects]);

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
    const savedOrder = normalizeRoomOrder(project?.meta?.roomOrder);
    if (savedOrder.length > 0) {
      const labelRank = roomOrderLabels(
        projectType,
        normalizeCustomRooms(project?.meta?.customRooms),
        savedOrder,
      );
      const rank = new Map(labelRank.map((label, index) => [label, index]));
      return list.sort((a, b) => {
        const aRank = rank.has(a.label) ? rank.get(a.label)! : 1000 + a.minSort;
        const bRank = rank.has(b.label) ? rank.get(b.label)! : 1000 + b.minSort;
        if (aRank !== bRank) return aRank - bRank;
        return a.minSort - b.minSort;
      });
    }
    return list.sort((a, b) => a.minSort - b.minSort);
  }, [project?.meta?.customRooms, project?.meta?.roomOrder, projectType, zones]);

  const scrollToZoneGroup = useCallback((label: string) => {
    const target = document.getElementById(zoneGroupDomId(label));
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const furnitureGrandTotal = useMemo(
    () =>
      zoneProducts.reduce(
        (sum, item) =>
          sum + Number(item.salePrice || 0) * Math.max(1, item.quantity || 1),
        0,
      ),
    [zoneProducts],
  );

  const closePicker = () => {
    setPickerOpen(false);
    setReplacingZoneProductId(null);
  };

  const openPicker = async (
    zoneId?: string | null,
    replaceZoneProductId?: string | null,
  ) => {
    setPickerZoneId(zoneId ?? null);
    setReplacingZoneProductId(replaceZoneProductId ?? null);
    setPickerOpen(true);
    if (products.length === 0) {
      setProductsLoading(true);
      fetchActiveShopifyProducts(1000)
        .then(setProducts)
        .finally(() => setProductsLoading(false));
    }
  };

  const replaceZoneProduct = (product: SearchProduct) => {
    if (!replacingZoneProductId) return;
    const current = zoneProducts.find(
      (item) => item.id === replacingZoneProductId,
    );
    if (!current) {
      toast.error('找不到要更換的產品');
      return;
    }
    patchProduct(replacingZoneProductId, {
      productId: product.id,
      productTitle: product.title,
      productImageUrl: product.imageUrl || '',
      salePrice: Number(product.salePrice) || 0,
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
    });
    if (res.ok && res.data) {
      setZoneProducts((prev) => [...prev, res.data!]);
      setFurnitureDirty(true);
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
    setFurnitureDirty(true);
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

  const addBlankProduct = async (zoneId: string) => {
    if (!activeProjectId || creatingBlankZoneId) return;
    setCreatingBlankZoneId(zoneId);
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
    setFurnitureDirty(true);
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

  const uploadProductImage = async (item: ZoneProduct, file: File | null) => {
    if (!file || !isCustomZoneProduct(item)) return;
    if (!file.type.startsWith('image/')) {
      toast.error('請上傳圖片檔案');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('圖片超過 8MB 上限');
      return;
    }
    setUploadingImageId(item.id);
    try {
      // Upload to Storage first; DB + design_projects.meta flush on「儲存」.
      const url = await uploadFileToStorage(file, item.id, 'zone');
      patchProduct(item.id, { productImageUrl: url });
      toast.success('產品圖片已上傳', {
        description: '請按上方「儲存」寫入專案資料',
      });
    } catch (error) {
      toast.error('上傳圖片失敗', {
        description: error instanceof Error ? error.message : '請稍後再試',
      });
    } finally {
      setUploadingImageId(null);
    }
  };

  const setQuantity = (item: ZoneProduct, value: number) => {
    const quantity = Math.max(1, Math.min(9999, Math.floor(value || 1)));
    patchProduct(item.id, { quantity });
  };

  const saveFurniture = async () => {
    if (!project || savingFurniture) return;
    if (typeof document !== 'undefined') {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    }
    setSavingFurniture(true);
    try {
      // Allow controlled inputs to flush latest keystrokes into state.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const result = await persistDesignProjectFurniture({
        project,
        zones,
        products: zoneProducts,
      });
      if (!result.ok || !result.data) {
        toast.error('儲存失敗', { description: result.error });
        return;
      }
      setZoneProducts(result.data.products);
      setProjects((current) =>
        current.map((row) =>
          row.id === project.id
            ? {
                ...row,
                meta: {
                  ...row.meta,
                  furnitureSnapshot: result.data!.snapshot,
                },
              }
            : row,
        ),
      );
      setFurnitureDirty(false);
      toast.success('已儲存傢俬配置', {
        description: `${result.data.snapshot.zoneCount} 個間隔 · ${result.data.snapshot.productCount} 件產品已寫入 design_projects`,
      });
    } finally {
      setSavingFurniture(false);
    }
  };

  const confirmProject = async () => {
    if (!project || confirmingProject) return;
    const selectedProducts = zoneProducts.filter((product) => product.zoneId);
    if (zones.length === 0 || selectedProducts.length === 0) {
      toast.error('請先設定間隔並加入產品');
      return;
    }
    setConfirmingProject(true);
    if (furnitureDirty) {
      const flushed = await persistDesignProjectFurniture({
        project,
        zones,
        products: zoneProducts,
      });
      if (!flushed.ok || !flushed.data) {
        setConfirmingProject(false);
        toast.error('確定前儲存失敗', { description: flushed.error });
        return;
      }
      setZoneProducts(flushed.data.products);
      setProjects((current) =>
        current.map((row) =>
          row.id === project.id
            ? {
                ...row,
                meta: {
                  ...row.meta,
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
      toast.error('確定方案失敗', { description: result.error });
      return;
    }
    setProjects((current) =>
      current.map((row) =>
        row.id === project.id
          ? { ...row, status: 'confirmed', progress: 100 }
          : row,
      ),
    );
    toast.success('方案已確定', {
      description: `${zones.length} 個間隔 · ${selectedProducts.length} 件產品`,
    });
    appStore.setCurrentView('confirmed-projects');
  };

  const filteredProducts = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
      if (productLevel1 && p.level1Category !== productLevel1) return false;
      if (productLevel2 && p.level2Category !== productLevel2) return false;
      return true;
    });
  }, [products, keyword, productLevel1, productLevel2]);

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
    <div className="h-full overflow-y-auto bg-background">
      {/* Header */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-7 py-4 md:flex-row md:items-center md:px-10">
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
            <button
              type="button"
              onClick={() => void confirmProject()}
              disabled={confirmingProject}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {confirmingProject ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              確定方案
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] space-y-6 px-7 py-8 md:px-10 md:py-10">
        {/* Text zone list + furniture */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold">間隔清單與傢俬配置</h2>
            <div className="flex flex-wrap items-center gap-2">
              {furnitureDirty ? (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[13px] font-medium text-amber-700">
                  尚未儲存
                </span>
              ) : null}
              <button
                type="button"
                disabled={!project || savingFurniture || loading}
                onClick={() => void saveFurniture()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {savingFurniture ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                儲存
              </button>
              <span className="font-mono-data text-[15px] text-muted-foreground">
                {zones.length} 個間隔 · {zoneProducts.filter((z) => z.zoneId).length} 件產品
              </span>
            </div>
          </div>
          {!loading && zoneGroups.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <span className="mr-1 text-[15px] font-semibold text-muted-foreground">
                間隔數量
              </span>
              {zoneGroups.map((group) => (
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
                </button>
              ))}
            </div>
          ) : null}

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
            {zoneGroups.map((group, groupIndex) => (
              <section
                key={group.key}
                id={zoneGroupDomId(group.label)}
                className="scroll-mt-6 space-y-3"
              >
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2.5">
                  <div>
                    <h3 className="font-display text-lg font-bold">
                      {group.label}
                    </h3>
                    <p className="mt-0.5 text-[15px] text-muted-foreground">
                      {group.zones.length} 個{group.label}
                    </p>
                  </div>
                  {groupIndex === 0 ? (
                    <p className="pb-0.5 font-mono-data text-base font-bold text-foreground">
                      總計 : HKD ${furnitureGrandTotal.toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-3">
                {group.zones.map((zone) => {
              const items = zoneProducts.filter((zp) => zp.zoneId === zone.id);
              return (
                <div
                  key={zone.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base font-bold">{zone.name}</h3>
                      <span className="text-[15px] text-muted-foreground">{items.length} 件傢俬</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                        onClick={() => openPicker(zone.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[15px] font-medium text-primary hover:bg-primary/15"
                      >
                        <Plus className="h-3 w-3" /> 加入產品
                      </button>
                    </div>
                  </div>
                  {items.length === 0 ? (
                    <p className="px-5 py-6 text-[15px] text-muted-foreground">
                      尚未配置傢俬 — 按右上角「新欄位」自行填寫，或「加入產品」從目錄選取
                    </p>
                  ) : (
                    <>
                    <ul className="divide-y divide-border/70">
                      {items.map((item) => (
                        <ZoneProductRow
                          key={item.id}
                          item={item}
                          zoneId={zone.id}
                          custom={isCustomZoneProduct(item)}
                          titleLabel={item.productTitle || '未命名產品'}
                          uploading={uploadingImageId === item.id}
                          deletingProductId={deletingProductId}
                          deletingFeedbackKey={deletingFeedbackKey}
                          imageInputRefs={imageInputRefs}
                          onUploadImage={(row, file) => {
                            void uploadProductImage(row, file);
                          }}
                          onPreview={(src, title) =>
                            setLightbox({ src, title })
                          }
                          onOpenPicker={(zId, itemId) =>
                            void openPicker(zId, itemId)
                          }
                          onSetQuantity={setQuantity}
                          onSetStatus={setStatus}
                          onRemove={(row) => {
                            void removeProduct(row);
                          }}
                          onSetTitle={setProductTitle}
                          onSetSalePrice={setSalePrice}
                          onSetNotes={setNotes}
                          onDeleteFeedback={(row, index) => {
                            void deleteClientFeedback(row, index);
                          }}
                        />
                      ))}
                    </ul>
                    <div className="flex justify-end border-t border-border bg-muted/20 px-5 py-3.5">
                      <p className="font-mono-data text-[15px] font-bold text-foreground">
                        小計：$
                        {items
                          .reduce(
                            (sum, item) =>
                              sum +
                              Number(item.salePrice || 0) * item.quantity,
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
            ))}
            </div>
          )}
        </section>

      </div>

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
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜尋產品…"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
                />
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
                  {filteredProducts.map((p) => (
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
                  ))}
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
