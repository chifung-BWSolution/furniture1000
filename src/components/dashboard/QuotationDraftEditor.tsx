import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import QRCode from "qrcode";
import "./quotation-draft-editor.css";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Eye,
  FileText,
  FolderKanban,
  GripVertical,
  ImagePlus,
  Inbox,
  Loader2,
  PackagePlus,
  PackageSearch,
  Pencil,
  Percent,
  Plus,
  QrCode,
  Save,
  Scissors,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  UserRound,
  Wallet,
  Wand2,
  X,
  Check,
  Link2,
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
  blankZoneManagerRow,
  detectZonesFromJpegBase64,
  imageBlobToJpegBase64,
  MAX_ZONE_IMAGES,
  parseQuoteFloorPlan,
  parseQuoteZoneImages,
  pruneQuoteZoneImages,
  regionsFromZoneRows,
  unconfirmZoneRegions,
  UNZONED_QUOTE_IMAGE_KEY,
  type QuoteFloorPlan,
  type QuoteZoneImageMap,
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
import { bumpQuoteVersion, displayQuoteVersion } from "@/lib/quoteVersions";
import { createQuoteShareLink, findActiveQuoteShareLink } from "@/lib/bwfQuoteShareLinks";
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
          className="font-display text-sm font-semibold tabular-nums leading-none text-foreground/75"
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
  /** 圖片庫現有張數 — AI 生成會寫入圖片庫，要擋 QUOTE_PHOTO_LIBRARY_LIMIT。 */
  const [libraryCount, setLibraryCount] = useState(0);

  useEffect(() => {
    if (!aiOpen) return;
    let cancelled = false;
    void listQuotePhotoAssets().then((result) => {
      if (!cancelled) setLibraryCount(result.assets.length);
    });
    return () => {
      cancelled = true;
    };
  }, [aiOpen]);

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
        libraryCount={libraryCount}
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
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="absolute -top-1 -right-1 z-10 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow"
            >
              <X className="h-3 w-3" />
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
  trailing,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "mb-1 flex items-center justify-between gap-2",
          trailing ? "min-h-5" : "h-4",
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

/** ~15 Chinese characters — 顏色 */
const QUOTE_SHORT_TEXT_INPUT_CLASS = `${QUOTE_INPUT_CLASS} max-w-[15em]`;

const QUOTE_NUMBER_INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30";

const QUOTE_COMPACT_NUMBER_INPUT_CLASS = `${QUOTE_NUMBER_INPUT_CLASS} min-w-0`;

/** Left column width — 類別、顏色、備註等短文字欄 */
const QUOTE_LEFT_COL_CLASS = "w-[15em] max-w-full shrink-0";

/**
 * ≥900px: desktop 9-col card (100% layout).
 * 650–899px: tablet stack (2-col media / pricing).
 * 300–649px: mobile stack (single-col pricing).
 */
const QUOTE_CARD_GRID = cn(
  "grid w-full min-w-0 auto-rows-min items-start gap-x-3 gap-y-3",
  "grid-cols-[1.75rem_minmax(0,1fr)]",
  "min-[900px]:grid-cols-[1.75rem_minmax(0,15em)_minmax(8rem,calc((56%-1.75rem-15em-2rem)/2))_minmax(8rem,calc((56%-1.75rem-15em-2rem)/2))_6em_7em_minmax(1rem,1fr)_7em_auto]",
);

/** Wide desktop only — extra offset needs ≥1400px card width */
const QUOTE_CARD_MEDIA_XL_SHIFT = "min-[1400px]:ml-[4rem]";
const QUOTE_CARD_PRICING_XL_SHIFT = "min-[1400px]:ml-[15rem]";
const QUOTE_QTY_COST_FIELD_CLASS = cn(
  "w-full min-w-0 max-w-none [&_label]:whitespace-nowrap",
  "min-[900px]:w-[6em] min-[900px]:min-w-[6em] min-[900px]:max-w-[6em] min-[900px]:shrink-0",
  "min-[1400px]:ml-[9rem]",
);

const QUOTE_PRICE_FIELD_CLASS =
  "w-full min-w-0 min-[900px]:w-[7em] min-[900px]:min-w-[7em] min-[900px]:max-w-[7em] min-[900px]:shrink-0 [&_label]:whitespace-nowrap";

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
}: {
  zoneTitleId: string | null;
  zoneOptions: { id: string; label: string }[];
  labels: QuoteUiLabels;
  onAssign: (zoneTitleId: string) => void;
}) {
  return (
    <Select value={zoneTitleId ?? "__none__"} onValueChange={onAssign}>
      <SelectTrigger
        className="h-8 w-[9.5rem] shrink-0 text-xs"
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
}: {
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
}) {
  const [cardCollapsed, setCardCollapsed] = useState(false);
  const dimensionMode = item.dimensionMode ?? 'lwh';
  const registryLocked =
    Boolean(item.productId?.trim()) && Boolean(item.productCategoryId?.trim());
  const level1Value = item.registryLevel1?.trim() || '';
  const level2Value = item.registryLevel2?.trim() || '';
  const level1Options = uniqueLevel1InOrder(categoryPairs);
  const level2Options = uniqueLevel2InOrder(categoryPairs, level1Value);
  const registrySelectClass =
    "h-[34px] w-full min-w-0 cursor-pointer rounded-md border border-border bg-background px-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60";
  const isDiameterHeight = dimensionMode === 'dh';
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
        "quote-product-row border border-border/80 bg-card",
      )}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
    >
      <div className="quote-product-row-head flex flex-wrap items-start gap-3">
        <QuoteRowDragHandle
          itemId={item.id}
          serialNumber={serialNumber}
          serialLabel={zonePrefix ?? undefined}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        {onAssignZone ? (
          <QuoteItemZoneSelect
            zoneTitleId={zoneTitleId}
            zoneOptions={zoneOptions}
            labels={labels}
            onAssign={onAssignZone}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={item.name || ""}
            placeholder={labels.productNamePlaceholder}
            onChange={(e) => updateItem(item.id, "name", e.target.value)}
            className="w-full bg-transparent font-display text-sm font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            aria-label="產品名稱"
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {item.productId?.trim() ? (
              <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                已連結
              </span>
            ) : null}
            {item.isOptional ? (
              <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                {labels.optionalProduct}
              </span>
            ) : null}
            {item.hideInPdf ? (
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {labels.hideInPdf}
              </span>
            ) : null}
          </div>
        </div>
        <div className="quote-product-row-totals">
          <span><small>{labels.quantity}</small>{item.quantity} {quoteUnitLabel(item.unit, labels.unit === 'Unit' ? 'en' : 'zh')}</span>
          <span><small>{labels.hkdUnitPrice}</small>${item.unitPrice.toLocaleString()}</span>
          <span><small>{labels.hkdSubtotal}</small><strong>${quoteItemLineSubtotal(item).toLocaleString()}</strong></span>
        </div>
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
          collapsed={cardCollapsed}
          onToggleCollapse={() => setCardCollapsed((v) => !v)}
        />
      </div>

      {cardCollapsed ? null : (
        <div className="quote-product-row-body">
        <div className="quote-product-row-fields">
          <section className="quote-item-group">
            <h3>{labels.unit === 'Unit' ? 'Classification' : '分類與類別'}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuoteFieldBlock label={labels.level1Category}>
            <Select
              value={level1Value || "__none__"}
              disabled={registryLocked || categoryPairsLoading}
              onValueChange={(value) =>
                onRegistryLevel1Change(
                  item.id,
                  value === "__none__" ? "" : value,
                )
              }
            >
              <SelectTrigger
                className={registrySelectClass}
                title={registryLocked ? labels.productCategoryLockedHint : undefined}
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
                registryLocked ||
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
                title={registryLocked ? labels.productCategoryLockedHint : undefined}
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
          <QuoteFieldBlock label={labels.category} className="sm:col-span-2">
            <Input
              value={item.category || ""}
              placeholder="—"
              onChange={(e) => updateItem(item.id, "category", e.target.value)}
              className={QUOTE_INPUT_CLASS}
            />
          </QuoteFieldBlock>
            </div>
          </section>
          <section className="quote-item-group">
            <h3>{labels.unit === 'Unit' ? 'Attributes' : '屬性'}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          </QuoteFieldBlock>
          <QuoteFieldBlock label={labels.unit}>
            <input
              type="text"
              value={quoteUnitLabel(item.unit, labels.unit === 'Unit' ? 'en' : 'zh')}
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
            />
          </QuoteFieldBlock>
            </div>
          </section>
          <section className="quote-item-group">
            <h3>{labels.unit === 'Unit' ? 'Cost & Selling Price' : '成本與售價'}</h3>
            <div className="quote-item-pricing grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
          <QuoteFieldBlock label={labels.hkdSubtotal} className="quote-item-subtotal">
            <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/40 px-2">
              <span
                className={cn(
                  "truncate font-mono-data text-xs font-medium",
                  item.isOptional ? "text-muted-foreground" : "text-foreground",
                )}
              >
                ${quoteItemLineSubtotal(item).toLocaleString()}
              </span>
            </div>
          </QuoteFieldBlock>
            </div>
          </section>
          <div className="quote-item-dimensions">
          <div className="min-w-0">
            <div className="mb-1 flex min-h-[22px] flex-wrap items-center gap-1.5 font-body text-xs font-medium text-muted-foreground">
              <span className="shrink-0 leading-normal">{labels.dimensionsMm}</span>
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
          <QuoteFieldBlock label={labels.color}>
            <input
              type="text"
              value={item.color || ""}
              placeholder="—"
              maxLength={15}
              onChange={(e) => updateItem(item.id, "color", e.target.value)}
              className={QUOTE_INPUT_CLASS}
            />
          </QuoteFieldBlock>
          </div>
          <section className="quote-item-group quote-item-description">
            <h3>{labels.unit === 'Unit' ? 'Description' : '說明'}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <QuoteFieldBlock label={labels.material}>
            <MaterialRichEditor
              value={item.material || ""}
              placeholder={labels.unit === 'Unit' ? 'Materials & details…' : '材質及明細…'}
              onChange={(html) => updateItem(item.id, "material", html)}
            />
          </QuoteFieldBlock>
          <QuoteFieldBlock label={labels.remarks}>
            <RemarksRichEditor
              singleLine
              locale={labels.unit === 'Unit' ? 'en' : 'zh'}
              placeholder={labels.unit === 'Unit' ? 'Remarks…' : '備註文字…'}
              key={item.id}
              compact
              value={item.remarks || ""}
              legacyImage={item.remarksImage}
              onChange={(val) => updateItem(item.id, "remarks", val)}
              uploadImage={uploadRemarksImage}
            />
          </QuoteFieldBlock>

            </div>
          </section>
        </div>
        <div className="quote-product-row-images">
          <QuoteFieldBlock label={labels.image}>
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
          <QuoteFieldBlock label={labels.referenceImage}>
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
        </div>
      )}
      {!cardCollapsed && (
          <div className="quote-product-row-footer">
            <QuoteItemFlagToggles
              item={item}
              updateItem={updateItem}
              labels={labels}
            />
          </div>
      )}
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
  onUploadZoneImage?: () => void;
  onRemoveZoneImage?: (url: string) => void;
  onPreviewZoneImage?: (imageIndex: number) => void;
}) {
  const ordinal = sectionTitleOrdinalAt(items, index);
  const prefix = sectionTitlePrefix(ordinal);
  const zoneAddBtn =
    "inline-flex items-center gap-1 rounded-md border border-dashed border-primary/40 bg-background px-2 py-1 font-body text-xs font-medium text-foreground/80 transition-colors hover:bg-primary/5 hover:text-primary";

  return (
    <div
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
              className={cn(QUOTE_INPUT_CLASS, "font-display text-sm font-semibold")}
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
      <span className="font-display text-xs font-bold text-primary/70">
        {sectionTitlePrefix(ordinal)}
      </span>
      <span className="min-w-0 truncate font-display text-xs font-bold text-primary/80">
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
          className="inline-flex shrink-0 items-center rounded-lg border border-border bg-background px-2.5 py-1 font-body text-xs font-medium text-foreground hover:bg-muted/50"
        >
          {english ? (editing ? 'Done' : 'Edit') : (editing ? '完成' : '編輯')}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
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

/** 類別 free-text defaults to 二級分類, else 一級分類. */
function categoryLabelFromRegistry(
  level1?: string | null,
  level2?: string | null,
): string {
  const l2 = (level2 ?? "").trim();
  const l1 = (level1 ?? "").trim();
  return l2 || l1;
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
    category: categoryLabelFromRegistry(pair.level1, pair.level2),
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
    .map((item) => ({
      id: item.id,
      name: item.name || "",
      nameEn: item.remarks || "",
      spaceType: item.category || "",
      quantity: item.quantity > 0 ? item.quantity : 1,
      rect: regions.find((region) => region.zoneId === item.id)?.rect ?? null,
    }));
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
  const btnBase = compact
    ? "inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 font-body text-xs font-medium transition-colors"
    : "inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 font-body text-sm font-medium transition-colors";
  const iconClass = compact ? "h-3 w-3" : "h-3.5 w-3.5";

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
    name: item.name || "",
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
  forceNewQuote = false,
  draftQuoteId = null,
}: QuotationDraftEditorProps) {
  const ui = (zh: string, en: string) => quoteLocale === 'en' ? en : zh;
  const { user } = useAuth();
  const staffName = usePmsStaffName(user?.id);

  // Determine initial values from existingQuote or defaults
  const savedProjectData = existingQuote?.projectData || {};
  const copyPayload = initialCopyPayload ?? null;
  const savedCompanyInfo = savedProjectData.companyInfo as
    | {
        name?: string;
        address?: string;
        addressEn?: string;
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
  const [shareUrl, setShareUrl] = useState("");
  const { settings: formatSettings } = useQuoteFormatSettings();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

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
  const [showCatalogSource, setShowCatalogSource] = useState(
    () => (savedProjectData as Record<string, unknown>).showCatalogSource !== false,
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
  const [zoneManagerOpen, setZoneManagerOpen] = useState(false);
  const [zoneManagerDraft, setZoneManagerDraft] = useState<ZoneManagerRow[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [zoneImageTargetId, setZoneImageTargetId] = useState<string | null>(null);
  const [zoneLightbox, setZoneLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  const floorPlanRef = useRef(floorPlan);
  floorPlanRef.current = floorPlan;
  const zoneManagerDraftRef = useRef(zoneManagerDraft);
  zoneManagerDraftRef.current = zoneManagerDraft;
  const zoneManagerOpenRef = useRef(zoneManagerOpen);
  zoneManagerOpenRef.current = zoneManagerOpen;
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
    const nextShowSource = projectData?.showCatalogSource !== false;
    setShowCatalogSource((prev) => (prev === nextShowSource ? prev : nextShowSource));
  }, [existingQuote?.quoteId, existingQuote?.projectData]);

  // 報價 PDF 的 QR 指向這張單已有的客戶連結，不必每次開啟都重新生成。
  const shareQuoteUuid = existingQuote?.quoteUuid?.trim() || "";
  useEffect(() => {
    if (!shareQuoteUuid) return;
    let cancelled = false;
    void findActiveQuoteShareLink(shareQuoteUuid).then((link) => {
      if (!cancelled && link) setShareUrl((current) => current || link.url);
    });
    return () => {
      cancelled = true;
    };
  }, [shareQuoteUuid]);

  useEffect(() => {
    if (!shareUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(shareUrl, { margin: 1, width: 440 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Company info (editable) — address / addressEn keep separate zh & en defaults;
  // after the user edits and saves, the saved value becomes the latest for that locale.
  const [companyInfo, setCompanyInfo] = useState({
    name: savedCompanyInfo?.name || formData.company || "Branding Works Design Ltd",
    address: savedCompanyInfo?.address || DEFAULT_COMPANY_ADDRESS.zh,
    addressEn: savedCompanyInfo?.addressEn || DEFAULT_COMPANY_ADDRESS.en,
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
    // Existing quotes load line items from bwf_quote_item — avoid flashing DEFAULT_ITEMS.
    if (existingQuote?.quoteUuid) {
      return [];
    }
    return DEFAULT_ITEMS;
  });
  const [itemsLoadedFromDb, setItemsLoadedFromDb] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const itemsLoadedRef = useRef(false);
  itemsLoadedRef.current = itemsLoadedFromDb;
  const itemsReadyWaiters = useRef<Array<() => void>>([]);

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
  const itemsHydratedForUuidRef = useRef<string | null>(null);

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
      (itemsUserEditedRef.current && itemsRef.current.some(hasQuoteItemContent))
      || itemsHydratedForUuidRef.current
    ) {
      itemsHydratedForUuidRef.current = quoteUuid;
      setItemsLoadedFromDb(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await loadQuoteItems(quoteUuid);
        if (cancelled) return;
        if (itemsUserEditedRef.current && itemsRef.current.some(hasQuoteItemContent)) {
          itemsHydratedForUuidRef.current = quoteUuid;
          return;
        }
        if (rows.length > 0) {
          const linked = await hydrateQuoteItemProductLinks(
            rows.map(normalizeLegacyQuoteItemProductId),
          );
          if (cancelled) return;
          if (itemsUserEditedRef.current && itemsRef.current.some(hasQuoteItemContent)) {
            itemsHydratedForUuidRef.current = quoteUuid;
            return;
          }
          setItems(linked.map((item) => mapInputToQuotationItem(item)));
        }
        itemsHydratedForUuidRef.current = quoteUuid;
      } catch (err) {
        console.warn('[QuotationDraftEditor] loadQuoteItems failed', err);
      } finally {
        if (!cancelled) setItemsLoadedFromDb(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // legacyItems length is stable for this existingQuote mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingQuote?.quoteUuid]);

  useEffect(() => {
    if (!itemsLoadedFromDb) return;
    const waiters = itemsReadyWaiters.current;
    itemsReadyWaiters.current = [];
    waiters.forEach((resolve) => resolve());
  }, [itemsLoadedFromDb]);

  const waitForQuoteItems = () => {
    if (!existingQuote?.quoteUuid || itemsLoadedRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      itemsReadyWaiters.current.push(resolve);
    });
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
          next.hkdCostPrice = computeHkdCostPrice(
            field === "costPrice" ? (value as number | null) : next.costPrice,
            field === "exchangeRate"
              ? (value as number | null)
              : next.exchangeRate,
          );
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
            productCategoryId,
            category: categoryLabelFromRegistry(level1, l2),
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
            productCategoryId,
            category: categoryLabelFromRegistry(l1, level2),
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
          hkdCostPrice: computeHkdCostPrice(item.costPrice, rate),
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
          hkdCostPrice: computeHkdCostPrice(item.costPrice, rate),
        };
      }),
    );
    toast.success("已統一所有產品匯率", { description: String(rate) });
    return true;
  }, []);

  const handleGenerateQuoteShare = useCallback(async () => {
    const quoteUuid = existingQuote?.quoteUuid?.trim() || "";
    const qid = (existingQuote?.quoteId || quoteId || "").trim();
    if (!quoteUuid || !qid || qid === "NEW") {
      toast.error("請先按「保存現有版本」或「版本審核」儲存報價單後再生成連結");
      return;
    }
    setShareBusy(true);
    setShareCopied(false);
    try {
      const res = await createQuoteShareLink({ quoteUuid, quoteId: qid });
      if (res.ok === false) {
        toast.error("生成失敗", { description: res.error });
        return;
      }
      const url = res.data.url;
      setShareUrl(url);
      setShareModalOpen(true);
      try {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        toast.success("已生成連結並複製");
      } catch {
        toast.success("已生成客戶專區連結");
      }
    } finally {
      setShareBusy(false);
    }
  }, [existingQuote?.quoteId, existingQuote?.quoteUuid, quoteId]);

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

  // Version & submission modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastLocalSavedAt, setLastLocalSavedAt] = useState<number | null>(null);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);

  const handleOpenSubmitReview = () => {
    if (existingQuote?.quoteUuid && !itemsLoadedFromDb) {
      toast.error(quoteLocale === "en" ? "The quotation is still loading" : "報價內容仍在載入", {
        description: quoteLocale === "en"
          ? "Wait until everything has loaded before sending it for review."
          : "請等報價內容載入完成再送出，以免漏掉項目。",
      });
      return;
    }
    const missing = [
      !quoteMeta.pmName.trim() && '項目經理姓名',
      !clientInfo.name.trim() && '公司名稱',
      !clientInfo.phone.trim() && '客戶電話',
      formData.clientIndustry.length === 0 && '客戶產業',
      formData.serviceScope.length === 0 && '辦公室傢俬類別',
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
  const baselineSnapshotRef = useRef<string | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);

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

  const openZoneImageUpload = (zoneId: string | null) => {
    const id = zoneId || UNZONED_QUOTE_IMAGE_KEY;
    const groups = zonePhotoLayouts[id] ?? [];
    setZoneLayoutEditor({ zoneId: id, groupId: groups[0]?.id ?? null });
    void listQuotePhotoAssets().then((result) => setPhotoLibrary(result.assets));
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

  const renderZonePhotoTail = (zoneId: string) => {
    const urls = zoneImages[zoneId] || [];
    const layouts = (zonePhotoLayouts[zoneId] || []).filter((group) => group.placements.length > 0);
    if (!urls.length && !layouts.length) return null;
    return (
      <div className="flex flex-col items-center gap-3">
        {layouts.map((group) => (
          <div key={group.id} className="relative w-full max-w-2xl">
            <button
              type="button"
              onClick={() => openZoneImageUpload(zoneId)}
              className="block w-full overflow-hidden rounded-md border border-border bg-background text-left"
              aria-label={t.uploadZoneImage}
            >
              <PhotoLayoutBlock
                geometry={groupGeometry(group)}
                placements={group.placements}
                photoFor={(assetId) => zonePhotoSources.get(assetId)}
              />
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
    const nextFloorPlan = floorPlan ? { ...floorPlan, regions: regionsFromZoneRows(kept) } : floorPlan;
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

  const detectZonesFromBlob = async (blob: Blob, priorRegions: QuoteZoneRegion[]) => {
    setRecognizingZones(true);
    try {
      const jpeg = await imageBlobToJpegBase64(blob);
      const detected = await detectZonesFromJpegBase64(jpeg);
      const base = zoneManagerOpenRef.current
        ? zoneManagerDraftRef.current
        : zoneRowsFromItems(itemsRef.current, priorRegions);
      const { rows, added } = applyDetectedZones(base, detected, generateId);
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
            ? "These rooms are already on the quote. Adjust the areas, then confirm."
            : "這些房間已經在報價裡，可以調整範圍後再確認",
        );
      } else {
        toast.success(
          quoteLocale === "en"
            ? `Found ${added} room${added === 1 ? "" : "s"}. Adjust the areas, then confirm.`
            : `已找到 ${added} 個房間，可以調整範圍後再確認加入`,
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

  const handleFloorPlanFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(lowerName);
    if (!isPdf && !isImage) {
      toast.error(quoteLocale === "en" ? "Upload a PDF, JPG or PNG" : "請上傳 PDF / JPG / PNG");
      return;
    }
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
      toast.success(quoteLocale === "en" ? "Floor plan uploaded. Detecting zones…" : "已上傳平面圖，正在識別分區");
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
      await detectZonesFromBlob(visionBlob, priorRegions);
    } catch (error) {
      toast.error(quoteLocale === "en" ? "Could not upload the floor plan" : "平面圖上傳失敗", {
        description: error instanceof Error ? error.message : undefined,
      });
      setFloorPlanBusy(false);
    }
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
        if ("showCatalogSource" in cachedRecord) {
          setShowCatalogSource(cachedRecord.showCatalogSource !== false);
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
      showCatalogSource,
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
      showCatalogSource,
    ],
  );

  // Unsaved-work guard: dirty only when content differs from the loaded baseline.
  const currentSnapshot = useMemo(
    () => quoteDraftSnapshot(buildDraftData()),
    [buildDraftData],
  );

  const isDirty =
    snapshotReady &&
    hasQuoteData &&
    currentSnapshot !== baselineSnapshotRef.current;

  useEffect(() => {
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
      toast.error(quoteLocale === "en" ? "The quotation is still loading" : "報價內容仍在載入", {
        description: quoteLocale === "en"
          ? "Wait until everything has loaded before saving."
          : "請等報價內容載入完成再保存，以免漏掉項目。",
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
    baselineSnapshotRef.current = null;
    setSnapshotReady(false);
  }, [storageKey]);

  // Capture baseline once quote content has finished loading.
  useEffect(() => {
    if (!draftLoaded) return;
    if (existingQuote?.quoteUuid && !itemsLoadedFromDb) return;
    if (baselineSnapshotRef.current !== null) return;

    const timer = window.setTimeout(() => {
      baselineSnapshotRef.current = quoteDraftSnapshot(buildDraftData());
      setSnapshotReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [draftLoaded, existingQuote?.quoteUuid, itemsLoadedFromDb, buildDraftData]);

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
        category:
          categoryLabelFromRegistry(pair?.level1, pair?.level2) ||
          p.category?.trim() ||
          "",
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
      showCatalogSource,
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
    const formatStamp = (value: string | null | undefined) => {
      if (!value) return undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return value;
      return parsed.toLocaleDateString(quoteLocale === 'en' ? 'en-GB' : 'zh-HK');
    };
    const pdfFormat = {
      showRevisionDate: formatSettings.showRevisionDate,
      showLatestModifiedDate: formatSettings.showLatestModifiedDate,
      revisionDate: formatSettings.showRevisionDate
        ? formatStamp(existingQuote?.createdAt)
        : undefined,
      latestModifiedDate: formatSettings.showLatestModifiedDate
        ? formatStamp(existingQuote?.modifiedDate)
        : undefined,
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
      const { addressEn, address: _zhAddress, ...companyRest } = companyInfo;
      const enFullHtml = deliveryAddress
        ? injectDeliveryAddressIntoTermsHtml(
            termsContentEn.fullHtml || buildDefaultTermsFullHtmlEn(deliveryAddress),
            deliveryAddress,
          )
        : termsContentEn.fullHtml || buildDefaultTermsFullHtmlEn();
      return {
        companyInfo: {
          ...companyRest,
          address: addressEn || DEFAULT_COMPANY_ADDRESS.en,
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
        showCatalogSource,
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
    showCatalogSource,
  };
  };

  const shownVersion = existingQuote?.version
    ? displayQuoteVersion(existingQuote.version)
    : "—";
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
      navLockUntilRef.current = Date.now() + 800;
      const root = editorScrollRootRef.current;
      const el = document.getElementById(sectionId);
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
    },
    [],
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
                <button
                  type="button"
                  disabled={zoneRecognitionActive}
                  onClick={() => floorPlanInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 font-body text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                >
                  {zoneRecognitionActive ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {floorPlan ? t.replaceFloorPlan : t.uploadFloorPlan}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openZoneManager}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 font-body text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
                >
                  <FolderKanban className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.manageZones}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUnifyRateDraft("");
                    setUnifyRateModalOpen(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 font-body text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
                >
                  <Percent className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.unifyExchangeRate}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPdfPreview?.(buildPDFData())}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                >
                  <Eye className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.previewPdf}</span>
                </button>
                <button
                  type="button"
                  disabled={shareBusy}
                  onClick={() => void handleGenerateQuoteShare()}
                  className="inline-flex min-w-[12rem] items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 font-body text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                >
                  {shareBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4" />
                  )}
                  {t.generateQrLink}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveExistingVersion()}
                  disabled={isSavingDraft || !hasQuoteData}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 font-body text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
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
                  className="inline-flex min-w-[4.5rem] items-center justify-center rounded-lg border border-border bg-background px-3 py-2 font-body text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/50"
                  aria-label="語言"
                >
                  {t.langToggle}
                </button>
              </div>
            </div>
          </div>
          <div className="quote-editor-metrics" aria-label="報價金額摘要">
            {[
              { label: `${t.grandTotal} HKD`, value: `$${totalAmount.toLocaleString()}`, tone: "total" },
              { label: "Cost", value: `$${totalProductCost.toLocaleString()}`, tone: "cost" },
              { label: "GP", value: `$${gpValue.toLocaleString()} (${Math.round(gpPercent)}%)`, tone: "gp" },
              { label: "Ship", value: `$${gpSummary.ship.toLocaleString()}` },
              { label: "Installation", value: `$${gpSummary.installation.toLocaleString()}` },
              { label: ui('Discount 折扣', 'Discount'), value: `$${discountValue.toLocaleString()}` },
            ].map(({ label, value, tone }) => (
              <div key={label} className={cn("quote-editor-metric", tone && `is-${tone}`)}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
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
              <button
                key={id}
                type="button"
                aria-current={activeNav === id ? "step" : undefined}
                onClick={() => scrollToNav(id)}
                className={cn("quote-editor-nav-step", activeNav === id && "is-active")}
              >
                <span className="quote-editor-nav-number">{index + 1}</span>
                <span>{label}</span>
              </button>
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
                  <textarea
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
                    rows={2}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
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
                <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <p className="text-sm text-foreground">
                    {ui('圖冊附件', 'Catalog pages')}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {catalogPages.length > 0
                        ? ui(`${catalogPages.length} 頁，會加在報價 PDF 後面`, `${catalogPages.length} pages, added after the quotation PDF`)
                        : ui('可選不同圖冊的整頁', 'Whole pages from one or more catalogs')}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setCatalogDialogOpen(true)}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
                  >
                    {ui('選擇頁面', 'Choose pages')}
                  </button>
                </div>
                <p className="mb-4 border-b border-border/80 pb-3 text-xs text-muted-foreground">
                  {ui('產品項目', 'Products')} {productCount} · {ui('增值服務', 'Services')} {serviceCount} · {ui('備註標題', 'Titles')} {titleCount}{ui('；依報價單順序排列，可拖曳或上下移動調整位置。', '; drag or use the arrows to reorder items as they appear in the quotation.')}
                </p>
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
                  {items.length > 0 ? null : (
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
                          onUploadZoneImage={() => openZoneImageUpload(item.id)}
                          onRemoveZoneImage={(url) => removeZoneImage(item.id, url)}
                          onPreviewZoneImage={(imageIndex) =>
                            setZoneLightbox({ urls: zoneImages[item.id] || [], index: imageIndex })
                          }
                        />
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
                          onAssignZone={(value) => assignItemToZone(item.id, value)}
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
                      </div>
                      {/* 右：結果欄 — Cost、GP、單價換算 */}
                      <aside className="quote-fee-side">
                        <div className="quote-fee-side-sec">
                          <span className="quote-lrow-label">
                            <Wallet className="h-3.5 w-3.5" /> Cost 成本
                          </span>
                          <div className="quote-side-big font-mono-data">HKD ${totalProductCost.toLocaleString()}</div>
                        </div>
                        <div className="quote-fee-side-sec">
                          <span className="quote-lrow-label">GP 毛利</span>
                          <div className="quote-side-big font-mono-data text-emerald-700">
                            HKD ${gpValue.toLocaleString()}
                            <span className="quote-gp-pct">（{Math.round(gpPercent)}%）</span>
                          </div>
                          <div className="quote-gp-bar" role="img" aria-label={`GP ${Math.round(gpPercent)}%`}>
                            <i style={{ width: `${Math.min(100, Math.max(0, gpPercent))}%` }} />
                          </div>
                        </div>
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
                              className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center font-mono-data text-xs read-only:bg-muted/40"
                            />
                            <button
                              type="button"
                              disabled={summaryLocked}
                              onClick={applyPriceMultiplier}
                              className="rounded-lg bg-indigo-600 px-3 py-1 font-body text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
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
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-colors ${
                      termsEditMode
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "border border-border text-foreground/60 hover:bg-accent hover:text-foreground"
                    }`}
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
          baselineSnapshotRef.current = quoteDraftSnapshot(buildDraftData());
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
                  category:
                    categoryLabelFromRegistry(registryLevel1, registryLevel2) ||
                    item.category,
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

      <Modal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        size="md"
        icon={<QrCode className="h-6 w-6" />}
        title={t.generateQrLink}
        description="掃描 QR Code 或複製連結後，可免登入進入客戶專區查看此報價單，並瀏覽產品搜尋、傢俬訂製、付款+送貨、訂單狀況、成功案例、服務一覽、公司資料及聯絡我們等頁面（不含機構採購帳號）。"
        footer={
          <ModalButton
            variant="secondary"
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
              ) : null}
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
            <div className="mt-3 flex items-center gap-1.5 font-body text-[11px] text-muted-foreground">
              <Link2 className="h-3.5 w-3.5" />
              每次按「生成」都會建立全新連結與 QR Code
            </div>
      </Modal>

      {zoneLayoutEditor ? (
        <QuotePhotoLayoutEditor
          layouts={zonePhotoLayouts[zoneLayoutEditor.zoneId] ?? []}
          groupId={zoneLayoutEditor.groupId}
          assets={photoLibrary}
          productPhotos={quoteProductPhotos}
          photoZones={quotePhotoZones}
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
        title={t.manageZones}
        description={zoneRecognitionActive ? t.recognizingZonesDetail : t.manageZonesHint}
        footer={
          <>
            <ModalButton
              variant="secondary"
              className="border-dashed sm:mr-auto"
              disabled={zoneRecognitionActive}
              onClick={() => setZoneManagerDraft((prev) => [...prev, blankZoneManagerRow(generateId())])}
            >
              <Plus className="h-4 w-4" />
              {t.addZoneSpace}
            </ModalButton>
            <ModalButton variant="secondary" onClick={() => setZoneManagerOpen(false)}>
              {t.cancel}
            </ModalButton>
            <ModalButton onClick={() => void saveZoneManager()} disabled={zoneRecognitionActive || isSavingDraft}>{t.confirm}</ModalButton>
          </>
        }
      >
        <div className="space-y-3">
          {floorPlan?.regions.some((region) => !region.confirmed) ? (
            <p className="font-body text-xs text-amber-700">{t.floorPlanReconfirmHint}</p>
          ) : null}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div
                className={cn(
                  "relative h-[440px] overflow-hidden rounded-lg",
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
                {hasFloorPlanPreview ? (
                  <FloorPlanZoneCanvas
                    src={(floorPlan?.previewUrl || floorPlan?.url) as string}
                    zones={zoneManagerDraft}
                    activeId={activeZoneId}
                    createId={generateId}
                    disabled={zoneRecognitionActive}
                    deleteLabel={quoteLocale === "en" ? "Delete space" : "刪除空間"}
                    onChange={setZoneManagerDraft}
                    onActive={setActiveZoneId}
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
              <p className="font-body text-xs leading-5 text-muted-foreground">{t.floorPlanRecognizeHint}</p>
            </div>
          <div className="min-w-0 space-y-3">
          {zoneManagerDraft.length === 0 ? (
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
                      className="flex h-6 w-6 items-center justify-center rounded font-mono-data text-xs text-white"
                      style={{ background: floorPlanZoneColor(index) }}
                    >
                      {index + 1}
                    </span>
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
                      className="h-10 rounded-xl border-slate-200 bg-white shadow-none"
                    />
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
                      onClick={() =>
                        setZoneManagerDraft((prev) => prev.filter((row) => row.id !== zone.id))
                      }
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
        showSource={showCatalogSource}
        onOpenChange={setCatalogDialogOpen}
        onConfirm={(nextPages, nextShowSource) => {
          setCatalogPages(nextPages);
          setShowCatalogSource(nextShowSource);
          setCatalogDialogOpen(false);
        }}
      />

      <ImageLightbox
        open={zoneLightbox != null}
        onClose={() => setZoneLightbox(null)}
        images={zoneLightbox?.urls || []}
        startIndex={zoneLightbox?.index || 0}
        title={t.uploadZoneImage}
        thumbWidth={96}
      />

    </>
  );
}
