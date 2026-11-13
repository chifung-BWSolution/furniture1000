import { autoFurniturePlacements, assignFurniturePosition, saveFurnitureSelection, reassignFurnitureZones, matchFurniturePlacements } from '@/lib/quoteFurniturePlacement';
import { ProductPlacementPicker, FurniturePlacementDialog } from './QuoteFurniturePlacement';
import { DEFAULT_LAYOUT_STYLE, detectedLayoutNotes, generateZoneLayoutImage, layoutZones, type LayoutReview, type LayoutRenderProgress, type LayoutRenderRevision, type LayoutZone } from '@/lib/quoteLayoutRender';
import { Button } from '@/components/ui/button';
import { confirm } from '@/components/ui/confirm-dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { QuoteLayoutRenderDialog } from './QuoteLayoutRenderDialog';
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useReducer, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import QRCode from "qrcode";
import "./quotation-draft-editor.css";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Eye,
  FileText,
  FolderKanban,
  GripVertical,
  Images,
  ImagePlus,
  Inbox,
  Layers,
  Loader2,
  Mail,
  PackagePlus,
  PackageSearch,
  Palette,
  Pencil,
  Percent,
  Plus,
  QrCode,
  RefreshCw,
  Ruler,
  Save,
  Scissors,
  ShieldCheck,
  StickyNote,
  Trash2,
  Truck,
  Upload,
  UserRound,
  Wallet,
  Wand2,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchTodayCnyHkdRate, formatFxRate } from "@/lib/fxRate";
import { TermsRichEditor } from "@/components/dashboard/TermsRichEditor";
import { RemarksRichEditor } from "@/components/dashboard/RemarksRichEditor";
import { MaterialRichEditor } from "@/components/dashboard/MaterialRichEditor";
import { QuotePhotoPages } from "@/components/dashboard/QuotePhotoPages";
import { QuotePhotoLayoutEditor } from "@/components/dashboard/QuotePhotoLayoutEditor";
import { PhotoLayoutBlock } from "@/components/dashboard/QuotePhotoLayoutView";
import {
  canManageQuotePhotos,
  listQuoteContentPages,
  listQuoteCoverPages,
  listQuotePhotoAssets,
  parseQuotePhotoAssetRefs,
  quotePhotoObjectUrl,
  quotePhotoRefUrl,
  quotePhotoErrorText,
  type QuotePhotoAsset,
  type QuoteContentPage,
  type QuoteCoverPage,
  type QuotePhotoAssetRef,
} from "@/lib/quotePhotoLibrary";
import {
  QuotePhotoGenerateDialog,
  type GenerateChoice,
  type QuotePhotoZone,
} from "@/components/dashboard/QuotePhotoGenerateDialog";
import {
  groupGeometry,
  newLayoutGroup,
  defaultPlacement,
  parsePhotoLayouts,
  parseZonePhotoLayouts,
  pruneZonePhotoLayouts,
  type PhotoLayoutGroup,
} from "@/lib/quotePhotoLayouts";
import { FloorPlanViewerModal } from "@/components/dashboard/solutions/FloorPlanViewerModal";
import { QuoteCatalogPagesDialog } from "@/components/dashboard/QuoteCatalogPagesDialog";
import { parseQuoteCatalogPages, type QuoteCatalogPage } from "@/lib/quoteCatalogPages";
import { FloorPlanZoneCanvas, floorPlanZoneColor } from "@/components/dashboard/FloorPlanZoneCanvas";
import { renderPdfPageToJpegBlob } from "@/lib/floorPlanPdf";
import {
  uploadProjectFloorPlanFile,
  uploadProjectFloorPlanPreview,
} from "@/lib/imageStorage";
import {
  applyDetectedZones,
  applyZoneCanvasChange,
  blankZoneManagerRow,
  detectZonesFromJpegBase64,
  imageBlobToJpegBase64,
  MAX_FLOOR_PLAN_ZONES,
  MAX_ZONE_IMAGES,
  parseQuoteFloorPlan,
  parseQuoteZoneImages,
  pruneQuoteZoneImages,
  regionsFromZoneRows,
  unconfirmZoneRegions,
  UNZONED_QUOTE_IMAGE_KEY,
  zoneCanvasRows,
  type QuoteFloorPlan,
  type QuoteZoneImageMap,
  type QuoteZoneRect,
  type QuoteZoneRegion,
  type ZoneManagerRow,
} from "@/lib/quoteFloorPlan";
import { materialPlainText } from "@/lib/quotationMaterialHtml";
import { toast } from "sonner";
import { SubmitReviewModal, type SubmitReviewResult } from "@/components/dashboard/SubmitReviewModal";
import { persistBwfQuote } from "@/lib/persistBwfQuote";
import { ProductSelectorModal } from "@/components/dashboard/ProductSelectorModal";
import { fetchProductCatalog } from "@/lib/productCatalogQuery";
import {
  ProductDetailModal,
  type ProductForDetail,
} from "@/components/dashboard/ProductDetailModal";
import { fetchFactoriesWithIds } from "@/lib/factorySupabase";
import { CopyQuoteItemsModal } from "@/components/dashboard/CopyQuoteItemsModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Modal, ModalButton } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { LoadingImage } from "@/components/ui/loading-image";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { fetchFactories } from "@/lib/factorySupabase";
import type { QuotationDimensionMode, QuotationPDFData } from "@/types/quotation-pdf";
import { uploadQuoteImageFile } from "@/lib/quoteImageStorage";
import { isHttpImageUrl } from "@/lib/imageStorage";
import { TrimmedEdgeImage } from "@/components/dashboard/TrimmedEdgeImage";
import {
  beginQuoteDnDDrag,
  endQuoteDnDDrag,
  getActiveQuoteDnDKind,
  isForeignQuoteDnDKind,
  readQuoteDnDId,
} from "@/lib/quoteDnD";
import {
  saveDraft,
  loadDraft,
  deleteDraft,
  makeDraftKey,
  type DraftData,
} from "@/lib/draftStore";
import { unsavedGuard } from "@/lib/unsavedGuard";
import {
  QUOTE_UNSAVED_LEAVE_MESSAGE,
  clearUseLocalQuoteDraft,
  markUseLocalQuoteDraft,
  resetQuickQuoteSessionStorage,
  shouldShowDraftRestoreNotice,
  shouldUseLocalQuoteDraft,
  writeQuickQuoteCopyFrom,
  writeQuickQuoteEditingId,
  writeQuickQuoteStep,
  writeResumeQuote,
} from "@/lib/quickQuoteSession";
import {
  extractDeliveryAddressFromTermsHtml,
  injectDeliveryAddressIntoTermsHtml,
  migrateTermsContentToCurrent,
  resolveDeliveryAddress,
  type SavedTermsContent,
} from "@/lib/quotationDefaultTerms";
import {
  sanitizeExchangeRateInput,
  parseExchangeRateValue,
  computeHkdCostPrice,
  exchangeRateInputDisplay,
} from "@/lib/quoteCostExchange";
import { parseGpSummary } from "@/lib/quoteGpSummary";
import { quoteBillableProductCost, quoteBillableSubtotal, quoteItemLineSubtotal } from "@/lib/quoteItemTotals";
import {
  findQuoteCostMismatches,
  quoteDerivedHkdCost,
} from "@/lib/quoteCostConsistency";
import {
  formatSectionTitleLabel,
  productSerialAt,
  sectionTitleOrdinalAt,
  sectionTitlePrefix,
} from "@/lib/quoteSectionTitle";
import {
  moveItemIntoZone,
  quoteItemSerialLabel,
  zoneEndInsertAt,
  zoneItemCountAt,
  zoneItemPrefixAt,
  zoneTitleIdAt,
  zoneTitleIdBefore,
} from "@/lib/quoteZone";
import {
  loadQuoteItems,
  itemsFromLegacyProjectData,
  resolvePitchingCode,
  type BwfQuoteItemInput,
} from "@/lib/bwfQuoteItems";
import {
  isLegacyQFormatQuoteId,
  pickQuoteChainId,
} from "@/lib/quoteChainId";
import type { QuoteCopyPayload } from "@/lib/quoteCopy";
import { parseQuotePathname } from "@/lib/quoteRoutes";
import {
  rememberZoneRenderPreview,
  subscribeZoneRenderPreviews,
  takeZoneRenderPreview,
  zoneRenderPreviewVersion,
  type ZoneRenderPreviewPayload,
} from "@/lib/zoneRenderHandoff";
import { requestQuoteOpen } from "@/lib/quoteOpenRequests";
import { bumpQuoteVersion, displayQuoteVersion } from "@/lib/quoteVersions";
import { ensureQuoteShareLink } from "@/lib/bwfQuoteShareLinks";
import { QuoteEmailFollowUpModal } from "@/components/dashboard/QuoteEmailFollowUpModal";
import { usePlatformRole } from "@/hooks/use-platform-role";
import { isUrgentWorkPeriod } from "@/lib/quoteStockFilter";
import {
  buildDraftProductFromQuoteItem,
  fetchProductForQuoteDetail,
  hydrateQuoteItemProductLinks,
  normalizeLegacyQuoteItemProductId,
} from "@/lib/quoteItemProductLink";
import {
  fetchProductCategoryPairs,
  findProductCategoryPairById,
  resolveProductCategoryId,
  uniqueLevel1InOrder,
  uniqueLevel2InOrder,
  type ProductCategoryPair,
} from "@/lib/productCategoryOptions";
import {
  type QuoteLocale,
  type QuoteUiLabels,
  quoteUi,
  quoteUnitLabel,
  quotePdf,
  DEFAULT_COMPANY_ADDRESS,
  DEFAULT_COMPANY_WEBSITE,
  formatQuoteDisplayDate,
  todayQuoteDateIso,
} from "@/lib/quotationLocale";
import { useQuoteFormatSettings } from "@/lib/quoteFormatSettings";
import {
  DEFAULT_QUOTATION_DELIVERY_DETAILS_EN,
  englishTermsContentForPdf,
  buildDefaultTermsFullHtmlEn,
} from "@/lib/quotationDefaultTermsEn";
import {
  DEFAULT_QUOTE_COMPANY_PHONE,
  resolveQuoteCompanyPhone,
} from "@/lib/quoteCompanyPhone";
import { useAuth } from "@/contexts/AuthProvider";
import { usePmsStaffName } from "@/hooks/use-pms-staff-name";

/** DOM anchor id for a zone (section-title row) inside 報價內容. */
const zoneAnchorId = (itemId: string) => `quote-zone-anchor-${itemId}`;

interface QuoteFormData {
  company: string;
  projectManager: string;
  /** In-memory 報價單號; becomes bwf_quote.quote_id on submit. */
  quoteId?: string;
  /** @deprecated Use quoteId */
  pitchingCode?: string;
  /** @deprecated Use quoteId */
  projectName?: string;
  pmsPitchingId?: string;
  pmsProjectId?: string;
  /** Client company / org (公司名稱). */
  clientName: string;
  /** Contact person (客戶名稱). */
  clientContactName?: string;
  clientPhone: string;
  clientEmail: string;
  clientIndustry: string[];
  quotationType: string[];
  serviceScope: string[];
  officeArea: string;
  headcount: string;
  workPeriod: string;
  validityDays: string;
  remarks: string;
}

interface QuotationItem {
  id: string;
  image: string;
  referenceImage?: string;
  name: string;
  costPrice?: number | null;
  exchangeRate?: number | null;
  /** Transient UI string for 匯率 input (preserves trailing decimal while typing). */
  exchangeRateInput?: string;
  hkdCostPrice?: number | null;
  unitPrice: number;
  quantity: number;
  unit?: string;
  /** Catalog / internal SKU — editable in draft; excluded from customer PDF. */
  sku?: string;
  category?: string;
  material?: string;
  color?: string;
  remarks?: string;
  remarksImage?: string;
  /** Freeform mm text — may include expressions like 1000+600 / 1000-600. */
  dimensionLMm?: string | null;
  dimensionWMm?: string | null;
  dimensionHMm?: string | null;
  /** lwh = 長×闊×高 (default); dh = 直徑×高 */
  dimensionMode?: QuotationDimensionMode;
  deliveryTermName?: string;
  factoryName?: string;
  /** True when 廠家 was set from 圖冊 — shown read-only. */
  factoryFromCatalog?: boolean;
  /** Reference-only line — excluded from quote 合計 and GP Cost; PDF shows 可選產品 + checkbox. */
  isOptional?: boolean;
  /** Keep in draft editor; omit from 報價單預覽 / Quotation Preview PDF. */
  hideInPdf?: boolean;
  isCustomTerm?: boolean;
  /** Section heading row (一、開放區) — not priced; draggable. */
  isSectionTitle?: boolean;
  /** Furniture products.id when line is linked to catalog. */
  productId?: string | null;
  /** FK to product_category.id (一級/二級 registry). */
  productCategoryId?: string | null;
  /** UI: selected 一級 when editing registry (may differ before 二級 chosen). */
  registryLevel1?: string;
  registryLevel2?: string;
}

interface QuotationDraftEditorProps {
  formData: QuoteFormData;
  onFormDataChange: (patch: Partial<QuoteFormData>) => void;
  industryOptions: string[];
  serviceScopeOptions: string[];
  workPeriodOptions: string[];
  onBack: () => void;
  userEmail?: string | null;
  onOpenPdfPreview?: (data: QuotationPDFData) => void;
  /** Called after 版本審核 persists to DB — parent can track quote id for subsequent updates. */
  onQuotePersisted?: (result: SubmitReviewResult) => void;
  existingQuote?: {
    quoteId: string;
    version: string;
    status: string;
    totalAmount: number;
    submitter: string;
    projectData: Record<string, unknown>;
    bwfPitchingId?: string | null;
    bwfProjectId?: string | null;
    quoteUuid?: string;
    /** Highest version string in the quote_id chain — used to compute next submit version. */
    maxVersionInChain?: string;
    createdAt?: string | null;
    modifiedDate?: string | null;
  };
  /** Body fields copied from another quote (items, delivery, terms). Header uses formData. */
  initialCopyPayload?: QuoteCopyPayload | null;
  /**
   * 由外層在顯示編輯器前預載的明細（bwf_quote_item）。
   * undefined＝未預載，編輯器自行載入；null＝預載失敗，先顯示錯誤讓用戶重新載入。
   */
  initialQuoteItems?: BwfQuoteItemInput[] | null;
  /** Always insert a new bwf_quote row (skip pitching dedup) — used for 複製報價單. */
  forceNewQuote?: boolean;
  /** Pre-assigned quote id for new drafts (editor-step URL persistence). */
  draftQuoteId?: string | null;
}

const generateId = () => Math.random().toString(36).substring(2, 12);

function QuoteRowDragHandle({
  itemId,
  serialNumber,
  serialLabel,
  onDragStart,
  onDragEnd,
}: {
  itemId: string;
  serialNumber?: number;
  /** Overrides serialNumber display (e.g. 一 for section titles). */
  serialLabel?: string;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {(serialLabel != null && serialLabel !== '') || serialNumber != null ? (
        <span
          className="font-body text-sm font-semibold tabular-nums leading-none text-foreground/75"
          aria-hidden
        >
          {serialLabel ?? serialNumber}
        </span>
      ) : null}
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          beginQuoteDnDDrag(e.dataTransfer, "quote-row", itemId);
          onDragStart(itemId);
        }}
        onDragEnd={() => {
          // Defer cleanup: some browsers fire dragend before drop; drop needs
          // the drag id / insert index refs to still be set.
          queueMicrotask(() => {
            endQuoteDnDDrag();
            onDragEnd();
          });
        }}
        className="cursor-grab rounded p-1 text-muted-foreground/45 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
        title="拖曳調整順序"
        aria-label={`序號 ${serialNumber}，拖曳調整順序`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

function quoteRowReorderClass(
  index: number,
  itemId: string,
  draggingItemId: string | null,
  dropInsertIndex: number | null,
  cutItemId: string | null,
  extra?: string,
) {
  return cn(
    extra,
    (draggingItemId === itemId || cutItemId === itemId) && "opacity-50",
    dropInsertIndex === index && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
    dropInsertIndex === index + 1 && "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]",
  );
}

function QuoteRowActionButtons({
  itemId,
  cutItemId,
  onCut,
  onDuplicate,
  onRemove,
  onOpenProduct,
  productLinked,
  labels,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  collapsed,
  onToggleCollapse,
}: {
  itemId: string;
  cutItemId: string | null;
  onCut: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenProduct?: () => void;
  productLinked?: boolean;
  labels: QuoteUiLabels;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const isCut = cutItemId === itemId;
  const iconBtn =
    "rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="flex h-[34px] items-center gap-0.5">
      {onOpenProduct ? (
        <button
          type="button"
          onClick={onOpenProduct}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            productLinked
              ? "text-primary/70 hover:bg-primary/10 hover:text-primary"
              : "text-muted-foreground/50 hover:bg-emerald-500/10 hover:text-emerald-600",
          )}
          title={
            productLinked ? labels.openLinkedProduct : labels.createLinkedProduct
          }
          aria-label={
            productLinked ? labels.openLinkedProduct : labels.createLinkedProduct
          }
        >
          {productLinked ? (
            <PackageSearch className="h-4 w-4" />
          ) : (
            <PackagePlus className="h-4 w-4" />
          )}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onCut(itemId)}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          isCut
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground/50 hover:bg-primary/10 hover:text-primary",
        )}
        title={labels.cutItem}
        aria-label={labels.cutItem}
        aria-pressed={isCut}
      >
        <Scissors className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onDuplicate(itemId)}
        className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-primary/10 hover:text-primary"
        title={labels.duplicateItem}
        aria-label={labels.duplicateItem}
      >
        <Copy className="h-4 w-4" />
      </button>
      {onMoveUp ? (
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className={iconBtn}
          title="上移"
          aria-label="上移"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      ) : null}
      {onMoveDown ? (
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className={iconBtn}
          title="下移"
          aria-label="下移"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onRemove(itemId)}
        className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
        title="刪除"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          className={iconBtn}
          title={collapsed ? "展開" : "收合"}
          aria-label={collapsed ? "展開" : "收合"}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
      ) : null}
    </div>
  );
}

/** Nearest ancestor that can actually scroll vertically (incl. documentElement). */
function findVerticalScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    const canScroll =
      overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (canScroll && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  const root = document.scrollingElement;
  if (root instanceof HTMLElement && root.scrollHeight > root.clientHeight + 1) {
    return root;
  }
  return null;
}

/** Wider than browser default edge bands so DnD can scroll without hugging the rim. */
const QUOTE_DND_AUTO_SCROLL_EDGE_PX = 336; // 3× prior 112px band
const QUOTE_DND_AUTO_SCROLL_MAX_STEP_PX = 28;

// Helper: Convert file to base64 data URL
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// Allowed image MIME types and their extensions
const ALLOWED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
  "image/svg+xml",
];
const ALLOWED_IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "tiff", "tif", "svg"];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_IMAGE_INPUT = ".png,.jpg,.jpeg,.webp,.tiff,.tif,.svg,image/png,image/jpeg,image/webp,image/tiff,image/svg+xml";

/** 平面圖可以從剪貼簿貼上：PDF、JPG、PNG 或 WebP。 */
function floorPlanFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (
      file.type === "application/pdf" ||
      file.type.startsWith("image/") ||
      /\.(pdf|jpe?g|png|webp)$/i.test(file.name)
    ) {
      return file;
    }
  }
  return null;
}

function validateImageFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const typeOk =
    ALLOWED_IMAGE_MIME.includes(file.type) ||
    ALLOWED_IMAGE_EXT.includes(ext);
  if (!typeOk) {
    return "不支援的格式。支援：PNG、JPG、JPEG、WEBP、TIFF、SVG";
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `檔案過大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限為 10 MB`;
  }
  return null;
}

// Sub-component: Image preview + upload modal
function ImageUploadModal({
  open,
  onClose,
  onSelect,
  title,
  previewUrl,
  uploadImage,
  aiChoices = [],
  photoZones = [],
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  title: string;
  previewUrl?: string;
  /** When set, uploads to Supabase Storage and passes back HTTP URL. */
  uploadImage?: (file: File) => Promise<string>;
  /** AI 生成候選（報價明細產品圖）；空的話仍可純描述生成。 */
  aiChoices?: GenerateChoice[];
  photoZones?: QuotePhotoZone[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const handleFile = async (file: File) => {
    const err = validateImageFile(file);
    if (err) {
      toast.error("無法上傳圖片", { description: err });
      return;
    }
    try {
      setBusy(true);
      const url = uploadImage ? await uploadImage(file) : await fileToDataUrl(file);
      onSelect(url);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "上傳失敗";
      toast.error("無法上傳圖片", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  // Listen to paste events while modal is open (Ctrl+V / right-click paste)
  useEffect(() => {
    if (!open) return;
    const handler = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) await handleFile(file);
          return;
        }
      }
    };
    window.addEventListener("paste", handler);
    dropRef.current?.focus();
    return () => window.removeEventListener("paste", handler);
  }, [open]);

  if (!open) return null;

  const handleInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await handleFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  return (
    <>
      <Modal
        open
        onOpenChange={(next) => { if (!next && !busy) onClose(); }}
        size="xl"
        icon={<ImagePlus className="h-6 w-6" />}
        title={title}
        description="支援 PNG、JPG、JPEG、WEBP、TIFF、SVG（最大 10 MB）"
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        {previewUrl ? (
          <div className="mb-4 flex max-h-[46vh] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20 p-3">
            <TrimmedEdgeImage
              src={previewUrl}
              className="max-h-[46vh] max-w-full object-contain"
            />
          </div>
        ) : null}

        <button
          ref={dropRef}
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-primary" />
          )}
          <span className="font-body text-xs font-medium text-foreground">
            {busy ? "上傳中..." : previewUrl ? "點擊、拖放或貼上 (Ctrl+V) 更換圖片" : "點擊、拖放或貼上 (Ctrl+V) 圖片"}
          </span>
          <span className="font-body text-xs text-muted-foreground">
            支援 PNG、JPG、JPEG、WEBP、TIFF、SVG（最大 10 MB）
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_IMAGE_INPUT}
          className="hidden"
          onChange={handleInput}
        />

        <div className="mt-4 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="font-body text-xs text-muted-foreground">或</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAiOpen(true)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 font-body text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Wand2 className="h-4 w-4" />
          用 AI 生成圖片
        </button>
      </Modal>

      <QuotePhotoGenerateDialog
        open={aiOpen}
        choices={aiChoices}
        zones={photoZones}
        onClose={() => setAiOpen(false)}
        onGenerated={(asset) => {
          // 生成結果已寫入圖片庫；直接選為此欄位的圖片。
          onSelect(quotePhotoRefUrl(asset));
          onClose();
        }}
      />
    </>
  );
}

// Sub-component: Reference Image Cell (modal upload) — editor-only sizing
const QUOTE_CARD_IMAGE_PX = 180;

function ReferenceImageCell({
  value,
  onChange,
  modalTitle = "上傳圖片",
  sizePx = QUOTE_CARD_IMAGE_PX,
  imageFit = "contain",
  fluid = false,
  uploadImage,
  aiChoices,
  photoZones,
}: {
  value: string;
  onChange: (url: string) => void;
  modalTitle?: string;
  sizePx?: number;
  imageFit?: "cover" | "contain";
  /** Expand to fill grid column width (keeps square aspect ratio) */
  fluid?: boolean;
  uploadImage?: (file: File) => Promise<string>;
  /** AI 生成候選（報價明細產品圖）— 傳入才會顯示「用 AI 生成圖片」入口。 */
  aiChoices?: GenerateChoice[];
  photoZones?: QuotePhotoZone[];
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "relative flex aspect-square items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30 cursor-pointer group",
          fluid && "w-full min-h-[6.5rem] min-[900px]:min-h-[8rem]",
        )}
        style={fluid ? undefined : { width: sizePx, height: sizePx }}
        onClick={() => setModalOpen(true)}
        title={value ? "點擊查看或更換圖片" : "點擊上傳圖片"}
      >
        {value ? (
          <>
            <TrimmedEdgeImage
              src={value}
              className={cn(
                "h-full w-full bg-muted/20",
                imageFit === "contain" ? "object-contain" : "object-cover",
              )}
            />
            {/* 移除鈕要留在框內：外框是 overflow-hidden，貼邊會被切掉一半而點不到。 */}
            <button
              type="button"
              aria-label="移除圖片"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 shadow-sm transition-opacity pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <ImagePlus className="h-8 w-8 text-muted-foreground/40" />
        )}
      </div>
      <ImageUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(url) => onChange(url)}
        title={modalTitle}
        previewUrl={value || undefined}
        uploadImage={uploadImage}
        aiChoices={aiChoices}
        photoZones={photoZones}
      />
    </>
  );
}

function QuoteFieldBlock({
  label,
  children,
  className,
  labelRowClassName,
  trailing,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** e.g. hide the label on mobile when a card group header already shows it. */
  labelRowClassName?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "mb-1 flex items-center justify-between gap-2",
          trailing ? "min-h-5" : "h-4",
          labelRowClassName,
        )}
      >
        <label className="font-body text-xs font-medium leading-4 text-muted-foreground">
          {label}
        </label>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/**
 * 產品項目卡的分組：手機／平板（<1150px）顯示成有標題的卡片區塊，
 * 桌面三欄版（≥1150px）只保留欄位本身的 label，不重複顯示區塊標題。
 */
function QuoteCardGroup({
  label,
  icon,
  children,
  className,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // 手機可收起；桌面三欄版一律展開（標題本身隱藏）。
  const [open, setOpen] = useState(true);
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border border-border/70 bg-card px-3 py-2.5",
        "min-[1400px]:rounded-none min-[1400px]:border-0 min-[1400px]:bg-transparent min-[1400px]:p-0",
        className,
      )}
    >
      <h3 className="mb-2 min-[1400px]:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left font-body text-xs font-semibold text-foreground"
        >
          <span className="text-indigo-500 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </h3>
      <div className={cn("space-y-2.5", !open && "hidden min-[1400px]:block")}>{children}</div>
    </section>
  );
}

function QuoteItemFlagToggles({
  item,
  updateItem,
  labels,
  className,
}: {
  item: QuotationItem;
  updateItem: (id: string, field: keyof QuotationItem, value: string | number | null | boolean) => void;
  labels: QuoteUiLabels;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2.5", className)}>
      <label className="inline-flex cursor-pointer items-center gap-1">
        <Checkbox
          checked={item.isOptional ?? false}
          onCheckedChange={(checked) =>
            updateItem(item.id, "isOptional", checked === true)
          }
          className="border-foreground/60 data-[state=checked]:border-primary"
        />
        <span className="whitespace-nowrap font-body text-xs text-muted-foreground">
          {labels.optionalProduct}
        </span>
      </label>
      <label className="inline-flex cursor-pointer items-center gap-1">
        <Checkbox
          checked={item.hideInPdf ?? false}
          onCheckedChange={(checked) =>
            updateItem(item.id, "hideInPdf", checked === true)
          }
          className="border-foreground/60 data-[state=checked]:border-primary"
        />
        <span className="whitespace-nowrap font-body text-xs text-muted-foreground">
          {labels.hideInPdf}
        </span>
      </label>
    </div>
  );
}

const QUOTE_INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30";

/** Single-line controls in the info cards. Inputs, selects and choice buttons share this height. */
const QUOTE_PANEL_CONTROL_CLASS =
  "h-9 w-full rounded-md border border-border bg-background px-3 py-0 font-body text-xs leading-9 text-foreground shadow-none placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30";

/**
 * 新增／上傳／渲染一類的小動作按鈕共用一種高度（32px，即 Button size="sm"），
 * 同一行有按鈕與共用 Button 時才不會一高一低。
 */
const QUOTE_ACTION_BTN_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed px-2.5 font-body text-xs font-medium transition-colors";

/** ~15 Chinese characters — 顏色 */
const QUOTE_SHORT_TEXT_INPUT_CLASS = `${QUOTE_INPUT_CLASS} max-w-[15em]`;

const QUOTE_NUMBER_INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30";

const QUOTE_COMPACT_NUMBER_INPUT_CLASS = `${QUOTE_NUMBER_INPUT_CLASS} min-w-0`;

/** Left column width — 類別、顏色、備註等短文字欄 */
const QUOTE_LEFT_COL_CLASS = "w-[15em] max-w-full shrink-0";

/** Full-width dimension inputs — same column width as 備註 */
const QUOTE_DIMENSION_INPUT_CLASS = cn(
  "min-w-0 flex-1 rounded-md border border-border bg-background px-1 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
);

/** ~10 visible factory rows; scroll for the rest */
const FACTORY_DROPDOWN_VISIBLE_COUNT = 10;
const FACTORY_DROPDOWN_ITEM_HEIGHT_PX = 28;
const FACTORY_DROPDOWN_MAX_HEIGHT =
  FACTORY_DROPDOWN_VISIBLE_COUNT * FACTORY_DROPDOWN_ITEM_HEIGHT_PX;

function QuoteFactoryField({
  labels,
  value,
  locked,
  factories,
  loading,
  onChange,
}: {
  labels: QuoteUiLabels;
  value: string;
  locked: boolean;
  factories: string[];
  loading: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredFactories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return factories;
    return factories.filter((name) => name.toLowerCase().includes(query));
  }, [factories, search]);

  if (locked) {
    return (
      <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
        <span
          className="truncate font-body text-xs text-foreground"
          title={value || undefined}
        >
          {value || "—"}
        </span>
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            QUOTE_INPUT_CLASS,
            "flex h-[34px] items-center justify-between gap-1 text-left",
            !value && "text-muted-foreground/40",
          )}
        >
          <span className="truncate">{value || labels.selectFactory}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" side="bottom" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={labels.searchFactory}
            value={search}
            onValueChange={setSearch}
            className="h-8 font-body text-xs"
          />
          <CommandList style={{ maxHeight: FACTORY_DROPDOWN_MAX_HEIGHT }}>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="font-body text-xs text-muted-foreground">{labels.loading}</span>
              </div>
            ) : (
              <>
                <CommandEmpty>
                  <p className="py-3 font-body text-xs text-muted-foreground">{labels.noFactory}</p>
                </CommandEmpty>
                <CommandGroup>
                  {filteredFactories.map((factory) => (
                    <CommandItem
                      key={factory}
                      value={factory}
                      onSelect={() => {
                        onChange(factory);
                        setOpen(false);
                        setSearch("");
                      }}
                      className="cursor-pointer py-1.5 font-body text-xs"
                    >
                      <span className="truncate">{factory}</span>
                      {value === factory && (
                        <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function QuoteItemZoneSelect({
  zoneTitleId,
  zoneOptions,
  labels,
  onAssign,
  className,
  highlight = false,
}: {
  zoneTitleId: string | null;
  zoneOptions: { id: string; label: string }[];
  labels: QuoteUiLabels;
  onAssign: (zoneTitleId: string) => void;
  className?: string;
  /** 提示使用者先選分區（例如按下「先選擇分區」後短暫標紅）。 */
  highlight?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!highlight) return;
    // 標紅的位置可能在畫面上方，滾動到看得見的地方。
    triggerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);
  return (
    <Select value={zoneTitleId ?? "__none__"} onValueChange={onAssign}>
      <SelectTrigger
        ref={triggerRef}
        className={cn(
          "h-8 w-[9.5rem] shrink-0 text-xs",
          highlight && "border-rose-500 text-rose-700 ring-2 ring-rose-200 focus-visible:ring-rose-300",
          className,
        )}
        aria-invalid={highlight || undefined}
        aria-label={labels.itemZone}
      >
        <SelectValue placeholder={labels.itemZone} />
      </SelectTrigger>
      <SelectContent className="z-[300]">
        <SelectItem value="__none__">{labels.unzoned}</SelectItem>
        {zoneOptions.map((zone) => (
          <SelectItem key={zone.id} value={zone.id}>
            {zone.label}
          </SelectItem>
        ))}
        <SelectItem value="__new__">{labels.addZoneHere}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function QuoteProductItemCard({
  item,
  index,
  serialNumber,
  zonePrefix,
  aiChoices,
  photoZones,
  placementField,
  zoneRegionCount = 0,
  draggingItemId,
  dropInsertIndex,
  cutItemId,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  updateItem,
  updateExchangeRate,
  updateDimensionMode,
  cutItem,
  duplicateItem,
  removeItem,
  onOpenProductLink,
  onRegistryLevel1Change,
  onRegistryLevel2Change,
  categoryPairs,
  categoryPairsLoading,
  factories,
  factoriesLoading,
  quoteImageScope,
  labels,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  zoneTitleId = null,
  zoneOptions = [],
  onAssignZone,
  zoneHighlight = false,
}: {
  placementField?: ReactNode;
  zoneRegionCount?: number;
  item: QuotationItem;
  index: number;
  serialNumber: number;
  /** 「1.2」式分區前綴 — inside a zone; null before the first zone. */
  zonePrefix?: string | null;
  /** AI 生成候選（報價明細產品圖），供圖片欄的「用 AI 生成圖片」。 */
  aiChoices?: GenerateChoice[];
  photoZones?: QuotePhotoZone[];
  draggingItemId: string | null;
  dropInsertIndex: number | null;
  cutItemId: string | null;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  updateItem: (id: string, field: keyof QuotationItem, value: string | number | null | boolean) => void;
  updateExchangeRate: (id: string, raw: string) => void;
  updateDimensionMode: (id: string, mode: QuotationDimensionMode) => void;
  cutItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  removeItem: (id: string) => void;
  onOpenProductLink: (item: QuotationItem) => void;
  onRegistryLevel1Change: (id: string, level1: string) => void;
  onRegistryLevel2Change: (id: string, level2: string) => void;
  categoryPairs: ProductCategoryPair[];
  categoryPairsLoading: boolean;
  factories: string[];
  factoriesLoading: boolean;
  /** Scope for Supabase Storage paths (quote id or draft key). */
  quoteImageScope: string;
  labels: QuoteUiLabels;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  zoneTitleId?: string | null;
  zoneOptions?: { id: string; label: string }[];
  onAssignZone?: (zoneTitleId: string) => void;
  /** 按下「先選擇分區」後，把上面的分區下拉標紅。 */
  zoneHighlight?: boolean;
}) {
  const dimensionMode = item.dimensionMode ?? 'lwh';
  const level1Value = item.registryLevel1?.trim() || '';
  const level2Value = item.registryLevel2?.trim() || '';
  const level1Options = uniqueLevel1InOrder(categoryPairs);
  const level2Options = uniqueLevel2InOrder(categoryPairs, level1Value);
  const registrySelectClass =
    "h-[34px] w-full min-w-0 cursor-pointer rounded-md border border-border bg-background px-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60";
  const isDiameterHeight = dimensionMode === 'dh';
  const unitLocale = labels.unit === 'Unit' ? 'en' : 'zh';
  const uploadProductImage = useCallback(
    (file: File) => uploadQuoteImageFile(file, quoteImageScope, item.id, 'product'),
    [quoteImageScope, item.id],
  );
  const uploadReferenceImage = useCallback(
    (file: File) => uploadQuoteImageFile(file, quoteImageScope, item.id, 'reference'),
    [quoteImageScope, item.id],
  );
  const uploadRemarksImage = useCallback(
    (file: File) => uploadQuoteImageFile(file, quoteImageScope, item.id, 'remarks'),
    [quoteImageScope, item.id],
  );

  return (
    <div
      className={quoteRowReorderClass(
        index,
        item.id,
        draggingItemId,
        dropInsertIndex,
        cutItemId,
        "rounded-xl border border-border bg-background p-3 min-[1400px]:p-4",
      )}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* 序號／拖曳把手放在整張卡的最左上角，跟「可選／於PDF隱藏」同一行。 */}
        <QuoteRowDragHandle
          itemId={item.id}
          serialNumber={serialNumber}
          serialLabel={zonePrefix ?? undefined}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <QuoteItemFlagToggles
          item={item}
          updateItem={updateItem}
          labels={labels}
        />
        <div className="ml-auto">
          <QuoteRowActionButtons
            itemId={item.id}
            cutItemId={cutItemId}
            onCut={cutItem}
            onDuplicate={duplicateItem}
            onRemove={removeItem}
            onOpenProduct={() => onOpenProductLink(item)}
            productLinked={Boolean(item.productId?.trim())}
            labels={labels}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
        </div>
      </div>
      {/* 三欄：左＝房間／名稱／分類／尺寸／顏色／備註；中＝材質及明細＋圖片／參考圖；右＝數量與價格。 */}
      <div className="flex flex-col gap-3 min-[1400px]:flex-row min-[1400px]:items-start min-[1400px]:gap-5">
        <div className="min-w-0 space-y-3 min-[1400px]:w-[24%] min-[1400px]:min-w-[14rem] min-[1400px]:max-w-[18rem] min-[1400px]:shrink-0">
          <QuoteCardGroup label={labels.basicInfo} icon={<PackageSearch />}>
            {onAssignZone ? (
              <QuoteFieldBlock label={labels.itemZone}>
                <QuoteItemZoneSelect
                  zoneTitleId={zoneTitleId}
                  zoneOptions={zoneOptions}
                  labels={labels}
                  onAssign={onAssignZone}
                  className="w-full"
                  highlight={zoneHighlight}
                />
              </QuoteFieldBlock>
            ) : null}
            <QuoteFieldBlock label={labels.productNamePlaceholder}>
              <input
                type="text"
                value={item.name || ""}
                placeholder={labels.productNamePlaceholder}
                onChange={(e) => updateItem(item.id, "name", e.target.value)}
                className={QUOTE_INPUT_CLASS}
                aria-label={labels.productNamePlaceholder}
              />
            </QuoteFieldBlock>
          <QuoteFieldBlock label={labels.level1Category}>
            <Select
              value={level1Value || "__none__"}
              disabled={categoryPairsLoading}
              onValueChange={(value) =>
                onRegistryLevel1Change(
                  item.id,
                  value === "__none__" ? "" : value,
                )
              }
            >
              <SelectTrigger
                className={registrySelectClass}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[300]">
                <SelectItem value="__none__">—</SelectItem>
                {level1Options.map((l1) => (
                  <SelectItem key={l1} value={l1}>
                    {l1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </QuoteFieldBlock>
          <QuoteFieldBlock label={labels.level2Category}>
            <Select
              value={level2Value || "__none__"}
              disabled={
                categoryPairsLoading ||
                !level1Value ||
                level2Options.length === 0
              }
              onValueChange={(value) =>
                onRegistryLevel2Change(
                  item.id,
                  value === "__none__" ? "" : value,
                )
              }
            >
              <SelectTrigger
                className={registrySelectClass}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[300]">
                <SelectItem value="__none__">—</SelectItem>
                {level2Options.map((l2) => (
                  <SelectItem key={l2} value={l2}>
                    {l2}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </QuoteFieldBlock>
          </QuoteCardGroup>
          <QuoteCardGroup label={labels.dimensionsMm} icon={<Ruler />}>
            <div className="min-w-0">
              <div className="mb-1 flex min-h-[22px] flex-wrap items-center gap-1.5 font-body text-xs font-medium text-muted-foreground">
              <span className="hidden shrink-0 leading-normal min-[1400px]:inline">{labels.dimensionsMm}</span>
              <Select
                value={dimensionMode}
                onValueChange={(value) =>
                  updateDimensionMode(item.id, value as QuotationDimensionMode)
                }
              >
                <SelectTrigger className="h-[22px] w-auto gap-1 rounded-md px-1.5 font-body text-xs" aria-label={labels.dimensionsMm}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[300]">
                  <SelectItem value="lwh">{labels.dimLwh}</SelectItem>
                  <SelectItem value="dh">{labels.dimDh}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid w-full min-w-0 grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-x-1">
              <input
                type="text"
                inputMode="text"
                value={item.dimensionLMm ?? ""}
                placeholder={isDiameterHeight ? "D" : "L"}
                onChange={(e) =>
                  updateItem(item.id, "dimensionLMm", parseDimensionInput(e.target.value))
                }
                className={QUOTE_DIMENSION_INPUT_CLASS}
              />
              <span className="shrink-0 text-xs text-muted-foreground">×</span>
              {isDiameterHeight ? (
                <>
                  <input
                    type="text"
                    inputMode="text"
                    value={item.dimensionHMm ?? ""}
                    placeholder="H"
                    onChange={(e) =>
                      updateItem(item.id, "dimensionHMm", parseDimensionInput(e.target.value))
                    }
                    className={QUOTE_DIMENSION_INPUT_CLASS}
                  />
                  <span className="invisible shrink-0 text-xs" aria-hidden>
                    ×
                  </span>
                  <div
                    className={cn(QUOTE_DIMENSION_INPUT_CLASS, "invisible pointer-events-none border-transparent")}
                    aria-hidden
                  />
                </>
              ) : (
                <>
                  <input
                    type="text"
                    inputMode="text"
                    value={item.dimensionWMm ?? ""}
                    placeholder="W"
                    onChange={(e) =>
                      updateItem(item.id, "dimensionWMm", parseDimensionInput(e.target.value))
                    }
                    className={QUOTE_DIMENSION_INPUT_CLASS}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">×</span>
                  <input
                    type="text"
                    inputMode="text"
                    value={item.dimensionHMm ?? ""}
                    placeholder="H"
                    onChange={(e) =>
                      updateItem(item.id, "dimensionHMm", parseDimensionInput(e.target.value))
                    }
                    className={QUOTE_DIMENSION_INPUT_CLASS}
                  />
                </>
              )}
            </div>
            </div>
          </QuoteCardGroup>
          <QuoteCardGroup label={labels.color} icon={<Palette />}>
            <QuoteFieldBlock label={labels.color} labelRowClassName="hidden min-[1400px]:flex">
              <input
                type="text"
                value={item.color || ""}
                placeholder="—"
                maxLength={15}
                onChange={(e) => updateItem(item.id, "color", e.target.value)}
                className={QUOTE_INPUT_CLASS}
              />
            </QuoteFieldBlock>
          </QuoteCardGroup>
          <QuoteCardGroup label={labels.remarks} icon={<StickyNote />}>
            <QuoteFieldBlock label={labels.remarks} labelRowClassName="hidden min-[1400px]:flex">
              <RemarksRichEditor
                key={item.id}
                compact
                locale={unitLocale}
                placeholder={unitLocale === "en" ? "Remarks…" : "備註文字…"}
                value={item.remarks || ""}
                legacyImage={item.remarksImage}
                onChange={(val) => updateItem(item.id, "remarks", val)}
                uploadImage={uploadRemarksImage}
              />
            </QuoteFieldBlock>
          </QuoteCardGroup>
          {placementField}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <QuoteCardGroup label={labels.material} icon={<Layers />}>
            <QuoteFieldBlock
              label={labels.material}
              labelRowClassName="hidden min-[1400px]:flex"
              className="min-[1400px]:[&_.material-rich-editor-content]:min-h-[168px]"
            >
              <MaterialRichEditor
                value={item.material || ""}
                placeholder={unitLocale === "en" ? "Materials & details…" : "材質及明細..."}
                onChange={(html) => updateItem(item.id, "material", html)}
              />
            </QuoteFieldBlock>
          </QuoteCardGroup>

          <QuoteCardGroup label={`${labels.image} / ${labels.referenceImage}`} icon={<Images />}>
            <div className="grid grid-cols-2 gap-3">
              <QuoteFieldBlock
                label={labels.image}
                className="min-w-0"
                labelRowClassName="hidden min-[1400px]:flex"
              >
                <ReferenceImageCell
                  value={item.image || ""}
                  onChange={(url) => updateItem(item.id, "image", url)}
                  modalTitle="上傳產品圖片"
                  imageFit="contain"
                  fluid
                  uploadImage={uploadProductImage}
                  aiChoices={aiChoices}
                  photoZones={photoZones}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock
                label={labels.referenceImage}
                className="min-w-0"
                labelRowClassName="hidden min-[1400px]:flex"
              >
                <ReferenceImageCell
                  value={item.referenceImage || ""}
                  onChange={(url) => updateItem(item.id, "referenceImage", url)}
                  modalTitle="上傳參考圖"
                  imageFit="contain"
                  fluid
                  uploadImage={uploadReferenceImage}
                  aiChoices={aiChoices}
                  photoZones={photoZones}
                />
              </QuoteFieldBlock>
            </div>
          </QuoteCardGroup>
        </div>

        <div className="min-w-0 space-y-3 min-[1400px]:w-[31%] min-[1400px]:min-w-[16rem] min-[1400px]:max-w-[22rem] min-[1400px]:shrink-0">
          <QuoteCardGroup label={labels.quantityAndPrice} icon={<Calculator />}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <QuoteFieldBlock label={labels.quantity}>
                <input
                  type="number"
                  value={item.quantity || ""}
                  placeholder="1"
                  min={1}
                  onChange={(e) =>
                    updateItem(item.id, "quantity", parseInt(e.target.value) || 1)
                  }
                  className={QUOTE_COMPACT_NUMBER_INPUT_CLASS}
                />
                {zoneRegionCount > 1 && <p className="mt-1 text-xs text-muted-foreground">{labels.unit === 'Unit' ? `Zone covers ${zoneRegionCount} areas` : `此分區涵蓋 ${zoneRegionCount} 個區域`}</p>}
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.unit}>
                <input
                  type="text"
                  value={quoteUnitLabel(item.unit, unitLocale)}
                  placeholder="—"
                  maxLength={4}
                  onChange={(e) => updateItem(item.id, "unit", e.target.value)}
                  className={QUOTE_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.factory}>
                <QuoteFactoryField
                  labels={labels}
                  value={item.factoryName || ""}
                  locked={Boolean(item.factoryFromCatalog)}
                  factories={factories}
                  loading={factoriesLoading}
                  onChange={(name) => updateItem(item.id, "factoryName", name)}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.sku}>
                <input
                  type="text"
                  value={item.sku || ""}
                  placeholder="—"
                  onChange={(e) => updateItem(item.id, "sku", e.target.value)}
                  className={QUOTE_INPUT_CLASS}
                  aria-label={labels.sku}
                  title="SKU（僅草稿編輯，不顯示於 PDF）"
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.cnyCost}>
                <input
                  type="number"
                  value={item.costPrice ?? ""}
                  placeholder="—"
                  min={0}
                  onChange={(e) =>
                    updateItem(
                      item.id,
                      "costPrice",
                      e.target.value ? parseFloat(e.target.value) : null,
                    )
                  }
                  className={QUOTE_COMPACT_NUMBER_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.hkdUnitPrice}>
                <input
                  type="number"
                  value={typeof item.unitPrice === "number" ? item.unitPrice : ""}
                  placeholder="0"
                  min={0}
                  onChange={(e) =>
                    updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)
                  }
                  className={QUOTE_COMPACT_NUMBER_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              {/* 小計橫跨兩欄，用淡紫底把它從一排輸入框中區分出來。 */}
              <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg bg-indigo-500/10 px-3 py-2">
                <span className="min-w-0 truncate font-body text-sm font-medium text-indigo-600">
                  {labels.hkdSubtotal}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono-data text-xl font-bold tabular-nums",
                    item.isOptional ? "text-muted-foreground" : "text-indigo-600",
                  )}
                >
                  ${quoteItemLineSubtotal(item).toLocaleString()}
                </span>
              </div>
              <QuoteFieldBlock label={labels.exchangeRate}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={exchangeRateInputDisplay(item.exchangeRateInput, item.exchangeRate)}
                  placeholder="—"
                  onChange={(e) => updateExchangeRate(item.id, e.target.value)}
                  className={QUOTE_COMPACT_NUMBER_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.hkdCost}>
                <input
                  type="number"
                  value={item.hkdCostPrice == null ? "" : Math.ceil(item.hkdCostPrice)}
                  placeholder="—"
                  min={0}
                  step={1}
                  onChange={(e) =>
                    updateItem(
                      item.id,
                      "hkdCostPrice",
                      e.target.value === "" ? null : parseFloat(e.target.value),
                    )
                  }
                  className={QUOTE_COMPACT_NUMBER_INPUT_CLASS}
                  aria-label={labels.hkdCost}
                />
              </QuoteFieldBlock>
            </div>
          </QuoteCardGroup>
        </div>
      </div>
    </div>
  );
}

function QuoteCustomTermCard({
  item,
  index,
  serialNumber,
  zonePrefix,
  draggingItemId,
  dropInsertIndex,
  cutItemId,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  updateItem,
  cutItem,
  duplicateItem,
  removeItem,
  labels,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  zoneTitleId = null,
  zoneOptions = [],
  onAssignZone,
}: {
  item: QuotationItem;
  index: number;
  serialNumber: number;
  /** 「1.2」式分區前綴 — inside a zone; null before the first zone. */
  zonePrefix?: string | null;
  draggingItemId: string | null;
  dropInsertIndex: number | null;
  cutItemId: string | null;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  updateItem: (id: string, field: keyof QuotationItem, value: string | number | null) => void;
  cutItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  removeItem: (id: string) => void;
  labels: QuoteUiLabels;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  zoneTitleId?: string | null;
  zoneOptions?: { id: string; label: string }[];
  onAssignZone?: (zoneTitleId: string) => void;
}) {
  return (
    <div
      className={quoteRowReorderClass(
        index,
        item.id,
        draggingItemId,
        dropInsertIndex,
        cutItemId,
        "rounded-lg border border-amber-500/30 bg-amber-500/5 p-4",
      )}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
    >
      <div className="flex gap-3">
        <div className="shrink-0 pt-4">
          <QuoteRowDragHandle
            itemId={item.id}
            serialNumber={serialNumber}
            serialLabel={zonePrefix ?? undefined}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
        {onAssignZone ? (
          <div className="shrink-0 pt-4">
            <QuoteItemZoneSelect
              zoneTitleId={zoneTitleId}
              zoneOptions={zoneOptions}
              labels={labels}
              onAssign={onAssignZone}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-3">
          <QuoteFieldBlock label={labels.valueServiceDesc}>
            <input
              type="text"
              value={item.name || ""}
              placeholder={labels.valueServicePlaceholder}
              onChange={(e) => updateItem(item.id, "name", e.target.value)}
              className={QUOTE_INPUT_CLASS}
            />
          </QuoteFieldBlock>
          <div className="flex flex-col gap-3 min-[650px]:flex-row min-[650px]:items-end">
            <div className="grid min-w-0 flex-1 grid-cols-5 gap-3">
              <QuoteFieldBlock label={labels.quantity} className="[&_label]:whitespace-nowrap">
                <input
                  type="number"
                  value={item.quantity || ""}
                  placeholder="1"
                  min={1}
                  onChange={(e) =>
                    updateItem(item.id, "quantity", e.target.value ? parseInt(e.target.value) : 0)
                  }
                  className={QUOTE_NUMBER_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.unit} className="[&_label]:whitespace-nowrap">
                <input
                  type="text"
                  value={quoteUnitLabel(item.unit, labels.unit === 'Unit' ? 'en' : 'zh')}
                  placeholder="—"
                  maxLength={4}
                  onChange={(e) => updateItem(item.id, "unit", e.target.value)}
                  className={QUOTE_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.hkdCostAmount} className="[&_label]:whitespace-nowrap">
                <input
                  type="number"
                  value={typeof item.hkdCostPrice === "number" ? item.hkdCostPrice : ""}
                  placeholder="0"
                  min={0}
                  onChange={(e) =>
                    updateItem(
                      item.id,
                      "hkdCostPrice",
                      e.target.value ? parseFloat(e.target.value) : null,
                    )
                  }
                  className={QUOTE_NUMBER_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.hkdUnitPrice} className="[&_label]:whitespace-nowrap">
                <input
                  type="number"
                  value={typeof item.unitPrice === "number" ? item.unitPrice : ""}
                  placeholder="0"
                  min={0}
                  onChange={(e) =>
                    updateItem(item.id, "unitPrice", e.target.value ? parseFloat(e.target.value) : 0)
                  }
                  className={QUOTE_NUMBER_INPUT_CLASS}
                />
              </QuoteFieldBlock>
              <QuoteFieldBlock label={labels.hkdSubtotal} className="[&_label]:whitespace-nowrap">
                <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
                  <span className="font-mono-data text-xs font-medium text-foreground">
                    ${(item.unitPrice * item.quantity).toLocaleString()}
                  </span>
                </div>
              </QuoteFieldBlock>
            </div>
            <div className="flex shrink-0 items-end justify-end pb-0.5">
              <QuoteRowActionButtons
                itemId={item.id}
                cutItemId={cutItemId}
                onCut={cutItem}
                onDuplicate={duplicateItem}
                onRemove={removeItem}
                labels={labels}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                canMoveUp={canMoveUp}
                canMoveDown={canMoveDown}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * AI 生圖進度條：對話框與背景 toast 共用同一個顯示，
 * percent 由 quoteLayoutRender 按實際階段回報，生圖期間再用時間估算推進。
 */
function ZoneRenderProgressMeter({ progress, className }: { progress?: LayoutRenderProgress; className?: string }) {
  const percent = Math.round(progress?.percent ?? 0);
  return (
    // aria-live="off"：進度每幾秒跳一次，避免螢幕閱讀器重複朗讀，階段文字由外層 status 交代。
    <div className={cn('space-y-1.5', className)} aria-live="off">
      <div className="flex items-center justify-between gap-3 font-body text-xs">
        <span className="min-w-0 truncate">{progress?.label ?? '準備中…'}</span>
        <span className="shrink-0 font-mono-data tabular-nums">{percent}%</span>
      </div>
      <Progress value={percent} aria-label="AI 生成渲染圖進度" />
    </div>
  );
}

/**
 * 分區生成進度只存一份：分區按鈕、右上角 toast 與預覽對話框都讀同一個 store，
 * 三處顯示的百分比與階段文字因此永遠一致（不會再出現 toast 停在 24%、按鈕已到 56%）。
 * store 由元件實例持有（useRef），不放在模組層：模組層在熱更新或多份 bundle 時會有兩份，
 * 寫入與訂閱各自落在不同的 Map，進度就會只更新一半。
 */
type ZoneRenderProgressStore = {
  get: (zoneId: string) => LayoutRenderProgress | undefined;
  set: (zoneId: string, progress: LayoutRenderProgress) => void;
  clear: (zoneId: string) => void;
  subscribe: (zoneId: string, listener: () => void) => () => void;
};

function createZoneRenderProgressStore(): ZoneRenderProgressStore {
  const values = new Map<string, LayoutRenderProgress>();
  const listeners = new Map<string, Set<() => void>>();
  const emit = (zoneId: string) => listeners.get(zoneId)?.forEach((listener) => listener());
  return {
    get: (zoneId) => values.get(zoneId),
    set: (zoneId, progress) => {
      const previous = values.get(zoneId);
      if (previous && previous.percent === progress.percent && previous.label === progress.label) return;
      values.set(zoneId, progress);
      emit(zoneId);
    },
    clear: (zoneId) => {
      if (!values.delete(zoneId)) return;
      emit(zoneId);
    },
    subscribe: (zoneId, listener) => {
      const set = listeners.get(zoneId) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(zoneId, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(zoneId);
      };
    },
  };
}

/** 訂閱單一分區的進度：重掛、toast 重建或晚一步才 mount 都即時拿到最新值，不會停在舊百分比。 */
function useZoneRenderProgress(store: ZoneRenderProgressStore, zoneId: string): LayoutRenderProgress | undefined {
  const subscribe = useCallback((listener: () => void) => store.subscribe(zoneId, listener), [store, zoneId]);
  const snapshot = useCallback(() => store.get(zoneId), [store, zoneId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** toast 內的進度條：跟分區按鈕讀同一個 store，toast 只建立一次，關掉就不會再出現。 */
function ZoneRenderProgressToastBody({ store, zoneId }: { store: ZoneRenderProgressStore; zoneId: string }) {
  const progress = useZoneRenderProgress(store, zoneId);
  return <ZoneRenderProgressMeter progress={progress} className="mt-1 w-full" />;
}

function QuoteSectionTitleCard({
  item,
  index,
  items,
  itemCount,
  onAddItemAbove,
  onAddItemBelow,
  draggingItemId,
  dropInsertIndex,
  cutItemId,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  updateItem,
  cutItem,
  duplicateItem,
  removeItem,
  labels,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  zoneImageUrls = [],
  onGenerateZoneRender,
  zoneRenderBusy = false,
  zoneRenderStore,
  zoneRenderDisabled = false,
  onUploadZoneImage,
  onRemoveZoneImage,
  onPreviewZoneImage,
}: {
  item: QuotationItem;
  index: number;
  items: QuotationItem[];
  /** Furniture/service rows currently inside this zone. */
  itemCount: number;
  onAddItemAbove: () => void;
  onAddItemBelow: () => void;
  draggingItemId: string | null;
  dropInsertIndex: number | null;
  cutItemId: string | null;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  updateItem: (id: string, field: keyof QuotationItem, value: string | number | null) => void;
  cutItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  removeItem: (id: string) => void;
  labels: QuoteUiLabels;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  zoneImageUrls?: string[];
  onGenerateZoneRender?: () => void;
  zoneRenderBusy?: boolean;
  /** 分區生成進度：按鈕與右上角 toast 讀同一個 store，避免兩處數字不同步。 */
  zoneRenderStore: ZoneRenderProgressStore;
  zoneRenderDisabled?: boolean;
  onUploadZoneImage?: () => void;
  onRemoveZoneImage?: (url: string) => void;
  onPreviewZoneImage?: (imageIndex: number) => void;
}) {
  const ordinal = sectionTitleOrdinalAt(items, index);
  const prefix = sectionTitlePrefix(ordinal);
  const zoneRenderProgress = useZoneRenderProgress(zoneRenderStore, item.id);
  const zoneAddBtn = cn(
    QUOTE_ACTION_BTN_CLASS,
    "border-primary/40 bg-background text-foreground/80 hover:bg-primary/5 hover:text-primary",
  );

  return (
    <div
      id={zoneAnchorId(item.id)}
      className={quoteRowReorderClass(
        index,
        item.id,
        draggingItemId,
        dropInsertIndex,
        cutItemId,
        "rounded-lg border border-primary/25 bg-primary/5 p-3",
      )}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <QuoteRowDragHandle
            itemId={item.id}
            serialLabel={prefix}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <input
              type="text"
              value={item.name || ""}
              placeholder={labels.sectionTitlePlaceholder}
              onChange={(e) => updateItem(item.id, "name", e.target.value)}
              className={cn(QUOTE_INPUT_CLASS, "text-sm font-semibold")}
              aria-label={labels.sectionTitleLabel}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <QuoteRowActionButtons
            itemId={item.id}
            cutItemId={cutItemId}
            onCut={cutItem}
            onDuplicate={duplicateItem}
            onRemove={removeItem}
            labels={labels}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                canMoveUp={canMoveUp}
                canMoveDown={canMoveDown}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-primary/15 pt-2">
        <p className="font-body text-xs text-muted-foreground">
          {labels.zoneItemCount.replace("{n}", String(itemCount))}
        </p>
        <div className="flex flex-wrap items-center gap-2">
        {onGenerateZoneRender ? <Button type="button" variant="outline" size="sm" className={zoneAddBtn} disabled={zoneRenderDisabled || zoneRenderBusy} onClick={onGenerateZoneRender}>
          {zoneRenderBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
          {zoneRenderBusy ? (zoneRenderProgress ? `生成中 ${Math.round(zoneRenderProgress.percent)}%` : '生成中…') : '生成渲染圖'}
        </Button> : null}
        <button
          type="button"
          onClick={onAddItemAbove}
          className={zoneAddBtn}
          title={labels.zoneAddItemAbove}
        >
          <Plus className="h-3 w-3" />
          {labels.zoneAddItemAbove}
        </button>
        <button
          type="button"
          onClick={onAddItemBelow}
          className={zoneAddBtn}
          title={labels.zoneAddItemBelow}
        >
          <Plus className="h-3 w-3" />
          {labels.zoneAddItemBelow}
        </button>
        {onUploadZoneImage ? (
          <button
            type="button"
            onClick={onUploadZoneImage}
            className={zoneAddBtn}
            title={labels.uploadZoneImage}
          >
            <ImagePlus className="h-3 w-3" />
            {labels.uploadZoneImage}
          </button>
        ) : null}
        </div>
      </div>
      {zoneImageUrls.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {zoneImageUrls.map((url, imageIndex) => (
            <div key={url} className="relative">
              <button
                type="button"
                onClick={() => onPreviewZoneImage?.(imageIndex)}
                className="block overflow-hidden rounded-md border border-border bg-background"
                aria-label={`${item.name || labels.sectionTitleLabel} 圖片 ${imageIndex + 1}`}
              >
                <LoadingImage
                  src={url}
                  alt=""
                  className="h-16 w-20"
                  imgClassName="object-contain"
                />
              </button>
              <button
                type="button"
                onClick={() => onRemoveZoneImage?.(url)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive"
                aria-label={labels.removeZoneImage}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact read-only zone banner shown in the product/service tabs where
 * section-title rows are filtered out — keeps 分區 context visible while
 * editing furniture. Full zone editing lives on the 備註標題 tab.
 */
function QuoteZoneDivider({
  ordinal,
  name,
  count,
  itemCountLabel,
}: {
  ordinal: number;
  name: string;
  count: number;
  itemCountLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-1.5">
      <span className="font-body text-xs font-bold text-primary/70">
        {sectionTitlePrefix(ordinal)}
      </span>
      <span className="min-w-0 truncate font-body text-xs font-bold text-primary/80">
        {name || "(未命名分區)"}
      </span>
      <span className="ml-auto shrink-0 font-body text-[11px] text-muted-foreground">
        {count > 0 ? itemCountLabel : null}
      </span>
    </div>
  );
}

function LabelValueRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-2 last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-xs leading-5 text-slate-500">{children}</div>
    </div>
  );
}

function QuoteMultiChoice({ label, values, options, onChange, english = false }: {
  english?: boolean;
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const available = [...new Map([...options, ...values].map((option) => [
    option.normalize('NFKC').replace(/\s+/g, ' ').trim(), option,
  ])).values()];
  return (
    <QuoteFieldBlock label={label}>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label} title={values.join('、')} className={cn(QUOTE_PANEL_CONTROL_CLASS, "flex items-center justify-between gap-2 text-left")}>
            <span className="min-w-0 flex-1 truncate">{values.length ? values.join('、') : (english ? `Select ${label.toLowerCase()}` : `選擇${label}`)}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={16} className="w-[min(440px,calc(100vw-32px))] p-3">
          <Input aria-label={`搜尋${label}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={english ? `Search ${label.toLowerCase()}…` : `搜尋${label}…`} className={QUOTE_INPUT_CLASS} />
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {available.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase())).map((option) => (
              <label key={option} className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-xs leading-5 hover:bg-muted">
                <Checkbox className="mt-0.5" checked={values.includes(option)} onCheckedChange={(checked) => onChange(checked ? [...values, option] : values.filter((value) => value !== option))} />
                <span>{option}</span>
              </label>
            ))}
            {available.length === 0 && <p className="p-2 text-xs text-muted-foreground">{english ? 'No options configured' : '尚未設定選項'}</p>}
          </div>
        </PopoverContent>
      </Popover>
    </QuoteFieldBlock>
  );
}

function InfoPanelColumn({
  english = false,
  title,
  icon,
  iconClassName,
  collapsed,
  onToggle,
  summary,
  children,
}: {
  english?: boolean;
  title: string;
  icon: ReactNode;
  iconClassName: string;
  collapsed: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  const editing = !collapsed;
  return (
    <section className="quote-info-panel flex h-full flex-col overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="flex items-center gap-2 px-3 py-3">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            iconClassName,
          )}
        >
          {icon}
        </span>
        <h2 className="min-w-0 flex-1 font-display text-sm font-bold text-foreground">{title}</h2>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-background px-2.5 font-body text-xs font-medium text-foreground hover:bg-muted/50"
        >
          {english ? (editing ? 'Done' : 'Edit') : (editing ? '完成' : '編輯')}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          aria-expanded={editing}
          aria-label={editing ? "收合" : "展開編輯"}
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", editing && "rotate-180")}
          />
        </button>
      </div>
      <div className="flex-1 border-t border-border/60 px-3 pb-3 pt-1">
        {editing ? <div className="space-y-3 pt-2">{children}</div> : summary}
      </div>
    </section>
  );
}

const DIMENSION_INPUT_CLASS =
  "w-12 rounded-md border border-border bg-background px-1 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

function parseDimensionInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function enrichQuotationItemRegistry(
  item: QuotationItem,
  pairs: ProductCategoryPair[],
): QuotationItem {
  const pair = findProductCategoryPairById(pairs, item.productCategoryId);
  if (!pair) return item;
  return {
    ...item,
    registryLevel1: pair.level1,
    registryLevel2: pair.level2,
  };
}

function createBlankProductItem(): QuotationItem {
  return {
    id: generateId(),
    image: "",
    referenceImage: "",
    name: "",
    costPrice: null,
    exchangeRate: null,
    hkdCostPrice: null,
    unitPrice: 0,
    quantity: 1,
    unit: "",
    sku: "",
    category: "",
    material: "",
    color: "",
    remarks: "",
    dimensionLMm: null,
    dimensionWMm: null,
    dimensionHMm: null,
    dimensionMode: 'lwh',
    deliveryTermName: "",
    factoryName: "",
    factoryFromCatalog: false,
    isOptional: false,
    hideInPdf: false,
  };
}

function createBlankSectionTitle(): QuotationItem {
  return {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    exchangeRate: null,
    hkdCostPrice: null,
    unitPrice: 0,
    quantity: 0,
    unit: "",
    isSectionTitle: true,
  };
}

function createBlankCustomTerm(defaultName = ""): QuotationItem {
  return {
    id: generateId(),
    image: "",
    name: defaultName,
    costPrice: null,
    exchangeRate: null,
    hkdCostPrice: null,
    unitPrice: 0,
    quantity: 1,
    unit: "",
    isCustomTerm: true,
  };
}

/** Insert `rows` before index `at` (0 = start of list). */
function insertItemsAt(
  prev: QuotationItem[],
  rows: QuotationItem[],
  at: number,
): QuotationItem[] {
  const clamped = Math.max(0, Math.min(at, prev.length));
  return [...prev.slice(0, clamped), ...rows, ...prev.slice(clamped)];
}

function zoneRowsFromItems(items: QuotationItem[], regions: QuoteZoneRegion[]): ZoneManagerRow[] {
  return items
    .filter((item) => item.isSectionTitle)
    .map((item) => {
      const rects = regions.filter((region) => region.zoneId === item.id).map((region) => region.rect);
      return {
        id: item.id,
        name: item.name || "",
        nameEn: item.remarks || "",
        spaceType: item.category || "",
        quantity: item.quantity > 0 ? item.quantity : 1,
        rect: rects[0] ?? null,
        rects,
      };
    });
}

/** Rebuild the flat list from the zone-manager draft. Removed zones release their rows to 未分區. */
function applyZoneManager(
  items: QuotationItem[],
  drafts: ZoneManagerRow[],
): QuotationItem[] {
  const kept = new Set(drafts.map((row) => row.id));
  const unzoned: QuotationItem[] = [];
  const blocks = new Map<string, QuotationItem[]>();
  let currentId: string | null = null;
  let current: QuotationItem[] | null = null;
  const flush = () => {
    if (current && currentId) blocks.set(currentId, current);
    current = null;
    currentId = null;
  };
  for (const item of items) {
    if (item.isSectionTitle) {
      flush();
      currentId = item.id;
      current = [item];
    } else if (current) {
      current.push(item);
    } else {
      unzoned.push(item);
    }
  }
  flush();
  const orphans: QuotationItem[] = [];
  for (const [id, block] of blocks) {
    if (!kept.has(id)) orphans.push(...block.filter((row) => !row.isSectionTitle));
  }
  const next = [...unzoned, ...orphans];
  for (const draft of drafts) {
    const name = draft.name.trim() || draft.nameEn.trim();
    const block = blocks.get(draft.id);
    const profile = {
      name,
      remarks: draft.nameEn.trim(),
      category: draft.spaceType.trim(),
      quantity: draft.quantity > 0 ? draft.quantity : 1,
    };
    if (block) {
      next.push({ ...block[0], ...profile, name: name || block[0].name }, ...block.slice(1));
    } else if (name) {
      next.push({ ...createBlankSectionTitle(), id: draft.id, ...profile });
    }
  }
  return next;
}

/** Dirty checks ignore the draft timestamp so a save can match the next render. */
function quoteDraftSnapshot(draft: DraftData): string {
  const { updatedAt: _updatedAt, ...rest } = draft;
  return JSON.stringify(rest);
}

function QuoteAddRowButtonGroup({
  labels,
  onCopyFromOther,
  onAddSectionTitle,
  onAddField,
  onAddCustomTerm,
  onAddProduct,
  onUploadZoneImage,
  onPaste,
  showPaste = false,
  compact = false,
}: {
  labels: QuoteUiLabels;
  onCopyFromOther: () => void;
  onAddSectionTitle: () => void;
  onAddField: () => void;
  onAddCustomTerm: () => void;
  onAddProduct: () => void;
  onUploadZoneImage?: () => void;
  onPaste?: () => void;
  showPaste?: boolean;
  compact?: boolean;
}) {
  const btnBase = cn(
    QUOTE_ACTION_BTN_CLASS,
    compact ? "px-2.5" : "rounded-lg px-3",
  );
  const iconClass = "h-3.5 w-3.5";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCopyFromOther}
        className={cn(
          btnBase,
          "border-violet-500/50 text-violet-700 hover:bg-violet-500/5 dark:text-violet-400",
        )}
      >
        <Copy className={iconClass} />
        {labels.copyFromOtherQuote}
      </button>
      <button
        type="button"
        onClick={onAddSectionTitle}
        className={cn(
          btnBase,
          "border-sky-500/50 text-sky-700 hover:bg-sky-500/5 dark:text-sky-400",
        )}
      >
        <Plus className={iconClass} />
        {labels.addSectionTitle}
      </button>
      {onUploadZoneImage ? (
        <button
          type="button"
          onClick={onUploadZoneImage}
          className={cn(
            btnBase,
            "border-teal-500/50 text-teal-700 hover:bg-teal-500/5 dark:text-teal-400",
          )}
        >
          <ImagePlus className={iconClass} />
          {labels.uploadZoneImage}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onAddField}
        className={cn(btnBase, "border-border text-foreground/80 hover:bg-muted/50")}
      >
        <Plus className={iconClass} />
        {labels.addField}
      </button>
      <button
        type="button"
        onClick={onAddCustomTerm}
        className={cn(
          btnBase,
          "border-orange-400 text-orange-600 hover:bg-orange-50",
        )}
      >
        <Plus className={iconClass} />
        {labels.addValueService}
      </button>
      <button
        type="button"
        onClick={onAddProduct}
        className={cn(
          btnBase,
          "border-indigo-400 text-indigo-700 hover:bg-indigo-50",
        )}
      >
        <Plus className={iconClass} />
        {labels.addProduct}
      </button>
      {showPaste && onPaste ? (
        <button
          type="button"
          onClick={onPaste}
          className={cn(
            btnBase,
            "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400",
          )}
        >
          <ClipboardPaste className={iconClass} />
          {labels.pasteItem}
        </button>
      ) : null}
    </div>
  );
}

/** A section title with no product or service lines under it is omitted from the PDF. */
function omitEmptyPdfZones(rows: QuotationItem[]): QuotationItem[] {
  const keepTitle = new Set<number>();
  let titleIndex = -1;
  let hasBody = false;
  const closeZone = () => {
    if (titleIndex >= 0 && hasBody) keepTitle.add(titleIndex);
    titleIndex = -1;
    hasBody = false;
  };
  rows.forEach((item, index) => {
    if (item.isSectionTitle) {
      closeZone();
      titleIndex = index;
      return;
    }
    hasBody = true;
  });
  closeZone();
  return rows.filter((item, index) => !item.isSectionTitle || keepTitle.has(index));
}

/** Rows created via 新建欄位 may have category/material but no product name — still export to PDF. */
function hasQuoteItemContent(item: QuotationItem): boolean {
  if (item.isSectionTitle || item.isCustomTerm) {
    return Boolean((item.name || "").trim());
  }
  return Boolean(
    (item.name || "").trim() ||
      (item.category || "").trim() ||
      materialPlainText(item.material) ||
      (item.color || "").trim() ||
      (item.remarks || "").trim() ||
      item.image ||
      item.referenceImage ||
      item.remarksImage ||
      (item.unitPrice ?? 0) > 0 ||
      item.costPrice != null ||
      (item.dimensionLMm != null && String(item.dimensionLMm).trim() !== "") ||
      (item.dimensionWMm != null && String(item.dimensionWMm).trim() !== "") ||
      (item.dimensionHMm != null && String(item.dimensionHMm).trim() !== "") ||
      (item.factoryName || "").trim(),
  );
}

const DEFAULT_ITEMS: QuotationItem[] = [
  {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    exchangeRate: null,
    hkdCostPrice: null,
    unitPrice: 0,
    quantity: 1,
  },
  {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    exchangeRate: null,
    hkdCostPrice: null,
    unitPrice: 0,
    quantity: 1,
  },
  {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    exchangeRate: null,
    hkdCostPrice: null,
    unitPrice: 0,
    quantity: 1,
  },
  {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    exchangeRate: null,
    hkdCostPrice: null,
    unitPrice: 0,
    quantity: 1,
  },
];

function mapInputToQuotationItem(item: BwfQuoteItemInput): QuotationItem {
  const costPrice = item.costPrice ?? null;
  const exchangeRate = item.exchangeRate ?? null;
  return {
    id: item.id || generateId(),
    image: item.image || "",
    // Older furniture rows used category as their product label.
    name:
      item.name?.trim() ||
      (!item.isSectionTitle && !item.isCustomTerm
        ? item.category?.trim()
        : "") ||
      "",
    costPrice,
    exchangeRate,
    hkdCostPrice:
      item.hkdCostPrice ?? computeHkdCostPrice(costPrice, exchangeRate),
    unitPrice: item.unitPrice || 0,
    quantity: item.quantity || 1,
    unit: item.unit || "",
    sku: item.sku || "",
    category: item.category,
    material: item.material,
    color: item.color,
    remarks: item.remarks,
    remarksImage: item.remarksImage,
    referenceImage: item.referenceImage,
    dimensionLMm:
      item.dimensionLMm == null || item.dimensionLMm === ""
        ? null
        : String(item.dimensionLMm).trim() || null,
    dimensionWMm:
      item.dimensionWMm == null || item.dimensionWMm === ""
        ? null
        : String(item.dimensionWMm).trim() || null,
    dimensionHMm:
      item.dimensionHMm == null || item.dimensionHMm === ""
        ? null
        : String(item.dimensionHMm).trim() || null,
    dimensionMode:
      (item as { dimensionMode?: QuotationDimensionMode }).dimensionMode ?? "lwh",
    deliveryTermName: item.deliveryTermName,
    factoryName: item.factoryName || "",
    factoryFromCatalog: item.factoryFromCatalog ?? false,
    isCustomTerm: item.isCustomTerm,
    isOptional: item.isOptional ?? false,
    hideInPdf: item.hideInPdf ?? false,
    isSectionTitle: item.isSectionTitle ?? false,
    productId: item.productId ?? null,
    productCategoryId: item.productCategoryId ?? null,
  };
}

type CostBreakdownLine = {
  key: string;
  name: string;
  unitCost: number;
  quantity: number;
  lineCost: number;
  mismatch: boolean;
};

/**
 * Shared hover card for the Cost totals (header metric + fee summary card).
 * The list scrolls inside a viewport-capped panel so it never runs off screen.
 */
function CostBreakdownHoverCard({
  children,
  lines,
  unpricedCount,
  total,
  english,
}: {
  children: ReactElement;
  lines: CostBreakdownLine[];
  unpricedCount: number;
  total: number;
  english: boolean;
}) {
  const label = (zh: string, en: string) => (english ? en : zh);
  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="group w-[min(92vw,20rem)] border-0 bg-transparent p-0 shadow-none"
      >
        {/* 小三角：旋轉 45° 的方塊；上半在卡片外，下半與 header / footer 同色，視覺上與卡片連成一體 */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-6 top-0 hidden h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t border-[hsl(var(--border))] bg-muted group-data-[side=bottom]:block"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-6 hidden h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rotate-45 border-b border-r border-[hsl(var(--border))] bg-popover group-data-[side=top]:block"
        />
        <div className="flex max-h-[min(70vh,24rem)] w-full flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-[0_18px_45px_-12px_rgba(15,23,42,0.4),0_4px_12px_-4px_rgba(15,23,42,0.22)]">
          <div className="border-b bg-muted px-3 py-2">
            <p className="font-body text-xs font-semibold text-foreground">{label('成本明細', 'Cost breakdown')}</p>
            <p className="mt-0.5 font-body text-[11px] text-muted-foreground">
              {label('單件成本 × 數量（HKD）', 'Unit cost × quantity (HKD)')}
            </p>
          </div>
          {lines.length === 0 ? (
            <p className="px-3 py-3 font-body text-xs text-muted-foreground">
              {label('未有已設定成本的項目', 'No items with a cost yet')}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {lines.map((line) => (
                <li key={line.key} className="flex items-baseline gap-2 px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body text-xs text-foreground" title={line.name}>{line.name}</p>
                    <p className="font-body text-[10px] tabular-nums text-muted-foreground">
                      ${line.unitCost.toLocaleString()} × {line.quantity}
                    </p>
                  </div>
                  {line.mismatch ? (
                    <span
                      className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-body text-[10px] font-semibold text-amber-700"
                      title={label('HKD 成本與「¥成本 × 匯率」不一致', 'HKD cost differs from CNY cost × rate')}
                    >
                      ≠
                    </span>
                  ) : null}
                  <span className="shrink-0 font-body text-xs font-semibold tabular-nums text-foreground">
                    ${line.lineCost.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {unpricedCount > 0 ? (
            <p className="border-t px-3 py-1.5 font-body text-[10px] text-muted-foreground">
              {label(`另有 ${unpricedCount} 項未設定成本`, `${unpricedCount} item(s) have no cost set`)}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <span className="font-body text-xs font-semibold text-muted-foreground">{label('合計', 'Total')}</span>
            <strong className="font-body text-sm font-bold tabular-nums text-[hsl(24,90%,48%)]">
              ${total.toLocaleString()}
            </strong>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function QuotationDraftEditor({
  formData,
  onFormDataChange,
  industryOptions,
  serviceScopeOptions,
  workPeriodOptions,
  onBack,
  userEmail,
  onOpenPdfPreview,
  onQuotePersisted,
  existingQuote,
  initialCopyPayload,
  initialQuoteItems,
  forceNewQuote = false,
  draftQuoteId = null,
}: QuotationDraftEditorProps) {
  const ui = (zh: string, en: string) => quoteLocale === 'en' ? en : zh;
  const { user } = useAuth();
  const { profileRole } = usePlatformRole();
  const canUseQuoteEmail = ['admin', 'uploader', 'pm'].includes((profileRole ?? '').toLowerCase());
  const staffName = usePmsStaffName(user?.id);
  /** 組件卸載後（用戶已切去其他頁面）toast 的 action 仍可被點，需要知道是否還在報價單頁。 */
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Determine initial values from existingQuote or defaults
  const savedProjectData = existingQuote?.projectData || {};
  const copyPayload = initialCopyPayload ?? null;
  const savedCompanyInfo = savedProjectData.companyInfo as
    | {
        name?: string;
        address?: string;
        addressEn?: string;
        showAddressInPdf?: boolean;
        phone?: string;
        email?: string;
        website?: string;
      }
    | undefined;
  const savedClientInfo = savedProjectData.clientInfo as
    | { name?: string; contactName?: string; phone?: string; email?: string }
    | undefined;
  const savedQuoteMeta = savedProjectData.quoteMeta as
    | {
        projectName?: string;
        pmName?: string;
        validity?: string;
        deliveryAddress?: string;
        date?: string;
      }
    | undefined;
  const savedDeliveryDetails = savedProjectData.deliveryDetails as
    | string
    | undefined;
  const savedDeliveryDetailsEn = savedProjectData.deliveryDetailsEn as
    | string
    | undefined;
  const legacyItems = itemsFromLegacyProjectData(
    savedProjectData as Record<string, unknown>,
  );
  const savedTermsContent = savedProjectData.termsContent as
    | {
        transport: string;
        extraFees: string;
        warranty: string;
        other: string;
        payment: string;
        fullHtml?: string;
      }
    | undefined;
  const savedTermsContentEn = savedProjectData.termsContentEn as
    | SavedTermsContent
    | undefined;

  // Basic information is immediately editable in the unified editor.
  const [collapseCompany, setCollapseCompany] = useState(false);
  const [collapseProject, setCollapseProject] = useState(false);
  const [collapseClient, setCollapseClient] = useState(false);
  const [collapseQuoteMeta, setCollapseQuoteMeta] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(true);
  const [activeNav, setActiveNav] = useState<"basic" | "content" | "fees" | "photos" | "terms">("basic");
  /** Section-title row currently at the top of 報價內容 — highlights its zone in the nav. */
  const [activeContentZoneId, setActiveContentZoneId] = useState<string | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const navLockUntilRef = useRef(0);
  /** 統一匯率改為彈窗輸入：按鈕只負責開啟，不再在工具列展開輸入框。 */
  const [unifyRateModalOpen, setUnifyRateModalOpen] = useState(false);
  const [unifyRateDraft, setUnifyRateDraft] = useState("");
  /** 開彈窗時預設抓取當日匯率：true＝輸入框目前是自動帶上的今日匯率。 */
  const [unifyRateAuto, setUnifyRateAuto] = useState(false);
  const [unifyRateLoadingToday, setUnifyRateLoadingToday] = useState(false);
  /** 當日匯率快取 — 同一次工作階段重開彈窗不再重新抓。 */
  const todayRateRef = useRef<number | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const { settings: formatSettings } = useQuoteFormatSettings();
  const [quoteShare, setQuoteShare] = useState<
    { quoteUuid: string; url: string; qr: string } | { quoteUuid: string; error: string } | null
  >(null);

  // 報價單圖片：project_data.quotePhotoLayouts 存排版，quotePhotoAssets 存圖片庫快照。
  const [quotePhotoLayouts, setQuotePhotoLayouts] = useState<PhotoLayoutGroup[]>(() =>
    parsePhotoLayouts(savedProjectData.quotePhotoLayouts),
  );
  const [quotePhotoAssets, setQuotePhotoAssets] = useState<QuotePhotoAssetRef[]>(() =>
    parseQuotePhotoAssetRefs(savedProjectData.quotePhotoAssets),
  );
  const [floorPlan, setFloorPlan] = useState<QuoteFloorPlan | null>(() =>
    parseQuoteFloorPlan(savedProjectData.floorPlan),
  );
  const [catalogPages, setCatalogPages] = useState<QuoteCatalogPage[]>(() =>
    parseQuoteCatalogPages((savedProjectData as Record<string, unknown>).catalogPageAttachments),
  );
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  const [zoneImages, setZoneImages] = useState<QuoteZoneImageMap>(() =>
    parseQuoteZoneImages(savedProjectData.zoneImages),
  );
  const [zonePhotoLayouts, setZonePhotoLayouts] = useState<Record<string, PhotoLayoutGroup[]>>(() =>
    parseZonePhotoLayouts(savedProjectData.zonePhotoLayouts),
  );
  const [zoneLayoutEditor, setZoneLayoutEditor] = useState<{ zoneId: string; groupId: string | null } | null>(null);
  const [photoLibrary, setPhotoLibrary] = useState<QuotePhotoAsset[]>([]);
  const [floorPlanBusy, setFloorPlanBusy] = useState(false);
  const [recognizingZones, setRecognizingZones] = useState(false);
  const [zoneRecognitionProgress, setZoneRecognitionProgress] = useState(0);
  const [floorPlanDragOver, setFloorPlanDragOver] = useState(false);
  const [zoneSortId, setZoneSortId] = useState<string | null>(null);
  const [floorPlanViewerOpen, setFloorPlanViewerOpen] = useState(false);
  const [pickingPlacement, setPickingPlacement] = useState<{ zoneId: string; itemId: string; index: number } | null>(null);
  const [renderingZoneIds, setRenderingZoneIds] = useState<Set<string>>(() => new Set());
  const [zoneRenderPreview, setZoneRenderPreview] = useState<ZoneRenderPreviewPayload | null>(null);
  const [zoneRenderVisible, setZoneRenderVisible] = useState(false);
  /** 預覽對話框內的修改意見：重新生成時跟上一張圖一同送交 AI。 */
  const [zoneRenderFeedback, setZoneRenderFeedback] = useState('');
  /** 目前這次重新生成是否由「自動修正」觸發，只用來顯示正確的文案。 */
  const [zoneRenderAutoFixRound, setZoneRenderAutoFixRound] = useState<number | null>(null);
  const zoneRenderBusyRef = useRef(new Set<string>());
  /**
   * 重新生成是背景任務：使用者在對話框按「重新生成」後可能順手關掉對話框，
   * 完成時要靠這兩個 ref 判斷結果要放回對話框，還是改成右上角 toast 通知。
   */
  const zoneRenderPreviewRef = useRef<ZoneRenderPreviewPayload | null>(null);
  const zoneRenderVisibleRef = useRef(false);
  useEffect(() => {
    zoneRenderPreviewRef.current = zoneRenderPreview;
  }, [zoneRenderPreview]);
  useEffect(() => {
    zoneRenderVisibleRef.current = zoneRenderVisible;
  }, [zoneRenderVisible]);
  /** 分區生成進度的唯一來源：分區按鈕、toast 與預覽對話框都訂閱它，不另外存一份 state。 */
  const zoneRenderStoreRef = useRef<ZoneRenderProgressStore | null>(null);
  if (!zoneRenderStoreRef.current) zoneRenderStoreRef.current = createZoneRenderProgressStore();
  const zoneRenderStore = zoneRenderStoreRef.current;
  const [activeFurnitureMarkerId, setActiveFurnitureMarkerId] = useState<string | null>(null);
  const [furnitureFocusRequest, setFurnitureFocusRequest] = useState(0);
  const [newFurnitureRect, setNewFurnitureRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [newFurnitureZone, setNewFurnitureZone] = useState('');
  const [newFurnitureCategory, setNewFurnitureCategory] = useState('');
  const [newFurnitureProduct, setNewFurnitureProduct] = useState('__none__');
  const [showRecognizedFurniture, setShowRecognizedFurniture] = useState(false);
  const [zoneCanvasEditing, setZoneCanvasEditing] = useState(false);
  const [layoutRenderOpen, setLayoutRenderOpen] = useState(false);
  const [zoneManagerOpen, setZoneManagerOpen] = useState(false);
  const [zoneManagerDraft, setZoneManagerDraft] = useState<ZoneManagerRow[]>([]);
  const [zoneHintItemId, setZoneHintItemId] = useState<string | null>(null);
  const zoneHintTimerRef = useRef<number | null>(null);
  const flashZoneSelect = (itemId: string) => {
    setZoneHintItemId(itemId);
    if (zoneHintTimerRef.current) window.clearTimeout(zoneHintTimerRef.current);
    zoneHintTimerRef.current = window.setTimeout(() => {
      setZoneHintItemId(null);
      zoneHintTimerRef.current = null;
    }, 2600);
  };
  useEffect(() => () => {
    if (zoneHintTimerRef.current) window.clearTimeout(zoneHintTimerRef.current);
  }, []);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [zoneImageTargetId, setZoneImageTargetId] = useState<string | null>(null);
  const [zoneLightbox, setZoneLightbox] = useState<{ urls: string[]; index: number; title?: string } | null>(null);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  const floorPlanRef = useRef(floorPlan);
  floorPlanRef.current = floorPlan;
  const zoneManagerDraftRef = useRef(zoneManagerDraft);
  zoneManagerDraftRef.current = zoneManagerDraft;
  const zoneManagerOpenRef = useRef(zoneManagerOpen);
  zoneManagerOpenRef.current = zoneManagerOpen;
  const zoneUndoRef = useRef<{ rows: ZoneManagerRow[]; placements: NonNullable<NonNullable<typeof floorPlan>['placements']> | undefined }[]>([]);
  const rememberZoneEdit = () => {
    zoneUndoRef.current.push({ rows: structuredClone(zoneManagerDraftRef.current), placements: structuredClone(floorPlanRef.current?.placements) });
    if (zoneUndoRef.current.length > 50) zoneUndoRef.current.shift();
  };
  useEffect(() => {
    if (!zoneManagerOpen) { zoneUndoRef.current = []; return; }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z' || target?.closest('input, textarea, [contenteditable="true"]') || newFurnitureRect || layoutRenderOpen) return;
      const previous = zoneUndoRef.current.pop();
      if (!previous) return;
      event.preventDefault();
      zoneManagerDraftRef.current = previous.rows;
      setZoneManagerDraft(previous.rows);
      setFloorPlan(current => current ? { ...current, placements: previous.placements } : current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoneManagerOpen, newFurnitureRect, layoutRenderOpen]);
  const [canManagePhotos, setCanManagePhotos] = useState(false);
  /**
   * 圖片庫標為封面／封底的圖（照 FCCD）：每次出 PDF 自動各佔一整頁，
   * 不隨報價存檔，改動圖片庫設定後下一個 PDF 就換圖。
   */
  const [quoteCoverPages, setQuoteCoverPages] = useState<QuoteCoverPage[]>([]);
  /** 圖片庫設為「內頁獨立整頁」的圖：出 PDF 自動插在正文第幾頁之後。 */
  const [quoteContentPages, setQuoteContentPages] = useState<QuoteContentPage[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listQuoteCoverPages().then((pages) => {
      if (!cancelled) setQuoteCoverPages(pages);
    });
    void listQuoteContentPages().then((pages) => {
      if (!cancelled) setQuoteContentPages(pages);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void canManageQuotePhotos().then((ok) => {
      if (!cancelled) setCanManagePhotos(ok);
    });
    void listQuotePhotoAssets().then((result) => {
      if (cancelled || result.error || result.missingTable) return;
      setPhotoLibrary((current) => {
        const known = new Set(current.map((asset) => asset.id));
        const extra = result.assets.filter((asset) => !known.has(asset.id));
        return extra.length === 0 ? current : [...current, ...extra];
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 版本審核後父層會重新載入 project_data，排版與快照要跟上。
  useEffect(() => {
    if (!existingQuote?.quoteId) return;
    const projectData = existingQuote.projectData as Record<string, unknown> | undefined;
    const nextLayouts = parsePhotoLayouts(projectData?.quotePhotoLayouts);
    setQuotePhotoLayouts((prev) => (JSON.stringify(prev) === JSON.stringify(nextLayouts) ? prev : nextLayouts));
    const nextAssets = parseQuotePhotoAssetRefs(projectData?.quotePhotoAssets);
    setQuotePhotoAssets((prev) => (JSON.stringify(prev) === JSON.stringify(nextAssets) ? prev : nextAssets));
    const nextFloorPlan = parseQuoteFloorPlan(projectData?.floorPlan);
    setFloorPlan((prev) => (JSON.stringify(prev) === JSON.stringify(nextFloorPlan) ? prev : nextFloorPlan));
    const nextZoneImages = parseQuoteZoneImages(projectData?.zoneImages);
    setZoneImages((prev) => (JSON.stringify(prev) === JSON.stringify(nextZoneImages) ? prev : nextZoneImages));
    const nextZoneLayouts = parseZonePhotoLayouts(projectData?.zonePhotoLayouts);
    setZonePhotoLayouts((prev) => (JSON.stringify(prev) === JSON.stringify(nextZoneLayouts) ? prev : nextZoneLayouts));
    const nextCatalogPages = parseQuoteCatalogPages(projectData?.catalogPageAttachments);
    setCatalogPages((prev) => (JSON.stringify(prev) === JSON.stringify(nextCatalogPages) ? prev : nextCatalogPages));
  }, [existingQuote?.quoteId, existingQuote?.projectData]);

  const shareQuoteUuid = forceNewQuote ? "" : existingQuote?.quoteUuid?.trim() || "";
  const shareQuoteId = existingQuote?.quoteId?.trim() || "";
  const canShareQuote = Boolean(shareQuoteUuid && shareQuoteId && shareQuoteId !== "NEW");
  const currentShare = canShareQuote && quoteShare?.quoteUuid === shareQuoteUuid ? quoteShare : null;
  const shareUrl = currentShare && "url" in currentShare ? currentShare.url : "";
  const qrDataUrl = currentShare && "qr" in currentShare ? currentShare.qr : null;
  const shareError = currentShare && "error" in currentShare ? currentShare.error : null;
  const shareBusy = canShareQuote && !currentShare;
  useEffect(() => {
    if (!canShareQuote) return;
    let cancelled = false;
    void (async () => {
      try {
        const link = await ensureQuoteShareLink({ quoteUuid: shareQuoteUuid, quoteId: shareQuoteId });
        if (cancelled) return;
        const qr = await QRCode.toDataURL(link.url, { margin: 1, width: 440 });
        if (!cancelled) setQuoteShare({ quoteUuid: shareQuoteUuid, url: link.url, qr });
      } catch (error) {
        if (!cancelled) setQuoteShare({
          quoteUuid: shareQuoteUuid,
          error: error instanceof Error ? error.message : "未能準備分享連結",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canShareQuote, shareQuoteId, shareQuoteUuid]);
  const [shareCopied, setShareCopied] = useState(false);

  // Company info (editable) — address / addressEn keep separate zh & en defaults;
  // after the user edits and saves, the saved value becomes the latest for that locale.
  const [companyInfo, setCompanyInfo] = useState({
    name: savedCompanyInfo?.name || formData.company || "Branding Works Design Ltd",
    address: savedCompanyInfo?.address || DEFAULT_COMPANY_ADDRESS.zh,
    addressEn: savedCompanyInfo?.addressEn || DEFAULT_COMPANY_ADDRESS.en,
    // 預設勾選：只有明確取消（舊資料沒有這個欄位）才不在 PDF 顯示地址。
    showAddressInPdf: savedCompanyInfo?.showAddressInPdf !== false,
    // Prefer the logged-in user's mapped phone when generating a quote.
    phone:
      resolveQuoteCompanyPhone({
        email: userEmail,
        name: null,
      }) ||
      savedCompanyInfo?.phone ||
      DEFAULT_QUOTE_COMPANY_PHONE,
    email: savedCompanyInfo?.email || "sales@brandingworks-furniture.com",
    website: savedCompanyInfo?.website || DEFAULT_COMPANY_WEBSITE,
  });

  // Keep「公司資訊 > 電話」aligned with the current login (email or PMS name).
  useEffect(() => {
    const resolved = resolveQuoteCompanyPhone({
      email: userEmail || user?.email,
      name: staffName,
    });
    if (!resolved) return;
    setCompanyInfo((current) =>
      current.phone === resolved ? current : { ...current, phone: resolved },
    );
  }, [staffName, user?.email, userEmail]);

  // Client info (editable, prefilled from steps or saved)
  // name = 公司名稱; contactName = 客戶名稱 (contact person)
  const [clientInfo, setClientInfo] = useState({
    name: savedClientInfo?.name || formData.clientName,
    contactName:
      savedClientInfo?.contactName || formData.clientContactName || "",
    phone: savedClientInfo?.phone || formData.clientPhone,
    email: savedClientInfo?.email || formData.clientEmail,
  });

  // Quote meta (editable) — pitching code is read-only from PMS
  const [quoteMeta, setQuoteMeta] = useState({
    pmName: savedQuoteMeta?.pmName || formData.projectManager,
    // Always show today in the editor; persist only on 保存現有版本 / 版本審核.
    date: todayQuoteDateIso(),
    validity: savedQuoteMeta?.validity || formData.validityDays || "30",
    deliveryAddress: savedQuoteMeta?.deliveryAddress || "",
  });
  const resolveEditorQuoteId = useCallback(
    (meta?: Record<string, unknown> | null) => {
      const existingId = existingQuote?.quoteId?.trim() || '';
      const preferredExisting = isLegacyQFormatQuoteId(existingId)
        ? ''
        : existingId;
      const fromFormMeta = resolvePitchingCode({
        quoteId: preferredExisting || formData.quoteId,
        pitchingCode: formData.pitchingCode,
        formData: formData as unknown as Record<string, unknown>,
        quoteMeta: (meta ?? quoteMeta) as unknown as Record<string, unknown>,
      });
      const fromUrl =
        typeof window !== 'undefined'
          ? (() => {
              const parsed = parseQuotePathname(window.location.pathname);
              return parsed.kind === 'quote' ? parsed.quoteId : '';
            })()
          : '';
      return (
        pickQuoteChainId(
          fromFormMeta,
          preferredExisting,
          formData.quoteId,
          formData.pitchingCode,
          formData.projectName,
          draftQuoteId,
          fromUrl,
        ) || ''
      );
    },
    [
      existingQuote?.quoteId,
      formData.quoteId,
      formData.pitchingCode,
      formData.projectName,
      formData,
      quoteMeta,
      draftQuoteId,
    ],
  );
  const quoteId = useMemo(() => resolveEditorQuoteId(), [resolveEditorQuoteId]);
  /**
   * toast 的 action 可能幾分鐘後才被點，到時要取最新「已存在」的報價單 id，
   * 而不是生成開始時的值；未保存的新報價單沒有詳情可跳，只能留在原頁預覽。
   */
  const persistedQuoteIdRef = useRef(existingQuote?.quoteId || '');
  persistedQuoteIdRef.current = existingQuote?.quoteId || '';
  /** Locked at 版本審核 open — survives parent remount clearing formData.quoteId. */
  const submitChainIdRef = useRef<string | null>(null);
  useEffect(() => {
    const locked = pickQuoteChainId(
      quoteId,
      existingQuote?.quoteId,
      formData.quoteId,
      draftQuoteId,
    );
    if (locked) submitChainIdRef.current = locked;
  }, [quoteId, existingQuote?.quoteId, formData.quoteId, draftQuoteId]);

  // Delivery details (editable) — zh / en kept separately (like company address).
  const [deliveryDetails, setDeliveryDetails] = useState(
    copyPayload?.deliveryDetails ??
      savedDeliveryDetails ??
      "訂單生產時間自收到訂金起計算，預計3-4 週完成。交付及安裝將分兩日進行：交付後1-2 個工作日內完成安裝。",
  );
  const [deliveryDetailsEn, setDeliveryDetailsEn] = useState(
    copyPayload?.deliveryDetailsEn ??
      savedDeliveryDetailsEn ??
      DEFAULT_QUOTATION_DELIVERY_DETAILS_EN,
  );

  // Discount (numeric value) — initialized from existing quote's project_data
  const savedDiscountNote = (() => {
    if (copyPayload) return copyPayload.discountNote;
    const raw = (savedProjectData as Record<string, unknown>).discountNote;
    return raw == null ? "" : String(raw);
  })();
  const [discountNote, setDiscountNote] = useState(savedDiscountNote);

  // Installation fee row (editable)
  const DEFAULT_INSTALL_FEE = {
    title: "傢俱安裝費用",
    subtitle: "安裝清單中傢俱產品並清理包裝垃圾",
    conditionText: "訂單總金額滿 HK$12,000\n將不收取安裝費用",
    freeLabel: "另議",
    chargeLabel: "另議",
    amount: null as number | null,
  };
  const savedInstallationFee = copyPayload?.installationFee
    ? copyPayload.installationFee
    : ((savedProjectData as Record<string, unknown>).installationFee as
        | typeof DEFAULT_INSTALL_FEE
        | undefined);
  const [installationFee, setInstallationFee] = useState({
    title: savedInstallationFee?.title || DEFAULT_INSTALL_FEE.title,
    subtitle: savedInstallationFee?.subtitle || DEFAULT_INSTALL_FEE.subtitle,
    conditionText:
      savedInstallationFee?.conditionText || DEFAULT_INSTALL_FEE.conditionText,
    freeLabel: savedInstallationFee?.freeLabel || DEFAULT_INSTALL_FEE.freeLabel,
    chargeLabel:
      savedInstallationFee?.chargeLabel || DEFAULT_INSTALL_FEE.chargeLabel,
    amount:
      typeof savedInstallationFee?.amount === "number"
        ? savedInstallationFee.amount
        : null,
  });

  const savedGpSummary = copyPayload
    ? copyPayload.gpSummary
    : parseGpSummary((savedProjectData as Record<string, unknown>).gpSummary);
  const [gpSummary, setGpSummary] = useState(savedGpSummary);

  // Keep GP Ship/Installation in sync when parent reloads project_data after 版本審核.
  useEffect(() => {
    if (!existingQuote?.quoteId) return;
    const next = parseGpSummary(
      (existingQuote.projectData as Record<string, unknown> | undefined)
        ?.gpSummary,
    );
    setGpSummary((prev) =>
      prev.ship === next.ship && prev.installation === next.installation
        ? prev
        : next,
    );
  }, [existingQuote?.quoteId, existingQuote?.projectData]);

  // Terms content — migrate legacy templates (incl. saved DB quotes & IndexedDB drafts)
  const [termsContent, setTermsContent] = useState(() =>
    migrateTermsContentToCurrent(
      (copyPayload?.termsContent ?? savedTermsContent) as
        | SavedTermsContent
        | undefined,
      savedQuoteMeta?.deliveryAddress,
    ),
  );
  const [termsContentEn, setTermsContentEn] = useState(() => {
    const saved =
      (copyPayload?.termsContentEn as SavedTermsContent | undefined) ??
      savedTermsContentEn;
    const defaults = englishTermsContentForPdf(savedQuoteMeta?.deliveryAddress);
    if (saved?.fullHtml?.trim()) {
      return {
        ...defaults,
        ...saved,
        fullHtml: saved.fullHtml,
      };
    }
    return defaults;
  });
  const [termsEditMode, setTermsEditMode] = useState(false);
  const [quoteLocale, setQuoteLocale] = useState<QuoteLocale>('zh');
  const t = quoteUi(quoteLocale);

  const finishTermsEdit = () => {
    setTermsEditMode(false);
  };

  // Re-apply canonical terms template when opening any saved quote (DB or IndexedDB).
  useEffect(() => {
    setTermsContent((prev) => {
      const migrated = migrateTermsContentToCurrent(
        prev as SavedTermsContent,
        quoteMeta.deliveryAddress,
      );
      if (
        migrated.fullHtml === prev.fullHtml &&
        migrated.templateVersion === prev.templateVersion
      ) {
        return prev;
      }
      return migrated;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingQuote?.quoteId]);

  const initialItemsHydratedRef = useRef(false);
  /** 外層已把明細載好才顯示編輯器；legacy project_data／複製內容仍然優先。 */
  const quoteItemsPrefetched =
    Boolean(existingQuote?.quoteUuid) &&
    initialQuoteItems !== undefined &&
    legacyItems.length === 0 &&
    !copyPayload?.items?.length;

  // Product items table
  const [factories, setFactories] = useState<string[]>([]);
  const [factoriesLoading, setFactoriesLoading] = useState(false);
  const [categoryPairs, setCategoryPairs] = useState<ProductCategoryPair[]>([]);
  const [categoryPairsLoading, setCategoryPairsLoading] = useState(false);
  const [items, setItems] = useState<QuotationItem[]>(() => {
    if (copyPayload?.items?.length) {
      return copyPayload.items.map((item) => mapInputToQuotationItem(item));
    }
    if (legacyItems.length > 0) {
      return legacyItems.map((item) => mapInputToQuotationItem(item));
    }
    if (quoteItemsPrefetched && initialQuoteItems?.length) {
      return initialQuoteItems.map((item) => mapInputToQuotationItem(item));
    }
    // Existing quotes load line items from bwf_quote_item — avoid flashing DEFAULT_ITEMS.
    if (existingQuote?.quoteUuid) {
      return [];
    }
    return DEFAULT_ITEMS;
  });
  const [itemsLoadedFromDb, setItemsLoadedFromDb] = useState(quoteItemsPrefetched);
  /** Line items failed to load: keep the loading hint off so the editor shows the empty table instead. */
  const [itemsLoadFailed, setItemsLoadFailed] = useState(
    quoteItemsPrefetched && initialQuoteItems === null,
  );
  /** 明細載入失敗時遞增，重新跑同一個 uuid 的載入（不用整頁 F5）。 */
  const [itemsReloadToken, setItemsReloadToken] = useState(0);
  /** 載入期間按了送出／保存：載入完成後自動續做，避免用未載入的明細落庫。 */
  const pendingQuoteActionRef = useRef<"submit" | "save" | null>(null);
  const autoPlacementAttempted = useRef(new Set<string>());
  useEffect(() => {
    if (existingQuote?.quoteUuid && !itemsLoadedFromDb) return;
    if (!floorPlan?.placements) return;
    const placements = matchFurniturePlacements(floorPlan.placements, layoutZones(items), autoPlacementAttempted.current);
    if (placements !== floorPlan.placements) {
      setFloorPlan(current => current === floorPlan ? { ...current, placements } : current);
    }
  }, [floorPlan, items, itemsLoadedFromDb, existingQuote?.quoteUuid]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const itemsLoadedRef = useRef(false);
  itemsLoadedRef.current = itemsLoadedFromDb;
  const itemsReadyWaiters = useRef<Array<() => void>>([]);
  /** 唤醒 waitForQuoteItems() 的等待者；失敗時也要 resolve，否則呼叫方會一直等下去。 */
  const resolveItemsWaiters = () => {
    const waiters = itemsReadyWaiters.current;
    itemsReadyWaiters.current = [];
    waiters.forEach((resolve) => resolve());
  };

  // 報價明細的產品圖：排版時預設放進素材區，不用再去圖片庫找。
  const quoteProductPhotos = useMemo(() => {
    const seen = new Set<string>();
    const photos: { id: string; title: string; url: string }[] = [];
    for (const item of items) {
      const url = (item.image || '').trim();
      if (!url || seen.has(url) || !hasQuoteItemContent(item)) continue;
      seen.add(url);
      photos.push({
        id: `product:${item.id}`,
        title: (item.name || item.sku || '產品圖').slice(0, 120),
        url,
      });
    }
    return photos;
  }, [items]);
  /** AI 生成候選（同 QMS）：只限報價明細的產品圖，AI 按產品圖把產品放進描述場景。 */
  const quotePhotoZones = useMemo<QuotePhotoZone[]>(() => {
    if (!floorPlan) return [];
    const zones: QuotePhotoZone[] = [];
    let current: QuotePhotoZone | null = null;
    for (const item of items) {
      if (item.isSectionTitle) {
        if (current?.name.trim()) zones.push(current);
        current = {
          id: item.id,
          name: (item.name || "").trim(),
          spaceType: (item.category || "").trim(),
          furniture: [],
        };
        continue;
      }
      if (!current || item.isCustomTerm) continue;
      const imageUrl = (item.image || "").trim();
      // 明細常常只填類別、產品名稱留空。類別就是這件傢俬的名稱。
      const name = (item.name || item.category || item.sku || "").trim();
      if (!name && !imageUrl) continue;
      const role = (item.category || item.registryLevel2 || item.registryLevel1 || "").trim();
      current.furniture.push({
        name: name || role || "傢俬",
        role,
        ...(imageUrl ? { imageUrl } : {}),
      });
    }
    if (current?.name.trim()) zones.push(current);
    return zones;
  }, [floorPlan, items]);
  const quoteAiChoices = useMemo<GenerateChoice[]>(
    () =>
      quoteProductPhotos.flatMap((photo) => {
        const url = (photo.url || "").trim();
        return url
          ? [{ id: photo.id, title: photo.title || "產品圖", previewUrl: url, referenceUrl: url }]
          : [];
      }),
    [quoteProductPhotos],
  );
  /** Prevents async loadQuoteItems from overwriting in-session line-item edits. */
  const itemsUserEditedRef = useRef(false);
  /** Tracks which quote uuid already hydrated items in this editor session. */
  const itemsHydratedForUuidRef = useRef<string | null>(
    quoteItemsPrefetched && Array.isArray(initialQuoteItems)
      ? existingQuote?.quoteUuid ?? null
      : null,
  );

  // Copy / legacy JSON drafts: infer product_id before first save (no quote UUID yet).
  useEffect(() => {
    if (initialItemsHydratedRef.current) return;
    if (existingQuote?.quoteUuid) return;
    const source = copyPayload?.items?.length
      ? copyPayload.items
      : legacyItems.length > 0
        ? legacyItems
        : null;
    if (!source?.length) return;
    initialItemsHydratedRef.current = true;
    void (async () => {
      const linked = await hydrateQuoteItemProductLinks(
        source.map(normalizeLegacyQuoteItemProductId),
      );
      if (itemsUserEditedRef.current) return;
      setItems(linked.map((item) => mapInputToQuotationItem(item)));
    })();
  }, [existingQuote?.quoteUuid, copyPayload, legacyItems]);

  // Load line items from bwf_quote_item (prefer over empty legacy JSON)
  useEffect(() => {
    const quoteUuid = existingQuote?.quoteUuid;
    if (!quoteUuid) {
      setItemsLoadedFromDb(true);
      return;
    }
    // Prefer items already hydrated from project_data / IndexedDB draft
    if (legacyItems.length > 0) {
      itemsHydratedForUuidRef.current = quoteUuid;
      setItemsLoadedFromDb(true);
      return;
    }
    // Same uuid already loaded — keep current rows.
    if (itemsHydratedForUuidRef.current === quoteUuid) {
      setItemsLoadedFromDb(true);
      return;
    }
    // After 版本審核 a new uuid appears; never clobber in-session edits / current table.
    // A flag with no line content is not an edit — the table is still the unloaded placeholder.
    if (
      itemsHydratedForUuidRef.current
    ) {
      itemsHydratedForUuidRef.current = quoteUuid;
      setItemsLoadedFromDb(true);
      return;
    }
    // 外層預載失敗：先顯示錯誤，等用戶按「重新載入明細」（itemsReloadToken > 0）才再抓，
    // 避免一進畫面就自動重試、把載入錯誤閃走。
    if (initialQuoteItems === null && itemsReloadToken === 0) return;
    let cancelled = false;
    setItemsLoadedFromDb(false);
    setItemsLoadFailed(false);
    (async () => {
      try {
        const rows = await loadQuoteItems(quoteUuid);
        if (cancelled) return;
        if (itemsUserEditedRef.current && itemsRef.current.some(hasQuoteItemContent)) {
          toast.error("明細載入期間有修改，請重新開啟報價單後再保存。");
          // 不要停在「仍在載入」：標成載入失敗，讓畫面顯示明確的錯誤與重新載入。
          if (!cancelled) {
            setItemsLoadFailed(true);
            resolveItemsWaiters();
          }
          return;
        }
        if (rows.length > 0) {
          const linked = await hydrateQuoteItemProductLinks(
            rows.map(normalizeLegacyQuoteItemProductId),
          );
          if (cancelled) return;
          if (itemsUserEditedRef.current && itemsRef.current.some(hasQuoteItemContent)) {
            toast.error("明細載入期間有修改，請重新開啟報價單後再保存。");
            if (!cancelled) {
              setItemsLoadFailed(true);
              resolveItemsWaiters();
            }
            return;
          }
          setItems(linked.map((item) => mapInputToQuotationItem(item)));
        }
        itemsHydratedForUuidRef.current = quoteUuid;
        if (!cancelled) setItemsLoadedFromDb(true);
      } catch (err) {
        console.warn('[QuotationDraftEditor] loadQuoteItems failed', err);
        if (!cancelled) {
          setItemsLoadedFromDb(false);
          setItemsLoadFailed(true);
          resolveItemsWaiters();
          toast.error('報價明細載入失敗，已暫停保存。請重新載入明細後再試。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // legacyItems length is stable for this existingQuote mount.
    // itemsReloadToken retries the same uuid after a failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingQuote?.quoteUuid, itemsReloadToken]);

  useEffect(() => {
    if (!itemsLoadedFromDb) return;
    const waiters = itemsReadyWaiters.current;
    itemsReadyWaiters.current = [];
    waiters.forEach((resolve) => resolve());
  }, [itemsLoadedFromDb]);

  const waitForQuoteItems = () => {
    if (!existingQuote?.quoteUuid || itemsLoadedRef.current || itemsLoadFailed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      itemsReadyWaiters.current.push(resolve);
    });
  };

  /** 明細載入失敗後的「重新載入」：重跑同一個 uuid，不用整頁刷新。 */
  const retryQuoteItemsLoad = () => {
    setItemsLoadFailed(false);
    setItemsLoadedFromDb(false);
    setItemsReloadToken((token) => token + 1);
  };

  useEffect(() => {
    let cancelled = false;
    setFactoriesLoading(true);
    fetchFactories()
      .then((names) => {
        if (!cancelled) setFactories(names);
      })
      .finally(() => {
        if (!cancelled) setFactoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCategoryPairsLoading(true);
    fetchProductCategoryPairs()
      .then((pairs) => {
        if (!cancelled) setCategoryPairs(pairs);
      })
      .finally(() => {
        if (!cancelled) setCategoryPairsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogScopeKey = formData.serviceScope.join('\u0001');
  const catalogStockOnly = isUrgentWorkPeriod(formData.workPeriod);
  useEffect(() => {
    void fetchProductCatalog({
      source: 'shopify',
      priority_level1: formData.serviceScope,
      stock_only: catalogStockOnly || undefined,
      page: 1,
      page_size: 20,
    }).catch(() => {});
    // catalogScopeKey already captures serviceScope contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogScopeKey, catalogStockOnly]);

  useEffect(() => {
    if (!categoryPairs.length) return;
    setItems((prev) =>
      prev.map((item) => enrichQuotationItemRegistry(item, categoryPairs)),
    );
  }, [categoryPairs]);

  /** Insert a blank product field at `at` (default: start of list). */
  const addItem = (at = 0) => {
    itemsUserEditedRef.current = true;
    setItems((prev) => insertItemsAt(prev, [createBlankProductItem()], at));
  };

  /** Insert a blank section title at `at` (default: start of list). */
  const addSectionTitle = (at = 0) => {
    itemsUserEditedRef.current = true;
    setItems((prev) => insertItemsAt(prev, [createBlankSectionTitle()], at));
  };

  /** Insert a value-added service row at `at` (default: start of list). */
  const addCustomTerm = (at = 0) => {
    itemsUserEditedRef.current = true;
    const defaultName = quoteLocale === "en" ? t.defaultValueServiceName : "";
    setItems((prev) =>
      insertItemsAt(prev, [createBlankCustomTerm(defaultName)], at),
    );
  };

  /** Open product picker; selected products insert at `at` (default: start of list). */
  const openProductSelector = (at = 0) => {
    productInsertAtRef.current = at;
    setActiveItemId(null);
    setShowProductSelector(true);
  };

  /** Copy full lines from another quote version — always insert at the front. */
  const insertCopiedItemsAtFront = (sourceItems: BwfQuoteItemInput[]) => {
    if (sourceItems.length === 0) return;
    itemsUserEditedRef.current = true;
    void (async () => {
      const linked = await hydrateQuoteItemProductLinks(
        sourceItems.map(normalizeLegacyQuoteItemProductId),
      );
      const rows = linked.map((item, index) =>
        enrichQuotationItemRegistry(
          mapInputToQuotationItem({
            ...item,
            id: `${generateId()}-${index}`,
          }),
          categoryPairs,
        ),
      );
      setItems((prev) => insertItemsAt(prev, rows, 0));
      toast.success(`${t.copyFromOtherQuoteSuccess}（${rows.length}）`);
    })();
  };

  const [cutItemId, setCutItemId] = useState<string | null>(null);

  // Drop cut state if the target row was removed by other means.
  useEffect(() => {
    if (cutItemId && !items.some((item) => item.id === cutItemId)) {
      setCutItemId(null);
    }
  }, [cutItemId, items]);

  const removeItem = (id: string) => {
    itemsUserEditedRef.current = true;
    if (cutItemId === id) setCutItemId(null);
    setItems((prev) => prev.filter((item) => item.id !== id));
    setZoneImages((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  /** Toggle cut state on a row (dimmed like dragging); paste moves it between rows. */
  const cutItem = useCallback((id: string) => {
    setCutItemId((prev) => (prev === id ? null : id));
  }, []);

  const pasteCutItemAt = useCallback(
    (at: number) => {
      if (!cutItemId) return;
      itemsUserEditedRef.current = true;
      setItems((prev) => {
        const fromIndex = prev.findIndex((i) => i.id === cutItemId);
        if (fromIndex === -1) return prev;
        let toIndex = Math.max(0, Math.min(at, prev.length));
        if (fromIndex < toIndex) toIndex -= 1;
        if (fromIndex === toIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
      setCutItemId(null);
    },
    [cutItemId],
  );

  /** Clone a row (product / value-added / section title) and insert it immediately after the source. */
  const duplicateItem = (id: string) => {
    itemsUserEditedRef.current = true;
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;
      const source = prev[index];
      const cloneId = generateId();
      const clone: QuotationItem = {
        ...source,
        id: cloneId,
      };
      if (source.isSectionTitle) {
        setZoneImages((prev) => {
          const urls = prev[source.id];
          if (!urls?.length) return prev;
          return { ...prev, [cloneId]: [...urls] };
        });
      }
      return [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)];
    });
  };

  const updateItem = (
    id: string,
    field: keyof QuotationItem,
    value: string | number | null | boolean,
  ) => {
    itemsUserEditedRef.current = true;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, [field]: value };
        if (field === "costPrice" || field === "exchangeRate") {
          // 保留手動輸入的 HKD 成本：只有「¥成本 × 匯率」算得出來時才覆寫。
          next.hkdCostPrice =
            computeHkdCostPrice(
              field === "costPrice" ? (value as number | null) : next.costPrice,
              field === "exchangeRate"
                ? (value as number | null)
                : next.exchangeRate,
            ) ?? next.hkdCostPrice;
        }
        return next;
      }),
    );
  };

  const updateDimensionMode = (id: string, mode: QuotationDimensionMode) => {
    itemsUserEditedRef.current = true;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, dimensionMode: mode };
      }),
    );
  };

  const onRegistryLevel1Change = useCallback(
    (id: string, level1: string) => {
      itemsUserEditedRef.current = true;
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const l2Options = uniqueLevel2InOrder(categoryPairs, level1);
          const l2 =
            item.registryLevel2 && l2Options.includes(item.registryLevel2)
              ? item.registryLevel2
              : "";
          const productCategoryId = resolveProductCategoryId(
            categoryPairs,
            level1,
            l2,
          );
          return {
            ...item,
            registryLevel1: level1,
            registryLevel2: l2,
            category: l2 || level1,
            productCategoryId,
          };
        }),
      );
    },
    [categoryPairs],
  );

  const onRegistryLevel2Change = useCallback(
    (id: string, level2: string) => {
      itemsUserEditedRef.current = true;
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const l1 = item.registryLevel1?.trim() || "";
          const productCategoryId = resolveProductCategoryId(
            categoryPairs,
            l1,
            level2,
          );
          return {
            ...item,
            registryLevel2: level2,
            category: level2 || l1,
            productCategoryId,
          };
        }),
      );
    },
    [categoryPairs],
  );

  const updateExchangeRate = (id: string, raw: string) => {
    itemsUserEditedRef.current = true;
    const sanitized = sanitizeExchangeRateInput(raw);
    const rate = parseExchangeRateValue(sanitized);
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          exchangeRateInput: sanitized,
          exchangeRate: rate,
          // 沒有 ¥ 成本的行（例如清拆舊扶手）保留原本手動輸入的 HKD 成本。
          hkdCostPrice: computeHkdCostPrice(item.costPrice, rate) ?? item.hkdCostPrice,
        };
      }),
    );
  };

  /** Apply a typed 匯率 onto every product row on the page. */
  const applyUnifiedExchangeRate = useCallback((raw: string) => {
    const sanitized = sanitizeExchangeRateInput(raw);
    const rate = parseExchangeRateValue(sanitized);
    if (!sanitized.trim() || rate == null || !Number.isFinite(rate) || rate <= 0) {
      toast.error("請輸入有效匯率");
      return false;
    }
    itemsUserEditedRef.current = true;
    setItems((prev) =>
      prev.map((item) => {
        if (item.isSectionTitle || item.isCustomTerm) return item;
        return {
          ...item,
          exchangeRateInput: sanitized,
          exchangeRate: rate,
          // 沒有 ¥ 成本的行保留原本手動輸入的 HKD 成本，避免統一匯率把它清空。
          hkdCostPrice: computeHkdCostPrice(item.costPrice, rate) ?? item.hkdCostPrice,
        };
      }),
    );
    toast.success("已統一所有產品匯率", { description: String(rate) });
    return true;
  }, []);

  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);
  /** Refs so drop always sees the latest values (state can be stale in the handler). */
  const draggingItemIdRef = useRef<string | null>(null);
  const dropInsertIndexRef = useRef<number | null>(null);
  /** Editor root — used to resolve which ancestor actually scrolls during DnD. */
  const editorScrollRootRef = useRef<HTMLDivElement | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);

  const trackQuoteDragPointer = useCallback((clientY: number) => {
    dragPointerYRef.current = clientY;
  }, []);

  const setQuoteDraggingItemId = useCallback((id: string | null) => {
    draggingItemIdRef.current = id;
    setDraggingItemId(id);
  }, []);

  const setQuoteDropInsertIndex = useCallback((index: number | null) => {
    dropInsertIndexRef.current = index;
    setDropInsertIndex(index);
  }, []);

  const moveItem = useCallback((fromId: string, insertIndex: number) => {
    itemsUserEditedRef.current = true;
    setItems((prev) => {
      const fromIndex = prev.findIndex((i) => i.id === fromId);
      if (fromIndex === -1) return prev;
      let toIndex = Math.max(0, Math.min(insertIndex, prev.length));
      if (fromIndex < toIndex) toIndex -= 1;
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const nudgeItem = useCallback((id: string, dir: -1 | 1) => {
    const fromIndex = items.findIndex((row) => row.id === id);
    if (fromIndex < 0 || fromIndex + dir < 0 || fromIndex + dir >= items.length) return;
    moveItem(id, dir < 0 ? fromIndex - 1 : fromIndex + 2);
  }, [items, moveItem]);

  const isQuoteRowDragActive = useCallback(() => {
    if (isForeignQuoteDnDKind("quote-row")) return false;
    return (
      draggingItemIdRef.current != null ||
      getActiveQuoteDnDKind() === "quote-row"
    );
  }, []);

  const handleQuoteRowDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      if (!isQuoteRowDragActive()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      trackQuoteDragPointer(e.clientY);
      const rect = e.currentTarget.getBoundingClientRect();
      setQuoteDropInsertIndex(
        e.clientY < rect.top + rect.height / 2 ? index : index + 1,
      );
    },
    [isQuoteRowDragActive, setQuoteDropInsertIndex, trackQuoteDragPointer],
  );

  const handleQuoteRowDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (isForeignQuoteDnDKind("quote-row")) return;
      const fromId =
        draggingItemIdRef.current ||
        readQuoteDnDId(e.dataTransfer, "quote-row");
      if (!fromId) return;
      e.preventDefault();
      const insertAt = dropInsertIndexRef.current;
      if (insertAt !== null) {
        moveItem(fromId, insertAt);
      }
      endQuoteDnDDrag();
      draggingItemIdRef.current = null;
      dropInsertIndexRef.current = null;
      setDraggingItemId(null);
      setDropInsertIndex(null);
    },
    [moveItem],
  );

  const clearQuoteRowDrag = useCallback(() => {
    endQuoteDnDDrag();
    draggingItemIdRef.current = null;
    dropInsertIndexRef.current = null;
    setDraggingItemId(null);
    setDropInsertIndex(null);
  }, []);

  // While reordering rows, auto-scroll the nearest scroll parent when the
  // pointer enters a wide top/bottom edge band (browser default bands are too thin).
  useEffect(() => {
    if (!draggingItemId) {
      dragPointerYRef.current = null;
      if (autoScrollRafRef.current != null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      return;
    }

    const onDragOver = (e: DragEvent) => {
      trackQuoteDragPointer(e.clientY);
    };
    document.addEventListener("dragover", onDragOver);

    const tick = () => {
      const clientY = dragPointerYRef.current;
      const root = editorScrollRootRef.current;
      if (clientY != null && root) {
        const scroller = findVerticalScrollParent(root);
        if (scroller) {
          const rect = scroller.getBoundingClientRect();
          const edge = QUOTE_DND_AUTO_SCROLL_EDGE_PX;
          const maxStep = QUOTE_DND_AUTO_SCROLL_MAX_STEP_PX;
          let delta = 0;
          if (clientY < rect.top + edge) {
            const intensity = Math.min(1, (rect.top + edge - clientY) / edge);
            delta = -Math.ceil(maxStep * intensity);
          } else if (clientY > rect.bottom - edge) {
            const intensity = Math.min(1, (clientY - (rect.bottom - edge)) / edge);
            delta = Math.ceil(maxStep * intensity);
          }
          if (delta !== 0) {
            scroller.scrollTop += delta;
          }
        }
      }
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener("dragover", onDragOver);
      if (autoScrollRafRef.current != null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      dragPointerYRef.current = null;
    };
  }, [draggingItemId, trackQuoteDragPointer]);

  // Unit price multiplier (cost-based) — persisted in project_data after 版本審核.
  const savedPriceMultiplier = (() => {
    if (copyPayload?.priceMultiplier != null && copyPayload.priceMultiplier !== "") {
      return String(copyPayload.priceMultiplier);
    }
    const raw = (savedProjectData as Record<string, unknown>).priceMultiplier;
    if (raw == null || raw === "") return "1";
    return String(raw);
  })();
  const [priceMultiplier, setPriceMultiplier] = useState<string>(savedPriceMultiplier);

  // Re-hydrate multiplier when parent reloads project_data after 版本審核.
  useEffect(() => {
    if (!existingQuote?.quoteId) return;
    const raw = (existingQuote.projectData as Record<string, unknown> | undefined)
      ?.priceMultiplier;
    if (raw == null || raw === "") return;
    setPriceMultiplier(String(raw));
  }, [existingQuote?.quoteId, existingQuote?.projectData]);

  const applyPriceMultiplier = () => {
    const mult = parseFloat(priceMultiplier);
    if (isNaN(mult) || mult < 0) {
      toast.error("請輸入有效的倍率數字");
      return;
    }
    itemsUserEditedRef.current = true;
    setItems((prev) =>
      prev.map((item) => {
        if (item.isSectionTitle || item.isCustomTerm) return item;
        const base =
          item.hkdCostPrice != null && item.hkdCostPrice > 0
            ? Math.ceil(item.hkdCostPrice)
            : item.costPrice;
        if (base != null && base > 0) {
          return { ...item, unitPrice: Math.round(base * mult) };
        }
        return item;
      }),
    );
    toast.success(`已按成本倍率 ×${mult} 更新單價`);
  };

  const subtotal = quoteBillableSubtotal(items);
  const discountValue = (() => {
    const n = parseFloat(discountNote);
    return isNaN(n) ? 0 : n;
  })();
  const isFreeInstallation = subtotal >= 12000;
  const installationAmount = isFreeInstallation ? 0 : (installationFee.amount ?? 0);
  /** Live editor total — persisted only as `bwf_quote.total_amount` (not in project_data). */
  const totalAmount = Math.max(0, subtotal - discountValue + installationAmount);
  // Exclude 可選產品 from GP Cost (same rule as 合計 / quoteBillableSubtotal).
  const totalProductCost = quoteBillableProductCost(items);
  const gpValue = totalAmount - totalProductCost - gpSummary.ship - gpSummary.installation;
  const gpPercent = totalAmount > 0 ? (gpValue / totalAmount) * 100 : 0;
  const totalCostPrice = totalProductCost;
  /**
   * 手動輸入的 HKD 成本與「¥成本 × 匯率」不一致的行。只提示、不自動覆寫
   * （部分報價刻意用廠家的實際 HKD 成本），由使用者決定是否按匯率重算。
   */
  const costMismatches = findQuoteCostMismatches(items);
  const costMismatchIds = new Set(costMismatches.map((row) => row.id));
  const costMismatchSummary = costMismatches
    .slice(0, 3)
    .map(
      (row) =>
        `${row.label}（HK$${Math.round(row.hkdCostPrice)}／應為 HK$${Math.ceil(row.derivedHkdCost)}）`,
    )
    .join('、');
  const realignMismatchedCosts = () => {
    if (costMismatches.length === 0) return;
    itemsUserEditedRef.current = true;
    const ids = new Set(costMismatches.map((row) => row.id));
    setItems((prev) =>
      prev.map((item) => {
        if (!ids.has(item.id)) return item;
        const derived = quoteDerivedHkdCost(item.costPrice, item.exchangeRate);
        return derived == null ? item : { ...item, hkdCostPrice: derived };
      }),
    );
    toast.success(`已按匯率重算 ${costMismatches.length} 行成本`);
  };
  /**
   * Per-line cost rows for the Cost metric hover card. Mirrors quoteItemLineCost
   * (ceil unit cost × qty; optional / section-title lines contribute 0) so the
   * rows always add up to totalProductCost.
   */
  const costBreakdown = items
    .map((item, index) => {
      const billable = !item.isOptional && !item.isSectionTitle;
      const unitCost = billable && item.hkdCostPrice != null ? Math.ceil(item.hkdCostPrice) : 0;
      const quantity = billable ? (item.quantity ?? 0) : 0;
      return {
        key: `${item.id ?? 'cost-line'}-${index}`,
        name: item.name?.trim() || ui('未命名項目', 'Untitled item'),
        unitCost,
        quantity,
        lineCost: unitCost * quantity,
        mismatch: costMismatchIds.has(item.id),
      };
    })
    .filter((line) => line.lineCost !== 0);
  const costBreakdownUnpricedCount = items.filter(
    (item) =>
      !item.isOptional &&
      !item.isSectionTitle &&
      (item.quantity ?? 0) > 0 &&
      (item.hkdCostPrice == null || Math.ceil(item.hkdCostPrice) <= 0),
  ).length;
  /** Existing quotes load line items from bwf_quote_item — say so instead of showing an empty $0 quote. */
  const quoteContentLoading = Boolean(existingQuote?.quoteUuid) && !itemsLoadedFromDb && !itemsLoadFailed && items.length === 0;

  // Version & submission modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastLocalSavedAt, setLastLocalSavedAt] = useState<number | null>(null);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);

  const handleOpenSubmitReview = () => {
    if (existingQuote?.quoteUuid && !itemsLoadedFromDb) {
      if (itemsLoadFailed) {
        toast.error(quoteLocale === "en" ? "Quotation items could not load" : "報價明細未能載入", {
          description: quoteLocale === "en"
            ? "Sending is paused so no items are lost. Reload the items below, then try again."
            : "為免漏掉項目，已暫停送出。請先在下方按「重新載入明細」，再試一次。",
        });
        return;
      }
      pendingQuoteActionRef.current = "submit";
      toast.message(quoteLocale === "en" ? "Waiting for quotation items to load" : "正在等報價內容載入完成", {
        description: quoteLocale === "en"
          ? "The review window opens automatically once loading finishes."
          : "載入完成後會自動打開版本審核，不用再按一次。",
      });
      return;
    }
    const missing = [
      !quoteMeta.pmName.trim() && '項目經理姓名',
      !clientInfo.name.trim() && '公司名稱',
      !clientInfo.phone.trim() && '客戶電話',
      formData.clientIndustry.length === 0 && '客戶產業',
      !/^\d+$/.test(quoteMeta.validity.trim()) && '有效期限（天）',
      clientInfo.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientInfo.email) && '有效的客戶電郵',
    ].filter(Boolean);
    if (missing.length) {
      setCollapseCompany(false);
      setCollapseClient(false);
      setCollapseProject(false);
      setCollapseQuoteMeta(false);
      toast.error('請補齊基本資料', { description: missing.join('、') });
      document.getElementById('quote-sec-basic')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const contentItems = items.filter(hasQuoteItemContent);
    if (contentItems.length === 0) {
      toast.error("無法提交審核", {
        description:
          "還沒有報價內容，總金額可能是 HK$0。如果剛才頁面出過問題，請先按「保存現有版本」，或重新整理取回剛才的內容。",
      });
      return;
    }
    if (totalAmount <= 0) {
      toast.error("無法提交審核", {
        description:
          "總金額是 HK$0。請檢查單價和數量後再送出。如果內容不見了，請重新整理取回剛才的內容。",
      });
      return;
    }
    const fromUrl =
      typeof window !== 'undefined'
        ? (() => {
            const parsed = parseQuotePathname(window.location.pathname);
            return parsed.kind === 'quote' ? parsed.quoteId : '';
          })()
        : '';
    const chainId = pickQuoteChainId(
      submitChainIdRef.current,
      quoteId,
      existingQuote?.quoteId,
      formData.quoteId,
      formData.pitchingCode,
      formData.projectName,
      draftQuoteId,
      fromUrl,
    );
    if (!chainId) {
      toast.error("缺少報價單號", {
        description:
          "找不到這張報價的單號。請返回重新選擇提案，或重新整理後再送出審核。",
      });
      return;
    }
    submitChainIdRef.current = chainId;
    setShowSubmitModal(true);
  };
  const currentVersion = useMemo(() => {
    const base =
      existingQuote?.maxVersionInChain || existingQuote?.version || null;
    return bumpQuoteVersion(base);
  }, [existingQuote?.maxVersionInChain, existingQuote?.version]);

  // Product selector modal state
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [showCopyFromOther, setShowCopyFromOther] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [quoteProductModal, setQuoteProductModal] = useState<{
    itemId: string;
    product: ProductForDetail;
    mode: "edit" | "create";
  } | null>(null);
  const [quoteProductModalBusy, setQuoteProductModalBusy] = useState(false);
  /** Index where products from the selector should be inserted (0 = start). */
  const productInsertAtRef = useRef(0);

  const openQuoteItemProductLink = useCallback(async (item: QuotationItem) => {
    if (quoteProductModalBusy) return;
    setQuoteProductModalBusy(true);
    try {
      const linkedId = item.productId?.trim();
      if (linkedId) {
        const product = await fetchProductForQuoteDetail(linkedId);
        if (!product) {
          toast.error("找不到關聯產品", {
            description: "這件產品可能已從目錄刪除，可以重新建立並連回去。",
          });
          return;
        }
        setQuoteProductModal({ itemId: item.id, product, mode: "edit" });
        return;
      }
      const factoriesWithIds = await fetchFactoriesWithIds();
      const product = buildDraftProductFromQuoteItem(item, { factoriesWithIds });
      setQuoteProductModal({ itemId: item.id, product, mode: "create" });
    } finally {
      setQuoteProductModalBusy(false);
    }
  }, [quoteProductModalBusy]);

  // Draft state — baseline snapshot detects unsaved edits vs loaded content.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const draftHydratedRef = useRef<string | null>(null);
  /** Baseline draft object (not just its string) so 明細載入後可以只換掉 items 部分。 */
  const baselineDraftRef = useRef<DraftData | null>(null);
  const baselineSnapshotRef = useRef<string | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  /** 換掉 baseline 的 items 後強制重算 isDirty（ref 變更不會觸發 render）。 */
  const [, refreshBaseline] = useReducer((revision: number) => revision + 1, 0);

  const rawQuoteId = existingQuote?.quoteId || draftQuoteId || "NEW";
  const storageKey = makeDraftKey(userEmail, rawQuoteId);
  const quoteImageScope = existingQuote?.quoteId || rawQuoteId;

  const zoneOptions = useMemo(
    () =>
      items
        .filter((item) => item.isSectionTitle)
        .map((item) => {
          const index = items.findIndex((row) => row.id === item.id);
          const name = item.name.trim() || (quoteLocale === "en" ? "Untitled zone" : "未命名分區");
          return {
            id: item.id,
            label: formatSectionTitleLabel(sectionTitleOrdinalAt(items, index), name),
          };
        }),
    [items, quoteLocale],
  );
  const zonePhotoSources = useMemo(() => {
    const map = new Map<string, { title: string; previewUrl: string }>();
    for (const photo of quoteProductPhotos) {
      if (photo.url) map.set(photo.id, { title: photo.title, previewUrl: photo.url });
    }
    for (const asset of quotePhotoAssets) {
      const url = quotePhotoRefUrl(asset);
      if (url) map.set(asset.id, { title: asset.title, previewUrl: url });
    }
    for (const asset of photoLibrary) {
      map.set(asset.id, { title: asset.title, previewUrl: asset.url });
    }
    return map;
  }, [photoLibrary, quotePhotoAssets, quoteProductPhotos]);

  const assignItemToZone = (itemId: string, value: string) => {
    itemsUserEditedRef.current = true;
    if (value === "__new__") {
      setItems((prev) => {
        const index = prev.findIndex((item) => item.id === itemId);
        if (index < 0 || prev[index]?.isSectionTitle) return prev;
        const row = prev[index];
        const without = prev.filter((_, i) => i !== index);
        return [...without, createBlankSectionTitle(), row];
      });
      return;
    }
    setItems((prev) => moveItemIntoZone(prev, itemId, value === "__none__" ? null : value));
  };

  const appendZoneImage = (zoneId: string, url: string) => {
    if (!isHttpImageUrl(url)) return;
    itemsUserEditedRef.current = true;
    setZoneImages((prev) => {
      const current = prev[zoneId] || [];
      if (current.includes(url)) return prev;
      if (current.length >= MAX_ZONE_IMAGES) {
        toast.error(quoteLocale === "en"
          ? `Each zone can hold ${MAX_ZONE_IMAGES} images`
          : `每個分區最多 ${MAX_ZONE_IMAGES} 張圖片`);
        return prev;
      }
      return { ...prev, [zoneId]: [...current, url] };
    });
  };

  const removeZoneImage = (zoneId: string, url: string) => {
    itemsUserEditedRef.current = true;
    setZoneImages((prev) => {
      const nextUrls = (prev[zoneId] || []).filter((entry) => entry !== url);
      const next = { ...prev };
      if (nextUrls.length) next[zoneId] = nextUrls;
      else delete next[zoneId];
      return next;
    });
  };

  const openZoneImageUpload = (zoneId: string | null, groupId?: string) => {
    const id = zoneId || UNZONED_QUOTE_IMAGE_KEY;
    const groups = zonePhotoLayouts[id] ?? [];
    setZoneLayoutEditor({ zoneId: id, groupId: groupId ?? groups[0]?.id ?? null });
    void listQuotePhotoAssets().then((result) => {
      if (result.error || result.missingTable) return;
      setPhotoLibrary((current) => {
        const known = new Set(current.map((asset) => asset.id));
        const extra = result.assets.filter((asset) => !known.has(asset.id));
        return extra.length === 0 ? current : [...current, ...extra];
      });
    });
  };

  const removeZoneLayout = (zoneId: string, groupId: string) => {
    setZonePhotoLayouts((prev) => {
      const nextGroups = (prev[zoneId] || []).filter((group) => group.id !== groupId);
      const next = { ...prev };
      if (nextGroups.length) next[zoneId] = nextGroups;
      else delete next[zoneId];
      return next;
    });
  };

  const setProductPlacement = (zoneId: string, itemId: string, index: number, positionId: string) => {
    const zone = layoutZones(itemsRef.current).find(z => z.id === zoneId);
    if (!zone || index < 0 || index >= (zone.products.find(p => p.id === itemId)?.quantity || 0)) return;
    setFloorPlan(current => current ? { ...current, placements: assignFurniturePosition(current.placements || { positions: {}, assignments: {} }, zoneId, zone.products.map(p => p.id), itemId, index, positionId), rendering: current.rendering ? { ...current.rendering, images: {} } : undefined } : current);
  };

  /**
   * 從其他頁面點「查看並匯入」回來的交接：用戶離開報價單頁時編輯器已卸載，
   * 那張生成圖先存在 store，等這張報價單的內容載入完成才開預覽，
   * 否則分區 id／平面圖還是空的，預覽與「確認匯入」的比對會對不上。
   */
  const pendingZoneRenderVersion = useSyncExternalStore(
    subscribeZoneRenderPreviews,
    zoneRenderPreviewVersion,
    zoneRenderPreviewVersion,
  );
  useEffect(() => {
    if (!draftLoaded) return;
    const targetQuoteId = (existingQuote?.quoteId || quoteId || '').trim();
    if (!targetQuoteId) return;
    // 報價內容仍在載入：等載入完再開，避免拿舊資料開預覽。
    if (existingQuote?.quoteUuid && !itemsLoadedFromDb && !itemsLoadFailed) return;
    const pending = takeZoneRenderPreview(targetQuoteId);
    if (!pending) return;
    // 項目 id 正常會保留（client_item_id），萬一重新載入後換了 id，用分區名稱後備比對。
    const zones = layoutZones(items);
    const zone =
      zones.find((entry) => entry.id === pending.zoneId) ??
      zones.find((entry) => entry.name.trim() === pending.zoneName.trim());
    if (!zone) {
      toast.info(`${pending.zoneName}分區已不存在，渲染圖已保留在圖片庫`, {
        description: '可到「報價單圖片」把這張圖重新加入報價。',
      });
      return;
    }
    setZoneRenderPreview({ ...pending, zoneId: zone.id });
    setZoneRenderVisible(true);
  }, [
    pendingZoneRenderVersion,
    draftLoaded,
    itemsLoadedFromDb,
    itemsLoadFailed,
    items,
    quoteId,
    existingQuote?.quoteId,
    existingQuote?.quoteUuid,
  ]);

  /**
   * toast 的「查看並匯入」：
   * - 仍在同一張報價單：直接開預覽（原行為）。
   * - 已切去其他頁面：把這張圖交接到該報價單，跳回報價單詳情，載入完成後自動開預覽。
   */
  const openZoneRenderPreviewFromToast = async (payload: ZoneRenderPreviewPayload) => {
    const dismissToast = () => toast.dismiss(`zone-render-${payload.zoneId}`);
    const targetQuoteId = (persistedQuoteIdRef.current || '').trim();
    const parsedPath = typeof window !== 'undefined' ? parseQuotePathname(window.location.pathname) : null;
    const onThisQuote = parsedPath?.kind === 'quote' && parsedPath.quoteId === targetQuoteId;
    if (mountedRef.current && (onThisQuote || !targetQuoteId || targetQuoteId === 'NEW')) {
      dismissToast();
      setZoneRenderPreview(payload);
      setZoneRenderVisible(true);
      return;
    }
    if (!targetQuoteId || targetQuoteId === 'NEW') {
      // 未成立的報價單沒有詳情可跳，圖仍留在圖片庫。
      dismissToast();
      toast.info('請先回到這張報價單，再查看生成的渲染圖', {
        description: '渲染圖已保存，可在「報價單圖片」找到。',
      });
      return;
    }
    if (!onThisQuote) {
      // 可能在另一張報價單上編輯中：照樣先問清楚，避免丟失未保存變更。
      if (!(await unsavedGuard.confirmLeave())) return;
      rememberZoneRenderPreview(targetQuoteId, payload);
      // 交由 AppShell 用 openQuoteForEdit 開啟，uuid／版本才會跟這張報價單一致。
      requestQuoteOpen(targetQuoteId);
    } else {
      rememberZoneRenderPreview(targetQuoteId, payload);
    }
    dismissToast();
  };

  /** 生成中的 toast：就在右上角顯示，附實時進度條，不再彈窗擋住編輯。 */
  const showZoneRenderToast = (zoneId: string, zoneName: string) =>
    toast.loading(`${zoneName}渲染圖生成中`, {
      id: `zone-render-${zoneId}`,
      duration: Infinity,
      // toast 內容區預設不會收窄，讓內容區可縮、進度條用 100% 才不會壓到其他元素。
      classNames: { content: 'min-w-0 flex-1', title: 'min-w-0', description: 'w-full min-w-0' },
      // 進度只建立一次 toast，之後由 store 推更新；重建會令已關掉的 toast 再彈出來。
      description: <ZoneRenderProgressToastBody store={zoneRenderStore} zoneId={zoneId} />,
    });

  /**
   * 自動修正會一直重新生成，直到 AI 對照沒有明顯差異為止；同時設兩道安全閥：
   * 最多再生成 ZONE_RENDER_AUTO_FIX_ROUNDS 次，以及連續兩回合差異數沒有減少就當作 AI 改不到、
   * 立即停止交人處理，避免無限重試白白消耗生圖成本。
   */
  const ZONE_RENDER_AUTO_FIX_ROUNDS = 5;

  /**
   * 生成＋自動修正：AI 對照發現明顯差異（數量、位置、朝向、門洞、款式）時，
   * 直接把差異當意見，沿用同一個區域再生成並重新對照，直到對照沒有 issues 為止。
   * 小問題與待確認不重生成。全過程只更新進度，不彈窗；完成的成品才交人確認。
   */
  const generateZoneRenderWithAutoFix = async (
    plan: QuoteFloorPlan,
    zone: LayoutZone,
    reportProgress: (progress: LayoutRenderProgress) => void,
    start: LayoutRenderRevision = {},
    onAutoFixRound?: (round: number) => void,
  ) => {
    // 每次生成都各自由 0% 跑到 100%，換算成整條流程的分段，進度條才不會倒退。
    const spans = [[0, 34], [34, 52], [52, 68], [68, 80], [80, 90], [90, 100]] as const;
    let round = 0;
    const report = (progress: LayoutRenderProgress) => {
      const [from, to] = spans[Math.min(round, spans.length - 1)];
      reportProgress({ percent: from + (progress.percent / 100) * (to - from), label: progress.label });
    };
    const initial: LayoutRenderRevision | undefined = start.previousImageUrl || start.areaIndex !== undefined
      ? { previousImageUrl: start.previousImageUrl, feedback: start.feedback, areaIndex: start.areaIndex }
      : undefined;
    let result = await generateZoneLayoutImage(plan, zone, existingQuote?.quoteUuid ?? null, report, initial);
    const firstUrl = result.asset.url;
    let autoFixes = 0;
    let stalled = 0;
    let lastCount = Number.POSITIVE_INFINITY;
    for (;;) {
      const issues = result.review?.issues ?? [];
      if (!issues.length) break; // 對照通過
      if (autoFixes >= ZONE_RENDER_AUTO_FIX_ROUNDS) break;
      // 差異數沒有減少＝AI 改不到，連續兩回合就停，不再燒成本。
      stalled = issues.length >= lastCount ? stalled + 1 : 0;
      if (stalled >= 2) break;
      lastCount = issues.length;
      autoFixes += 1;
      round = Math.min(autoFixes, spans.length - 1);
      const feedback = `按對照結果修正，其餘已符合的部分保持不變：${issues.map((issue, index) => `${index + 1}) ${issue}`).join('；')}`.slice(0, 300);
      onAutoFixRound?.(autoFixes);
      report({ percent: 3, label: `對照發現 ${issues.length} 項差異，正在自動修正（第 ${autoFixes} 次）` });
      result = await generateZoneLayoutImage(plan, zone, existingQuote?.quoteUuid ?? null, report, { previousImageUrl: result.asset.url, feedback, areaIndex: result.area.index - 1, autoFix: true });
    }
    reportProgress({ percent: 100, label: '完成' });
    return { ...result, autoFixes, firstUrl };
  };

  const generateZoneRender = async (zoneId: string) => {
    if (zoneRenderBusyRef.current.has(zoneId)) return;
    const plan = floorPlanRef.current;
    const zone = layoutZones(itemsRef.current).find(z => z.id === zoneId);
    if (!plan || !zone) { toast.error('請先上傳平面圖並確認分區'); return; }
    zoneRenderBusyRef.current.add(zoneId);
    setRenderingZoneIds(prev => new Set(prev).add(zoneId));
    setZoneRenderFeedback('');
    const snapshot = JSON.stringify({ plan, zone });
    // 預設走背景：右上角 toast 與分區按鈕讀同一個進度 store，完成後才由 toast 的「查看預覽」開彈窗。
    showZoneRenderToast(zoneId, zone.name);
    const reportProgress = (progress: LayoutRenderProgress) => {
      // 唯一寫入點：toast、分區按鈕、預覽對話框訂閱的是同一份資料，數字不會各自跑。
      zoneRenderStore.set(zoneId, progress);
    };
    try {
      const { asset, zoneImage, review, area, autoFixes, firstUrl } = await generateZoneRenderWithAutoFix(plan, zone, reportProgress);
      setPhotoLibrary(prev => [...prev.filter(p => p.id !== asset.id), asset]);
      toast.success(`${zone.name}渲染圖已生成`, {
        id: `zone-render-${zoneId}`,
        duration: Infinity,
        description: `${autoFixes ? `AI 對照後已自動修正 ${autoFixes} 次；` : ''}${area.total > 1 ? `此分區有多個區域，本次生成第 ${area.index}／${area.total} 個；` : ''}點擊「查看並匯入」預覽生成圖，確認後才加入報價。`,
        action: {
          label: '查看並匯入',
          onClick: () => {
            void openZoneRenderPreviewFromToast({
              zoneId, zoneName: zone.name, snapshot, asset, zoneImage, review, area, autoFixes,
              ...(autoFixes ? { previous: { url: firstUrl, feedback: `AI 對照發現差異，已自動修正 ${autoFixes} 次` } } : {}),
            });
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error && !error.message.startsWith('quote_photo_') ? error.message : quotePhotoErrorText(error);
      // 失敗時沿用同一個 toast id 換成錯誤，並清掉 action：不再顯示「查看進度」。
      toast.error(`${zone.name}渲染圖生成失敗`, { id: `zone-render-${zoneId}`, description: message, duration: 12000, action: undefined });
    } finally {
      zoneRenderBusyRef.current.delete(zoneId);
      zoneRenderStore.clear(zoneId);
      setRenderingZoneIds(prev => { const next = new Set(prev); next.delete(zoneId); return next; });
    }
  };

  /**
   * 預覽對話框內的「重新生成」：把目前這張圖當第三張參考圖、連同用戶意見再生成一次；
   * 若 AI 對照又發現明顯差異，會自動再修（不彈窗），結果原地取代預覽。
   * 上一張保留在對話框內對比，舊圖仍留在圖片庫。
   *
   * 這是背景任務，生成期間對話框可以被關掉：一開始就掛右上角進度 toast（與分區按鈕同一個 store），
   * 完成時若對話框已經不在，就把結果留在同一個 toast，附「查看並匯入」把預覽叫回來，
   * 不會再出現「關掉對話框後完全不知道生成到哪／生成了甚麼」。
   */
  const regenerateZoneRender = async () => {
    const preview = zoneRenderPreview;
    if (!preview?.asset || zoneRenderBusyRef.current.has(preview.zoneId)) return;
    const plan = floorPlanRef.current;
    const zone = layoutZones(itemsRef.current).find(item => item.id === preview.zoneId);
    if (!plan || !zone) { toast.error('請先上傳平面圖並確認分區'); return; }
    const previousImageUrl = preview.asset.url;
    const feedback = zoneRenderFeedback.trim();
    // 重新生成用的是當前平面圖／分區，成功後要把快照換成這次的依據，否則「確認匯入」會被誤判為已變更。
    const snapshot = JSON.stringify({ plan, zone });
    zoneRenderBusyRef.current.add(preview.zoneId);
    setRenderingZoneIds(prev => new Set(prev).add(preview.zoneId));
    setZoneRenderPreview(current => current ? { ...current, error: undefined } : current);
    // 重新生成也寫同一個 store：對話框與分區按鈕看到的是同一個百分比。
    zoneRenderStore.set(preview.zoneId, { percent: 2, label: '準備重新生成' });
    setZoneRenderAutoFixRound(null);
    // 一開始就建立右上角進度 toast：萬一使用者關掉對話框，仍能看到背景生成進度。
    const toastId = `zone-render-${preview.zoneId}`;
    showZoneRenderToast(preview.zoneId, zone.name);
    try {
      const { asset, zoneImage, review, area, autoFixes } = await generateZoneRenderWithAutoFix(
        plan,
        zone,
        (progress) => zoneRenderStore.set(preview.zoneId, progress),
        { previousImageUrl, feedback, areaIndex: preview.area ? preview.area.index - 1 : undefined },
        round => setZoneRenderAutoFixRound(round),
      );
      setPhotoLibrary(prev => [...prev.filter(item => item.id !== asset.id), asset]);
      // 對話框可能已在生成期間被關掉：這時把結果留在 toast，讓使用者可以重新打開預覽。
      const stillOpen =
        zoneRenderVisibleRef.current && zoneRenderPreviewRef.current?.zoneId === preview.zoneId;
      if (stillOpen) {
        setZoneRenderPreview(current => current && current.zoneId === preview.zoneId
          ? { ...current, asset, zoneImage, review, area, error: undefined, snapshot, previous: { url: previousImageUrl, feedback: feedback || undefined }, autoFixes }
          : current);
        toast.success(autoFixes ? `已重新生成並自動修正 ${autoFixes} 次` : '已按意見重新生成', {
          id: toastId,
          duration: 6000,
          description: review?.issues.length ? `仍有 ${review.issues.length} 項明顯差異，可再按「重新生成」或自行調整意見。` : '已重新對照，未發現明顯差異，可確認匯入。',
        });
      } else {
        toast.success(`${zone.name}渲染圖已重新生成`, {
          id: toastId,
          duration: Infinity,
          description: `${autoFixes ? `AI 對照後已自動修正 ${autoFixes} 次；` : ''}點擊「查看並匯入」預覽新圖，確認後才加入報價。`,
          action: {
            label: '查看並匯入',
            onClick: () => {
              void openZoneRenderPreviewFromToast({
                zoneId: zone.id, zoneName: zone.name, snapshot, asset, zoneImage, review, area, autoFixes,
                previous: { url: previousImageUrl, feedback: feedback || undefined },
              });
            },
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error && !error.message.startsWith('quote_photo_') ? error.message : quotePhotoErrorText(error);
      const stillOpen =
        zoneRenderVisibleRef.current && zoneRenderPreviewRef.current?.zoneId === preview.zoneId;
      if (stillOpen) setZoneRenderPreview(current => current ? { ...current, error: message } : current);
      toast.error(`${zone.name}重新生成失敗`, { id: toastId, duration: 12000, description: message });
    } finally {
      zoneRenderBusyRef.current.delete(preview.zoneId);
      setRenderingZoneIds(prev => { const next = new Set(prev); next.delete(preview.zoneId); return next; });
      zoneRenderStore.clear(preview.zoneId);
      setZoneRenderAutoFixRound(null);
    }
  };


  const zoneRenderPreviewBusy = !!zoneRenderPreview && renderingZoneIds.has(zoneRenderPreview.zoneId);
  /** 對話框進度與分區按鈕同源：重新生成時兩邊顯示同一個百分比，不會一邊 24% 一邊 56%。 */
  const zoneRenderPreviewMeter = useZoneRenderProgress(zoneRenderStore, zoneRenderPreview?.zoneId ?? '');

  /**
   * 自動修正會跑到「對照沒有明顯差異」為止；預覽打開時仍有 issues，
   * 代表安全閥（回合上限／連續無改善）已停手，剩餘差異交人手核對，不再當錯誤擋匯入。
   */
  const zoneRenderReviewStatus = (review?: LayoutReview | null) => {
    if (!review) return null;
    if (review.issues.length) return { label: `${review.issues.length} 項需人手核對`, className: 'border-amber-500/30 bg-amber-500/10 text-amber-700' };
    if (review.minor.length || review.uncertain.length) return { label: '只有小問題，可忽略', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700' };
    return { label: '通過', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' };
  };

  const confirmZoneRender = () => {
    const preview = zoneRenderPreview;
    if (!preview?.asset) return;
    const plan = floorPlanRef.current;
    const zone = layoutZones(itemsRef.current).find(item => item.id === preview.zoneId);
    if (!plan || !zone || JSON.stringify({ plan, zone }) !== preview.snapshot) {
      setZoneRenderPreview({ ...preview, error: '平面圖或分區產品已變更，請重新生成。此圖片已保留在圖片庫。', asset: undefined });
      return;
    }
    const asset = preview.asset;
    const group = newLayoutGroup('L19');
    group.placements = [defaultPlacement(groupGeometry(group).slots[0], asset.id)];
    setQuotePhotoAssets(prev => [...prev.filter(p => p.id !== asset.id), { id: asset.id, title: `${preview.zoneName}渲染圖`, objectPath: asset.objectPath, isGenerated: true }]);
    setZonePhotoLayouts(prev => ({ ...prev, [preview.zoneId]: [...(prev[preview.zoneId] || []), group] }));
    setFloorPlan(current => current ? { ...current, rendering: { ...current.rendering, style: current.rendering?.style || DEFAULT_LAYOUT_STYLE, notes: current.rendering?.notes || {}, images: { ...current.rendering?.images, [preview.zoneId]: asset.url } } } : current);
    itemsUserEditedRef.current = true;
    setZoneRenderPreview(null);
    setZoneRenderVisible(false);
    toast.success('渲染圖已加入此分區產品下方');
  };

  const renderZonePhotoTail = (zoneId: string) => {
    const urls = zoneImages[zoneId] || [];
    const layouts = (zonePhotoLayouts[zoneId] || []).filter((group) => group.placements.length > 0);
    if (!urls.length && !layouts.length) return null;
    return (
      <div className="flex flex-col items-center gap-3">
        {layouts.map((group) => (
          <div key={group.id} className="relative w-full max-w-2xl">
            <div className="block w-full overflow-hidden rounded-md border border-border bg-background text-left">
              <PhotoLayoutBlock
                geometry={groupGeometry(group)}
                placements={group.placements}
                photoFor={(assetId) => zonePhotoSources.get(assetId)}
                renderSlot={(_slot, placement, content) => {
                  const previewUrls = group.placements.map((entry) => zonePhotoSources.get(entry.assetId)?.previewUrl).filter((url): url is string => Boolean(url));
                  const url = placement && zonePhotoSources.get(placement.assetId)?.previewUrl;
                  if (!url) return content;
                  return (
                    <button type="button" className="block h-full w-full cursor-zoom-in" aria-label={quoteLocale === "en" ? "Preview image" : "預覽圖片"}
                      onClick={() => setZoneLightbox({ urls: previewUrls, index: previewUrls.indexOf(url) })}>
                      {content}
                    </button>
                  );
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => openZoneImageUpload(zoneId, group.id)}
              className="absolute right-8 top-2 z-10 text-muted-foreground hover:text-foreground"
              aria-label={quoteLocale === "en" ? "Edit images" : "編輯圖片"}
              title={quoteLocale === "en" ? "Edit images" : "編輯圖片"}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => removeZoneLayout(zoneId, group.id)}
              className="absolute right-2 top-2 z-10 text-destructive hover:text-destructive/80"
              aria-label={t.removeZoneImage}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {urls.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {urls.map((url, imageIndex) => (
              <div key={url} className="relative">
                <button
                  type="button"
                  onClick={() => setZoneLightbox({ urls, index: imageIndex })}
                  className="block overflow-hidden rounded-md border border-border bg-background"
                  aria-label={quoteLocale === "en" ? `Image ${imageIndex + 1}` : `圖片 ${imageIndex + 1}`}
                >
                  <LoadingImage src={url} alt="" className="h-16 w-20" imgClassName="object-contain" />
                </button>
                <button
                  type="button"
                  onClick={() => removeZoneImage(zoneId, url)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive"
                  aria-label={t.removeZoneImage}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const openZoneManager = () => {
    setZoneManagerDraft(zoneRowsFromItems(items, floorPlan?.regions ?? []));
    setActiveZoneId(null);
    setZoneManagerOpen(true);
  };

  const zoneRecognitionActive = floorPlanBusy || recognizingZones;
  /** Rooms the user still has to draw on the plan before they can be cropped. */
  const unboxedZoneCount = zoneManagerDraft.filter((zone) => !zone.rect).length;
  // Synthetic canvas IDs keep each area independently editable while the list keeps one zone,
  // so a space that sits in two places can be copied and dragged like in the presentation manager.
  const canvasZoneRows = zoneCanvasRows(zoneManagerDraft);
  const recognizedFurnitureMarkers = zoneManagerDraft.flatMap((zone, index) =>
    (floorPlan?.placements?.positions[zone.id] || []).map(position => ({
      ...position,
      zoneId: zone.id,
      positionId: position.id,
      id: `${zone.id}:${position.id}`,
      label: `${index + 1}·${position.label}`,
      color: floorPlanZoneColor(index),
      zoneName: zone.name,
      description: `${zone.name} · ${position.label} · ${position.category} · ${position.angle === null ? '方向未知' : `${position.angle}°`}`,
    })),
  );
  const furnitureGroupName = (category: string) => {
    const name = category.trim().toLowerCase().replace(/\s+/g, ' ');
    if (['cabinet', 'storage cabinet', 'storage cupboard', '儲物櫃', '储物柜', '儲物柜'].includes(name)) return '儲物櫃';
    if (['office chair', '辦公椅', '办公椅'].includes(name)) return '辦公椅';
    if (['office desk', '辦公桌', '办公桌', '辦公枱'].includes(name)) return '辦公桌';
    return category.trim();
  };
  const furnitureGroups = Object.values(recognizedFurnitureMarkers.reduce<Record<string, typeof recognizedFurnitureMarkers>>((groups, marker) => {
    const key = `${marker.zoneId}:${furnitureGroupName(marker.category).toLowerCase()}`;
    (groups[key] ||= []).push(marker);
    return groups;
  }, {}));
  const editFurnitureMarker = (zoneId: string, positionId: string, remove: boolean) => {
    rememberZoneEdit();
    setFloorPlan(current => {
      if (!current?.placements) return current;
      const placements = current.placements;
      const positions = (placements.positions[zoneId] || []).flatMap(position => position.id !== positionId ? [position] : remove ? [] : [{ ...position, angle: ((position.angle ?? 0) + 90) % 360 }]);
      const assignments = remove ? Object.fromEntries(Object.entries(placements.assignments).map(([id, ids]) => [id, ids.map(value => value === positionId ? '' : value)])) : placements.assignments;
      return { ...current, placements: { positions: { ...placements.positions, [zoneId]: positions }, assignments } };
    });
  };
  const copyFurnitureMarker = (zoneId: string, positionId: string) => {
    rememberZoneEdit();
    setFloorPlan(current => {
      const placements = current?.placements;
      const positions = placements?.positions[zoneId] || [];
      const original = positions.find(position => position.id === positionId);
      if (!current || !placements || !original) return current;
      const n = Math.max(0, ...positions.map(position => Number(position.label.replace(/^P/, '')) || 0)) + 1;
      const dx = original.rect ? Math.min(2, 100 - original.rect.x - original.rect.w) : Math.min(2, 100 - original.x);
      const dy = original.rect ? Math.min(2, 100 - original.rect.y - original.rect.h) : Math.min(2, 100 - original.y);
      const copy = { ...original, id: `${zoneId}:P${n}`, label: `P${n}`, x: original.x + dx, y: original.y + dy, ...(original.rect ? { rect: { ...original.rect, x: original.rect.x + dx, y: original.rect.y + dy } } : {}), productId: undefined };
      return { ...current, placements: { ...placements, positions: { ...placements.positions, [zoneId]: [...positions, copy] } } };
    });
  };
  const zoneCanvasId = (id: string) => id.split("::")[0];
  const applyZoneCanvas = (rows: ZoneManagerRow[]) =>
    setZoneManagerDraft((current) => applyZoneCanvasChange(current, rows));
  const copyZoneArea = (id: string) => {
    rememberZoneEdit();
    const [zoneId, rawIndex] = id.split("::");
    setZoneManagerDraft((current) => current.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const rects = zone.rects?.length ? zone.rects : zone.rect ? [zone.rect] : [];
      const rect = rects[Number(rawIndex)];
      if (!rect || rects.length >= MAX_FLOOR_PLAN_ZONES) return zone;
      // Nudge the copy clear of the original: down-right, or up-left when it is already at the edge.
      const copy = {
        ...rect,
        x: rect.x + 3 + rect.w <= 100 ? rect.x + 3 : Math.max(0, rect.x - 3),
        y: rect.y + 3 + rect.h <= 100 ? rect.y + 3 : Math.max(0, rect.y - 3),
      };
      return { ...zone, rects: [...rects, copy], rect: rects[0] ?? copy };
    }));
    setActiveZoneId(zoneId);
  };

  useEffect(() => {
    if (!zoneRecognitionActive) {
      setZoneRecognitionProgress(0);
      return;
    }
    setZoneRecognitionProgress((value) => (value > 0 ? value : 8));
    const timer = window.setInterval(() => {
      setZoneRecognitionProgress((value) => {
        const cap = floorPlanBusy ? 36 : 92;
        if (value >= cap) return value;
        const step = value < cap * 0.5 ? 3.5 : 1.1;
        return Math.min(cap, Math.round((value + step) * 10) / 10);
      });
    }, 350);
    return () => window.clearInterval(timer);
  }, [zoneRecognitionActive, floorPlanBusy]);

  const saveZoneManager = async () => {
    const drafts = zoneManagerDraft;
    const existingIds = new Set(
      items.filter((item) => item.isSectionTitle).map((item) => item.id),
    );
    const kept = drafts.filter((row) => row.name.trim() || row.nameEn.trim() || existingIds.has(row.id));
    const nextItems = applyZoneManager(items, kept);
    const keptIds = kept.map((row) => row.id);
    const nextZoneImages = pruneQuoteZoneImages(zoneImages, keptIds);
    const nextZonePhotoLayouts = pruneZonePhotoLayouts(zonePhotoLayouts, [...keptIds, UNZONED_QUOTE_IMAGE_KEY]);
    const nextRegions = regionsFromZoneRows(kept);
    const nextFloorPlan = floorPlan ? { ...floorPlan, regions: nextRegions, ...(floorPlan.placements ? { placements: reassignFurnitureZones(floorPlan.placements, nextRegions, layoutZones(nextItems)) } : {}) } : floorPlan;
    // Empty drafts can have zones before their first priced line. Keep those edits
    // locally and let the normal save action persist them once the quote is valid.
    const canSave = nextItems.some(hasQuoteItemContent) && totalAmount > 0;
    if (canSave) {
      const saved = await handleSaveExistingVersion({
        items: nextItems,
        floorPlan: nextFloorPlan,
        zoneImages: nextZoneImages,
        zonePhotoLayouts: nextZonePhotoLayouts,
      });
      if (!saved) return;
    }
    itemsUserEditedRef.current = true;
    setItems(nextItems);
    setZoneImages(nextZoneImages);
    setZonePhotoLayouts(nextZonePhotoLayouts);
    setFloorPlan(nextFloorPlan);
    setZoneManagerOpen(false);
  };

  const detectZonesFromBlob = async (blob: Blob, priorRegions: QuoteZoneRegion[], replace = false) => {
    setRecognizingZones(true);
    try {
      const jpeg = await imageBlobToJpegBase64(blob);
      const productZones = layoutZones(itemsRef.current);
      const detected = await detectZonesFromJpegBase64(jpeg, JSON.stringify(productZones.map(z => ({ name: z.name, products: z.products.map(p => ({ id: p.id, name: p.name, category: p.category, quantity: p.quantity })) }))), () => toast.warning('分塊識別未完成，已使用整圖識別結果；傢俬可能有遺漏，請稍後重試。'));
      const base = replace ? [] : zoneManagerOpenRef.current
        ? zoneManagerDraftRef.current
        : zoneRowsFromItems(itemsRef.current, priorRegions);
      const { rows, added } = applyDetectedZones(base, detected, generateId);
      const unboxed = detected.filter((zone) => !zone.rect).length;
      const unboxedNote = unboxed
        ? quoteLocale === "en"
          ? ` ${unboxed} of them came back without an area — drag a box over those on the plan.`
          : `，其中 ${unboxed} 個未能自動框選，可在圖上補框`
        : "";
      const notes = detectedLayoutNotes(rows, detected);
      const placements = autoFurniturePlacements(rows, detected, productZones);
      setFloorPlan(current => current ? { ...current, placements, rendering: { ...current.rendering, style: current.rendering?.style || DEFAULT_LAYOUT_STYLE, notes, images: {} } } : current);
      setZoneManagerDraft(rows);
      setActiveZoneId(added > 0 ? rows[0]?.id ?? null : null);
      setZoneManagerOpen(true);
      if (!detected.length) {
        toast.message(
          quoteLocale === "en"
            ? "No labeled rooms were found. Draw them on the plan, or add them below."
            : "平面圖上看不到已標名稱的房間，可以在圖上自己畫，或在下面新增",
        );
      } else if (!added) {
        toast.message(
          quoteLocale === "en"
            ? `These rooms are already on the quote. Adjust the areas, then confirm.${unboxedNote}`
            : `這些房間已經在報價裡，可以調整範圍後再確認${unboxedNote}`,
        );
      } else {
        toast.success(
          quoteLocale === "en"
            ? `Found ${added} room${added === 1 ? "" : "s"}. Adjust the areas, then confirm.${unboxedNote}`
            : `已找到 ${added} 個房間，可以調整範圍後再確認加入${unboxedNote}`,
        );
      }
    } catch (error) {
      toast.error(quoteLocale === "en" ? "Could not detect zones" : "識別分區失敗", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRecognizingZones(false);
    }
  };

  const redetectZones = async () => {
    if (!floorPlan || zoneRecognitionActive) return;
    const accepted = await confirm({
      title: quoteLocale === 'en' ? 'Recognize again?' : '重新識別平面圖？',
      description: quoteLocale === 'en' ? 'This will clear the existing zones and furniture recognition results.' : '重新識別會清空現有分區和傢俬識別結果，並重新識別平面圖。',
      confirmLabel: quoteLocale === 'en' ? 'Recognize again' : '重新識別',
      cancelLabel: t.cancel,
      destructive: true,
    });
    if (!accepted) return;
    setFloorPlanBusy(true);
    try {
      const response = await fetch(floorPlan.previewUrl || floorPlan.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await detectZonesFromBlob(await response.blob(), [], true);
    } catch (error) {
      toast.error(quoteLocale === 'en' ? 'Could not load floor plan' : '無法讀取平面圖', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setFloorPlanBusy(false);
    }
  };

  const handleFloorPlanFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(lowerName);
    if (!isPdf && !isImage) {
      toast.error(quoteLocale === "en" ? "Upload a PDF, JPG or PNG" : "請上傳 PDF / JPG / PNG");
      return;
    }
    const replacing = Boolean(floorPlanRef.current?.url);
    if (replacing && !(await confirm({
      title: quoteLocale === 'en' ? 'Replace floor plan?' : '確定更換平面圖？',
      description: quoteLocale === 'en' ? 'Existing zones and furniture recognition results will be replaced by the new recognition results.' : '更換後會重新識別分區及傢俬，取代現有的分區和傢俬識別結果。',
      confirmLabel: quoteLocale === 'en' ? 'Replace' : '確定更換',
      cancelLabel: t.cancel,
      destructive: true,
    }))) return;
    if (!zoneManagerOpenRef.current) {
      setZoneManagerDraft(zoneRowsFromItems(itemsRef.current, floorPlanRef.current?.regions ?? []));
      setActiveZoneId(null);
    }
    setZoneManagerOpen(true);
    setFloorPlanBusy(true);
    try {
      const uploaded = await uploadProjectFloorPlanFile(quoteImageScope || "quote", file);
      let previewUrl = uploaded.mimeType.startsWith("image/") ? uploaded.url : null;
      let visionBlob: Blob = file;
      if (isPdf) {
        const rendered = await renderPdfPageToJpegBlob(file, 1, { scale: 1.1, quality: 0.8 });
        previewUrl = await uploadProjectFloorPlanPreview(quoteImageScope || "quote", rendered.blob);
        visionBlob = rendered.blob;
      }
      const priorRegions = floorPlanRef.current?.regions ?? [];
      setFloorPlan({
        url: uploaded.url,
        mimeType: uploaded.mimeType,
        fileName: uploaded.fileName,
        previewUrl,
        regions: unconfirmZoneRegions(priorRegions),
      });
      toast.success(quoteLocale === "en" ? "Floor plan uploaded. Detecting zones…" : "已上傳平面圖，正在識別分區、傢俬位置及方向");
      // Floor plan metadata is not a line-item edit. Marking items edited while
      // bwf_quote_item is still loading drops those rows on the way back.
      if (existingQuote?.quoteUuid && !itemsLoadedRef.current) {
        await Promise.race([
          waitForQuoteItems(),
          new Promise<void>((resolve) => window.setTimeout(resolve, 30000)),
        ]);
      }
      setRecognizingZones(true);
      setFloorPlanBusy(false);
      await detectZonesFromBlob(visionBlob, priorRegions, replacing);
    } catch (error) {
      toast.error(quoteLocale === "en" ? "Could not upload the floor plan" : "平面圖上傳失敗", {
        description: error instanceof Error ? error.message : undefined,
      });
      setFloorPlanBusy(false);
    }
  };

  const handleFloorPlanFileRef = useRef(handleFloorPlanFile);
  handleFloorPlanFileRef.current = handleFloorPlanFile;
  const zoneRecognitionActiveRef = useRef(false);
  zoneRecognitionActiveRef.current = floorPlanBusy || recognizingZones;

  /** Ctrl+V／右鍵貼上平面圖：對話框（更換平面圖、圖片上載）有自己的貼上處理。 */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (zoneManagerOpenRef.current || zoneRecognitionActiveRef.current) return;
      if (document.querySelector('[data-modal-content]')) return;
      if (target?.closest('[data-modal-content]')) return;
      // 在輸入框貼文字時不要搶走；只有剪貼簿帶檔案才當成平面圖。
      if (target?.closest('input, textarea, [contenteditable="true"]') && event.clipboardData?.types.includes('text/plain')) return;
      const file = floorPlanFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void handleFloorPlanFileRef.current(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  /** 分區管理內貼上，直接更換平面圖並重新識別。 */
  useEffect(() => {
    if (!zoneManagerOpen) return;
    const onPaste = (event: ClipboardEvent) => {
      if (zoneRecognitionActiveRef.current) return;
      // 子對話框（例如渲染圖設置）各自處理自己的貼上。
      if (document.querySelectorAll('[data-modal-content]').length > 1) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') && event.clipboardData?.types.includes('text/plain')) return;
      const file = floorPlanFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void handleFloorPlanFileRef.current(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [zoneManagerOpen]);

  const handleDeleteFloorPlan = async () => {
    if (!floorPlanRef.current?.url) return;
    const accepted = await confirm({
      title: ui("刪除平面圖？", "Delete the floor plan?"),
      description: ui(
        "平面圖、分區範圍和傢俬位置會從這張報價移除；分區名稱和報價項目會保留。",
        "The floor plan, zone areas and furniture positions are removed from this quote. Zone names and quote items stay.",
      ),
      confirmLabel: ui("刪除", "Delete"),
      cancelLabel: t.cancel,
      destructive: true,
    });
    if (!accepted) return;
    const canSave = itemsRef.current.some(hasQuoteItemContent) && totalAmount > 0;
    if (canSave) {
      const saved = await handleSaveExistingVersion({
        items: itemsRef.current,
        floorPlan: null,
        zoneImages,
        zonePhotoLayouts,
      });
      if (!saved) return;
    }
    setFloorPlan(null);
    setZoneManagerDraft(zoneRowsFromItems(itemsRef.current, []));
    setActiveZoneId(null);
    toast.success(ui("已刪除平面圖", "Floor plan deleted"));
  };

  // Reset item-edit guard when switching to a different quote.
  // Do NOT reset when first persist promotes NEW → real quoteId (same editor session).
  const prevStorageKeyRef = useRef(storageKey);
  useEffect(() => {
    const prev = prevStorageKeyRef.current;
    prevStorageKeyRef.current = storageKey;
    if (prev === storageKey) return;
    const prevIsNew = prev.endsWith("::NEW");
    const nextIsNew = storageKey.endsWith("::NEW");
    if (prevIsNew && !nextIsNew) {
      // First 版本審核 on a new quote — keep in-memory items / edit guard.
      return;
    }
    itemsUserEditedRef.current = false;
    itemsHydratedForUuidRef.current = null;
  }, [storageKey]);

  // 報價內容 is considered "有數據" if any row has a product name.
  const hasQuoteData = items.some(hasQuoteItemContent);

  // Load draft from IndexedDB on mount.
  // NEW quotes: always allow local draft.
  // Existing quotes: only when markUseLocalQuoteDraft was set (autosave / F5).
  // Opening from 報價一覽 clears that mark so Supabase 版本審核 data wins.
  useEffect(() => {
    if (draftHydratedRef.current === storageKey) {
      setDraftLoaded(true);
      return;
    }
    draftHydratedRef.current = storageKey;
    let cancelled = false;
    (async () => {
      try {
        const allowLocalDraft =
          !existingQuote?.quoteId ||
          shouldUseLocalQuoteDraft(userEmail, existingQuote.quoteId) ||
          shouldUseLocalQuoteDraft(userEmail, rawQuoteId);
        if (!allowLocalDraft) {
          setDraftLoaded(true);
          return;
        }
        const cached = await loadDraft(storageKey);
        if (cancelled || !cached) {
          setDraftLoaded(true);
          return;
        }
        // Hydrate state from the cached draft
        if (cached.formData) {
          const cachedForm = cached.formData as Partial<QuoteFormData>;
          onFormDataChange({
            clientIndustry: cachedForm.clientIndustry ?? formData.clientIndustry,
            quotationType: cachedForm.quotationType ?? formData.quotationType,
            serviceScope: cachedForm.serviceScope ?? formData.serviceScope,
            workPeriod: cachedForm.workPeriod ?? formData.workPeriod,
            remarks: cachedForm.remarks ?? formData.remarks,
          });
        }
        if (cached.companyInfo) {
          const cachedCompany = cached.companyInfo as Partial<typeof companyInfo>;
          setCompanyInfo({
            name:
              cachedCompany.name ||
              formData.company ||
              "Branding Works Design Ltd",
            address: cachedCompany.address || DEFAULT_COMPANY_ADDRESS.zh,
            addressEn: cachedCompany.addressEn || DEFAULT_COMPANY_ADDRESS.en,
            showAddressInPdf: cachedCompany.showAddressInPdf !== false,
            phone:
              resolveQuoteCompanyPhone({
                email: userEmail,
                name: staffName,
              }) ||
              cachedCompany.phone ||
              DEFAULT_QUOTE_COMPANY_PHONE,
            email: cachedCompany.email || "sales@brandingworks-furniture.com",
            website: cachedCompany.website || DEFAULT_COMPANY_WEBSITE,
          });
        }
        if (cached.clientInfo) {
          setClientInfo(cached.clientInfo as typeof clientInfo);
        }
        if (cached.quoteMeta) {
          const meta = cached.quoteMeta as {
            pmName?: string;
            validity?: string;
            deliveryAddress?: string;
            projectName?: string;
            date?: string;
          };
          setQuoteMeta({
            pmName: meta.pmName || quoteMeta.pmName,
            date: todayQuoteDateIso(),
            validity: meta.validity || quoteMeta.validity,
            deliveryAddress: meta.deliveryAddress || "",
          });
        }
        if (cached.deliveryDetails) {
          setDeliveryDetails(cached.deliveryDetails);
        }
        const cachedRecord = cached as unknown as Record<string, unknown>;
        if (typeof cached.deliveryDetailsEn === "string" && cached.deliveryDetailsEn) {
          setDeliveryDetailsEn(cached.deliveryDetailsEn);
        }
        if (cachedRecord.installationFee) {
          setInstallationFee(
            cachedRecord.installationFee as typeof installationFee,
          );
        }
        if (typeof cachedRecord.discountNote === "string") {
          setDiscountNote(
            cachedRecord.discountNote as string,
          );
        }
        if (cachedRecord.gpSummary) {
          const gp = cachedRecord.gpSummary as { ship?: number; installation?: number };
          setGpSummary({
            ship: gp.ship ?? 0,
            installation: gp.installation ?? 0,
          });
        }
        if (cachedRecord.priceMultiplier != null && cachedRecord.priceMultiplier !== "") {
          setPriceMultiplier(String(cachedRecord.priceMultiplier));
        }
        if (Array.isArray(cachedRecord.quotePhotoLayouts)) {
          setQuotePhotoLayouts(parsePhotoLayouts(cachedRecord.quotePhotoLayouts));
        }
        if (Array.isArray(cachedRecord.quotePhotoAssets)) {
          setQuotePhotoAssets(parseQuotePhotoAssetRefs(cachedRecord.quotePhotoAssets));
        }
        if ("floorPlan" in cachedRecord) {
          setFloorPlan(parseQuoteFloorPlan(cachedRecord.floorPlan));
        }
        if ("zoneImages" in cachedRecord) {
          setZoneImages(parseQuoteZoneImages(cachedRecord.zoneImages));
        }
        if ("zonePhotoLayouts" in cachedRecord) {
          setZonePhotoLayouts(parseZonePhotoLayouts(cachedRecord.zonePhotoLayouts));
        }
        if ("catalogPageAttachments" in cachedRecord) {
          setCatalogPages(parseQuoteCatalogPages(cachedRecord.catalogPageAttachments));
        }
        if (cached.termsContent) {
          const cachedMeta = cached.quoteMeta as { deliveryAddress?: string } | undefined;
          setTermsContent(
            migrateTermsContentToCurrent(
              cached.termsContent as SavedTermsContent,
              cachedMeta?.deliveryAddress,
            ),
          );
        }
        if (cached.termsContentEn) {
          const cachedMeta = cached.quoteMeta as { deliveryAddress?: string } | undefined;
          const defaults = englishTermsContentForPdf(cachedMeta?.deliveryAddress);
          const savedEn = cached.termsContentEn as SavedTermsContent;
          setTermsContentEn(
            savedEn.fullHtml?.trim()
              ? { ...defaults, ...savedEn, fullHtml: savedEn.fullHtml }
              : defaults,
          );
        }
        if (cached.items && cached.items.length > 0) {
          itemsUserEditedRef.current = true;
          if (existingQuote?.quoteUuid) {
            itemsHydratedForUuidRef.current = existingQuote.quoteUuid;
          }
          // Use shared mapper so fields like `unit` are not dropped on restore.
          setItems(
            cached.items.map((item) =>
              mapInputToQuotationItem(item as BwfQuoteItemInput),
            ),
          );
        }
        if (
          shouldShowDraftRestoreNotice(userEmail, rawQuoteId)
        ) {
          toast.info("已恢復未提交的報價內容", {
            description: `上次編輯於 ${new Date(cached.updatedAt).toLocaleString("zh-HK")}`,
          });
        }
      } catch {
        // IndexedDB not available or error — silently continue
      } finally {
        if (!cancelled) setDraftLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Build draft data for auto-save (IndexedDB — survives refresh; cleared on 版本審核 or leave)
  const buildDraftData = useCallback(
    (): DraftData => ({
      quoteId: storageKey,
      updatedAt: Date.now(),
      formData: formData as unknown as Record<string, unknown>,
      companyInfo: companyInfo as unknown as Record<string, unknown>,
      clientInfo: clientInfo as unknown as Record<string, unknown>,
      quoteMeta: quoteMeta as unknown as Record<string, unknown>,
      deliveryDetails,
      deliveryDetailsEn,
      termsContent: termsContent as unknown as Record<string, unknown>,
      termsContentEn: termsContentEn as unknown as Record<string, unknown>,
      items: items.map(
        ({ id, exchangeRateInput: _exchangeRateInput, ...rest }) =>
          rest as unknown as Record<string, unknown>,
      ),
      subtotal,
      discountNote,
      installationFee,
      gpSummary,
      priceMultiplier: parseFloat(priceMultiplier) || 1,
      quotePhotoLayouts: quotePhotoLayouts as unknown as Record<string, unknown>[],
      quotePhotoAssets: quotePhotoAssets as unknown as Record<string, unknown>[],
      floorPlan: floorPlan as unknown as Record<string, unknown> | null,
      zoneImages: zoneImages as unknown as Record<string, unknown>,
      zonePhotoLayouts: zonePhotoLayouts as unknown as Record<string, unknown>,
      catalogPageAttachments: catalogPages as unknown as Record<string, unknown>[],
    }),
    [
      storageKey,
      formData,
      companyInfo,
      clientInfo,
      quoteMeta,
      deliveryDetails,
      deliveryDetailsEn,
      termsContent,
      termsContentEn,
      items,
      subtotal,
      discountNote,
      installationFee,
      gpSummary,
      priceMultiplier,
      quotePhotoLayouts,
      quotePhotoAssets,
      floorPlan,
      zoneImages,
      zonePhotoLayouts,
      catalogPages,
    ],
  );

  // Unsaved-work guard: dirty only when content differs from the loaded baseline.
  const currentDraft = useMemo(() => buildDraftData(), [buildDraftData]);
  const currentSnapshot = useMemo(
    () => quoteDraftSnapshot(currentDraft),
    [currentDraft],
  );

  /** 明細（bwf_quote_item）比報價單本身遲載入，載入前不應把 placeholder 當成修改。 */
  const awaitingQuoteItems =
    Boolean(existingQuote?.quoteUuid) && !itemsLoadedFromDb && !itemsLoadFailed;

  const baselineDraft = baselineDraftRef.current;
  const isDirty =
    snapshotReady &&
    baselineDraft !== null &&
    baselineSnapshotRef.current !== null &&
    (awaitingQuoteItems
      // 明細仍在下載：只比較其他欄位，載入期間改 基本資料 一樣要提示離開。
      ? quoteDraftSnapshot({ ...baselineDraft, items: [] }) !==
        quoteDraftSnapshot({ ...currentDraft, items: [] })
      : currentSnapshot !== baselineSnapshotRef.current);

  /**
   * 用 useLayoutEffect：剛改完立刻點選單時，handler 讀到的已經是最新狀態。
   * （useEffect 會延後到瀏覽器空閒，偶爾會讓離開檢查讀到舊值而漏提示。）
   */
  useLayoutEffect(() => {
    unsavedGuard.set(isDirty, QUOTE_UNSAVED_LEAVE_MESSAGE);
    return () => unsavedGuard.clear();
  }, [isDirty]);

  useEffect(() => {
    unsavedGuard.setLeaveHandler(() => {
      deleteDraft(storageKey).catch(() => {});
      clearUseLocalQuoteDraft(userEmail);
      resetQuickQuoteSessionStorage(userEmail);
    });
    return () => unsavedGuard.setLeaveHandler(null);
  }, [storageKey, userEmail]);

  const pinSessionForReload = useCallback(() => {
    const quoteId = existingQuote?.quoteId || rawQuoteId;
    writeResumeQuote(userEmail, {
      quoteId,
      quoteUuid: existingQuote?.quoteUuid ?? null,
    });
    if (existingQuote?.quoteId) {
      writeQuickQuoteEditingId(userEmail, existingQuote.quoteId);
    }
    // NEW quotes have no editing id — keep wizard on editor step after reload.
    if (typeof window !== "undefined") {
      writeQuickQuoteStep(userEmail, 3);
    }
  }, [userEmail, existingQuote?.quoteId, existingQuote?.quoteUuid, rawQuoteId]);

  /** Call only after writing IndexedDB — enables local draft on next F5. */
  const persistLocalDraftMarkers = useCallback(() => {
    const quoteId = existingQuote?.quoteId || rawQuoteId;
    pinSessionForReload();
    markUseLocalQuoteDraft(userEmail, quoteId);
  }, [pinSessionForReload, userEmail, existingQuote?.quoteId, rawQuoteId]);

  // Pin URL/session as soon as editor opens so F5 can return here.
  // Do NOT markUseLocal here — that would let stale IndexedDB override 版本審核 data
  // when reopening from 報價一覽.
  useEffect(() => {
    if (!draftLoaded) return;
    pinSessionForReload();
  }, [draftLoaded, pinSessionForReload]);

  // Flush IndexedDB + resume markers before deploy-reload prompt.
  useEffect(() => {
    unsavedGuard.setDraftFlushHandler(async () => {
      if (!hasQuoteData) return;
      await saveDraft(buildDraftData());
      persistLocalDraftMarkers();
    });
    return () => unsavedGuard.setDraftFlushHandler(null);
  }, [hasQuoteData, buildDraftData, persistLocalDraftMarkers]);

  /** Save current editor state to Supabase (update open version, or create v1). */
  const handleSaveExistingVersion = async (overrides?: {
    items: QuotationItem[];
    floorPlan: QuoteFloorPlan | null;
    zoneImages: QuoteZoneImageMap;
    zonePhotoLayouts: Record<string, PhotoLayoutGroup[]>;
  }): Promise<boolean> => {
    const sourceItems = overrides?.items ?? items;
    if (existingQuote?.quoteUuid && !itemsLoadedFromDb) {
      if (itemsLoadFailed) {
        toast.error(quoteLocale === "en" ? "Quotation items could not load" : "報價明細未能載入", {
          description: quoteLocale === "en"
            ? "Saving is paused so no items are lost. Reload the items below, then try again."
            : "為免漏掉項目，已暫停保存。請先在下方按「重新載入明細」，再試一次。",
        });
        return false;
      }
      if (overrides) {
        // 分區管理等內部流程：不接受未載入的明細，直接擋下。
        toast.error(quoteLocale === "en" ? "The quotation is still loading" : "報價內容仍在載入", {
          description: quoteLocale === "en"
            ? "Wait until everything has loaded before saving."
            : "請等報價內容載入完成再保存，以免漏掉項目。",
        });
        return false;
      }
      pendingQuoteActionRef.current = "save";
      toast.message(quoteLocale === "en" ? "Waiting for quotation items to load" : "正在等報價內容載入完成", {
        description: quoteLocale === "en"
          ? "Saving continues automatically once loading finishes."
          : "載入完成後會自動繼續保存，不用再按一次。",
      });
      return false;
    }
    const contentItems = sourceItems.filter(hasQuoteItemContent);
    if (contentItems.length === 0) {
      toast.error("尚無報價內容可保存");
      return false;
    }
    if (totalAmount <= 0) {
      toast.error("無法保存", {
        description: "報價總金額為 HK$0。請確認品項單價／數量後再保存。",
      });
      return false;
    }
    const fromUrl =
      typeof window !== "undefined"
        ? (() => {
            const parsed = parseQuotePathname(window.location.pathname);
            return parsed.kind === "quote" ? parsed.quoteId : "";
          })()
        : "";
    const chainId = pickQuoteChainId(
      submitChainIdRef.current,
      quoteId,
      existingQuote?.quoteId,
      formData.quoteId,
      formData.pitchingCode,
      formData.projectName,
      draftQuoteId,
      fromUrl,
    );
    if (!chainId) {
      toast.error("缺少報價單號", {
        description:
          "找不到這張報價的單號。請返回重新選擇提案，或重新整理後再保存。",
      });
      return false;
    }
    const submitter = (staffName || userEmail || user?.email || "").trim();
    if (!submitter) {
      toast.error("無法保存", {
        description: "缺少提交者姓名（請確認已登入）。",
      });
      return false;
    }

    const draft = overrides
      ? {
          ...buildDraftData(),
          items: overrides.items.map(
            ({ id, exchangeRateInput: _exchangeRateInput, ...rest }) =>
              rest as unknown as Record<string, unknown>,
          ),
          floorPlan: overrides.floorPlan as unknown as Record<string, unknown> | null,
          zoneImages: overrides.zoneImages as unknown as Record<string, unknown>,
          zonePhotoLayouts: overrides.zonePhotoLayouts as unknown as Record<string, unknown>,
        }
      : buildDraftData();

    setIsSavingDraft(true);
    try {
      // Best-effort local backup before network save.
      await saveDraft(draft).catch(() => {});
      // 複製報價單尚未落庫時不可覆寫舊版本 → 開新版；其餘更新現有版／新單存 v1。
      const persistMode =
        forceNewQuote && !existingQuote?.quoteUuid
          ? "new-version"
          : "save-current";
      const result = await persistBwfQuote({
        mode: persistMode,
        totalAmount,
        totalCostPrice,
        projectData: buildProjectData(overrides),
        items: contentItems,
        bwfPitchingId:
          formData.pmsPitchingId || existingQuote?.bwfPitchingId || null,
        bwfProjectId:
          formData.pmsProjectId || existingQuote?.bwfProjectId || null,
        quoteId: chainId,
        pitchingCode: chainId,
        existingQuoteId: pickQuoteChainId(
          existingQuote?.quoteId,
          submitChainIdRef.current,
          quoteId,
          draftQuoteId,
          chainId,
        ),
        existingQuoteUuid: existingQuote?.quoteUuid ?? null,
        existingVersion: existingQuote?.version ?? null,
        existingStatus: existingQuote?.status ?? null,
        lockedChainId: chainId,
        submitter,
      });
      submitChainIdRef.current = result.quoteId;
      baselineDraftRef.current = draft;
      baselineSnapshotRef.current = quoteDraftSnapshot(draft);
      setSnapshotReady(true);
      unsavedGuard.clear();
      deleteDraft(storageKey).catch(() => {});
      deleteDraft(makeDraftKey(userEmail, result.quoteId)).catch(() => {});
      clearUseLocalQuoteDraft(userEmail);
      writeQuickQuoteEditingId(userEmail, result.quoteId);
      writeQuickQuoteCopyFrom(userEmail, null);
      writeResumeQuote(userEmail, {
        quoteId: result.quoteId,
        quoteUuid: result.quoteUuid,
      });
      itemsUserEditedRef.current = true;
      itemsHydratedForUuidRef.current = result.quoteUuid;
      setLastLocalSavedAt(Date.now());
      setAutoSaveFailed(false);
      toast.success(
        !existingQuote?.quoteUuid && result.version === "v1"
          ? "已保存為第 1 版"
          : persistMode === "new-version"
            ? "已保存為新版本"
            : "已保存現有版本",
        {
          description: `${result.quoteId} · 版本 ${result.version}`,
        },
      );
      onQuotePersisted?.(result);
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "暫時存不了，請稍後再試";
      toast.error("保存失敗", { description: message });
      return false;
    } finally {
      setIsSavingDraft(false);
    }
  };

  /** 明細載入完成後，自動續做剛才按下的送出／保存（在最新一次 render 執行，讀到已載入的 items）。 */
  const quoteActionHandlersRef = useRef({
    submit: () => {},
    save: async (): Promise<boolean> => false,
  });
  quoteActionHandlersRef.current = {
    submit: handleOpenSubmitReview,
    save: handleSaveExistingVersion,
  };
  useEffect(() => {
    if (!itemsLoadedFromDb) return;
    const action = pendingQuoteActionRef.current;
    if (!action) return;
    pendingQuoteActionRef.current = null;
    if (action === "submit") quoteActionHandlersRef.current.submit();
    else void quoteActionHandlersRef.current.save();
  }, [itemsLoadedFromDb]);
  useEffect(() => {
    if (!itemsLoadFailed || !pendingQuoteActionRef.current) return;
    pendingQuoteActionRef.current = null;
    toast.error(quoteLocale === "en" ? "Quotation items could not load" : "報價明細未能載入", {
      description: quoteLocale === "en"
        ? "The send/save you requested was cancelled so no items are lost. Reload the items and try again."
        : "剛才的送出／保存已取消，以免漏掉項目。請重新載入明細後再試。",
    });
  }, [itemsLoadFailed, quoteLocale]);

  // Warn on browser tab close / refresh while dirty.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (unsavedGuard.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Reset baseline when switching quotes.
  useEffect(() => {
    pendingQuoteActionRef.current = null;
    baselineDraftRef.current = null;
    baselineSnapshotRef.current = null;
    setSnapshotReady(false);
  }, [storageKey]);

  /**
   * Capture the baseline as soon as the draft is loaded — 不再等明細。
   * 明細要另外一張表下載，等它的話，載入期間的修改會被一併寫進 baseline，
   * 之後離開頁面就不會提示。明細載入完成後只把 items 補回 baseline（見下一個 effect）。
   */
  useEffect(() => {
    if (!draftLoaded) return;
    if (baselineSnapshotRef.current !== null) return;

    const draft = buildDraftData();
    baselineDraftRef.current = draft;
    baselineSnapshotRef.current = quoteDraftSnapshot(draft);
    setSnapshotReady(true);
  }, [draftLoaded, buildDraftData]);

  /**
   * 明細載入 / 自動補齊（分類、產品連結）後換掉 baseline 的 items，避免誤報有未保存修改。
   * 用戶真的改過明細（itemsUserEditedRef）時不覆蓋，那些修改必須保持 dirty。
   */
  useEffect(() => {
    if (!snapshotReady) return;
    const baseline = baselineDraftRef.current;
    if (!baseline) return;
    if (itemsUserEditedRef.current) return;
    const nextItems = items.map(
      ({ id, exchangeRateInput: _exchangeRateInput, ...rest }) =>
        rest as unknown as Record<string, unknown>,
    );
    if (JSON.stringify(baseline.items) === JSON.stringify(nextItems)) return;
    baselineDraftRef.current = { ...baseline, items: nextItems };
    baselineSnapshotRef.current = quoteDraftSnapshot(baselineDraftRef.current);
    refreshBaseline();
  }, [items, snapshotReady, refreshBaseline]);

  // Auto-save draft locally while dirty (browser backup; server save =「保存現有版本」).
  // Also refreshes resume / editingId markers so F5 can reopen this editor.
  useEffect(() => {
    if (!draftLoaded || !hasQuoteData || !isDirty) return;
    setIsAutoSaving(true);
    const timer = window.setTimeout(() => {
      const draft = buildDraftData();
      saveDraft(draft)
        .then(() => {
          persistLocalDraftMarkers();
          setLastLocalSavedAt(Date.now());
          setAutoSaveFailed(false);
        })
        .catch(() => {
          setAutoSaveFailed(true);
        })
        .finally(() => {
          setIsAutoSaving(false);
        });
    }, 800);
    return () => {
      window.clearTimeout(timer);
      setIsAutoSaving(false);
    };
  }, [draftLoaded, hasQuoteData, isDirty, buildDraftData, persistLocalDraftMarkers]);

  const handleProductSelected = (
    products: {
      image: string;
      name: string;
      unitPrice: number;
      costPrice?: number | null;
      category?: string;
      material?: string;
      color?: string;
      remarks?: string;
      dimensionLMm?: number | null;
      dimensionWMm?: number | null;
      dimensionHMm?: number | null;
      deliveryTermName?: string;
      factoryName?: string;
      sku?: string;
      productId?: string | null;
      productCategoryId?: string | null;
    }[],
  ) => {
    if (products.length === 0) {
      setActiveItemId(null);
      return;
    }

    // Insert selected products as new rows at the requested index (no deduplication)
    itemsUserEditedRef.current = true;
    const newRows = products.map((p) => {
      const costPrice = p.costPrice ?? null;
      const exchangeRate = null;
      const productCategoryId = p.productCategoryId?.trim() || null;
      const pair = findProductCategoryPairById(categoryPairs, productCategoryId);
      return {
        id: generateId(),
        image: p.image && isHttpImageUrl(p.image) ? p.image : "",
        name: p.name,
        costPrice,
        exchangeRate,
        hkdCostPrice: computeHkdCostPrice(costPrice, exchangeRate),
        unitPrice: p.unitPrice || p.costPrice || 0,
        quantity: 1,
        unit: "",
        sku: p.sku?.trim() || "",
        category: p.category?.trim() || "",
        material: p.material,
        color: p.color?.trim() || "",
        remarks: p.remarks,
        dimensionLMm:
          p.dimensionLMm == null ? null : String(p.dimensionLMm).trim() || null,
        dimensionWMm:
          p.dimensionWMm == null ? null : String(p.dimensionWMm).trim() || null,
        dimensionHMm:
          p.dimensionHMm == null ? null : String(p.dimensionHMm).trim() || null,
        dimensionMode: 'lwh' as const,
        deliveryTermName: p.deliveryTermName,
        factoryName: p.factoryName?.trim() || "",
        factoryFromCatalog: Boolean(
          (p.productId || "").trim() || p.factoryName?.trim(),
        ),
        productId: p.productId?.trim() || null,
        productCategoryId,
        registryLevel1: pair?.level1,
        registryLevel2: pair?.level2,
      };
    });

    const insertAt = productInsertAtRef.current;
    setItems((prev) => insertItemsAt(prev, newRows, insertAt));
    productInsertAtRef.current = 0;
    setActiveItemId(null);
  };

  const buildProjectData = (overrides?: {
    items: QuotationItem[];
    floorPlan: QuoteFloorPlan | null;
    zoneImages: QuoteZoneImageMap;
    zonePhotoLayouts: Record<string, PhotoLayoutGroup[]>;
  }) => {
    const projectItems = overrides?.items ?? items;
    const projectFloorPlan = overrides ? overrides.floorPlan : floorPlan;
    const projectZoneImages = overrides?.zoneImages ?? zoneImages;
    const projectZoneLayouts = overrides?.zonePhotoLayouts ?? zonePhotoLayouts;
    const pitchingId =
      formData.pmsPitchingId ||
      existingQuote?.bwfPitchingId ||
      null;
    const projectId =
      formData.pmsProjectId ||
      existingQuote?.bwfProjectId ||
      null;
    const {
      quoteId: _omitQuoteId,
      pitchingCode: _omitPitchingCode,
      projectName: _omitProjectName,
      ...formDataRest
    } = formData as QuoteFormData;
    void _omitQuoteId;
    void _omitPitchingCode;
    void _omitProjectName;
    // Keep formData client fields aligned with the editable 客戶資訊 panel so
    // list search / later wizard resume see the same company & contact values.
    const nextFormData = {
      ...formDataRest,
      company: companyInfo.name,
      projectManager: quoteMeta.pmName,
      validityDays: quoteMeta.validity,
      clientName: clientInfo.name,
      clientContactName: clientInfo.contactName || '',
      clientPhone: clientInfo.phone,
      clientEmail: clientInfo.email,
      ...(pitchingId ? { pmsPitchingId: pitchingId } : {}),
      ...(projectId ? { pmsProjectId: projectId } : {}),
    };
    // Items live in bwf_quote_item — omit from project_data JSON.
    // Quote total lives in bwf_quote.total_amount — never embed grandTotal here.
    return {
      formData: nextFormData,
      companyInfo,
      clientInfo,
      quoteMeta: {
        ...quoteMeta,
        quoteNumber: resolveEditorQuoteId(),
      },
      deliveryDetails,
      deliveryDetailsEn,
      termsContent,
      termsContentEn,
      subtotal,
      discountNote,
      discountValue,
      installationFee,
      gpSummary,
      priceMultiplier: parseFloat(priceMultiplier) || 1,
      quotePhotoLayouts,
      quotePhotoAssets,
      floorPlan: projectFloorPlan,
      zoneImages: pruneQuoteZoneImages(
        projectZoneImages,
        projectItems.filter((item) => item.isSectionTitle).map((item) => item.id),
      ),
      zonePhotoLayouts: pruneZonePhotoLayouts(
        projectZoneLayouts,
        [
          ...projectItems.filter((item) => item.isSectionTitle).map((item) => item.id),
          UNZONED_QUOTE_IMAGE_KEY,
        ],
      ),
      catalogPageAttachments: catalogPages,
    };
  };

  const buildPDFData = (): QuotationPDFData => {
    const activeTermsHtml =
      quoteLocale === 'en'
        ? termsContentEn.fullHtml || ''
        : termsContent.fullHtml || '';
    const deliveryAddress = resolveDeliveryAddress(
      activeTermsHtml,
      quoteMeta.deliveryAddress,
    );
    const displayDate = formatQuoteDisplayDate(quoteMeta.date, quoteLocale);
    // 「於PDF 隱藏」lines stay in the editor but are omitted from preview / PDF totals.
    const pdfSourceItems = omitEmptyPdfZones(
      items.filter((item) => hasQuoteItemContent(item) && !item.hideInPdf),
    );
    const pdfItems = pdfSourceItems.map((item) => ({
      image: item.image,
      referenceImage: item.referenceImage,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      category: item.category,
      material: item.material,
      color: item.color,
      remarks: item.remarks,
      remarksImage: item.remarksImage,
      dimensionLMm: item.dimensionLMm,
      dimensionWMm: item.dimensionWMm,
      dimensionHMm: item.dimensionHMm,
      dimensionMode: item.dimensionMode ?? 'lwh',
      deliveryTermName: item.deliveryTermName,
      isCustomTerm: item.isCustomTerm,
      isOptional: item.isOptional,
      isSectionTitle: item.isSectionTitle,
      id: item.isSectionTitle ? item.id : undefined,
      zoneImages: item.isSectionTitle ? zoneImages[item.id] : undefined,
      unit: item.unit,
    }));
    const pdfSubtotal = quoteBillableSubtotal(pdfSourceItems);
    const pdfFormat = {
      zoneSubtotalPlacement: formatSettings.zoneSubtotalPlacement,
      qrCaption: formatSettings.qrCaption,
      qrDataUrl: qrDataUrl ?? undefined,
    };

    const pdfQuotePhotoLayouts = {
      groups: quotePhotoLayouts,
      assets: quotePhotoAssets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        url: quotePhotoRefUrl(asset),
        ...(asset.isGenerated ? { isGenerated: true } : {}),
      })),
    };

    const pdfCoverPages = quoteCoverPages.map((page) => ({
      id: page.id,
      title: page.title,
      placement: page.placement,
      url: page.url,
    }));

    const pdfContentPages = quoteContentPages.map((page) => ({
      id: page.id,
      title: page.title,
      url: page.url,
      pageNumber: page.pageNumber,
    }));
    const pdfLeadImages = zoneImages[UNZONED_QUOTE_IMAGE_KEY] ?? [];
    const pdfZonePhotoLayouts = pruneZonePhotoLayouts(zonePhotoLayouts, [
      ...pdfSourceItems.filter((item) => item.isSectionTitle).map((item) => item.id),
      UNZONED_QUOTE_IMAGE_KEY,
    ]);

    if (quoteLocale === 'en') {
      const pdfLabels = quotePdf('en');
      const enFullHtml = deliveryAddress
        ? injectDeliveryAddressIntoTermsHtml(
            termsContentEn.fullHtml || buildDefaultTermsFullHtmlEn(deliveryAddress),
            deliveryAddress,
          )
        : termsContentEn.fullHtml || buildDefaultTermsFullHtmlEn();
      return {
        companyInfo: {
          name: companyInfo.name,
          address: companyInfo.addressEn || DEFAULT_COMPANY_ADDRESS.en,
          showAddress: companyInfo.showAddressInPdf,
          phone: companyInfo.phone,
          email: companyInfo.email,
          website: companyInfo.website,
        },
        clientInfo,
        quoteMeta: {
          ...quoteMeta,
          projectName: quoteId,
          deliveryAddress,
          quoteNumber: quoteId,
          version: existingQuote?.version
            ? displayQuoteVersion(existingQuote.version)
            : 'v1',
          date: displayDate,
        },
        format: pdfFormat,
        locale: 'en',
        deliveryDetails: deliveryDetailsEn,
        termsContent: {
          ...termsContentEn,
          fullHtml: enFullHtml,
        },
        leadImages: pdfLeadImages,
        zonePhotoLayouts: pdfZonePhotoLayouts,
        items: pdfItems,
        subtotal: pdfSubtotal,
        discountNote,
        quotePhotoLayouts: pdfQuotePhotoLayouts,
        quoteCoverPages: pdfCoverPages,
        quoteContentPages: pdfContentPages,
        installationFee: {
          ...installationFee,
          title: pdfLabels.installTitle,
          subtitle: pdfLabels.installSubtitle,
          conditionText: pdfLabels.installCondition,
        },
        catalogPages,
      };
    }

    const fullHtmlForPdf = deliveryAddress
      ? injectDeliveryAddressIntoTermsHtml(termsContent.fullHtml, deliveryAddress)
      : termsContent.fullHtml;

    return {
    // gpSummary (Contract Sum / Cost / Ship / Installation / GP) is editor-only — excluded here.
    companyInfo: {
      name: companyInfo.name,
      address: companyInfo.address,
      showAddress: companyInfo.showAddressInPdf,
      phone: companyInfo.phone,
      email: companyInfo.email,
      website: companyInfo.website,
    },
    clientInfo,
    quoteMeta: {
      ...quoteMeta,
      projectName: quoteId,
      deliveryAddress,
      quoteNumber: quoteId,
      version: existingQuote?.version
        ? displayQuoteVersion(existingQuote.version)
        : 'v1',
      date: displayDate,
    },
    format: pdfFormat,
    locale: 'zh',
    deliveryDetails,
    termsContent: {
      ...termsContent,
      fullHtml: fullHtmlForPdf,
    },
    leadImages: pdfLeadImages,
    zonePhotoLayouts: pdfZonePhotoLayouts,
    items: pdfItems,
    subtotal: pdfSubtotal,
    discountNote,
    quotePhotoLayouts: pdfQuotePhotoLayouts,
    quoteCoverPages: pdfCoverPages,
    quoteContentPages: pdfContentPages,
    installationFee,
    catalogPages,
  };
  };

  const shownVersion = existingQuote?.version
    ? displayQuoteVersion(existingQuote.version)
    : "—";
  const scrollToElement = useCallback((elementId: string) => {
    const root = editorScrollRootRef.current;
    const el = document.getElementById(elementId);
    if (!root || !el) return;
    const chrome = chromeRef.current && getComputedStyle(chromeRef.current).position === "sticky"
      ? chromeRef.current.offsetHeight
      : 0;
    const top =
      el.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop -
      chrome -
      8;
    root.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);

  const scrollToNav = useCallback(
    (nav: "basic" | "content" | "fees" | "photos" | "terms") => {
      const sectionId = {
        basic: "quote-sec-basic",
        content: "quote-sec-content",
        fees: "quote-sec-fees",
        photos: "quote-sec-photos",
        terms: "quote-sec-terms",
      }[nav];
      setActiveNav(nav);
      setActiveContentZoneId(null);
      navLockUntilRef.current = Date.now() + 800;
      scrollToElement(sectionId);
    },
    [scrollToElement],
  );

  /** 分區 (section title) sub-step under 報價內容 — scroll to that zone's card. */
  const scrollToZone = useCallback(
    (zoneId: string) => {
      setActiveNav("content");
      setActiveContentZoneId(zoneId);
      navLockUntilRef.current = Date.now() + 800;
      scrollToElement(zoneAnchorId(zoneId));
    },
    [scrollToElement],
  );

  useEffect(() => {
    const root = editorScrollRootRef.current;
    if (!root) return;
    const ids = [
      "quote-sec-basic",
      "quote-sec-content",
      "quote-sec-fees",
      "quote-sec-photos",
      "quote-sec-terms",
    ] as const;
    const navOf = {
      "quote-sec-basic": "basic",
      "quote-sec-content": "content",
      "quote-sec-fees": "fees",
      "quote-sec-photos": "photos",
      "quote-sec-terms": "terms",
    } as const;
    const onScroll = () => {
      if (Date.now() < navLockUntilRef.current) return;
      const chrome = chromeRef.current && getComputedStyle(chromeRef.current).position === "sticky"
        ? chromeRef.current.offsetHeight
        : 0;
      const marker = root.getBoundingClientRect().top + chrome + 16;
      let current: (typeof ids)[number] = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= marker) current = id;
      }
      setActiveNav(navOf[current]);
      if (navOf[current] !== "content") {
        setActiveContentZoneId(null);
        return;
      }
      // 分區副步驟：取內容區最上方、已越過頂端的那個分區。
      let zoneId: string | null = null;
      for (const item of itemsRef.current) {
        if (!item.isSectionTitle) continue;
        const el = document.getElementById(zoneAnchorId(item.id));
        if (el && el.getBoundingClientRect().top <= marker) zoneId = item.id;
      }
      setActiveContentZoneId(zoneId);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, [items.length]);

  useEffect(() => {
    const chrome = chromeRef.current;
    const root = editorScrollRootRef.current;
    if (!chrome || !root) return;
    const apply = () => {
      const height = getComputedStyle(chrome).position === "sticky" ? chrome.offsetHeight : 0;
      root.style.setProperty("--quote-chrome", `${height + 12}px`);
    };
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(chrome);
    return () => obs.disconnect();
  }, [unifyRateModalOpen, quoteLocale, autoSaveFailed, lastLocalSavedAt, isSavingDraft]);

  /** 開啟統一匯率彈窗時，預設帶上當日 CNY→HKD 匯率（抓取失敗則保持空白）。 */
  useEffect(() => {
    if (!unifyRateModalOpen) return;
    let cancelled = false;
    const cached = todayRateRef.current;
    if (cached) {
      setUnifyRateDraft(formatFxRate(cached));
      setUnifyRateAuto(true);
      setUnifyRateLoadingToday(false);
      return;
    }
    setUnifyRateLoadingToday(true);
    fetchTodayCnyHkdRate()
      .then((rate) => {
        if (cancelled) return;
        if (rate) {
          todayRateRef.current = rate;
          setUnifyRateDraft(formatFxRate(rate));
          setUnifyRateAuto(true);
        }
      })
      .finally(() => {
        if (!cancelled) setUnifyRateLoadingToday(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unifyRateModalOpen]);

  const productCount = items.filter((row) => !row.isSectionTitle && !row.isCustomTerm).length;
  const serviceCount = items.filter((row) => row.isCustomTerm).length;
  const titleCount = items.filter((row) => row.isSectionTitle).length;
  /** 分區副步驟：報價內容中每個區隔標題（分區）對應一條，供左側步驟列直接跳轉。 */
  const zoneNavItems = useMemo(
    () =>
      items.flatMap((item, index) =>
        item.isSectionTitle
          ? [{
              id: item.id,
              ordinal: sectionTitleOrdinalAt(items, index),
              label: item.name?.trim() ?? "",
              count: zoneItemCountAt(items, index),
            }]
          : [],
      ),
    [items],
  );
  const canNudge = (index: number, dir: -1 | 1) =>
    index + dir >= 0 && index + dir < items.length;
  const summaryLocked = !summaryEditing;
  const hasFloorPlanPreview = Boolean(floorPlan?.previewUrl || floorPlan?.mimeType.startsWith("image/"));

  return (
    <>
      <div className="quote-draft-editor flex h-full min-h-0 flex-col overflow-hidden">
      <div ref={editorScrollRootRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div
          ref={chromeRef}
          className="quote-editor-header sticky top-0 z-30 border-b border-border bg-card px-3 pt-3 sm:px-5"
        >
          <div className="quote-editor-titlebar flex flex-col gap-3 pb-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => onBack?.()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 font-body text-sm font-medium text-foreground hover:bg-muted/50"
              >
                <ChevronLeft className="h-4 w-4" />
                {t.back}
              </button>
              <div className="quote-editor-heading min-w-0">
              <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {t.editorTitle}
              </h1>
              <p className="fds-page-description">
                <span className="font-mono-data text-xs tracking-wide text-slate-500">
                  {quoteId || "—"}
                </span>
                <span>{t.currentVersion} <strong className="font-bold text-black">{shownVersion}</strong></span>
                <span>{t.nextReviewVersion} <strong className="font-bold text-black">{currentVersion}</strong></span>
                {autoSaveFailed || lastLocalSavedAt ? (
                  <span className={cn("ml-2", autoSaveFailed ? "text-rose-500" : "text-emerald-600")}>
                    {autoSaveFailed
                      ? t.autoSaveFailed
                      : `${t.autoSavedAt} ${new Date(lastLocalSavedAt as number).toLocaleTimeString(quoteLocale === "en" ? "en-GB" : "zh-HK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
                  </span>
                ) : null}
              </p>
              </div>
            </div>
            <div className="quote-editor-actions">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {floorPlan ? (
                  <button
                    type="button"
                    disabled={zoneRecognitionActive}
                    onClick={openZoneManager}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 font-body text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50"
                  >
                    <FolderKanban className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t.manageZones}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={zoneRecognitionActive}
                    onClick={openZoneManager}
                    title={ui("上傳平面圖，或按 Ctrl+V 貼上", "Upload a floor plan, or press Ctrl+V to paste")}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 font-body text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                  >
                    {zoneRecognitionActive ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">{t.uploadFloorPlan}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setUnifyRateDraft("");
                    setUnifyRateModalOpen(true);
                  }}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 font-body text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
                >
                  <Percent className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.unifyExchangeRate}</span>
                </button>
                <button
                  type="button"
                  disabled={shareBusy}
                  onClick={() => onOpenPdfPreview?.(buildPDFData())}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 font-body text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <Eye className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.previewPdf}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShareCopied(false);
                    setShareModalOpen(true);
                  }}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 font-body text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                >
                  {shareBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4" />
                  )}
                  {t.getQuoteQrCode}
                </button>
                {canUseQuoteEmail ? (
                  <button
                    type="button"
                    disabled={!canShareQuote}
                    title={canShareQuote ? t.emailCustomer : t.emailCustomerNeedSave}
                    onClick={() => setEmailModalOpen(true)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 font-body text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Mail className="h-4 w-4" />
                    <span className="truncate">{t.emailCustomer}</span>
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveExistingVersion()}
                  disabled={isSavingDraft || !hasQuoteData}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 font-body text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingDraft ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{t.saveDraft}</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenSubmitReview}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 font-body text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                  title="開新版本並提交審核"
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.versionReview}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTermsEditMode(false);
                    setQuoteLocale((l) => (l === "zh" ? "en" : "zh"));
                  }}
                  className="inline-flex h-9 min-w-[4.5rem] items-center justify-center rounded-lg border border-border bg-background px-3 font-body text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/50"
                  aria-label="語言"
                >
                  {t.langToggle}
                </button>
              </div>
            </div>
          </div>
          <div className="quote-editor-metrics" aria-label="報價金額摘要" aria-busy={quoteContentLoading}>
            {quoteContentLoading ? (
              <div role="status" aria-live="polite" className="col-span-full flex min-h-10 items-center gap-2 px-1 font-body text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span>{ui('正在載入報價內容與金額…', 'Loading quotation contents and totals…')}</span>
              </div>
            ) : itemsLoadFailed && existingQuote?.quoteUuid ? (
              <div role="alert" className="col-span-full flex min-h-10 items-center gap-2 px-1 font-body text-xs text-rose-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{ui('報價明細未能載入，金額暫時無法計算。', 'Quotation items could not load, so totals are unavailable.')}</span>
              </div>
            ) : [
              { label: `${t.grandTotal} HKD`, value: `$${totalAmount.toLocaleString()}`, tone: "total" },
              { label: "Cost", value: `$${totalProductCost.toLocaleString()}`, tone: "cost" },
              { label: "GP", value: `$${gpValue.toLocaleString()} (${Math.round(gpPercent)}%)`, tone: "gp" },
              { label: "Ship", value: `$${gpSummary.ship.toLocaleString()}` },
              { label: "Installation", value: `$${gpSummary.installation.toLocaleString()}` },
              { label: ui('Discount 折扣', 'Discount'), value: `$${discountValue.toLocaleString()}` },
            ].map(({ label, value, tone }) => {
              if (tone === "cost") {
                return (
                  <CostBreakdownHoverCard
                    key={label}
                    lines={costBreakdown}
                    unpricedCount={costBreakdownUnpricedCount}
                    total={totalProductCost}
                    english={quoteLocale === 'en'}
                  >
                    <div
                      className={cn(
                        "quote-editor-metric cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        tone && `is-${tone}`,
                      )}
                      tabIndex={0}
                      aria-label={ui(
                        `成本 $${totalProductCost.toLocaleString()}，查看每項成本`,
                        `Cost $${totalProductCost.toLocaleString()} — view per-item cost`,
                      )}
                    >
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  </CostBreakdownHoverCard>
                );
              }
              return (
                <div key={label} className={cn("quote-editor-metric", tone && `is-${tone}`)}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              );
            })}
          </div>
          {costMismatches.length > 0 ? (
            <button
              type="button"
              onClick={() => scrollToNav('fees')}
              className="flex w-full items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-1 py-1.5 text-left font-body text-[11px] text-amber-700 transition-colors hover:bg-amber-500/15"
              title={`${costMismatchSummary}${costMismatches.length > 3 ? '…' : ''}`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {ui(
                  `${costMismatches.length} 行成本未同步（HKD 成本 ≠ ¥成本 × 匯率），Cost / GP 以 HKD 成本計算`,
                  `${costMismatches.length} line(s) have an HKD cost that differs from CNY cost × rate; Cost / GP uses the HKD cost`,
                )}
              </span>
              <span className="shrink-0 underline underline-offset-2">{ui('查看', 'View')}</span>
            </button>
          ) : null}
        </div>
        <div className="quote-editor-workspace">
          <nav aria-label="報價步驟" className="quote-editor-nav">
            {([
              ["basic", t.basicInfo],
              ["content", t.quoteContent],
              ["fees", t.feesAndTotal],
              ["photos", t.quotePhotos],
              ["terms", t.termsSection],
            ] as const).map(([id, label], index) => (
              <div key={id} className="quote-editor-nav-group">
                <button
                  type="button"
                  aria-current={activeNav === id ? "step" : undefined}
                  onClick={() => scrollToNav(id)}
                  className={cn("quote-editor-nav-step", activeNav === id && "is-active")}
                >
                  <span className="quote-editor-nav-number">{index + 1}</span>
                  <span>{label}</span>
                </button>
                {id === "content" && zoneNavItems.length > 0 ? (
                  <ul className="quote-editor-nav-zones" aria-label={ui('報價內容的分區', 'Zones in quotation content')}>
                    {zoneNavItems.map((zone) => {
                      const zoneLabel = zone.label || ui('未命名分區', 'Untitled zone');
                      const zoneFullLabel = `${sectionTitlePrefix(zone.ordinal)}${zoneLabel}`;
                      return (
                        <li key={zone.id}>
                          <button
                            type="button"
                            title={`${zoneFullLabel} · ${ui(`已加入 ${zone.count} 項`, `${zone.count} item(s)`)}`}
                            aria-current={activeNav === "content" && activeContentZoneId === zone.id ? "location" : undefined}
                            onClick={() => scrollToZone(zone.id)}
                            className={cn(
                              "quote-editor-nav-zone",
                              activeNav === "content" && activeContentZoneId === zone.id && "is-active",
                            )}
                          >
                            <span className="quote-editor-nav-zone-serial">{sectionTitlePrefix(zone.ordinal)}</span>
                            <span className="quote-editor-nav-zone-name">{zoneLabel}</span>
                            <span className="quote-editor-nav-zone-count" aria-hidden="true">{zone.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ))}
          </nav>
        <div className="quote-editor-canvas">
          <div className="min-w-0">
            <div className="space-y-4">
            <section id="quote-sec-basic" className="order-1 scroll-mt-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
              <h2 className="font-display text-base font-bold text-foreground">{t.basicInfo}</h2>
              <p className="mb-4 mt-1 font-body text-sm text-muted-foreground">
                {ui('編輯報價單的基礎資訊，包括公司、專案、客戶及報價設定。', 'Edit company, project, customer and quotation information.')}
              </p>
            <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
              <InfoPanelColumn
                english={quoteLocale === 'en'}
                title={ui('公司資訊', 'Company Information')}
                icon={<Building2 className="h-4 w-4" />}
                iconClassName="bg-sky-50 text-sky-700"
                collapsed={collapseCompany}
                onToggle={() => setCollapseCompany((v) => !v)}
                summary={
                  <>
                    <LabelValueRow label={ui('公司名稱', 'Company Name')}>{companyInfo.name || "—"}</LabelValueRow>
                    <LabelValueRow label={ui('地址', 'Address')}>
                      {(quoteLocale === "en" ? companyInfo.addressEn : companyInfo.address) || "—"}
                      {companyInfo.showAddressInPdf
                        ? null
                        : ui('（PDF 隱藏）', ' (hidden in PDF)')}
                    </LabelValueRow>
                    <LabelValueRow label={ui('電話', 'Phone')}>{companyInfo.phone || "—"}</LabelValueRow>
                    <LabelValueRow label={ui('電郵', 'Email')}>{companyInfo.email || "—"}</LabelValueRow>
                    <LabelValueRow label={ui('網站', 'Website')}>{companyInfo.website || "—"}</LabelValueRow>
                  </>
                }
              >
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('公司名稱', 'Company Name')}
                  </label>
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono-data text-xs text-foreground/80">
                    {companyInfo.name}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('地址', 'Address')}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={
                        quoteLocale === 'en'
                          ? companyInfo.addressEn
                          : companyInfo.address
                      }
                      onChange={(e) =>
                        setCompanyInfo((p) =>
                          quoteLocale === 'en'
                            ? { ...p, addressEn: e.target.value }
                            : { ...p, address: e.target.value },
                        )
                      }
                      title={
                        quoteLocale === 'en'
                          ? companyInfo.addressEn
                          : companyInfo.address
                      }
                      className="h-9 w-full rounded-md border border-border bg-background pl-3 pr-24 font-body text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                    <label
                      className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 cursor-pointer items-center gap-1 rounded bg-background/90 px-1 py-0.5"
                      title={ui(
                        '取消勾選後，客戶的報價單不會顯示公司地址',
                        'Uncheck to leave the company address off the customer quotation.',
                      )}
                    >
                      <Checkbox
                        checked={companyInfo.showAddressInPdf}
                        onCheckedChange={(checked) =>
                          setCompanyInfo((p) => ({
                            ...p,
                            showAddressInPdf: checked === true,
                          }))
                        }
                        className="border-foreground/60 data-[state=checked]:border-primary"
                      />
                      <span className="whitespace-nowrap font-body text-[11px] text-muted-foreground">
                        {ui('是否顯示', 'Show in PDF')}
                      </span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('電話', 'Phone')}
                  </label>
                  <input
                    type="text"
                    value={companyInfo.phone}
                    onChange={(e) =>
                      setCompanyInfo((p) => ({ ...p, phone: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('電郵', 'Email')}
                  </label>
                  <input
                    type="email"
                    value={companyInfo.email}
                    onChange={(e) =>
                      setCompanyInfo((p) => ({ ...p, email: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('網站', 'Website')}
                  </label>
                  <input
                    type="text"
                    value={companyInfo.website}
                    onChange={(e) =>
                      setCompanyInfo((p) => ({
                        ...p,
                        website: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </InfoPanelColumn>

              <InfoPanelColumn
                english={quoteLocale === 'en'}
                title={ui('客戶資訊', 'Customer Information')}
                icon={<UserRound className="h-4 w-4" />}
                iconClassName="bg-emerald-50 text-emerald-700"
                collapsed={collapseClient}
                onToggle={() => setCollapseClient((v) => !v)}
                summary={
                  <>
                    <LabelValueRow label={ui('公司名稱', 'Company Name')}>{clientInfo.name || "—"}</LabelValueRow>
                    <LabelValueRow label={ui('客戶名稱', 'Contact Name')}>{clientInfo.contactName || "—"}</LabelValueRow>
                    <LabelValueRow label={ui('電話', 'Phone')}>{clientInfo.phone || "—"}</LabelValueRow>
                    <LabelValueRow label={ui('電郵', 'Email')}>{clientInfo.email || "—"}</LabelValueRow>
                  </>
                }
              >
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('公司名稱', 'Company Name')}
                  </label>
                  <input
                    type="text"
                    value={clientInfo.name}
                    onChange={(e) =>
                      setClientInfo((p) => ({ ...p, name: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('客戶名稱', 'Contact Name')}
                  </label>
                  <input
                    type="text"
                    value={clientInfo.contactName}
                    onChange={(e) =>
                      setClientInfo((p) => ({
                        ...p,
                        contactName: e.target.value,
                      }))
                    }
                    placeholder={ui('聯絡人姓名', 'Contact name')}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('電話', 'Phone')}
                  </label>
                  <input
                    type="text"
                    value={clientInfo.phone}
                    onChange={(e) =>
                      setClientInfo((p) => ({ ...p, phone: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {ui('電郵', 'Email')}
                  </label>
                  <input
                    type="email"
                    value={clientInfo.email}
                    onChange={(e) =>
                      setClientInfo((p) => ({ ...p, email: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </InfoPanelColumn>

              <InfoPanelColumn
                english={quoteLocale === 'en'}
                title={t.quoteInfo}
                icon={<FileText className="h-4 w-4" />}
                iconClassName="bg-violet-50 text-violet-700"
                collapsed={collapseQuoteMeta}
                onToggle={() => setCollapseQuoteMeta((v) => !v)}
                summary={
                  <>
                    <LabelValueRow label={t.quoteNo}>{quoteId || "—"}</LabelValueRow>
                    <LabelValueRow label={t.pic}>{quoteMeta.pmName || "—"}</LabelValueRow>
                    <LabelValueRow label={t.quoteDate}>{quoteMeta.date || "—"}</LabelValueRow>
                    <LabelValueRow label={t.validityDays}>{quoteMeta.validity || "—"}</LabelValueRow>
                    <LabelValueRow label={t.deliveryAddress}>
                      {quoteMeta.deliveryAddress || "—"}
                    </LabelValueRow>
                  </>
                }
              >
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {t.quoteNo}
                  </label>
                  <div className={cn(QUOTE_PANEL_CONTROL_CLASS, "truncate border-border/50 bg-muted/30 font-mono-data text-foreground/80")}>
                    {quoteId || "—"}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {t.pic}
                  </label>
                  <input
                    type="text"
                    value={quoteMeta.pmName}
                    onChange={(e) =>
                      setQuoteMeta((p) => ({ ...p, pmName: e.target.value }))
                    }
                    className={QUOTE_PANEL_CONTROL_CLASS}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {t.quoteDate}
                  </label>
                  <input
                    type="date"
                    value={quoteMeta.date}
                    onChange={(e) =>
                      setQuoteMeta((p) => ({
                        ...p,
                        date: e.target.value || todayQuoteDateIso(),
                      }))
                    }
                    className={cn(QUOTE_PANEL_CONTROL_CLASS, "font-mono-data")}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {t.validityDays}
                  </label>
                  <input
                    type="number"
                    value={quoteMeta.validity}
                    onChange={(e) =>
                      setQuoteMeta((p) => ({
                        ...p,
                        validity: e.target.value,
                      }))
                    }
                    className={cn(QUOTE_PANEL_CONTROL_CLASS, "font-mono-data")}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    {t.deliveryAddress}
                  </label>
                  <textarea
                    value={quoteMeta.deliveryAddress}
                    onChange={(e) => {
                      const deliveryAddress = e.target.value;
                      setQuoteMeta((p) => ({
                        ...p,
                        deliveryAddress,
                      }));
                      setTermsContent((prev) => ({
                        ...prev,
                        fullHtml: injectDeliveryAddressIntoTermsHtml(
                          prev.fullHtml,
                          deliveryAddress,
                        ),
                      }));
                    }}
                    placeholder={t.deliveryAddressPlaceholder}
                    rows={3}
                    className="min-h-[4.75rem] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </InfoPanelColumn>

              <InfoPanelColumn
                english={quoteLocale === 'en'}
                title={ui('專案分類與需求', 'Project Categories & Requirements')}
                icon={<FolderKanban className="h-4 w-4" />}
                iconClassName="bg-amber-50 text-amber-700"
                collapsed={collapseProject}
                onToggle={() => setCollapseProject((v) => !v)}
                summary={
                  <>
                    <LabelValueRow label={ui('客戶產業', 'Client Industry')}>
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        {formData.clientIndustry.length === 0
                          ? "—"
                          : formData.clientIndustry.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                              >
                                {tag}
                              </span>
                            ))}
                      </span>
                    </LabelValueRow>
                    <LabelValueRow label={ui('辦公室傢俬級別', 'Furniture Grade')}>
                      {formData.quotationType.length === 0
                        ? "—"
                        : formData.quotationType.join("、")}
                    </LabelValueRow>
                    <LabelValueRow label={ui('辦公室傢俬類別', 'Furniture Categories')}>
                      {formData.serviceScope.length === 0
                        ? "—"
                        : formData.serviceScope.join("、")}
                    </LabelValueRow>
                    <LabelValueRow label={ui('工期需求', 'Lead Time')}>{formData.workPeriod || '—'}</LabelValueRow>
                    <LabelValueRow label={ui('專案備註', 'Project Remarks')}>{formData.remarks || '—'}</LabelValueRow>
                  </>
                }
              >
                <QuoteMultiChoice
                  english={quoteLocale === 'en'}
                  label={ui('客戶產業', 'Client Industry')}
                  values={formData.clientIndustry}
                  options={industryOptions}
                  onChange={(clientIndustry) => onFormDataChange({ clientIndustry })}
                />
                <QuoteFieldBlock label={ui('辦公室傢俬級別', 'Furniture Grade')}>
                  <Input
                    key={formData.quotationType.join('、')}
                    aria-label={ui('辦公室傢俬級別', 'Furniture Grade')}
                    defaultValue={formData.quotationType.join('、')}
                    placeholder="以頓號分隔；未指定可留空"
                    onBlur={(e) => onFormDataChange({ quotationType: [...new Set(e.target.value.split(/[、,，]/).map((value) => value.trim()).filter(Boolean))] })}
                    className={QUOTE_PANEL_CONTROL_CLASS}
                  />
                </QuoteFieldBlock>
                <QuoteMultiChoice
                  english={quoteLocale === 'en'}
                  label={ui('辦公室傢俬類別', 'Furniture Categories')}
                  values={formData.serviceScope}
                  options={serviceScopeOptions}
                  onChange={(serviceScope) => onFormDataChange({ serviceScope })}
                />
                <QuoteFieldBlock label={ui('工期需求', 'Lead Time')}>
                  <Select
                    value={formData.workPeriod || '__none__'}
                    onValueChange={(value) => onFormDataChange({ workPeriod: value === '__none__' ? '' : value })}
                  >
                    <SelectTrigger aria-label={ui('工期需求', 'Lead Time')} className={cn(QUOTE_PANEL_CONTROL_CLASS, "focus:ring-1")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">未指定</SelectItem>
                      {[...new Set([...workPeriodOptions, formData.workPeriod].filter(Boolean))].map((period) => (
                        <SelectItem key={period} value={period}>{period}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </QuoteFieldBlock>
                <QuoteFieldBlock label={ui('專案備註', 'Project Remarks')}>
                  <Textarea
                    aria-label={ui('專案備註', 'Project Remarks')}
                    value={formData.remarks}
                    onChange={(e) => onFormDataChange({ remarks: e.target.value })}
                    rows={3}
                    className="min-h-[4.75rem] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground shadow-none placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 md:text-xs"
                  />
                </QuoteFieldBlock>
              </InfoPanelColumn>
            </div>
            </section>

              <section id="quote-sec-content" className="order-3 scroll-mt-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
                <div className="mb-4 flex flex-col items-stretch gap-3 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-between">
                  <div>
                    <h2 className="font-display text-base font-bold text-foreground">
                      {t.quoteContent}
                    </h2>
                    <p className="mt-1 font-body text-sm text-muted-foreground">
                      {ui('新增或編輯產品項目、增值服務等，支援圖片、材料及詳細規格。上傳平面圖後會自動識別分區，也可在分區管理裡調整。', 'Add or edit products and services, including images, materials and specifications. Uploading a floor plan detects zones automatically. Adjust them in Manage zones.')}
                    </p>
                  </div>
                  <QuoteAddRowButtonGroup
                    labels={t}
                    showPaste={cutItemId != null}
                    onUploadZoneImage={() => openZoneImageUpload(zoneTitleIdBefore(items, 0))}
                    onPaste={() => {

                      pasteCutItemAt(0);
                    }}
                    onCopyFromOther={() => setShowCopyFromOther(true)}
                    onAddSectionTitle={() => {
                      addSectionTitle(0);
                    }}
                    onAddField={() => {
                      addItem(0);
                    }}
                    onAddCustomTerm={() => {
                      addCustomTerm(0);
                    }}
                    onAddProduct={() => {
                      openProductSelector(0);
                    }}
                  />
                </div>
                <p className="mb-4 border-b border-border/80 pb-3 text-xs text-muted-foreground">
                  {quoteContentLoading
                    ? ui('正在載入報價項目…', 'Loading quotation items…')
                    : itemsLoadFailed && existingQuote?.quoteUuid
                      ? ui('報價明細載入失敗，以下可能不是完整內容。', 'Items failed to load, so the list below may be incomplete.')
                      : <>{ui('產品項目', 'Products')} {productCount} · {ui('增值服務', 'Services')} {serviceCount} · {ui('備註標題', 'Titles')} {titleCount}{ui('；依報價單順序排列，可拖曳或上下移動調整位置。', '; drag or use the arrows to reorder items as they appear in the quotation.')}</>}
                </p>
                {itemsLoadFailed && existingQuote?.quoteUuid && items.length > 0 ? (
                  <div
                    role="alert"
                    className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-xs text-rose-700"
                  >
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {ui('報價明細未完整載入，已暫停保存及送出，以免漏掉項目。', 'Items did not fully load. Saving and sending are paused so no items are lost.')}
                    </span>
                    <button
                      type="button"
                      onClick={retryQuoteItemsLoad}
                      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-rose-300 bg-white px-2 font-body text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100"
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                      {ui('重新載入明細', 'Reload items')}
                    </button>
                  </div>
                ) : null}
                <input
                  ref={floorPlanInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleFloorPlanFile(file);
                  }}
                />
                <div
                  className="space-y-3"
                  onDragOver={(e) => {
                    // Keep pointer Y fresh over gaps between rows (add-row strips).
                    if (isQuoteRowDragActive()) {
                      e.preventDefault();
                      trackQuoteDragPointer(e.clientY);
                    }
                  }}
                  onDragLeave={(e) => {
                    // Only clear the insert marker — keep draggingItemId so edge
                    // auto-scroll still runs when the pointer leaves the list
                    // (e.g. into the top/bottom scroll bands over chrome).
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setQuoteDropInsertIndex(null);
                    }
                  }}
                >
                  {items.length > 0 || !(zoneImages[UNZONED_QUOTE_IMAGE_KEY]?.length || zonePhotoLayouts[UNZONED_QUOTE_IMAGE_KEY]?.length)
                    ? null
                    : renderZonePhotoTail(UNZONED_QUOTE_IMAGE_KEY)}
                  {items.length > 0 ? null : quoteContentLoading ? (
                    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <p className="font-body text-sm text-muted-foreground">
                        {ui('正在載入報價內容…', 'Loading quotation contents…')}
                      </p>
                    </div>
                  ) : itemsLoadFailed && existingQuote?.quoteUuid ? (
                    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-center">
                      <AlertTriangle className="mx-auto h-5 w-5 text-rose-500" />
                      <p className="mt-2 font-body text-sm font-medium text-rose-700">
                        {ui('報價明細未能載入', 'Could not load quotation items')}
                      </p>
                      <p className="mx-auto mt-1 max-w-md font-body text-xs text-rose-600">
                        {ui(
                          '為免保存時漏掉項目，已暫停保存及送出。請先重新載入；如果仍然失敗，請重新整理頁面。',
                          'Saving and sending are paused so no items are lost. Reload the items; if it still fails, refresh the page.',
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={retryQuoteItemsLoad}
                        className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-3 font-body text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
                      >
                        <RefreshCw className="h-4 w-4 shrink-0" />
                        {ui('重新載入明細', 'Reload items')}
                      </button>
                    </div>
                  ) : (
                    <p className="py-8 text-center font-body text-sm text-muted-foreground">
                      尚未加入報價項目
                    </p>
                  )}
                  {items[0]?.isSectionTitle ? renderZonePhotoTail(UNZONED_QUOTE_IMAGE_KEY) : null}
                  {items.map((item, index) => {
                    const zonePrefix = zoneItemPrefixAt(items, index);
                    return (
                    <div key={item.id} className="space-y-3">
                      {item.isSectionTitle ? (
                        <>
                        <QuoteSectionTitleCard
                          item={item}
                          index={index}
                          items={items}
                          itemCount={zoneItemCountAt(items, index)}
                          onAddItemAbove={() => {
                            addItem(index + 1);
                          }}
                          onAddItemBelow={() => {
                            addItem(zoneEndInsertAt(items, index));
                          }}
                          draggingItemId={draggingItemId}
                          dropInsertIndex={dropInsertIndex}
                          cutItemId={cutItemId}
                          onDragOver={handleQuoteRowDragOver}
                          onDrop={handleQuoteRowDrop}
                          onDragStart={setQuoteDraggingItemId}
                          onDragEnd={clearQuoteRowDrag}
                          updateItem={updateItem}
                          cutItem={cutItem}
                          duplicateItem={duplicateItem}
                          removeItem={removeItem}
                          labels={t}
                          onMoveUp={() => nudgeItem(item.id, -1)}
                          onMoveDown={() => nudgeItem(item.id, 1)}
                          canMoveUp={canNudge(index, -1)}
                          canMoveDown={canNudge(index, 1)}
                          onGenerateZoneRender={() => void generateZoneRender(item.id)}
                          zoneRenderBusy={renderingZoneIds.has(item.id)}
                          zoneRenderStore={zoneRenderStore}
                          zoneRenderDisabled={zoneRecognitionActive}
                          onUploadZoneImage={() => openZoneImageUpload(item.id)}
                          onRemoveZoneImage={(url) => removeZoneImage(item.id, url)}
                          onPreviewZoneImage={(imageIndex) =>
                            setZoneLightbox({ urls: zoneImages[item.id] || [], index: imageIndex })
                          }
                        />
                        </>
                      ) : item.isCustomTerm ? (
                        <QuoteCustomTermCard
                          item={item}
                          index={index}
                          serialNumber={productSerialAt(items, index)}
                          zonePrefix={zonePrefix}
                          draggingItemId={draggingItemId}
                          dropInsertIndex={dropInsertIndex}
                          cutItemId={cutItemId}
                          onDragOver={handleQuoteRowDragOver}
                          onDrop={handleQuoteRowDrop}
                          onDragStart={setQuoteDraggingItemId}
                          onDragEnd={clearQuoteRowDrag}
                          updateItem={updateItem}
                          cutItem={cutItem}
                          duplicateItem={duplicateItem}
                          removeItem={removeItem}
                          labels={t}
                          onMoveUp={() => nudgeItem(item.id, -1)}
                          onMoveDown={() => nudgeItem(item.id, 1)}
                          canMoveUp={canNudge(index, -1)}
                          canMoveDown={canNudge(index, 1)}
                          zoneTitleId={zoneTitleIdAt(items, index)}
                          zoneOptions={zoneOptions}
                          onAssignZone={(value) => assignItemToZone(item.id, value)}
                        />
                      ) : (
                        <QuoteProductItemCard
                          item={item}
                          index={index}
                          serialNumber={productSerialAt(items, index)}
                          zonePrefix={zonePrefix}
                          aiChoices={quoteAiChoices}
                          photoZones={quotePhotoZones}
                          zoneRegionCount={items.find(row => row.id === zoneTitleIdAt(items, index))?.quantity ?? 0}
                          placementField={hasFloorPlanPreview ? <ProductPlacementPicker positions={floorPlan?.placements?.positions[zoneTitleIdAt(items, index) || ''] || []} values={floorPlan?.placements?.assignments[item.id] || []} quantity={item.quantity} canSelect={Boolean(floorPlan && floorPlan.regions.some(r => r.zoneId === zoneTitleIdAt(items, index)))} unavailableReason={!zoneTitleIdAt(items, index) ? 'no-zone' : 'no-region'} onManageZones={openZoneManager} onRequestZone={() => flashZoneSelect(item.id)} onChange={(positionIndex, positionId) => { const zoneId = zoneTitleIdAt(items, index); if (zoneId) setProductPlacement(zoneId, item.id, positionIndex, positionId); }} onPickOnPlan={positionIndex => { const zoneId = zoneTitleIdAt(items, index); if (!zoneId) return; setPickingPlacement({ zoneId, itemId: item.id, index: positionIndex }); }} /> : null}
                          draggingItemId={draggingItemId}
                          dropInsertIndex={dropInsertIndex}
                          cutItemId={cutItemId}
                          onDragOver={handleQuoteRowDragOver}
                          onDrop={handleQuoteRowDrop}
                          onDragStart={setQuoteDraggingItemId}
                          onDragEnd={clearQuoteRowDrag}
                          updateItem={updateItem}
                          updateExchangeRate={updateExchangeRate}
                          updateDimensionMode={updateDimensionMode}
                          cutItem={cutItem}
                          duplicateItem={duplicateItem}
                          removeItem={removeItem}
                          onOpenProductLink={openQuoteItemProductLink}
                          onRegistryLevel1Change={onRegistryLevel1Change}
                          onRegistryLevel2Change={onRegistryLevel2Change}
                          categoryPairs={categoryPairs}
                          categoryPairsLoading={categoryPairsLoading}
                          factories={factories}
                          factoriesLoading={factoriesLoading}
                          quoteImageScope={quoteImageScope}
                          labels={t}
                          onMoveUp={() => nudgeItem(item.id, -1)}
                          onMoveDown={() => nudgeItem(item.id, 1)}
                          canMoveUp={canNudge(index, -1)}
                          canMoveDown={canNudge(index, 1)}
                          zoneTitleId={zoneTitleIdAt(items, index)}
                          zoneOptions={zoneOptions}
                          zoneHighlight={zoneHintItemId === item.id}
                          onAssignZone={(value) => {
                            setZoneHintItemId(null);
                            assignItemToZone(item.id, value);
                          }}
                        />
                      )}
                      <QuoteAddRowButtonGroup
                        labels={t}
                        compact
                        showPaste={cutItemId != null}
                        onPaste={() => {

                          pasteCutItemAt(index + 1);
                        }}
                        onCopyFromOther={() => setShowCopyFromOther(true)}
                        onAddSectionTitle={() => {
                          addSectionTitle(index + 1);
                        }}
                        onAddField={() => {
                          addItem(index + 1);
                        }}
                        onAddCustomTerm={() => {
                          addCustomTerm(index + 1);
                        }}
                        onAddProduct={() => {
                          openProductSelector(index + 1);
                        }}
                        onUploadZoneImage={() =>
                          openZoneImageUpload(
                            item.isSectionTitle ? item.id : zoneTitleIdBefore(items, index + 1),
                          )
                        }
                      />
                      {index === items.length - 1 || items[index + 1]?.isSectionTitle
                        ? renderZonePhotoTail(
                            item.isSectionTitle
                              ? item.id
                              : (zoneTitleIdAt(items, index) ?? UNZONED_QUOTE_IMAGE_KEY),
                          )
                        : null}
                    </div>
                    );
                  })}
                </div>

              </section>

              {/* 訂單確認及交付細節 / Order Confirmation and Delivery Details */}
              <section id="quote-sec-fees" className="order-4 scroll-mt-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
                <h2 className="font-display text-base font-bold text-foreground">{t.feesAndTotal}</h2>
                <p className="mb-3 mt-1 font-body text-sm text-muted-foreground">
                  合約金額、成本、運費、安裝、折扣與合計在「報價摘要」，與這裡同一組數字。
                </p>
                {costMismatches.length > 0 ? (
                  <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 sm:p-4">
                    <p className="flex items-start gap-2 font-body text-sm font-semibold text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        {ui(
                          `${costMismatches.length} 行 HKD 成本與「¥成本 × 匯率」不一致`,
                          `${costMismatches.length} line(s) have an HKD cost that differs from CNY cost × rate`,
                        )}
                      </span>
                    </p>
                    <p className="mt-1 font-body text-xs leading-relaxed text-amber-800/80">
                      {ui(
                        'Cost / GP 以 HKD 成本為準。若 HKD 成本是刻意輸入（廠家直接報 HKD），可保留；若是舊值，請按下方按鈕重算。',
                        'Cost / GP uses the HKD cost. Keep it if it was entered deliberately (e.g. the factory quoted in HKD); otherwise recalculate below.',
                      )}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {costMismatches.map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-body text-xs text-amber-900"
                        >
                          <span className="min-w-0 truncate">{row.label}</span>
                          <span className="font-mono-data tabular-nums">
                            HK${Math.round(row.hkdCostPrice).toLocaleString()}
                            <span className="ml-1 text-amber-800/70">
                              （¥{row.costPrice} × {row.exchangeRate} = {Math.ceil(row.derivedHkdCost)}）
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={summaryLocked}
                      onClick={realignMismatchedCosts}
                      className="mt-2 h-8 px-2 font-body text-xs font-medium text-amber-800 hover:bg-amber-500/15"
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      {ui('按「¥成本 × 匯率」重算這些行', 'Recalculate these lines from CNY cost × rate')}
                    </Button>
                  </div>
                ) : null}
                <div className="quote-fee-editor mb-5">
                  <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="min-w-0 truncate font-display text-base font-bold text-foreground">報價摘要</h2>
                      <label
                        htmlFor="quote-summary-editing"
                        className="flex shrink-0 cursor-pointer select-none items-center gap-2 whitespace-nowrap font-body text-xs text-muted-foreground"
                      >
                        <span>編輯模式</span>
                        <Switch
                          id="quote-summary-editing"
                          checked={summaryEditing}
                          onCheckedChange={setSummaryEditing}
                          aria-label="切換報價摘要編輯模式"
                        />
                      </label>
                    </div>
                    <div className="quote-fee-body text-sm">
                      {/* 左：報價帳目流（方案 B） */}
                      <div className="quote-fee-ledger">
                        <div className="quote-lrow">
                          <span className="quote-lrow-op" aria-hidden="true">·</span>
                          <span className="quote-lrow-label">
                            <Wallet className="h-3.5 w-3.5" /> Contract Sum 合約金額
                          </span>
                          <span className="quote-lrow-value font-mono-data">HKD ${totalAmount.toLocaleString()}</span>
                        </div>
                        <label className="quote-lrow">
                          <span className="quote-lrow-op" aria-hidden="true">＋</span>
                          <span className="quote-lrow-label">
                            <Truck className="h-3.5 w-3.5" /> Ship 運費
                          </span>
                          <input
                            type="number"
                            min={0}
                            readOnly={summaryLocked}
                            value={gpSummary.ship || ""}
                            placeholder="0"
                            onChange={(e) =>
                              setGpSummary((prev) => ({
                                ...prev,
                                ship: e.target.value === "" ? 0 : Math.max(0, parseFloat(e.target.value) || 0),
                              }))
                            }
                            className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-right font-mono-data text-xs read-only:bg-muted/40"
                          />
                        </label>
                        <label className="quote-lrow">
                          <span className="quote-lrow-op" aria-hidden="true">＋</span>
                          <span className="quote-lrow-label">Installation 安裝費</span>
                          <input
                            type="number"
                            min={0}
                            readOnly={summaryLocked}
                            value={gpSummary.installation || ""}
                            placeholder="0"
                            onChange={(e) =>
                              setGpSummary((prev) => ({
                                ...prev,
                                installation: e.target.value === "" ? 0 : Math.max(0, parseFloat(e.target.value) || 0),
                              }))
                            }
                            className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-right font-mono-data text-xs read-only:bg-muted/40"
                          />
                        </label>
                        <label className="quote-lrow">
                          <span className="quote-lrow-op" aria-hidden="true">－</span>
                          <span className="quote-lrow-label">
                            <Percent className="h-3.5 w-3.5" /> Discount 折扣
                          </span>
                          <input
                            type="number"
                            readOnly={summaryLocked}
                            value={discountNote}
                            onChange={(e) => setDiscountNote(e.target.value)}
                            placeholder="0"
                            className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-right font-mono-data text-xs read-only:bg-muted/40"
                          />
                        </label>
                        <div className="quote-lrow quote-lrow-sum">
                          <span className="quote-lrow-op" aria-hidden="true">＝</span>
                          <span className="quote-lrow-label quote-sum-label">
                            <Wallet className="h-4 w-4" /> {t.grandTotal}
                          </span>
                          <span className="quote-sum-value font-mono-data">
                            <small>HKD</small>${totalAmount.toLocaleString()}
                          </span>
                        </div>
                        {/* 成本與毛利：放在合計下面並排，兩欄對齊 */}
                        <div className="quote-fee-split">
                          <CostBreakdownHoverCard
                            lines={costBreakdown}
                            unpricedCount={costBreakdownUnpricedCount}
                            total={totalProductCost}
                            english={quoteLocale === 'en'}
                          >
                            <div
                              className="quote-fee-split-sec cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              tabIndex={0}
                              aria-label={ui(
                                `成本 $${totalProductCost.toLocaleString()}，查看每項成本`,
                                `Cost $${totalProductCost.toLocaleString()} — view per-item cost`,
                              )}
                            >
                              <span className="quote-lrow-label">
                                <Wallet className="h-3.5 w-3.5" /> Cost 成本
                              </span>
                              <div className="quote-side-big font-mono-data">HKD ${totalProductCost.toLocaleString()}</div>
                            </div>
                          </CostBreakdownHoverCard>
                          <div className="quote-fee-split-sec">
                            <span className="quote-lrow-label">GP 毛利</span>
                            <div className="quote-side-big font-mono-data text-emerald-700">
                              HKD ${gpValue.toLocaleString()}
                              <span className="quote-gp-pct">（{Math.round(gpPercent)}%）</span>
                            </div>
                            <div className="quote-gp-bar" role="img" aria-label={`GP ${Math.round(gpPercent)}%`}>
                              <i style={{ width: `${Math.min(100, Math.max(0, gpPercent))}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* 右：結果欄 — 安裝費與單價換算 */}
                      <aside className="quote-fee-side">
                        <div className="quote-fee-note">
                          <input
                            type="text"
                            readOnly={summaryLocked}
                            value={installationFee.title}
                            onChange={(e) =>
                              setInstallationFee((prev) => ({ ...prev, title: e.target.value }))
                            }
                            className="w-full bg-transparent text-sm font-medium text-foreground focus:outline-none read-only:text-muted-foreground"
                          />
                          <input
                            type="text"
                            readOnly={summaryLocked}
                            value={installationFee.subtitle}
                            onChange={(e) =>
                              setInstallationFee((prev) => ({ ...prev, subtitle: e.target.value }))
                            }
                            className="mt-1 w-full bg-transparent text-xs text-muted-foreground focus:outline-none"
                          />
                          <textarea
                            readOnly={summaryLocked}
                            value={installationFee.conditionText}
                            onChange={(e) =>
                              setInstallationFee((prev) => ({ ...prev, conditionText: e.target.value }))
                            }
                            rows={2}
                            className="mt-2 w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1 text-center text-xs text-muted-foreground focus:outline-none read-only:border-transparent read-only:bg-transparent"
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {installationFee.freeLabel || "—"}
                            </span>
                            {isFreeInstallation ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                FREE
                              </span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                readOnly={summaryLocked}
                                value={installationFee.amount ?? ""}
                                placeholder={installationFee.freeLabel || "另議"}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setInstallationFee((prev) => ({
                                    ...prev,
                                    amount: raw === "" ? null : Math.max(0, parseFloat(raw) || 0),
                                  }));
                                }}
                                className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-right font-mono-data text-xs read-only:bg-muted/40"
                              />
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-indigo-700">
                            {t.priceMultiplier}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              readOnly={summaryLocked}
                              value={priceMultiplier}
                              onChange={(e) => setPriceMultiplier(e.target.value)}
                              className="h-8 w-20 rounded-lg border border-border bg-background px-2 text-center font-mono-data text-xs read-only:bg-muted/40"
                            />
                            <button
                              type="button"
                              disabled={summaryLocked}
                              onClick={applyPriceMultiplier}
                              className="h-8 rounded-lg bg-indigo-600 px-3 font-body text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              {t.apply}
                            </button>
                          </div>
                        </div>
                      </aside>
                    </div>
                  </div>
                </div>
                <h3 className="mb-2 font-display text-sm font-bold text-foreground/80">
                  {t.deliverySection}
                </h3>
                <textarea
                  value={
                    quoteLocale === 'en' ? deliveryDetailsEn : deliveryDetails
                  }
                  onChange={(e) => {
                    if (quoteLocale === 'en') {
                      setDeliveryDetailsEn(e.target.value);
                      return;
                    }
                    setDeliveryDetails(e.target.value);
                  }}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </section>

              {/* 報價單圖片 / QUOTATION IMAGES */}
              <section id="quote-sec-photos" className="order-5 scroll-mt-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
                <h2 className="mb-3 font-display text-base font-bold text-foreground">{t.quotePhotos}</h2>
                <QuotePhotoPages
                  layouts={quotePhotoLayouts}
                  assets={quotePhotoAssets}
                  productPhotos={quoteProductPhotos}
                  photoZones={quotePhotoZones}
                  canManage={canManagePhotos}
                  onChange={(groups, usedAssets) => {
                    setQuotePhotoLayouts(groups);
                    setQuotePhotoAssets(usedAssets);
                  }}
                />

                {/* 圖冊附件：放在報價單圖片下面（附件頁會接在封底之前） */}
                <div className="mt-5 border-t border-border/80 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {ui('圖冊附件', 'Catalog pages')}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {catalogPages.length > 0
                            ? ui(`${catalogPages.length} 項，會加在封底之前`, `${catalogPages.length} items, added before the back cover`)
                            : ui('可選不同圖冊的整頁；跨頁圖冊會拆成左半／右半', 'Whole pages from one or more catalogs; spreads are split into left/right')}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCatalogDialogOpen(true)}
                      className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
                    >
                      {ui('選擇頁面', 'Choose pages')}
                    </button>
                  </div>
                </div>
              </section>

              {/* 條款及付款 / TERMS AND CONDITIONS */}
              <section id="quote-sec-terms" className="order-6 scroll-mt-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-foreground">
                    {t.termsSection}
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      termsEditMode ? finishTermsEdit() : setTermsEditMode(true)
                    }
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 font-body text-xs font-medium transition-colors",
                      termsEditMode
                        ? "border-transparent bg-primary/10 text-primary hover:bg-primary/20"
                        : "border-border text-foreground/60 hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {termsEditMode ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        {t.doneEditTerms}
                      </>
                    ) : (
                      <>
                        <Pencil className="h-3.5 w-3.5" />
                        {t.editTerms}
                      </>
                    )}
                  </button>
                </div>

                {quoteLocale === 'en' ? (
                  <TermsRichEditor
                    key="terms-en"
                    value={termsContentEn.fullHtml || ''}
                    onChange={(html) => {
                      setTermsContentEn((prev) => ({ ...prev, fullHtml: html }));
                      const deliveryAddress =
                        extractDeliveryAddressFromTermsHtml(html);
                      setQuoteMeta((prev) =>
                        prev.deliveryAddress === deliveryAddress
                          ? prev
                          : { ...prev, deliveryAddress },
                      );
                    }}
                    editable={termsEditMode}
                  />
                ) : (
                <TermsRichEditor
                  key="terms-zh"
                  value={termsContent.fullHtml}
                  onChange={(html) => {
                    setTermsContent((prev) => ({ ...prev, fullHtml: html }));
                    const deliveryAddress = extractDeliveryAddressFromTermsHtml(html);
                    setQuoteMeta((prev) =>
                      prev.deliveryAddress === deliveryAddress
                        ? prev
                        : { ...prev, deliveryAddress },
                    );
                  }}
                  editable={termsEditMode}
                />
                )}
                <div className="hidden space-y-4 font-body text-xs leading-relaxed text-foreground/80">
                  {/* 運輸及安裝條款 (legacy - kept for PDF compat) */}
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold text-foreground">
                      運輸及安裝條款
                    </h3>
                    {termsEditMode ? (
                      <textarea
                        value={termsContent.transport}
                        onChange={(e) =>
                          setTermsContent((prev) => ({
                            ...prev,
                            transport: e.target.value,
                          }))
                        }
                        rows={8}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
                      />
                    ) : (
                      <div className="space-y-1.5 pl-1 whitespace-pre-line">
                        {termsContent.transport}
                      </div>
                    )}
                  </div>

                  {/* 額外費用 */}
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold text-foreground">
                      額外費用
                    </h3>
                    {termsEditMode ? (
                      <textarea
                        value={termsContent.extraFees}
                        onChange={(e) =>
                          setTermsContent((prev) => ({
                            ...prev,
                            extraFees: e.target.value,
                          }))
                        }
                        rows={7}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
                      />
                    ) : (
                      <div className="space-y-1.5 pl-1 whitespace-pre-line">
                        {termsContent.extraFees}
                      </div>
                    )}
                  </div>

                  {/* 保養及維修 */}
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold text-foreground">
                      保養及維修
                    </h3>
                    {termsEditMode ? (
                      <textarea
                        value={termsContent.warranty}
                        onChange={(e) =>
                          setTermsContent((prev) => ({
                            ...prev,
                            warranty: e.target.value,
                          }))
                        }
                        rows={4}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
                      />
                    ) : (
                      <div className="space-y-1.5 pl-1 whitespace-pre-line">
                        {termsContent.warranty}
                      </div>
                    )}
                  </div>

                  {/* 其他 */}
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold text-foreground">
                      其他
                    </h3>
                    {termsEditMode ? (
                      <textarea
                        value={termsContent.other}
                        onChange={(e) =>
                          setTermsContent((prev) => ({
                            ...prev,
                            other: e.target.value,
                          }))
                        }
                        rows={10}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
                      />
                    ) : (
                      <div className="space-y-1.5 pl-1 whitespace-pre-line">
                        {termsContent.other}
                      </div>
                    )}
                  </div>

                  {/* 付款資料 */}
                  <div>
                    <h3 className="mb-2 font-display text-xs font-semibold text-foreground">
                      付款資料
                    </h3>
                    {termsEditMode ? (
                      <textarea
                        value={termsContent.payment}
                        onChange={(e) =>
                          setTermsContent((prev) => ({
                            ...prev,
                            payment: e.target.value,
                          }))
                        }
                        rows={8}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
                      />
                    ) : (
                      <div className="space-y-1.5 pl-1 whitespace-pre-line">
                        {termsContent.payment}
                      </div>
                    )}
                  </div>
                </div>
              </section>


            </div>


          </div>
        </div>
        </div>
      </div>
      </div>

      {/* Submit Review Modal */}
      <SubmitReviewModal
        open={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSuccess={(result) => {
          setShowSubmitModal(false);
          const submittedDraft = buildDraftData();
          baselineDraftRef.current = submittedDraft;
          baselineSnapshotRef.current = quoteDraftSnapshot(submittedDraft);
          setSnapshotReady(true);
          unsavedGuard.clear();
          deleteDraft(storageKey).catch(() => {});
          deleteDraft(makeDraftKey(userEmail, result.quoteId)).catch(() => {});
          // Submitted snapshot is now in Supabase — do not let IndexedDB override on reopen.
          clearUseLocalQuoteDraft(userEmail);
          // Keep session pinned to the submitted quote so refresh reopens it (not empty NEW).
          writeQuickQuoteEditingId(userEmail, result.quoteId);
          writeQuickQuoteCopyFrom(userEmail, null);
          writeResumeQuote(userEmail, {
            quoteId: result.quoteId,
            quoteUuid: result.quoteUuid,
          });
          itemsUserEditedRef.current = true;
          itemsHydratedForUuidRef.current = result.quoteUuid;
          onQuotePersisted?.(result);
        }}
        totalAmount={totalAmount}
        totalCostPrice={totalCostPrice}
        version={currentVersion}
        projectData={buildProjectData()}
        items={items.filter(hasQuoteItemContent)}
        bwfPitchingId={formData.pmsPitchingId || existingQuote?.bwfPitchingId || null}
        bwfProjectId={formData.pmsProjectId || existingQuote?.bwfProjectId || null}
        quoteId={pickQuoteChainId(
          submitChainIdRef.current,
          quoteId,
          existingQuote?.quoteId,
          formData.quoteId,
          formData.pitchingCode,
          formData.projectName,
          draftQuoteId,
        )}
        pitchingCode={pickQuoteChainId(
          submitChainIdRef.current,
          quoteId,
          existingQuote?.quoteId,
          formData.quoteId,
          formData.pitchingCode,
          formData.projectName,
          draftQuoteId,
        )}
        existingQuoteId={pickQuoteChainId(
          existingQuote?.quoteId,
          submitChainIdRef.current,
          quoteId,
          draftQuoteId,
        )}
        existingQuoteUuid={existingQuote?.quoteUuid ?? null}
        forceNewQuote={forceNewQuote}
      />

      {/* 統一匯率 Modal */}
      <Modal
        open={unifyRateModalOpen}
        onOpenChange={(open) => {
          setUnifyRateModalOpen(open);
          if (!open) {
            setUnifyRateDraft("");
            setUnifyRateAuto(false);
          }
        }}
        size="sm"
        icon={<Percent className="h-5 w-5" />}
        title={t.unifyExchangeRate}
        footer={
          <>
            <ModalButton
              variant="secondary"
              onClick={() => {
                setUnifyRateModalOpen(false);
                setUnifyRateDraft("");
              }}
            >
              {t.cancel}
            </ModalButton>
            <ModalButton
              onClick={() => {
                if (applyUnifiedExchangeRate(unifyRateDraft)) {
                  setUnifyRateModalOpen(false);
                  setUnifyRateDraft("");
                }
              }}
            >
              {t.confirm}
            </ModalButton>
          </>
        }
      >
        <div className="space-y-2.5">
          <label
            htmlFor="unify-exchange-rate-input"
            className="block font-body text-sm font-medium text-foreground"
          >
            {t.exchangeRate}
            <span className="ml-1 font-normal text-muted-foreground">CNY¥ → HKD$</span>
          </label>
          <input
            id="unify-exchange-rate-input"
            type="text"
            inputMode="decimal"
            autoFocus
            value={unifyRateDraft}
            onChange={(e) => {
              setUnifyRateDraft(sanitizeExchangeRateInput(e.target.value));
              setUnifyRateAuto(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (applyUnifiedExchangeRate(unifyRateDraft)) {
                setUnifyRateModalOpen(false);
                setUnifyRateDraft("");
              }
            }}
            placeholder="0.92"
            className="h-11 w-full rounded-xl border border-input bg-background px-3 font-mono-data text-base text-foreground focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
          />
          <p className="font-body text-xs text-muted-foreground">
            {unifyRateLoadingToday
              ? t.unifyRateTodayLoading
              : unifyRateAuto
                ? t.unifyRateTodayLoaded
                : t.unifyRateScope.replace("{n}", String(productCount))}
          </p>
        </div>
      </Modal>

      <CopyQuoteItemsModal
        open={showCopyFromOther}
        onClose={() => setShowCopyFromOther(false)}
        onAddItems={insertCopiedItemsAtFront}
        labels={t}
      />

      {/* Product Selector Modal */}
      <ProductSelectorModal
        open={showProductSelector}
        onClose={() => {
          setShowProductSelector(false);
          setActiveItemId(null);
        }}
        onSelect={handleProductSelected}
        existingProductNames={[]}
        priorityLevel1Categories={formData.serviceScope}
        stockOnly={isUrgentWorkPeriod(formData.workPeriod)}
        categoryPairs={categoryPairs}
      />

      {quoteProductModal ? (
        <ProductDetailModal
          product={quoteProductModal.product}
          open
          mode={quoteProductModal.mode}
          activityStage="product_catalog"
          onClose={() => setQuoteProductModal(null)}
          onProductUpdated={(updated) => {
            itemsUserEditedRef.current = true;
            const itemId = quoteProductModal.itemId;
            const productCategoryId = resolveProductCategoryId(
              categoryPairs,
              updated.level1Category,
              updated.level2Category,
            );
            const pair = findProductCategoryPairById(
              categoryPairs,
              productCategoryId,
            );
            setItems((prev) =>
              prev.map((item) => {
                if (item.id !== itemId) return item;
                const registryLevel1 =
                  pair?.level1 ?? updated.level1Category ?? item.registryLevel1;
                const registryLevel2 =
                  pair?.level2 ?? updated.level2Category ?? item.registryLevel2;
                return {
                  ...item,
                  productId: updated.id,
                  sku: updated.sku?.trim() || item.sku,
                  productCategoryId,
                  registryLevel1,
                  registryLevel2,
                };
              }),
            );
            setQuoteProductModal(null);
            toast.success(
              quoteProductModal.mode === "create"
                ? "已建立產品並連結此報價列"
                : "已更新關聯產品",
            );
          }}
        />
      ) : null}

      <QuoteEmailFollowUpModal
        open={emailModalOpen && canShareQuote}
        quote={canShareQuote ? {
          id: shareQuoteUuid,
          quoteId: shareQuoteId || quoteId,
          clientEmail: clientInfo.email || null,
          clientName: clientInfo.name || null,
          contactPhone: companyInfo.phone || null,
          pitchingId: formData.pmsPitchingId || existingQuote?.bwfPitchingId || null,
        } : null}
        onOpenChange={setEmailModalOpen}
      />

      <Modal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        size="md"
        icon={<QrCode className="h-6 w-6" />}
        title={t.quoteShareLink}
        description="掃描 QR Code 或複製連結後，可免登入進入客戶專區查看此報價單，並瀏覽產品搜尋、傢俬訂製、付款+送貨、訂單狀況、成功案例、服務一覽、公司資料及聯絡我們等頁面（不含機構採購帳號）。"
        footer={
          <ModalButton
            variant="secondary"
            disabled={!shareUrl}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl);
                setShareCopied(true);
                toast.success("已複製連結");
              } catch {
                toast.error("複製失敗");
              }
            }}
          >
            {shareCopied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {shareCopied ? "已複製" : "複製連結"}
          </ModalButton>
        }
      >
            <div className="mb-4 flex justify-center rounded-xl border border-border bg-background p-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Quote share QR code"
                  width={220}
                  height={220}
                  className="h-[220px] w-[220px]"
                />
              ) : (
                <p className="text-sm text-muted-foreground" role="status">
                  {shareBusy ? "正在準備 QR Code…" : shareError || "保存報價後會自動準備 QR Code 及連結。"}
                </p>
              )}
            </div>
            <label className="mb-1 block font-body text-xs text-muted-foreground">
              網址連結
            </label>
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono-data text-[11px] text-foreground"
            />
      </Modal>

      {pickingPlacement && floorPlan ? <FurniturePlacementDialog key={`${pickingPlacement.itemId}:${pickingPlacement.index}`} plan={floorPlan} zoneId={pickingPlacement.zoneId} zoneName={items.find(i => i.id === pickingPlacement.zoneId)?.name || '分區'} productName={items.find(i => i.id === pickingPlacement.itemId)?.name || items.find(i => i.id === pickingPlacement.itemId)?.category || '傢俬'} productCategory={items.find(i => i.id === pickingPlacement.itemId)?.category} productSku={items.find(i => i.id === pickingPlacement.itemId)?.sku} productImage={items.find(i => i.id === pickingPlacement.itemId)?.image} quantity={items.find(i => i.id === pickingPlacement.itemId)?.quantity || 0} values={floorPlan.placements?.assignments[pickingPlacement.itemId]} occupiedIds={Object.entries(floorPlan.placements?.assignments || {}).filter(([id]) => id !== pickingPlacement.itemId).flatMap(([, ids]) => ids.filter(Boolean))} onClose={() => setPickingPlacement(null)} onSave={selections => {
        const target = pickingPlacement;
        const zone = layoutZones(itemsRef.current).find(z => z.id === target.zoneId);
        const product = zone?.products.find(p => p.id === target.itemId);
        if (zone && product && target.index < product.quantity) {
          setFloorPlan(current => {
            if (!current) return current;
            const existing = current.placements || { positions: {}, assignments: {} };
            let placements = { ...existing, assignments: { ...existing.assignments, [target.itemId]: [] as string[] } };
            const itemIds = zone.products.map(p => p.id);
            selections.forEach((selection, index) => {
              placements = selection.positionId ? assignFurniturePosition(placements, target.zoneId, itemIds, target.itemId, index, selection.positionId) : saveFurnitureSelection(placements, target.zoneId, itemIds, target.itemId, index, { ...selection, category: product.name || product.category || '傢俬', angle: null });
            });
            return { ...current, placements, rendering: { ...current.rendering, style: current.rendering?.style || DEFAULT_LAYOUT_STYLE, notes: { ...current.rendering?.notes, [target.zoneId]: current.rendering?.notes[target.zoneId] || '以報價產品資料中已確認的圈選位置、範圍及角度為準；未指定的項目位置未知。' }, images: {} } };
          });
        }
        setPickingPlacement(null);
      }} /> : null}
      <Modal
        open={!!zoneRenderPreview && zoneRenderVisible}
        onOpenChange={open => {
          if (open) return;
          setZoneRenderVisible(false);
          setZoneRenderPreview(null);
          setZoneRenderFeedback('');
        }}
        size="5xl"
        className="max-w-7xl"
        title="生成渲染圖"
        description={zoneRenderPreview?.zoneName}
        footer={zoneRenderPreview ? (
          <>
            <ModalButton variant="secondary" disabled={zoneRenderPreviewBusy} onClick={() => { setZoneRenderVisible(false); setZoneRenderPreview(null); setZoneRenderFeedback(''); }}>取消</ModalButton>
            {zoneRenderPreview.asset ? (
              <ModalButton variant="secondary" disabled={zoneRenderPreviewBusy} onClick={() => void regenerateZoneRender()}>
                {zoneRenderPreviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {zoneRenderPreviewBusy
                  ? (zoneRenderPreviewMeter ? `重新生成 ${Math.round(zoneRenderPreviewMeter.percent)}%` : '重新生成中…')
                  : '重新生成'}
              </ModalButton>
            ) : null}
            {zoneRenderPreview.asset ? <ModalButton disabled={zoneRenderPreviewBusy} onClick={confirmZoneRender}>確認匯入</ModalButton> : null}
          </>
        ) : undefined}
      >
        {zoneRenderPreview?.asset ? (
          <div className="space-y-3">
            {zoneRenderPreviewBusy ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="mb-1.5 text-sm font-medium">{zoneRenderAutoFixRound ? `對照發現差異，正在自動修正（第 ${zoneRenderAutoFixRound} 次）…` : '正在以上一版效果圖及你的意見重新生成…'}</p>
                <ZoneRenderProgressMeter progress={zoneRenderPreviewMeter} />
              </div>
            ) : null}
            {zoneRenderPreview.error ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{zoneRenderPreview.error}</p>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)]">
              <div className="grid gap-3 self-start sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium">分區平面圖{zoneRenderPreview.area && zoneRenderPreview.area.total > 1 ? `（第 ${zoneRenderPreview.area.index}／${zoneRenderPreview.area.total} 個區域）` : ''}</p>
                  <button
                    type="button"
                    disabled={!zoneRenderPreview.zoneImage}
                    aria-label="放大分區平面圖"
                    className="block w-full cursor-zoom-in rounded-lg disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={() => setZoneLightbox({ urls: [zoneRenderPreview.zoneImage], index: 0, title: '分區平面圖' })}
                  >
                    <LoadingImage src={zoneRenderPreview.zoneImage} alt="用於對照的分區平面圖" className="h-[min(50vh,500px)] w-full rounded-lg bg-muted" imgClassName="object-contain" />
                  </button>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">生成效果圖</p>
                  <button
                    type="button"
                    aria-label="放大生成效果圖"
                    className="block w-full cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={() => setZoneLightbox({ urls: zoneRenderPreview.previous ? [zoneRenderPreview.asset!.url, zoneRenderPreview.previous.url] : [zoneRenderPreview.asset!.url], index: 0, title: '生成效果圖' })}
                  >
                    <LoadingImage src={zoneRenderPreview.asset.url} alt={`${zoneRenderPreview.zoneName}渲染圖預覽`} className="h-[min(50vh,500px)] w-full rounded-lg bg-muted" imgClassName="object-contain" />
                  </button>
                  {zoneRenderPreview.previous ? (
                    <div className="mt-2 flex items-start gap-2">
                      <button type="button" className="shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border bg-muted"
                        aria-label="放大對比上一版效果圖"
                        onClick={() => setZoneLightbox({ urls: [zoneRenderPreview.previous!.url, zoneRenderPreview.asset!.url], index: 0, title: '上一版與新效果圖對比' })}>
                        <LoadingImage src={zoneRenderPreview.previous.url} alt="上一版效果圖" className="h-14 w-20" imgClassName="object-contain" />
                      </button>
                      <div className="min-w-0 text-xs text-muted-foreground">
                        <p className="font-medium">上一次生成的效果圖</p>
                        {zoneRenderPreview.previous.feedback ? <p className="mt-0.5 break-words">意見：{zoneRenderPreview.previous.feedback}</p> : <p className="mt-0.5">未填寫意見，只重新生成。</p>}
                        <p className="mt-0.5">點縮圖可與新圖放大對比。</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <aside className="rounded-lg border bg-muted/20 p-3 text-sm lg:flex lg:min-h-0 lg:flex-col lg:[contain:size]">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">AI 對照提示</p>
                  <span className="flex items-center gap-2">
                    {zoneRenderPreview.autoFixes ? <span className="text-[11px] text-muted-foreground">已自動修正 {zoneRenderPreview.autoFixes} 次</span> : null}
                    {(() => {
                      const status = zoneRenderReviewStatus(zoneRenderPreview.review);
                      return status ? <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', status.className)}>{status.label}</span> : null;
                    })()}
                  </span>
                </div>
                <div className="mt-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
                  {zoneRenderPreview.review ? (
                    <>
                      {zoneRenderPreview.review.issues.length ? (
                        <>
                          <p className="mt-1 text-muted-foreground">
                            {zoneRenderPreview.autoFixes ? `自動修正 ${zoneRenderPreview.autoFixes} 次後仍有差異` : '對照後仍有差異'}（請人手核對，不影響匯入）：
                          </p>
                          {zoneRenderPreview.review.issues.map((issue, index) => <p key={`issue-${index}`} className="mt-1 text-amber-700">• {issue}</p>)}
                          <p className="mt-1 text-xs text-muted-foreground">可再按「重新生成」並填寫意見，或直接匯入後人手微調。</p>
                        </>
                      ) : <p className="mt-1 text-emerald-600">未發現明顯差異，可直接按「確認匯入」。</p>}
                      {zoneRenderPreview.review.minor.length ? (
                        <>
                          <p className="mt-2 text-muted-foreground">小問題（可忽略）：</p>
                          {zoneRenderPreview.review.minor.map((issue, index) => <p key={`minor-${index}`} className="mt-1 text-amber-700">• {issue}</p>)}
                        </>
                      ) : null}
                      {zoneRenderPreview.review.uncertain.length ? (
                        <>
                          <p className="mt-2 text-muted-foreground">待確認（不影響匯入）：</p>
                          {zoneRenderPreview.review.uncertain.map((issue, index) => <p key={`uncertain-${index}`} className="mt-1 text-muted-foreground">• {issue}</p>)}
                        </>
                      ) : null}
                    </>
                  ) : <p className="mt-1 text-muted-foreground">自動對照未完成，請人工檢查。</p>}
                </div>
              </aside>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <label htmlFor="zone-render-feedback" className="shrink-0 text-sm font-medium">重新生成意見（可選）</label>
              <Textarea
                id="zone-render-feedback"
                value={zoneRenderFeedback}
                onChange={event => setZoneRenderFeedback(event.target.value)}
                rows={1}
                maxLength={300}
                disabled={zoneRenderPreviewBusy}
                placeholder="例如：書櫃應貼牆、椅子朝向桌面、地板改淺木色、鏡頭再拉遠一點…"
                className="min-h-[2.5rem] min-w-[14rem] flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 font-body text-sm text-foreground shadow-none placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
        ) : zoneRenderPreview?.error ? <p role="alert" className="text-sm text-destructive">{zoneRenderPreview.error}</p> : null}
      </Modal>
      {layoutRenderOpen && floorPlan ? <QuoteLayoutRenderDialog title="渲染圖設置" products={layoutZones(items).flatMap(zone => zone.products)} plan={floorPlan} onChange={next => setFloorPlan(current => current ? { ...current, rendering: next.rendering } : current)} onClose={() => setLayoutRenderOpen(false)} /> : null}
      <Modal open={!!newFurnitureRect} onOpenChange={open => { if (!open) setNewFurnitureRect(null); }} title="新增傢俬位置" description="選擇所屬分區和傢俬名稱；可選擇對應的報價產品。" footer={<><ModalButton variant="secondary" onClick={() => setNewFurnitureRect(null)}>取消</ModalButton><ModalButton disabled={!newFurnitureZone || !newFurnitureCategory.trim()} onClick={() => {
        if (!newFurnitureRect) return;
        rememberZoneEdit();
        const rect = newFurnitureRect;
        setFloorPlan(current => {
          if (!current) return current;
          const placements = current.placements || { positions: {}, assignments: {} };
          const positions = placements.positions[newFurnitureZone] || [];
          const n = Math.max(0, ...positions.map(position => Number(position.label.replace(/^P/, '')) || 0)) + 1;
          const positionId = `${newFurnitureZone}:P${n}`;
          let next = { ...placements, positions: { ...placements.positions, [newFurnitureZone]: [...positions, { id: positionId, label: `P${n}`, category: newFurnitureCategory.trim(), x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, rect, angle: null }] } };
          const zone = layoutZones(itemsRef.current).find(item => item.id === newFurnitureZone);
          const product = zone?.products.find(item => item.id === newFurnitureProduct);
          if (zone && product) {
            const existing = next.assignments[product.id] || [];
            const index = Array.from({ length: Math.max(0, Math.floor(product.quantity)) }, (_, i) => i).find(i => !existing[i]);
            if (index !== undefined) next = assignFurniturePosition(next, newFurnitureZone, zone.products.map(item => item.id), product.id, index, positionId);
          }
          return { ...current, placements: next };
        });
        setNewFurnitureRect(null);
      }}>新增</ModalButton></>}>
        <div className="space-y-4">
          <label className="block space-y-2"><span className="text-sm font-medium">所屬分區</span><Select value={newFurnitureZone} onValueChange={value => { setNewFurnitureZone(value); setNewFurnitureProduct('__none__'); }}><SelectTrigger><SelectValue placeholder="選擇分區" /></SelectTrigger><SelectContent>{zoneManagerDraft.map(zone => <SelectItem key={zone.id} value={zone.id}>{zone.name || '未命名空間'}</SelectItem>)}</SelectContent></Select></label>
          <label className="block space-y-2"><span className="text-sm font-medium">傢俬名稱</span><Input value={newFurnitureCategory} onChange={event => setNewFurnitureCategory(event.target.value)} placeholder="例如：辦公椅" /></label>
          <label className="block space-y-2"><span className="text-sm font-medium">對應報價產品（選填）</span><Select value={newFurnitureProduct} onValueChange={setNewFurnitureProduct}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">暫不配對</SelectItem>{(layoutZones(items).find(zone => zone.id === newFurnitureZone)?.products || []).filter(product => (floorPlan?.placements?.assignments[product.id] || []).filter(Boolean).length < Math.floor(product.quantity)).map(product => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent></Select></label>
        </div>
      </Modal>
      {zoneLayoutEditor ? (
        <QuotePhotoLayoutEditor
          layouts={zonePhotoLayouts[zoneLayoutEditor.zoneId] ?? []}
          groupId={zoneLayoutEditor.groupId}
          assets={photoLibrary}
          productPhotos={quoteProductPhotos}
          photoZones={quotePhotoZones}
          quoteUuid={existingQuote?.quoteUuid ?? null}
          photos={quotePhotoAssets.map((asset) => ({
            assetId: asset.id,
            title: asset.title,
            objectPath: quotePhotoRefUrl(asset),
          }))}
          canManage={canManagePhotos}
          onUploaded={(asset) =>
            setPhotoLibrary((current) => (current.some((row) => row.id === asset.id) ? current : [...current, asset]))
          }
          onSave={(groups, usedAssets) => {
            const zoneId = zoneLayoutEditor.zoneId;
            setZonePhotoLayouts((prev) => {
              const next = { ...prev };
              if (groups.some((group) => group.placements.length > 0)) next[zoneId] = groups;
              else delete next[zoneId];
              return next;
            });
            const usedIds = new Set(groups.flatMap((group) => group.placements.map((placement) => placement.assetId)));
            setQuotePhotoAssets((prev) => {
              const next = [...prev];
              const have = new Set(next.map((asset) => asset.id));
              for (const asset of usedAssets) {
                if (!usedIds.has(asset.id) || have.has(asset.id)) continue;
                next.push({
                  id: asset.id,
                  title: asset.title,
                  objectPath: asset.objectPath,
                  ...(asset.isGenerated ? { isGenerated: true } : {}),
                });
                have.add(asset.id);
              }
              for (const photo of quoteProductPhotos) {
                if (!usedIds.has(photo.id) || have.has(photo.id)) continue;
                next.push({ id: photo.id, title: photo.title, url: photo.url });
                have.add(photo.id);
              }
              return next;
            });
            setZoneLayoutEditor(null);
          }}
          onClose={() => setZoneLayoutEditor(null)}
        />
      ) : null}

      <ImageUploadModal
        open={zoneImageTargetId != null}
        onClose={() => setZoneImageTargetId(null)}
        onSelect={(url) => {
          if (zoneImageTargetId) appendZoneImage(zoneImageTargetId, url);
        }}
        title={t.uploadZoneImage}
        uploadImage={
          zoneImageTargetId
            ? (file) => uploadQuoteImageFile(file, quoteImageScope, zoneImageTargetId, "reference")
            : undefined
        }
      />

      <Modal
        open={zoneManagerOpen}
        onOpenChange={setZoneManagerOpen}
        size="4xl"
        className="max-w-6xl"
        icon={<FolderKanban className="h-5 w-5" />}
        title={floorPlan ? t.manageZones : t.uploadFloorPlan}
        description={
          zoneRecognitionActive
            ? t.recognizingZonesDetail
            : floorPlan
              ? t.manageZonesHint
              : ui(
                  "把平面圖拖到這裡或貼上（Ctrl+V），上傳後會自動識別分區。",
                  "Drop or paste a floor plan here (Ctrl+V). Zones are detected after upload.",
                )
        }
        footer={
          <>
            <div className="flex flex-wrap items-center gap-3 sm:mr-auto">
            <ModalButton variant="secondary" disabled={!hasFloorPlanPreview || zoneRecognitionActive} onClick={() => void redetectZones()}>
              {quoteLocale === 'en' ? 'Recognize again' : '重新識別'}
            </ModalButton>
            {!showRecognizedFurniture && <ModalButton
              variant="secondary"
              className="border-dashed"
              disabled={zoneRecognitionActive}
              onClick={() => { rememberZoneEdit(); setZoneManagerDraft((prev) => [...prev, blankZoneManagerRow(generateId())]); }}
            >
              <Plus className="h-4 w-4" />
              {t.addZoneSpace}
            </ModalButton>}
            <ModalButton variant="secondary" disabled={!floorPlan || zoneRecognitionActive} onClick={() => setLayoutRenderOpen(true)}>
              渲染圖設置
            </ModalButton>
            </div>
            <ModalButton variant="secondary" onClick={() => setZoneManagerOpen(false)}>
              {t.cancel}
            </ModalButton>
            <ModalButton onClick={() => void saveZoneManager()} disabled={zoneRecognitionActive || isSavingDraft}>{t.confirm}</ModalButton>
          </>
        }
      >
        <div className="space-y-3">
          {floorPlan ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 font-body text-xs text-muted-foreground">
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{floorPlan.fileName || ui("平面圖", "Floor plan")}</span>
                <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold text-foreground/60">
                  {floorPlan.mimeType === "application/pdf" ? "PDF" : ui("圖片", "Image")}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <ModalButton
                  size="sm"
                  variant="secondary"
                  disabled={zoneRecognitionActive}
                  onClick={() => floorPlanInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t.replaceFloorPlan}
                </ModalButton>
                <ModalButton
                  size="sm"
                  variant="ghost"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  disabled={zoneRecognitionActive}
                  onClick={() => void handleDeleteFloorPlan()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t.deleteFloorPlan}
                </ModalButton>
              </div>
            </div>
          ) : null}
          {floorPlan?.regions.some((region) => !region.confirmed) ? (
            <p className="font-body text-xs text-amber-700">{t.floorPlanReconfirmHint}</p>
          ) : null}
          {hasFloorPlanPreview && unboxedZoneCount > 0 ? (
            <p className="font-body text-xs text-amber-700">
              {t.zoneUnboxedHint.replace("{n}", String(unboxedZoneCount))}
            </p>
          ) : null}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div
                className={cn(
                  "relative h-[496px] overflow-hidden rounded-lg",
                  floorPlanDragOver && "ring-2 ring-violet-400",
                )}
                onDragOver={(event) => {
                  if (zoneRecognitionActive || ![...event.dataTransfer.types].includes("Files")) return;
                  event.preventDefault();
                  setFloorPlanDragOver(true);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                  setFloorPlanDragOver(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setFloorPlanDragOver(false);
                  if (zoneRecognitionActive) return;
                  const file = event.dataTransfer.files?.[0];
                  if (file) void handleFloorPlanFile(file);
                }}
              >
                <Tabs className="absolute left-3 top-3 z-30" value={zoneCanvasEditing ? 'edit' : 'view'} onValueChange={value => setZoneCanvasEditing(value === 'edit')}>
                  <TabsList aria-label="畫布模式" className="border border-border bg-background/95 shadow-sm">
                    <TabsTrigger value="view" disabled={!hasFloorPlanPreview || zoneRecognitionActive} className="px-2 text-xs data-[state=active]:!text-primary-foreground [&>span[aria-hidden=true]]:!bg-primary">查看模式</TabsTrigger>
                    <TabsTrigger value="edit" disabled={!hasFloorPlanPreview || zoneRecognitionActive} className="px-2 text-xs data-[state=active]:!text-primary-foreground [&>span[aria-hidden=true]]:!bg-primary">編輯模式</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Tabs className="absolute right-3 top-3 z-30" value={showRecognizedFurniture ? 'furniture' : 'plan'} onValueChange={value => {
                  if (value === 'furniture') setFloorPlan(current => current?.placements ? { ...current, placements: reassignFurnitureZones(current.placements, regionsFromZoneRows(zoneManagerDraft), layoutZones(applyZoneManager(items, zoneManagerDraft))) } : current);
                  setShowRecognizedFurniture(value === 'furniture');
                }}>
                  <TabsList aria-label="識別類型" className="border border-border bg-background/95 shadow-sm">
                    <TabsTrigger value="plan" disabled={!hasFloorPlanPreview || zoneRecognitionActive} className="px-2 text-xs data-[state=active]:!text-primary-foreground [&>span[aria-hidden=true]]:!bg-primary">平面識別</TabsTrigger>
                    <TabsTrigger value="furniture" disabled={!hasFloorPlanPreview || zoneRecognitionActive} className="px-2 text-xs data-[state=active]:!text-primary-foreground [&>span[aria-hidden=true]]:!bg-primary">傢俬識別</TabsTrigger>
                  </TabsList>
                </Tabs>
                {hasFloorPlanPreview ? (
                  <FloorPlanZoneCanvas
                    src={(floorPlan?.previewUrl || floorPlan?.url) as string}
                    zones={canvasZoneRows}
                    showFurniture={showRecognizedFurniture}
                    furnitureMarkers={recognizedFurnitureMarkers}
                    activeFurnitureId={activeFurnitureMarkerId}
                    furnitureFocusRequest={furnitureFocusRequest}
                    activeId={activeZoneId ? `${activeZoneId}::0` : null}
                    createId={generateId}
                    disabled={zoneRecognitionActive || !zoneCanvasEditing}
                    panEnabled={!zoneCanvasEditing && !zoneRecognitionActive}
                    onDrawFurniture={rect => {
                      const centerX = rect.x + rect.w / 2, centerY = rect.y + rect.h / 2;
                      const matching = zoneManagerDraft.find(zone => (zone.rects?.length ? zone.rects : zone.rect ? [zone.rect] : []).some(area => centerX >= area.x && centerX <= area.x + area.w && centerY >= area.y && centerY <= area.y + area.h));
                      setNewFurnitureZone(matching?.id || '');
                      setNewFurnitureCategory('');
                      setNewFurnitureProduct('__none__');
                      setNewFurnitureRect(rect);
                    }}
                    onMoveFurniture={(id, rect) => {
                      const marker = recognizedFurnitureMarkers.find(item => item.id === id);
                      if (!marker) return;
                      setFloorPlan(current => {
                        if (!current?.placements) return current;
                        const placements = current.placements;
                        return { ...current, placements: { ...placements, positions: { ...placements.positions, [marker.zoneId]: (placements.positions[marker.zoneId] || []).map(position => position.id === marker.positionId ? { ...position, rect, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : position) } } };
                      });
                    }}
                    deleteLabel={quoteLocale === "en" ? "Delete space" : "刪除空間"}
                    onChange={applyZoneCanvas}
                    onBeforeEdit={rememberZoneEdit}
                    onActive={(id) => setActiveZoneId(zoneCanvasId(id))}
                    onCopyRegion={copyZoneArea}
                    regionDisplay={(id, index) => {
                      const zoneIndex = zoneManagerDraft.findIndex((zone) => zone.id === zoneCanvasId(id));
                      return { colorIndex: zoneIndex < 0 ? index : zoneIndex, number: zoneIndex < 0 ? index + 1 : zoneIndex + 1 };
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={zoneRecognitionActive}
                    onClick={() => floorPlanInputRef.current?.click()}
                    className="flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-violet-500 bg-muted/30 px-6 text-center font-body text-sm text-muted-foreground hover:bg-violet-50 disabled:cursor-default"
                  >
                    {t.dropFloorPlan} {t.dropFloorPlanAction}
                  </button>
                )}
                {zoneRecognitionActive ? (
                  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-900/40" role="status" aria-live="polite">
                    <div className="w-[min(18rem,78%)] space-y-1.5 rounded-xl bg-white px-4 py-3 shadow-lg">
                      <div className="flex items-center justify-between gap-3 font-body text-xs text-foreground">
                        <span>{floorPlanBusy ? t.uploadingFloorPlan : t.recognizingZones}</span>
                        <span className="font-mono-data tabular-nums">{Math.round(zoneRecognitionProgress)}%</span>
                      </div>
                      <Progress value={zoneRecognitionProgress} />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          <div className="min-w-0 space-y-3">
          {showRecognizedFurniture ? (
            <div className="flex h-[496px] flex-col gap-3">
              <div className="flex items-center justify-between"><p className="text-sm font-semibold">傢俬分區</p><span className="text-xs text-muted-foreground">共 {recognizedFurnitureMarkers.length} 件</span></div>
              <p className="text-xs leading-5 text-muted-foreground">包含尚未配對報價的傢俬。有識別範圍時顯示框線，只有座標時顯示位置標記。</p>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" aria-live="polite">
                {furnitureGroups.length ? furnitureGroups.map(group => <div key={`${group[0].zoneId}:${group[0].category}`} className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">{group[0].zoneName} · {furnitureGroupName(group[0].category)}（{group.length}）</p>
                  {group.map(marker => <div key={marker.id} className="flex items-center gap-2">
                    <button type="button" onClick={() => { setActiveFurnitureMarkerId(marker.id); setFurnitureFocusRequest(value => value + 1); }} aria-pressed={activeFurnitureMarkerId === marker.id} className={`shrink-0 rounded px-2 py-1 text-xs font-semibold text-white ${activeFurnitureMarkerId === marker.id ? 'ring-2 ring-foreground ring-offset-2' : ''}`} style={{ background: marker.color }}>{marker.label}</button>
                    <span className="flex flex-1 items-center gap-1.5 text-sm font-semibold text-foreground">{marker.angle === null ? '方向未知' : <><span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xl font-bold leading-none" style={{ transform: `rotate(${marker.angle}deg)` }}>↑</span><span>{marker.angle}°</span></>}</span>
                    <Button type="button" variant="outline" size="sm" disabled={!zoneCanvasEditing || zoneRecognitionActive} onClick={() => editFurnitureMarker(marker.zoneId, marker.positionId, false)}>轉向 90°</Button>
                    <Button type="button" variant="outline" size="sm" disabled={!zoneCanvasEditing || zoneRecognitionActive} onClick={() => copyFurnitureMarker(marker.zoneId, marker.positionId)} aria-label={`複製 ${marker.label}`}><Copy className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="sm" disabled={!zoneCanvasEditing || zoneRecognitionActive} aria-label={`刪除 ${marker.label}`} onClick={() => editFurnitureMarker(marker.zoneId, marker.positionId, true)}><Trash2 className="h-4 w-4" /></Button>
                  </div>)}
                </div>) : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">尚未有傢俬識別資料，請上傳平面圖進行識別。</p>}
              </div>
            </div>
          ) : zoneManagerDraft.length === 0 ? (
            <Empty className="h-[440px] border border-border bg-muted/20">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle className="text-sm font-normal text-muted-foreground">{t.noZonesYet}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <div className="min-w-[28rem] space-y-2 lg:min-w-0">
                <div className="grid grid-cols-[1.25rem_1.5rem_minmax(0,1.4fr)_minmax(0,1.2fr)_4.5rem_2rem] gap-2 px-0.5">
                  <span />
                  <span />
                  <span className="font-body text-xs text-muted-foreground">{t.zoneSpaceName}</span>
                  <span className="font-body text-xs text-muted-foreground">{t.zoneSpaceType}</span>
                  <span className="font-body text-xs text-muted-foreground">{t.zoneQuantity}</span>
                  <span />
                </div>
                {zoneManagerDraft.map((zone, index) => (
                  <div
                    key={zone.id}
                    className={`grid grid-cols-[1.25rem_1.5rem_minmax(0,1.4fr)_minmax(0,1.2fr)_4.5rem_2rem] items-center gap-2 ${zoneSortId === zone.id ? "opacity-50" : ""}`}
                    onDragOver={(event) => {
                      if (!zoneSortId) return;
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const fromId = event.dataTransfer.getData("text/plain") || zoneSortId;
                      setZoneSortId(null);
                      if (!fromId || fromId === zone.id) return;
                      setZoneManagerDraft((prev) => {
                        const from = prev.findIndex((row) => row.id === fromId);
                        const to = prev.findIndex((row) => row.id === zone.id);
                        if (from < 0 || to < 0) return prev;
                        const next = [...prev];
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved);
                        return next;
                      });
                    }}
                  >
                    <button
                      type="button"
                      draggable
                      aria-label={quoteLocale === "en" ? "Reorder zone" : "調整順序"}
                      className="flex h-10 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", zone.id);
                        setZoneSortId(zone.id);
                      }}
                      onDragEnd={() => setZoneSortId(null)}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded font-mono-data text-xs text-white ${zone.rect ? "" : "ring-2 ring-amber-400 ring-offset-1"}`}
                      style={{ background: floorPlanZoneColor(index) }}
                      title={zone.rect ? t.zoneBoxed : t.zoneUnboxed}
                    >
                      {index + 1}
                    </span>
                    <div className="relative min-w-0">
                      <Input
                        value={zone.name}
                        aria-label={t.zoneSpaceName}
                        placeholder={t.zoneSpaceNamePlaceholder}
                        onFocus={() => setActiveZoneId(zone.id)}
                        onChange={(e) =>
                          setZoneManagerDraft((prev) =>
                            prev.map((row) => (row.id === zone.id ? { ...row, name: e.target.value } : row)),
                          )
                        }
                        className={`h-10 rounded-xl border-slate-200 bg-white shadow-none ${zone.rect ? "" : "border-amber-300 bg-amber-50/60"}`}
                      />
                      {zone.rect ? null : (
                        <span className="pointer-events-none absolute -top-2 right-2 rounded-full bg-amber-500 px-1.5 py-px font-body text-[10px] font-medium leading-4 text-white">
                          {t.zoneUnboxed}
                        </span>
                      )}
                    </div>
                    <Input
                      value={zone.spaceType}
                      aria-label={t.zoneSpaceType}
                      placeholder={t.zoneSpaceTypePlaceholder}
                      onFocus={() => setActiveZoneId(zone.id)}
                      onChange={(e) =>
                        setZoneManagerDraft((prev) =>
                          prev.map((row) => (row.id === zone.id ? { ...row, spaceType: e.target.value } : row)),
                        )
                      }
                      className="h-10 rounded-xl border-slate-200 bg-white shadow-none"
                    />
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={zone.quantity > 0 ? String(zone.quantity) : ""}
                      aria-label={t.zoneQuantity}
                      onFocus={() => setActiveZoneId(zone.id)}
                      onChange={(e) => {
                        const nextQuantity = Number.parseInt(e.target.value, 10);
                        setZoneManagerDraft((prev) =>
                          prev.map((row) => (
                            row.id === zone.id
                              ? { ...row, quantity: Number.isFinite(nextQuantity) && nextQuantity > 0 ? nextQuantity : 0 }
                              : row
                          )),
                        );
                      }}
                      className="h-10 rounded-xl border-slate-200 bg-white text-center font-mono-data shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      className="flex h-10 items-center justify-center text-rose-500 hover:text-rose-600"
                      aria-label={quoteLocale === "en" ? "Remove zone" : "移除分區"}
                      onClick={() => { rememberZoneEdit(); setZoneManagerDraft((prev) => prev.filter((row) => row.id !== zone.id)); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
          </div>
        </div>
      </Modal>

      <FloorPlanViewerModal
        open={floorPlanViewerOpen}
        title={floorPlan?.fileName || t.uploadFloorPlan}
        url={floorPlan?.url ?? null}
        type={floorPlan?.mimeType ?? null}
        previewUrl={floorPlan?.previewUrl}
        onClose={() => setFloorPlanViewerOpen(false)}
      />

      <QuoteCatalogPagesDialog
        open={catalogDialogOpen}
        pages={catalogPages}
        onOpenChange={setCatalogDialogOpen}
        onConfirm={(nextPages) => {
          setCatalogPages(nextPages);
          setCatalogDialogOpen(false);
        }}
      />

      <ImageLightbox
        open={zoneLightbox != null}
        onClose={() => setZoneLightbox(null)}
        images={zoneLightbox?.urls || []}
        startIndex={zoneLightbox?.index || 0}
        title={zoneLightbox?.title ?? t.uploadZoneImage}
        thumbWidth={96}
      />

      {quoteContentLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          onWheel={(event) => event.preventDefault()}
          onTouchMove={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 flex touch-none flex-col items-center justify-center gap-3 overscroll-none bg-background/85 px-6 backdrop-blur-sm"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="font-body text-sm font-medium text-foreground">
            {ui('正在載入報價內容…', 'Loading quotation contents…')}
          </p>
          <p className="max-w-sm text-center font-body text-xs text-muted-foreground">
            {ui(
              '載入完成後即可繼續編輯、保存或送出審核。',
              'Editing, saving and sending are available once loading finishes.',
            )}
          </p>
        </div>
      ) : null}

    </>
  );
}
