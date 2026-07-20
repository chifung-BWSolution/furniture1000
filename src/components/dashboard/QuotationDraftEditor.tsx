import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import {
  ChevronDown,
  Plus,
  Trash2,
  Copy,
  Scissors,
  ClipboardPaste,
  ShieldCheck,
  ImagePlus,
  Eye,
  Pencil,
  Check,
  Upload,
  X,
  GripVertical,
  Loader2,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TermsRichEditor } from "@/components/dashboard/TermsRichEditor";
import { RemarksRichEditor } from "@/components/dashboard/RemarksRichEditor";
import { toast } from "sonner";
import { SubmitReviewModal, type SubmitReviewResult } from "@/components/dashboard/SubmitReviewModal";
import { ProductSelectorModal } from "@/components/dashboard/ProductSelectorModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
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
  quickQuoteStepKey,
  resetQuickQuoteSessionStorage,
  shouldShowDraftRestoreNotice,
  shouldUseLocalQuoteDraft,
  writeQuickQuoteCopyFrom,
  writeQuickQuoteEditingId,
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
  formatHkdCostDisplayCeil,
  exchangeRateInputDisplay,
} from "@/lib/quoteCostExchange";
import { parseGpSummary } from "@/lib/quoteGpSummary";
import { quoteBillableProductCost, quoteBillableSubtotal, quoteItemLineSubtotal } from "@/lib/quoteItemTotals";
import {
  productSerialAt,
  sectionTitleOrdinalAt,
  sectionTitlePrefix,
} from "@/lib/quoteSectionTitle";
import {
  loadQuoteItems,
  itemsFromLegacyProjectData,
  resolvePitchingCode,
  type BwfQuoteItemInput,
} from "@/lib/bwfQuoteItems";
import type { QuoteCopyPayload } from "@/lib/quoteCopy";
import { bumpQuoteVersion, displayQuoteVersion } from "@/lib/quoteVersions";
import { isUrgentWorkPeriod } from "@/lib/quoteStockFilter";
import {
  type QuoteLocale,
  type QuoteUiLabels,
  quoteUi,
  quotePdf,
  DEFAULT_COMPANY_ADDRESS,
  DEFAULT_COMPANY_WEBSITE,
} from "@/lib/quotationLocale";
import {
  DEFAULT_QUOTATION_DELIVERY_DETAILS_EN,
  englishTermsContentForPdf,
  buildDefaultTermsFullHtmlEn,
} from "@/lib/quotationDefaultTermsEn";

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
  category?: string;
  material?: string;
  color?: string;
  remarks?: string;
  remarksImage?: string;
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
  /** lwh = 長×闊×高 (default); dh = 直徑×高 */
  dimensionMode?: QuotationDimensionMode;
  deliveryTermName?: string;
  factoryName?: string;
  /** True when 廠家 was set from 產品目錄 — shown read-only. */
  factoryFromCatalog?: boolean;
  /** Reference-only line — excluded from quote 合計 and GP Cost; PDF shows 可選產品 + checkbox. */
  isOptional?: boolean;
  isCustomTerm?: boolean;
  /** Section heading row (一、開放區) — not priced; draggable. */
  isSectionTitle?: boolean;
}

interface QuotationDraftEditorProps {
  formData: QuoteFormData;
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
  };
  /** Body fields copied from another quote (items, delivery, terms). Header uses formData. */
  initialCopyPayload?: QuoteCopyPayload | null;
  /** Always insert a new bwf_quote row (skip pitching dedup) — used for 複製報價單. */
  forceNewQuote?: boolean;
  /** Pre-assigned quote id for new drafts (step 4 URL persistence). */
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
    <div className="flex flex-col items-center gap-0.5">
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
  labels,
}: {
  itemId: string;
  cutItemId: string | null;
  onCut: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  labels: QuoteUiLabels;
}) {
  const isCut = cutItemId === itemId;
  return (
    <div className="flex h-[34px] items-center gap-0.5">
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
      <button
        type="button"
        onClick={() => onRemove(itemId)}
        className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
        title="刪除"
      >
        <Trash2 className="h-4 w-4" />
      </button>
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
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  title: string;
  previewUrl?: string;
  /** When set, uploads to Supabase Storage and passes back HTTP URL. */
  uploadImage?: (file: File) => Promise<string>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {previewUrl ? (
          <div className="mb-4 flex max-h-[50vh] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20 p-3">
            <img
              src={previewUrl}
              alt=""
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
      </div>
    </div>
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
}: {
  value: string;
  onChange: (url: string) => void;
  modalTitle?: string;
  sizePx?: number;
  imageFit?: "cover" | "contain";
  /** Expand to fill grid column width (keeps square aspect ratio) */
  fluid?: boolean;
  uploadImage?: (file: File) => Promise<string>;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "relative flex aspect-square items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30 cursor-pointer group",
          fluid && "w-full min-h-[6.5rem] xl:min-h-[8rem]",
        )}
        style={fluid ? undefined : { width: sizePx, height: sizePx }}
        onClick={() => setModalOpen(true)}
        title={value ? "點擊查看或更換圖片" : "點擊上傳圖片"}
      >
        {value ? (
          <>
            <img
              src={value}
              alt=""
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
              className="absolute -top-1 -right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow"
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
      />
    </>
  );
}

function QuoteFieldBlock({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label className="mb-1 block h-4 font-body text-xs font-medium leading-4 text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const QUOTE_INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30";

/** ~15 Chinese characters — 顏色 */
const QUOTE_SHORT_TEXT_INPUT_CLASS = `${QUOTE_INPUT_CLASS} max-w-[15em]`;

const QUOTE_NUMBER_INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30";

const QUOTE_COMPACT_NUMBER_INPUT_CLASS = `${QUOTE_NUMBER_INPUT_CLASS} min-w-0`;

/** Left column width — 類別、顏色、備註等短文字欄 */
const QUOTE_LEFT_COL_CLASS = "w-[15em] max-w-full shrink-0";

/**
 * Grid track widths — below xl: fixed caps. At xl: cols 3–4 use wider calc tracks (size only);
 * position alignment uses ml nudge on the field blocks, not column shrink on pricing cols.
 */
const QUOTE_CARD_GRID = cn(
  "grid w-full auto-rows-min items-start gap-x-3 gap-y-3",
  "grid-cols-[1.75rem_minmax(0,15em)_minmax(6.5rem,min(16rem,1fr))_minmax(6.5rem,min(16rem,1fr))_6em_6em_minmax(0,1fr)_6.5rem_auto]",
  "xl:gap-x-2 xl:grid-cols-[1.75rem_minmax(0,15em)_minmax(8rem,calc((56%-1.75rem-15em-2rem)/2))_minmax(8rem,calc((56%-1.75rem-15em-2rem)/2))_6em_6em_minmax(0,1fr)_6.5rem_auto]",
);

/** xl: shift media block right — align with 「案」 in 專案分類 (position only) */
const QUOTE_CARD_MEDIA_XL_SHIFT = "xl:ml-[4rem]";
/** xl: shift 單價 only — 數量/成本 use separate offset below */
const QUOTE_CARD_PRICING_XL_SHIFT = "xl:ml-[15rem]";
/** ~6 Chinese chars — 單價 (single-line label + input) */
const QUOTE_PRICING_FIELD_CLASS = cn(
  "w-[6em] min-w-[6em] max-w-[6em] shrink-0 [&_label]:whitespace-nowrap",
  QUOTE_CARD_PRICING_XL_SHIFT,
);
/** 數量 · 成本價 — same col, left-aligned labels, 6rem left of 單價 offset */
const QUOTE_QTY_COST_FIELD_CLASS = cn(
  "w-[6em] min-w-[6em] max-w-[6em] shrink-0 [&_label]:whitespace-nowrap",
  "xl:ml-[9rem]",
);

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
  value,
  locked,
  factories,
  loading,
  onChange,
}: {
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
          <span className="truncate">{value || "選擇廠家"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" side="bottom" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="搜尋廠家..."
            value={search}
            onValueChange={setSearch}
            className="h-8 font-body text-xs"
          />
          <CommandList style={{ maxHeight: FACTORY_DROPDOWN_MAX_HEIGHT }}>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="font-body text-xs text-muted-foreground">載入中...</span>
              </div>
            ) : (
              <>
                <CommandEmpty>
                  <p className="py-3 font-body text-xs text-muted-foreground">沒有找到廠家</p>
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

function QuoteProductItemCard({
  item,
  index,
  serialNumber,
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
  unifyExchangeRatesFromFirst,
  showUnifyExchangeRate,
  cutItem,
  duplicateItem,
  removeItem,
  factories,
  factoriesLoading,
  quoteImageScope,
  labels,
}: {
  item: QuotationItem;
  index: number;
  serialNumber: number;
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
  unifyExchangeRatesFromFirst: () => void;
  /** True only for the first product row (moves with reorder). */
  showUnifyExchangeRate: boolean;
  cutItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  removeItem: (id: string) => void;
  factories: string[];
  factoriesLoading: boolean;
  /** Scope for Supabase Storage paths (quote id or draft key). */
  quoteImageScope: string;
  labels: QuoteUiLabels;
}) {
  const dimensionMode = item.dimensionMode ?? 'lwh';
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
        "rounded-lg border border-border bg-background p-4",
      )}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
    >
      <div className={QUOTE_CARD_GRID}>
        {/* Col 1 — serial + drag handle (both rows) */}
        <div className="col-start-1 row-span-2 row-start-1 flex justify-center pt-4">
          <QuoteRowDragHandle
            itemId={item.id}
            serialNumber={serialNumber}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>

        {/* Row 1 — col 2: 類別 · 尺寸 · 顏色 */}
        <div className="col-start-2 row-start-1 min-w-0 w-full space-y-2">
          <QuoteFieldBlock label={labels.category}>
            <textarea
              value={item.category || ""}
              placeholder="—"
              rows={2}
              onChange={(e) => updateItem(item.id, "category", e.target.value)}
              className={`${QUOTE_INPUT_CLASS} min-h-[34px] resize-y leading-relaxed`}
            />
          </QuoteFieldBlock>
          <div className="min-w-0">
            <div className="mb-1 flex min-h-[22px] flex-wrap items-center gap-1.5 font-body text-xs font-medium text-muted-foreground">
              <span className="shrink-0 leading-normal">{labels.dimensionsMm}</span>
              <select
                value={dimensionMode}
                onChange={(e) =>
                  updateDimensionMode(item.id, e.target.value as QuotationDimensionMode)
                }
                className="h-[22px] min-w-0 max-w-full cursor-pointer rounded-md border border-border bg-background px-1.5 font-body text-xs leading-normal text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="lwh">{labels.dimLwh}</option>
                <option value="dh">{labels.dimDh}</option>
              </select>
            </div>
            <div className="grid w-full min-w-0 grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-x-1">
              <input
                type="number"
                min={0}
                value={item.dimensionLMm ?? ""}
                placeholder={isDiameterHeight ? "D" : "L"}
                onChange={(e) =>
                  updateItem(item.id, "dimensionLMm", parseNonNegativeDimension(e.target.value))
                }
                className={QUOTE_DIMENSION_INPUT_CLASS}
              />
              <span className="shrink-0 text-xs text-muted-foreground">×</span>
              {isDiameterHeight ? (
                <>
                  <input
                    type="number"
                    min={0}
                    value={item.dimensionHMm ?? ""}
                    placeholder="H"
                    onChange={(e) =>
                      updateItem(item.id, "dimensionHMm", parseNonNegativeDimension(e.target.value))
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
                    type="number"
                    min={0}
                    value={item.dimensionWMm ?? ""}
                    placeholder="W"
                    onChange={(e) =>
                      updateItem(item.id, "dimensionWMm", parseNonNegativeDimension(e.target.value))
                    }
                    className={QUOTE_DIMENSION_INPUT_CLASS}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">×</span>
                  <input
                    type="number"
                    min={0}
                    value={item.dimensionHMm ?? ""}
                    placeholder="H"
                    onChange={(e) =>
                      updateItem(item.id, "dimensionHMm", parseNonNegativeDimension(e.target.value))
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

        {/* Row 1 — cols 3–4: 材質及明細 */}
        <QuoteFieldBlock
          label={labels.material}
          className={cn("col-span-2 col-start-3 row-start-1 min-w-0", QUOTE_CARD_MEDIA_XL_SHIFT)}
        >
          <textarea
            value={item.material || ""}
            placeholder="材質及明細..."
            rows={7}
            onChange={(e) => updateItem(item.id, "material", e.target.value)}
            className={`${QUOTE_INPUT_CLASS} resize-y leading-relaxed`}
          />
        </QuoteFieldBlock>

        {/* Col 5 row 1 — 數量 + 廠家（垂直置中於數量與 CNY 之間） */}
        <div
          className={cn(
            "col-start-5 row-start-1 flex min-h-0 flex-col self-stretch",
            QUOTE_QTY_COST_FIELD_CLASS,
          )}
        >
          <QuoteFieldBlock label={labels.quantity} className="shrink-0">
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
          <div className="flex min-h-0 flex-1 items-center">
            <QuoteFieldBlock label={labels.factory} className="w-full">
              <QuoteFactoryField
                value={item.factoryName || ""}
                locked={Boolean(item.factoryFromCatalog)}
                factories={factories}
                loading={factoriesLoading}
                onChange={(name) => updateItem(item.id, "factoryName", name)}
              />
            </QuoteFieldBlock>
          </div>
        </div>

        {/* Col 5 row 2 — CNY成本 · 匯率 · HKD成本（與 HKD$單價同高） */}
        <div
          className={cn(
            "col-start-5 row-start-2 flex min-h-0 flex-col self-stretch",
            QUOTE_QTY_COST_FIELD_CLASS,
          )}
        >
          <QuoteFieldBlock label={labels.cnyCost} className="shrink-0">
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
          <div className="flex min-h-0 flex-1 items-center py-0.5">
            <QuoteFieldBlock label={labels.exchangeRate} className="w-full">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={exchangeRateInputDisplay(item.exchangeRateInput, item.exchangeRate)}
                  placeholder="—"
                  onChange={(e) => updateExchangeRate(item.id, e.target.value)}
                  className={cn(QUOTE_COMPACT_NUMBER_INPUT_CLASS, "min-w-0 flex-1")}
                />
                {showUnifyExchangeRate ? (
                  <button
                    type="button"
                    onClick={unifyExchangeRatesFromFirst}
                    title={labels.unifyExchangeRate}
                    className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-1 font-body text-[10px] font-medium leading-tight text-primary transition-colors hover:bg-primary/15"
                  >
                    {labels.unifyExchangeRate}
                  </button>
                ) : null}
              </div>
            </QuoteFieldBlock>
          </div>
          <QuoteFieldBlock label={labels.hkdCost} className="shrink-0">
            <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
              <span className="truncate font-mono-data text-xs font-medium text-foreground">
                {formatHkdCostDisplayCeil(item.hkdCostPrice)}
              </span>
            </div>
          </QuoteFieldBlock>
        </div>

        {/* Row 1 — col 6: 單位 (aligned with 單價 below) */}
        <QuoteFieldBlock
          label={labels.unit}
          className={cn("col-start-6 row-start-1", QUOTE_PRICING_FIELD_CLASS)}
        >
          <input
            type="text"
            value={item.unit || ""}
            placeholder="—"
            maxLength={4}
            onChange={(e) => updateItem(item.id, "unit", e.target.value)}
            className={QUOTE_INPUT_CLASS}
          />
        </QuoteFieldBlock>

        {/* Row 2 — col 2: 備註 */}
        <QuoteFieldBlock label={labels.remarks} className="col-start-2 row-start-2 min-w-0">
          <RemarksRichEditor
            key={item.id}
            compact
            value={item.remarks || ""}
            legacyImage={item.remarksImage}
            onChange={(val) => updateItem(item.id, "remarks", val)}
            uploadImage={uploadRemarksImage}
          />
        </QuoteFieldBlock>

        {/* Row 2 — cols 3–4: 圖片 · 參考圖 */}
        <QuoteFieldBlock
          label={labels.image}
          className={cn("col-start-3 row-start-2 min-w-0", QUOTE_CARD_MEDIA_XL_SHIFT)}
        >
          <ReferenceImageCell
            value={item.image || ""}
            onChange={(url) => updateItem(item.id, "image", url)}
            modalTitle="上傳產品圖片"
            imageFit="contain"
            fluid
            uploadImage={uploadProductImage}
          />
        </QuoteFieldBlock>
        <QuoteFieldBlock
          label={labels.referenceImage}
          className={cn("col-start-4 row-start-2 min-w-0", QUOTE_CARD_MEDIA_XL_SHIFT)}
        >
          <ReferenceImageCell
            value={item.referenceImage || ""}
            onChange={(url) => updateItem(item.id, "referenceImage", url)}
            modalTitle="上傳參考圖"
            imageFit="contain"
            fluid
            uploadImage={uploadReferenceImage}
          />
        </QuoteFieldBlock>

        <QuoteFieldBlock
          label={labels.hkdUnitPrice}
          className={cn("col-start-6 row-start-2", QUOTE_PRICING_FIELD_CLASS)}
        >
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

        {/* Row 1 — col 8: 可選產品 (above HKD$小計) */}
        <div className="col-start-8 row-start-1 flex min-w-0 items-end justify-end">
          <label className="flex cursor-pointer items-center gap-1.5">
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
        </div>

        {/* Row 2 — col 8: 小計 */}
        <QuoteFieldBlock label={labels.hkdSubtotal} className="col-start-8 row-start-2 min-w-0">
          <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
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

        {/* Row 2 — col 9: 剪下 / 複製 / 刪除 */}
        <div className="col-start-9 row-start-2 shrink-0">
          <div className="mb-1 h-4" aria-hidden="true" />
          <QuoteRowActionButtons
            itemId={item.id}
            cutItemId={cutItemId}
            onCut={cutItem}
            onDuplicate={duplicateItem}
            onRemove={removeItem}
            labels={labels}
          />
        </div>
      </div>
    </div>
  );
}

function QuoteCustomTermCard({
  item,
  index,
  serialNumber,
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
}: {
  item: QuotationItem;
  index: number;
  serialNumber: number;
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
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <QuoteFieldBlock label={labels.quantity}>
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
            <QuoteFieldBlock label={labels.unit}>
              <input
                type="text"
                value={item.unit || ""}
                placeholder="—"
                maxLength={4}
                onChange={(e) => updateItem(item.id, "unit", e.target.value)}
                className={QUOTE_INPUT_CLASS}
              />
            </QuoteFieldBlock>
            <QuoteFieldBlock label={labels.hkdUnitPrice}>
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
            <QuoteFieldBlock label={labels.hkdSubtotal}>
              <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
                <span className="font-mono-data text-xs font-medium text-foreground">
                  ${(item.unitPrice * item.quantity).toLocaleString()}
                </span>
              </div>
            </QuoteFieldBlock>
            <div className="flex items-end justify-end pb-0.5">
              <QuoteRowActionButtons
                itemId={item.id}
                cutItemId={cutItemId}
                onCut={cutItem}
                onDuplicate={duplicateItem}
                onRemove={removeItem}
                labels={labels}
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
}: {
  item: QuotationItem;
  index: number;
  items: QuotationItem[];
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
}) {
  const ordinal = sectionTitleOrdinalAt(items, index);
  const prefix = sectionTitlePrefix(ordinal);

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
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-display text-sm font-bold text-foreground/80">
            {prefix}
          </span>
          <input
            type="text"
            value={item.name || ""}
            placeholder={labels.sectionTitlePlaceholder}
            onChange={(e) => updateItem(item.id, "name", e.target.value)}
            className={cn(QUOTE_INPUT_CLASS, "font-display text-sm font-semibold")}
            aria-label={labels.sectionTitleLabel}
          />
        </div>
        <div className="flex shrink-0 items-center">
          <QuoteRowActionButtons
            itemId={item.id}
            cutItemId={cutItemId}
            onCut={cutItem}
            onDuplicate={duplicateItem}
            onRemove={removeItem}
            labels={labels}
          />
        </div>
      </div>
    </div>
  );
}

function InfoPanelColumn({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "self-start overflow-hidden rounded-xl border bg-card shadow-sm",
        !collapsed && "border-primary/35 ring-1 ring-primary/15",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <h2 className="font-display text-sm font-bold text-foreground/80">{title}</h2>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            !collapsed && "rotate-180",
          )}
        />
      </button>
      {!collapsed && (
        <div className="space-y-3 border-t border-border/60 px-3 pb-4 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}

const DIMENSION_INPUT_CLASS =
  "w-12 rounded-md border border-border bg-background px-1 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

function parseNonNegativeDimension(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, n);
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

function QuoteAddRowButtonGroup({
  labels,
  onAddSectionTitle,
  onAddField,
  onAddCustomTerm,
  onAddProduct,
  onPaste,
  showPaste = false,
  compact = false,
}: {
  labels: QuoteUiLabels;
  onAddSectionTitle: () => void;
  onAddField: () => void;
  onAddCustomTerm: () => void;
  onAddProduct: () => void;
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
        onClick={onAddSectionTitle}
        className={cn(
          btnBase,
          "border-sky-500/50 text-sky-700 hover:bg-sky-500/5 dark:text-sky-400",
        )}
      >
        <Plus className={iconClass} />
        {labels.addSectionTitle}
      </button>
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
          "border-amber-500/50 text-amber-600 hover:bg-amber-500/5",
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
          "border-primary/40 text-primary hover:bg-primary/5",
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

/** Rows created via 新建欄位 may have category/material but no product name — still export to PDF. */
function hasQuoteItemContent(item: QuotationItem): boolean {
  if (item.isSectionTitle || item.isCustomTerm) {
    return Boolean((item.name || "").trim());
  }
  return Boolean(
    (item.name || "").trim() ||
      (item.category || "").trim() ||
      (item.material || "").trim() ||
      (item.color || "").trim() ||
      (item.remarks || "").trim() ||
      item.image ||
      item.referenceImage ||
      item.remarksImage ||
      (item.unitPrice ?? 0) > 0 ||
      item.costPrice != null ||
      item.dimensionLMm != null ||
      item.dimensionWMm != null ||
      item.dimensionHMm != null ||
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
    category: item.category,
    material: item.material,
    color: item.color,
    remarks: item.remarks,
    remarksImage: item.remarksImage,
    referenceImage: item.referenceImage,
    dimensionLMm: item.dimensionLMm ?? null,
    dimensionWMm: item.dimensionWMm ?? null,
    dimensionHMm: item.dimensionHMm ?? null,
    dimensionMode:
      (item as { dimensionMode?: QuotationDimensionMode }).dimensionMode ?? "lwh",
    deliveryTermName: item.deliveryTermName,
    factoryName: item.factoryName || "",
    factoryFromCatalog: item.factoryFromCatalog ?? false,
    isCustomTerm: item.isCustomTerm,
    isOptional: item.isOptional ?? false,
    isSectionTitle: item.isSectionTitle ?? false,
  };
}

export function QuotationDraftEditor({
  formData,
  onBack: _onBack,
  userEmail,
  onOpenPdfPreview,
  onQuotePersisted,
  existingQuote,
  initialCopyPayload,
  forceNewQuote = false,
  draftQuoteId = null,
}: QuotationDraftEditorProps) {
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
      }
    | undefined;
  const savedDeliveryDetails = savedProjectData.deliveryDetails as
    | string
    | undefined;
  const legacyItems = itemsFromLegacyProjectData(
    savedProjectData as Record<string, unknown>,
  );
  const quoteIdDisplay = resolvePitchingCode({
    quoteId: existingQuote?.quoteId || formData.quoteId,
    pitchingCode: formData.pitchingCode,
    formData: formData as unknown as Record<string, unknown>,
    quoteMeta: savedQuoteMeta as unknown as Record<string, unknown>,
  });
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

  // Info panel section collapse states (all collapsed by default)
  const [collapseCompany, setCollapseCompany] = useState(true);
  const [collapseProject, setCollapseProject] = useState(true);
  const [collapseClient, setCollapseClient] = useState(true);
  const [collapseQuoteMeta, setCollapseQuoteMeta] = useState(true);

  // Company info (editable) — address / addressEn keep separate zh & en defaults;
  // after the user edits and saves, the saved value becomes the latest for that locale.
  const [companyInfo, setCompanyInfo] = useState({
    name: savedCompanyInfo?.name || formData.company || "Branding Works Design Ltd",
    address: savedCompanyInfo?.address || DEFAULT_COMPANY_ADDRESS.zh,
    addressEn: savedCompanyInfo?.addressEn || DEFAULT_COMPANY_ADDRESS.en,
    phone: savedCompanyInfo?.phone || "51634839/ 97173545",
    email: savedCompanyInfo?.email || "sales@brandingworks-furniture.com",
    website: savedCompanyInfo?.website || DEFAULT_COMPANY_WEBSITE,
  });

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
    validity: savedQuoteMeta?.validity || formData.validityDays || "30",
    deliveryAddress: savedQuoteMeta?.deliveryAddress || "",
  });
  const [quoteId] = useState(quoteIdDisplay);

  // Delivery details (editable)
  const [deliveryDetails, setDeliveryDetails] = useState(
    copyPayload?.deliveryDetails ??
      savedDeliveryDetails ??
      "訂單生產時間自收到訂金起計算，預計3-4 週完成。交付及安裝將分兩日進行：交付後1-2 個工作日內完成安裝。",
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

  // Product items table
  const [factories, setFactories] = useState<string[]>([]);
  const [factoriesLoading, setFactoriesLoading] = useState(false);
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
  /** Prevents async loadQuoteItems from overwriting in-session user edits. */
  const itemsUserEditedRef = useRef(false);
  /** Tracks which quote uuid already hydrated items in this editor session. */
  const itemsHydratedForUuidRef = useRef<string | null>(null);

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
    if (itemsUserEditedRef.current || itemsHydratedForUuidRef.current) {
      itemsHydratedForUuidRef.current = quoteUuid;
      setItemsLoadedFromDb(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await loadQuoteItems(quoteUuid);
        if (cancelled) return;
        if (itemsUserEditedRef.current) {
          itemsHydratedForUuidRef.current = quoteUuid;
          return;
        }
        if (rows.length > 0) {
          setItems(rows.map((item) => mapInputToQuotationItem(item)));
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
      const clone: QuotationItem = {
        ...source,
        id: generateId(),
      };
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

  /** Copy the first product row's 匯率 onto every product row on the page. */
  const unifyExchangeRatesFromFirst = useCallback(() => {
    itemsUserEditedRef.current = true;
    setItems((prev) => {
      const firstProduct = prev.find(
        (item) => !item.isSectionTitle && !item.isCustomTerm,
      );
      if (!firstProduct) return prev;
      const rate = firstProduct.exchangeRate ?? null;
      const rateInput =
        firstProduct.exchangeRateInput !== undefined
          ? firstProduct.exchangeRateInput
          : rate == null
            ? ""
            : String(rate);
      return prev.map((item) => {
        if (item.isSectionTitle || item.isCustomTerm) return item;
        if (
          item.id === firstProduct.id &&
          item.exchangeRate === rate &&
          item.exchangeRateInput === rateInput
        ) {
          return item;
        }
        return {
          ...item,
          exchangeRateInput: rateInput,
          exchangeRate: rate,
          hkdCostPrice: computeHkdCostPrice(item.costPrice, rate),
        };
      });
    });
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
  const grandTotal = Math.max(0, subtotal - discountValue + installationAmount);
  // Exclude 可選產品 from GP Cost (same rule as 合計 / quoteBillableSubtotal).
  const totalProductCost = quoteBillableProductCost(items);
  const gpValue = grandTotal - totalProductCost - gpSummary.ship - gpSummary.installation;
  const gpPercent = grandTotal > 0 ? (gpValue / grandTotal) * 100 : 0;
  const totalCostPrice = totalProductCost;

  // Version & submission modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastLocalSavedAt, setLastLocalSavedAt] = useState<number | null>(null);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);

  const handleOpenSubmitReview = () => {
    const contentItems = items.filter(hasQuoteItemContent);
    if (contentItems.length === 0) {
      toast.error("無法提交審核", {
        description:
          "目前沒有報價內容（總額可能為 HK$0）。若剛才頁面曾異常，請先按「暫存草稿」或重新整理以恢復草稿。",
      });
      return;
    }
    if (grandTotal <= 0) {
      toast.error("無法提交審核", {
        description:
          "報價總金額為 HK$0。請確認品項單價／數量後再提交；若資料異常消失，請重新整理以恢復草稿。",
      });
      return;
    }
    setShowSubmitModal(true);
  };
  const currentVersion = useMemo(() => {
    const base =
      existingQuote?.maxVersionInChain || existingQuote?.version || null;
    return bumpQuoteVersion(base);
  }, [existingQuote?.maxVersionInChain, existingQuote?.version]);

  // Product selector modal state
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  /** Index where products from the selector should be inserted (0 = start). */
  const productInsertAtRef = useRef(0);

  // Draft state — baseline snapshot detects unsaved edits vs loaded content.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const draftHydratedRef = useRef<string | null>(null);
  const baselineSnapshotRef = useRef<string | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);

  const rawQuoteId = existingQuote?.quoteId || draftQuoteId || "NEW";
  const storageKey = makeDraftKey(userEmail, rawQuoteId);
  const quoteImageScope = existingQuote?.quoteId || rawQuoteId;

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
        if (cached.companyInfo) {
          const cachedCompany = cached.companyInfo as Partial<typeof companyInfo>;
          setCompanyInfo({
            name:
              cachedCompany.name ||
              formData.company ||
              "Branding Works Design Ltd",
            address: cachedCompany.address || DEFAULT_COMPANY_ADDRESS.zh,
            addressEn: cachedCompany.addressEn || DEFAULT_COMPANY_ADDRESS.en,
            phone: cachedCompany.phone || "51634839/ 97173545",
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
          };
          setQuoteMeta({
            pmName: meta.pmName || quoteMeta.pmName,
            validity: meta.validity || quoteMeta.validity,
            deliveryAddress: meta.deliveryAddress || "",
          });
        }
        if (cached.deliveryDetails) {
          setDeliveryDetails(cached.deliveryDetails);
        }
        const cachedRecord = cached as unknown as Record<string, unknown>;
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
        if (cached.termsContent) {
          const cachedMeta = cached.quoteMeta as { deliveryAddress?: string } | undefined;
          setTermsContent(
            migrateTermsContentToCurrent(
              cached.termsContent as SavedTermsContent,
              cachedMeta?.deliveryAddress,
            ),
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
      termsContent: termsContent as unknown as Record<string, unknown>,
      items: items.map(
        ({ id, exchangeRateInput: _exchangeRateInput, ...rest }) =>
          rest as unknown as Record<string, unknown>,
      ),
      subtotal,
      discountNote,
      installationFee,
      gpSummary,
      priceMultiplier: parseFloat(priceMultiplier) || 1,
    }),
    [
      storageKey,
      formData,
      companyInfo,
      clientInfo,
      quoteMeta,
      deliveryDetails,
      termsContent,
      items,
      subtotal,
      discountNote,
      installationFee,
      gpSummary,
      priceMultiplier,
    ],
  );

  // Unsaved-work guard: dirty only when content differs from the loaded baseline.
  const currentSnapshot = useMemo(
    () => JSON.stringify(buildDraftData()),
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
    // NEW quotes have no editing id — keep wizard on step 4 after reload.
    if (typeof window !== "undefined") {
      sessionStorage.setItem(quickQuoteStepKey(userEmail), "4");
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

  const handleSaveLocalDraft = async () => {
    if (!hasQuoteData) {
      toast.error("尚無報價內容可暫存");
      return;
    }
    setIsSavingDraft(true);
    try {
      await saveDraft(buildDraftData());
      persistLocalDraftMarkers();
      setLastLocalSavedAt(Date.now());
      setAutoSaveFailed(false);
      toast.success("草稿已暫存", {
        description: "僅保存在此瀏覽器。完成後請再按「版本審核」正式提交。",
      });
    } catch (err: unknown) {
      setAutoSaveFailed(true);
      const message =
        err instanceof Error ? err.message : "無法寫入本機草稿，請檢查瀏覽器儲存空間";
      toast.error("暫存失敗", { description: message });
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
      baselineSnapshotRef.current = JSON.stringify(buildDraftData());
      setSnapshotReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [draftLoaded, existingQuote?.quoteUuid, itemsLoadedFromDb, buildDraftData]);

  // Auto-save draft locally while dirty (no need to mash「暫存草稿」).
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
        category: p.category?.trim() || "",
        material: p.material,
        color: p.color?.trim() || "",
        remarks: p.remarks,
        dimensionLMm: p.dimensionLMm,
        dimensionWMm: p.dimensionWMm,
        dimensionHMm: p.dimensionHMm,
        dimensionMode: 'lwh' as const,
        deliveryTermName: p.deliveryTermName,
        factoryName: p.factoryName?.trim() || "",
        factoryFromCatalog: Boolean(p.factoryName?.trim()),
      };
    });

    const insertAt = productInsertAtRef.current;
    setItems((prev) => insertItemsAt(prev, newRows, insertAt));
    productInsertAtRef.current = 0;
    setActiveItemId(null);
  };

  const buildProjectData = () => {
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
      clientName: clientInfo.name,
      clientContactName: clientInfo.contactName || '',
      clientPhone: clientInfo.phone,
      clientEmail: clientInfo.email,
      ...(pitchingId ? { pmsPitchingId: pitchingId } : {}),
      ...(projectId ? { pmsProjectId: projectId } : {}),
    };
    // Items live in bwf_quote_item — omit from project_data JSON.
    return {
      formData: nextFormData,
      companyInfo,
      clientInfo,
      quoteMeta,
      deliveryDetails,
      termsContent,
      subtotal,
      discountNote,
      discountValue,
      grandTotal,
      installationFee,
      gpSummary,
      priceMultiplier: parseFloat(priceMultiplier) || 1,
    };
  };

  const buildPDFData = (): QuotationPDFData => {
    const deliveryAddress = resolveDeliveryAddress(
      termsContent.fullHtml,
      quoteMeta.deliveryAddress,
    );
    const dateLocale = quoteLocale === 'en' ? 'en-GB' : 'zh-HK';

    if (quoteLocale === 'en') {
      const pdfLabels = quotePdf('en');
      const { addressEn, address: _zhAddress, ...companyRest } = companyInfo;
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
            : undefined,
          date: new Date().toLocaleDateString(dateLocale, {
            year: "numeric",
            month: "numeric",
            day: "numeric",
          }),
        },
        locale: 'en',
        deliveryDetails: DEFAULT_QUOTATION_DELIVERY_DETAILS_EN,
        termsContent: englishTermsContentForPdf(deliveryAddress),
        items: items
          .filter(hasQuoteItemContent)
          .map((item) => ({
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
            unit: item.unit,
          })),
        subtotal,
        discountNote,
        installationFee: {
          ...installationFee,
          title: pdfLabels.installTitle,
          subtitle: pdfLabels.installSubtitle,
          conditionText: pdfLabels.installCondition,
        },
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
        : undefined,
      date: new Date().toLocaleDateString(dateLocale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }),
    },
    locale: 'zh',
    deliveryDetails,
    termsContent: {
      ...termsContent,
      fullHtml: fullHtmlForPdf,
    },
    items: items
      .filter(hasQuoteItemContent)
      .map((item) => ({
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
        unit: item.unit,
      })),
    subtotal,
    discountNote,
    installationFee,
  };
  };

  return (
    <>
      <div ref={editorScrollRootRef} className="h-full overflow-y-auto bg-background">
        {/* Header — span full available width (parent already adds small side
            padding) so 報價內容 stretches left-and-right and needs less scrolling */}
        <div className="mx-auto w-full max-w-none">
          {/* Info panels + action buttons — above 報價內容
              Top row: 預覽 PDF (above 立即暫存) · ENG (above 版本審核)
              Main row: 公司資訊 / 專案分類 / 客戶資訊 / 報價資訊 / 立即暫存 / 版本審核 */}
          <div className="mb-5 space-y-2">
            {/* Top row — 預覽 PDF above 立即暫存, ENG above 版本審核 */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
              <div className="hidden lg:col-span-4 lg:block" aria-hidden />
              <div className="flex justify-stretch">
                <button
                  type="button"
                  onClick={() => onOpenPdfPreview?.(buildPDFData())}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 font-body text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Eye className="h-4 w-4" />
                  {t.previewPdf}
                </button>
              </div>
              <div className="flex justify-stretch">
                <button
                  type="button"
                  onClick={() => setQuoteLocale((l) => (l === 'zh' ? 'en' : 'zh'))}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-3 py-2 font-body text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/50"
                >
                  {t.langToggle}
                </button>
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-2 items-start gap-2 lg:grid-cols-6">
              <InfoPanelColumn
                title="公司資訊"
                collapsed={collapseCompany}
                onToggle={() => setCollapseCompany((v) => !v)}
              >
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    公司名稱
                  </label>
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono-data text-xs text-foreground/80">
                    {companyInfo.name}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    地址
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
                    電話
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
                    電郵
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
                    網站
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
                title="專案分類"
                collapsed={collapseProject}
                onToggle={() => setCollapseProject((v) => !v)}
              >
                <div>
                  <label className="mb-1.5 block font-body text-xs text-muted-foreground">
                    客戶產業
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {formData.clientIndustry.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 font-body text-xs font-medium text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                    {formData.clientIndustry.length === 0 && (
                      <span className="font-body text-xs text-muted-foreground/60">
                        —
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block font-body text-xs text-muted-foreground">
                    辦公室傢俬級別
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {formData.quotationType.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex rounded-full bg-orange-500/10 px-2.5 py-0.5 font-body text-xs font-medium text-orange-600 dark:text-orange-400"
                      >
                        {tag}
                      </span>
                    ))}
                    {formData.quotationType.length === 0 && (
                      <span className="font-body text-xs text-muted-foreground/60">
                        —
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block font-body text-xs text-muted-foreground">
                    辦公室傢俬類別
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {formData.serviceScope.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-body text-xs font-medium text-emerald-600 dark:text-emerald-400"
                      >
                        {tag}
                      </span>
                    ))}
                    {formData.serviceScope.length === 0 && (
                      <span className="font-body text-xs text-muted-foreground/60">
                        —
                      </span>
                    )}
                  </div>
                </div>
                <p className="font-body text-xs text-muted-foreground/60">
                  * 如需修改，請點擊「基本資訊」回到編輯頁
                </p>
              </InfoPanelColumn>

              <InfoPanelColumn
                title="客戶資訊"
                collapsed={collapseClient}
                onToggle={() => setCollapseClient((v) => !v)}
              >
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    公司名稱
                  </label>
                  <input
                    type="text"
                    value={clientInfo.name}
                    onChange={(e) =>
                      setClientInfo((p) => ({ ...p, name: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    客戶名稱
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
                    placeholder="聯絡人姓名"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    電話
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
                    電郵
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
                title="報價資訊"
                collapsed={collapseQuoteMeta}
                onToggle={() => setCollapseQuoteMeta((v) => !v)}
              >
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    報價單號
                  </label>
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono-data text-xs text-foreground/80">
                    {quoteId || "—"}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    負責人
                  </label>
                  <input
                    type="text"
                    value={quoteMeta.pmName}
                    onChange={(e) =>
                      setQuoteMeta((p) => ({ ...p, pmName: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    報價有效期 (天)
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
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono-data text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-body text-xs text-muted-foreground">
                    送貨地址
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
                    placeholder="請輸入送貨地址"
                    rows={3}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </InfoPanelColumn>

              {/* Col 5: 立即暫存 — vertically under 預覽 PDF */}
              <div className="col-span-1 flex flex-col items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => void handleSaveLocalDraft()}
                  disabled={isSavingDraft || isAutoSaving || !hasQuoteData}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t.autoSaveHint}
                >
                  {isSavingDraft || isAutoSaving ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {isAutoSaving ? t.autoSaving : t.saveDraft}
                  </span>
                </button>
                <p
                  className={cn(
                    "text-center font-body text-[10px] leading-snug",
                    autoSaveFailed
                      ? "text-rose-500"
                      : "text-muted-foreground",
                  )}
                  title={t.autoSaveHint}
                >
                  {autoSaveFailed
                    ? "自動暫存失敗，請按立即暫存"
                    : lastLocalSavedAt
                      ? `${t.autoSavedAt} ${new Date(lastLocalSavedAt).toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                      : t.autoSaveHint}
                </p>
              </div>

              {/* Col 6: 版本審核 — vertically under ENG */}
              <div className="col-span-1 flex flex-col items-stretch gap-1">
                <button
                  type="button"
                  onClick={handleOpenSubmitReview}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 font-body text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98]"
                  title="提交後會產生新版本快照並送審"
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t.versionReview}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-5">
              {/* 報價內容表格 */}
              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="font-display text-base font-bold text-foreground/80">
                    {t.quoteContent}
                  </h2>
                  <QuoteAddRowButtonGroup
                    labels={t}
                    showPaste={cutItemId != null}
                    onPaste={() => pasteCutItemAt(0)}
                    onAddSectionTitle={() => addSectionTitle(0)}
                    onAddField={() => addItem(0)}
                    onAddCustomTerm={() => addCustomTerm(0)}
                    onAddProduct={() => openProductSelector(0)}
                  />
                </div>

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
                  {(() => {
                    const firstProductIndex = items.findIndex(
                      (row) => !row.isSectionTitle && !row.isCustomTerm,
                    );
                    return items.map((item, index) => (
                    <div key={item.id} className="space-y-3">
                      {item.isSectionTitle ? (
                        <QuoteSectionTitleCard
                          item={item}
                          index={index}
                          items={items}
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
                        />
                      ) : item.isCustomTerm ? (
                        <QuoteCustomTermCard
                          item={item}
                          index={index}
                          serialNumber={productSerialAt(items, index)}
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
                        />
                      ) : (
                        <QuoteProductItemCard
                          item={item}
                          index={index}
                          serialNumber={productSerialAt(items, index)}
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
                          unifyExchangeRatesFromFirst={unifyExchangeRatesFromFirst}
                          showUnifyExchangeRate={index === firstProductIndex}
                          cutItem={cutItem}
                          duplicateItem={duplicateItem}
                          removeItem={removeItem}
                          factories={factories}
                          factoriesLoading={factoriesLoading}
                          quoteImageScope={quoteImageScope}
                          labels={t}
                        />
                      )}
                      <QuoteAddRowButtonGroup
                        labels={t}
                        compact
                        showPaste={cutItemId != null}
                        onPaste={() => pasteCutItemAt(index + 1)}
                        onAddSectionTitle={() => addSectionTitle(index + 1)}
                        onAddField={() => addItem(index + 1)}
                        onAddCustomTerm={() => addCustomTerm(index + 1)}
                        onAddProduct={() => openProductSelector(index + 1)}
                      />
                    </div>
                    ));
                  })()}
                </div>

                {/* Price Multiplier, GP Summary & Subtotal */}
                <div className="mt-4 grid grid-cols-1 items-end gap-4 border-t border-border pt-3 lg:grid-cols-3">
                  {/* 單價規則 - Unit price batch multiplier */}
                  <div className="flex items-center gap-2">
                    <span className="font-body text-xs text-primary font-medium">
                      {t.priceMultiplier}
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={priceMultiplier}
                      onChange={(e) => setPriceMultiplier(e.target.value)}
                      className="w-16 rounded-md border border-primary/30 bg-background px-2 py-1 font-mono-data text-xs text-foreground text-center focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                    <button
                      type="button"
                      onClick={applyPriceMultiplier}
                      className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 font-body text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      {t.apply}
                    </button>
                  </div>
                  {/* GP summary — internal margin calc; not exported to PDF preview */}
                  <div className="flex justify-center">
                    <div className="w-full max-w-[300px] overflow-hidden rounded-md border border-border text-xs">
                      <div className="flex items-center justify-between gap-4 border-b border-border px-3 py-2">
                        <span className="font-body font-medium text-foreground">Contract Sum</span>
                        <span className="font-mono-data text-foreground">
                          HKD ${grandTotal.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-b border-border px-3 py-2">
                        <span className="font-body font-medium text-foreground">Cost</span>
                        <span className="font-mono-data text-foreground">
                          HKD ${totalProductCost.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-b border-border px-3 py-2">
                        <span className="font-body font-medium text-foreground">Ship</span>
                        <input
                          type="number"
                          min={0}
                          value={gpSummary.ship || ""}
                          placeholder="0"
                          onChange={(e) =>
                            setGpSummary((prev) => ({
                              ...prev,
                              ship: e.target.value === "" ? 0 : Math.max(0, parseFloat(e.target.value) || 0),
                            }))
                          }
                          className="w-28 rounded-md border border-border bg-background px-2 py-1 font-mono-data text-xs text-foreground text-right focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4 border-b border-border px-3 py-2">
                        <span className="font-body font-medium text-foreground">Installation</span>
                        <input
                          type="number"
                          min={0}
                          value={gpSummary.installation || ""}
                          placeholder="0"
                          onChange={(e) =>
                            setGpSummary((prev) => ({
                              ...prev,
                              installation: e.target.value === "" ? 0 : Math.max(0, parseFloat(e.target.value) || 0),
                            }))
                          }
                          className="w-28 rounded-md border border-border bg-background px-2 py-1 font-mono-data text-xs text-foreground text-right focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4 px-3 py-2 bg-muted/20">
                        <span className="font-body font-medium text-foreground">GP</span>
                        <span className="font-mono-data font-medium text-foreground">
                          HKD ${gpValue.toLocaleString()}
                          <span className="ml-2 text-muted-foreground">
                            ({Math.round(gpPercent)}%)
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 lg:col-start-3">
                    {/* 傢俱安裝費用 row (editable) */}
                    <div className="flex w-full items-stretch rounded-md border border-border overflow-hidden text-xs">
                      <div className="flex flex-col justify-center gap-1 px-3 py-2 bg-muted/30 border-r border-border" style={{ width: '45%' }}>
                        <input
                          type="text"
                          value={installationFee.title}
                          onChange={(e) =>
                            setInstallationFee((prev) => ({ ...prev, title: e.target.value }))
                          }
                          className="w-full bg-transparent font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 rounded px-1"
                        />
                        <input
                          type="text"
                          value={installationFee.subtitle}
                          onChange={(e) =>
                            setInstallationFee((prev) => ({ ...prev, subtitle: e.target.value }))
                          }
                          className="w-full bg-transparent text-muted-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 rounded px-1"
                        />
                      </div>
                      <div className="flex flex-col justify-center px-3 py-2 border-r border-border text-center" style={{ width: '30%' }}>
                        <textarea
                          value={installationFee.conditionText}
                          onChange={(e) =>
                            setInstallationFee((prev) => ({ ...prev, conditionText: e.target.value }))
                          }
                          rows={2}
                          className="w-full bg-transparent text-muted-foreground text-xs leading-relaxed text-center focus:outline-none focus:ring-1 focus:ring-primary/30 rounded px-1 resize-none"
                        />
                      </div>
                      <div className="flex items-center justify-center px-2 py-2 border-r border-border font-medium" style={{ width: '12.5%' }}>
                        {isFreeInstallation ? (
                          <span className="text-green-600">FREE</span>
                        ) : (
                          <span className="text-muted-foreground">{installationFee.freeLabel}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-center px-2 py-2 font-medium" style={{ width: '12.5%' }}>
                        {isFreeInstallation ? (
                          <span className="text-green-600">FREE</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={installationFee.amount ?? ""}
                            placeholder="另議"
                            onChange={(e) => {
                              const raw = e.target.value;
                              setInstallationFee((prev) => ({
                                ...prev,
                                amount: raw === "" ? null : Math.max(0, parseFloat(raw) || 0),
                              }));
                            }}
                            className="w-full bg-transparent text-right font-mono-data text-foreground placeholder:text-muted-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary/30 rounded px-1"
                          />
                        )}
                      </div>
                    </div>
                    {/* Discount row — split into label + numeric input, sits above 合計 */}
                    <div className="flex items-stretch overflow-hidden rounded-md border border-border text-sm">
                      <div className="flex items-center justify-center bg-muted/30 px-3 py-2 border-r border-border" style={{ width: '80px' }}>
                        <span className="font-medium text-foreground">Discount</span>
                      </div>
                      <div className="flex items-center px-2 py-1" style={{ width: '120px' }}>
                        <input
                          type="number"
                          value={discountNote}
                          onChange={(e) => setDiscountNote(e.target.value)}
                          placeholder="0"
                          className="w-full bg-transparent text-right font-mono-data text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 rounded px-1"
                        />
                      </div>
                    </div>
                    {/* 合計 (after discount) */}
                    <div className="flex items-center">
                      <span className="mr-3 font-body text-xs text-muted-foreground" style={{ width: '80px', textAlign: 'center' }}>
                        {t.grandTotal}:
                      </span>
                      <span className="font-mono-data text-base font-bold text-foreground" style={{ width: '120px', textAlign: 'right' }}>
                        HKD ${grandTotal.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 訂單確認及交付細節 */}
              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h2 className="mb-3 font-display text-sm font-bold text-foreground/80">
                  {t.deliverySection}
                </h2>
                <textarea
                  value={
                    quoteLocale === 'en'
                      ? DEFAULT_QUOTATION_DELIVERY_DETAILS_EN
                      : deliveryDetails
                  }
                  onChange={(e) => {
                    if (quoteLocale === 'en') return;
                    setDeliveryDetails(e.target.value);
                  }}
                  readOnly={quoteLocale === 'en'}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </section>

              {/* 條款及付款 */}
              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold text-foreground/80">
                    {t.termsSection}
                  </h2>
                  {quoteLocale === 'zh' && (
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
                  )}
                </div>

                {quoteLocale === 'en' ? (
                  <div
                    className="prose prose-sm max-w-none font-body text-xs leading-relaxed text-foreground/80 [&_p]:mb-1.5"
                    dangerouslySetInnerHTML={{
                      __html: buildDefaultTermsFullHtmlEn(quoteMeta.deliveryAddress),
                    }}
                  />
                ) : (
                <TermsRichEditor
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

      {/* Submit Review Modal */}
      <SubmitReviewModal
        open={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSuccess={(result) => {
          setShowSubmitModal(false);
          baselineSnapshotRef.current = JSON.stringify(buildDraftData());
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
        totalAmount={grandTotal}
        totalCostPrice={totalCostPrice}
        version={currentVersion}
        projectData={buildProjectData()}
        items={items.filter(hasQuoteItemContent)}
        bwfPitchingId={formData.pmsPitchingId || existingQuote?.bwfPitchingId || null}
        bwfProjectId={formData.pmsProjectId || existingQuote?.bwfProjectId || null}
        quoteId={quoteId}
        existingQuoteId={existingQuote?.quoteId ?? null}
        existingQuoteUuid={existingQuote?.quoteUuid ?? null}
        forceNewQuote={forceNewQuote}
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
      />

    </>
  );
}
