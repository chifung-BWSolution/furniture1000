import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  ChevronDown,
  Plus,
  Trash2,
  ShieldCheck,
  ImagePlus,
  Eye,
  Pencil,
  Check,
  Upload,
  X,
  GripVertical,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TermsRichEditor } from "@/components/dashboard/TermsRichEditor";
import { RemarksRichEditor } from "@/components/dashboard/RemarksRichEditor";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { SubmitReviewModal } from "@/components/dashboard/SubmitReviewModal";
import { ProductSelectorModal } from "@/components/dashboard/ProductSelectorModal";
import type { QuotationPDFData } from "@/types/quotation-pdf";
import {
  saveDraft,
  loadDraft,
  deleteDraft,
  makeDraftKey,
  type DraftData,
} from "@/lib/draftStore";
import { unsavedGuard } from "@/lib/unsavedGuard";
import { QUOTE_UNSAVED_LEAVE_MESSAGE, resetQuickQuoteSessionStorage, shouldShowDraftRestoreNotice } from "@/lib/quickQuoteSession";
import {
  injectDeliveryAddressIntoTermsHtml,
  isDeliveryAddressFilled,
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

interface QuoteFormData {
  company: string;
  projectManager: string;
  projectName: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientIndustry: string[];
  quotationType: string[];
  serviceScope: string[];
  officeArea: string;
  headcount: string;
  budgetMin: string;
  budgetMax: string;
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
  deliveryTermName?: string;
  isCustomTerm?: boolean;
}

interface QuotationDraftEditorProps {
  formData: QuoteFormData;
  onBack: () => void;
  userEmail?: string | null;
  onOpenPdfPreview?: (data: QuotationPDFData) => void;
  existingQuote?: {
    quoteId: string;
    version: string;
    status: string;
    totalAmount: number;
    submitter: string;
    projectData: Record<string, unknown>;
  };
}

const generateId = () => Math.random().toString(36).substring(2, 12);

function QuoteRowDragHandle({
  itemId,
  serialNumber,
  onDragStart,
  onDragEnd,
}: {
  itemId: string;
  serialNumber: number;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="font-display text-sm font-semibold tabular-nums leading-none text-foreground/75"
        aria-hidden
      >
        {serialNumber}
      </span>
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", itemId);
          onDragStart(itemId);
        }}
        onDragEnd={onDragEnd}
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
  extra?: string,
) {
  return cn(
    extra,
    draggingItemId === itemId && "opacity-50",
    dropInsertIndex === index && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
    dropInsertIndex === index + 1 && "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]",
  );
}

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
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (dataUrl: string) => void;
  title: string;
  previewUrl?: string;
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
      const dataUrl = await fileToDataUrl(file);
      onSelect(dataUrl);
      onClose();
    } catch {
      toast.error("讀取檔案失敗");
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
}: {
  value: string;
  onChange: (url: string) => void;
  modalTitle?: string;
  sizePx?: number;
  imageFit?: "cover" | "contain";
  /** Expand to fill grid column width (keeps square aspect ratio) */
  fluid?: boolean;
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

function QuoteProductItemCard({
  item,
  index,
  draggingItemId,
  dropInsertIndex,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  updateItem,
  updateExchangeRate,
  removeItem,
}: {
  item: QuotationItem;
  index: number;
  draggingItemId: string | null;
  dropInsertIndex: number | null;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  updateItem: (id: string, field: keyof QuotationItem, value: string | number | null) => void;
  updateExchangeRate: (id: string, raw: string) => void;
  removeItem: (id: string) => void;
}) {
  return (
    <div
      className={quoteRowReorderClass(
        index,
        item.id,
        draggingItemId,
        dropInsertIndex,
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
            serialNumber={index + 1}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>

        {/* Row 1 — col 2: 類別 · 尺寸 · 顏色 */}
        <div className="col-start-2 row-start-1 min-w-0 w-full space-y-2">
          <QuoteFieldBlock label="類別">
            <textarea
              value={item.category || ""}
              placeholder="—"
              rows={2}
              onChange={(e) => updateItem(item.id, "category", e.target.value)}
              className={`${QUOTE_INPUT_CLASS} min-h-[34px] resize-y leading-relaxed`}
            />
          </QuoteFieldBlock>
          <QuoteFieldBlock label="尺寸(mm), 長 x 闊 x 高">
            <div className="flex w-full min-w-0 items-center gap-1">
              <input
                type="number"
                min={0}
                value={item.dimensionLMm ?? ""}
                placeholder="L"
                onChange={(e) =>
                  updateItem(item.id, "dimensionLMm", parseNonNegativeDimension(e.target.value))
                }
                className={QUOTE_DIMENSION_INPUT_CLASS}
              />
              <span className="shrink-0 text-xs text-muted-foreground">×</span>
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
            </div>
          </QuoteFieldBlock>
          <QuoteFieldBlock label="顏色">
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
          label="材質及明細"
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

        {/* Row 1 — col 5: 數量 */}
        <QuoteFieldBlock
          label="數量"
          className={cn("col-start-5 row-start-1", QUOTE_QTY_COST_FIELD_CLASS)}
        >
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

        {/* Row 1 — col 6: 單位 (aligned with 單價 below) */}
        <QuoteFieldBlock
          label="單位"
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
        <QuoteFieldBlock label="備註" className="col-start-2 row-start-2 min-w-0">
          <RemarksRichEditor
            key={item.id}
            compact
            value={item.remarks || ""}
            legacyImage={item.remarksImage}
            onChange={(val) => updateItem(item.id, "remarks", val)}
          />
        </QuoteFieldBlock>

        {/* Row 2 — cols 3–4: 圖片 · 參考圖 */}
        <QuoteFieldBlock
          label="圖片"
          className={cn("col-start-3 row-start-2 min-w-0", QUOTE_CARD_MEDIA_XL_SHIFT)}
        >
          <ReferenceImageCell
            value={item.image || ""}
            onChange={(url) => updateItem(item.id, "image", url)}
            modalTitle="上傳產品圖片"
            imageFit="contain"
            fluid
          />
        </QuoteFieldBlock>
        <QuoteFieldBlock
          label="參考圖"
          className={cn("col-start-4 row-start-2 min-w-0", QUOTE_CARD_MEDIA_XL_SHIFT)}
        >
          <ReferenceImageCell
            value={item.referenceImage || ""}
            onChange={(url) => updateItem(item.id, "referenceImage", url)}
            modalTitle="上傳參考圖"
            imageFit="contain"
            fluid
          />
        </QuoteFieldBlock>

        {/* Row 2 — col 5: CNY成本 · 匯率 · HKD成本 (匯率垂直置中於上下兩欄之間) */}
        <div
          className={cn(
            "col-start-5 row-start-2 flex min-h-0 flex-col self-stretch",
            QUOTE_QTY_COST_FIELD_CLASS,
          )}
        >
          <QuoteFieldBlock label="CNY¥成本價" className="shrink-0">
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
            <QuoteFieldBlock label="匯率" className="w-full">
              <input
                type="text"
                inputMode="decimal"
                value={exchangeRateInputDisplay(item.exchangeRateInput, item.exchangeRate)}
                placeholder="—"
                onChange={(e) => updateExchangeRate(item.id, e.target.value)}
                className={QUOTE_COMPACT_NUMBER_INPUT_CLASS}
              />
            </QuoteFieldBlock>
          </div>
          <QuoteFieldBlock label="HKD$成本價" className="shrink-0">
            <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
              <span className="truncate font-mono-data text-xs font-medium text-foreground">
                {formatHkdCostDisplayCeil(item.hkdCostPrice)}
              </span>
            </div>
          </QuoteFieldBlock>
        </div>
        <QuoteFieldBlock
          label="HKD$單價"
          className={cn("col-start-6 row-start-2", QUOTE_PRICING_FIELD_CLASS)}
        >
          <input
            type="number"
            value={item.unitPrice || ""}
            placeholder="0"
            min={0}
            onChange={(e) =>
              updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)
            }
            className={QUOTE_COMPACT_NUMBER_INPUT_CLASS}
          />
        </QuoteFieldBlock>
        {/* Row 2 — col 8: 小計 */}
        <QuoteFieldBlock label="HKD$小計" className="col-start-8 row-start-2 min-w-0">
          <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
            <span className="truncate font-mono-data text-xs font-medium text-foreground">
              ${(item.unitPrice * item.quantity).toLocaleString()}
            </span>
          </div>
        </QuoteFieldBlock>

        {/* Row 2 — col 9: 刪除 */}
        <div className="col-start-9 row-start-2 shrink-0">
          <div className="mb-1 h-4" aria-hidden="true" />
          <button
            type="button"
            onClick={() => removeItem(item.id)}
            className="flex h-[34px] items-center rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
            title="刪除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function QuoteCustomTermCard({
  item,
  index,
  draggingItemId,
  dropInsertIndex,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  updateItem,
  removeItem,
}: {
  item: QuotationItem;
  index: number;
  draggingItemId: string | null;
  dropInsertIndex: number | null;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  updateItem: (id: string, field: keyof QuotationItem, value: string | number | null) => void;
  removeItem: (id: string) => void;
}) {
  return (
    <div
      className={quoteRowReorderClass(
        index,
        item.id,
        draggingItemId,
        dropInsertIndex,
        "rounded-lg border border-amber-500/30 bg-amber-500/5 p-4",
      )}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
    >
      <div className="flex gap-3">
        <div className="shrink-0 pt-4">
          <QuoteRowDragHandle
            itemId={item.id}
            serialNumber={index + 1}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <QuoteFieldBlock label="增值服務說明">
            <input
              type="text"
              value={item.name || ""}
              placeholder="輸入額外增值服務（例如：清拆、拆裝舊家私等）..."
              onChange={(e) => updateItem(item.id, "name", e.target.value)}
              className={QUOTE_INPUT_CLASS}
            />
          </QuoteFieldBlock>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <QuoteFieldBlock label="數量">
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
            <QuoteFieldBlock label="單價">
              <input
                type="number"
                value={item.unitPrice || ""}
                placeholder="0"
                min={0}
                onChange={(e) =>
                  updateItem(item.id, "unitPrice", e.target.value ? parseFloat(e.target.value) : 0)
                }
                className={QUOTE_NUMBER_INPUT_CLASS}
              />
            </QuoteFieldBlock>
            <QuoteFieldBlock label="小計">
              <div className="flex h-[34px] items-center rounded-md border border-border/60 bg-muted/20 px-2">
                <span className="font-mono-data text-xs font-medium text-foreground">
                  ${(item.unitPrice * item.quantity).toLocaleString()}
                </span>
              </div>
            </QuoteFieldBlock>
            <div className="flex items-end justify-end pb-0.5">
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                title="刪除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
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
    deliveryTermName: "",
  };
}

/** Rows created via 新建欄位 may have category/material but no product name — still export to PDF. */
function hasQuoteItemContent(item: QuotationItem): boolean {
  if (item.isCustomTerm) {
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
      item.dimensionHMm != null,
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

export function QuotationDraftEditor({
  formData,
  onBack: _onBack,
  userEmail,
  onOpenPdfPreview,
  existingQuote,
}: QuotationDraftEditorProps) {
  // Determine initial values from existingQuote or defaults
  const savedProjectData = existingQuote?.projectData || {};
  const savedCompanyInfo = savedProjectData.companyInfo as
    | {
        name?: string;
        address?: string;
        phone?: string;
        email?: string;
        website?: string;
      }
    | undefined;
  const savedClientInfo = savedProjectData.clientInfo as
    | { name?: string; phone?: string; email?: string }
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
  const savedItems = savedProjectData.items as
    | Array<{
        image: string;
        name: string;
        costPrice?: number | null;
        exchangeRate?: number | null;
        hkdCostPrice?: number | null;
        unitPrice: number;
        quantity: number;
        category?: string;
        material?: string;
        color?: string;
        remarks?: string;
        remarksImage?: string;
        referenceImage?: string;
        dimensionLMm?: number | null;
        dimensionWMm?: number | null;
        dimensionHMm?: number | null;
        deliveryTermName?: string;
      }>
    | undefined;
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

  // Company info (editable)
  const [companyInfo, setCompanyInfo] = useState({
    name: savedCompanyInfo?.name || "Branding Works Design Ltd",
    address:
      savedCompanyInfo?.address ||
      "香港荃灣青山公路459-469號華力工業中心5字樓D-G室",
    phone: savedCompanyInfo?.phone || "51634839/ 97173545",
    email: savedCompanyInfo?.email || "sales@brandingworks-furniture.com",
    website: savedCompanyInfo?.website || "www.brandingworks-furniture.com",
  });

  // Client info (editable, prefilled from steps or saved)
  const [clientInfo, setClientInfo] = useState({
    name: savedClientInfo?.name || formData.clientName,
    phone: savedClientInfo?.phone || formData.clientPhone,
    email: savedClientInfo?.email || formData.clientEmail,
  });

  // Quote meta (editable)
  const [quoteMeta, setQuoteMeta] = useState({
    projectName: savedQuoteMeta?.projectName || formData.projectName,
    pmName: savedQuoteMeta?.pmName || formData.projectManager,
    validity: savedQuoteMeta?.validity || formData.validityDays || "30",
    deliveryAddress: savedQuoteMeta?.deliveryAddress || "",
  });

  // Delivery details (editable)
  const [deliveryDetails, setDeliveryDetails] = useState(
    savedDeliveryDetails ||
      "訂單生產時間自收到訂金起計算，預計3-4 週完成。交付及安裝將分兩日進行：交付後1-2 個工作日內完成安裝。",
  );

  // Discount (numeric value) — initialized from existing quote's project_data
  const savedDiscountNote = (() => {
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
  const savedInstallationFee = (savedProjectData as Record<string, unknown>)
    .installationFee as typeof DEFAULT_INSTALL_FEE | undefined;
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

  const savedGpSummary = (savedProjectData as Record<string, unknown>).gpSummary as
    | { ship?: number; installation?: number }
    | undefined;
  const [gpSummary, setGpSummary] = useState({
    ship: savedGpSummary?.ship ?? 0,
    installation: savedGpSummary?.installation ?? 0,
  });

  // Terms content — migrate legacy templates (incl. saved DB quotes & IndexedDB drafts)
  const [termsContent, setTermsContent] = useState(() =>
    migrateTermsContentToCurrent(
      savedTermsContent as SavedTermsContent | undefined,
      savedQuoteMeta?.deliveryAddress,
    ),
  );
  const [termsEditMode, setTermsEditMode] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);

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

  const saveTermsToDb = async () => {
    if (!existingQuote?.quoteId) {
      // Not yet saved to DB — just toggle off edit mode
      setTermsEditMode(false);
      return;
    }
    setTermsSaving(true);
    try {
      const currentProjectData = buildProjectData();
      const { error } = await supabase
        .from("bwf_quote")
        .update({ project_data: currentProjectData })
        .eq("quote_id", existingQuote.quoteId);
      if (error) throw error;
      toast.success("條款已保存");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存失敗";
      toast.error("保存失敗", { description: msg });
    } finally {
      setTermsSaving(false);
      setTermsEditMode(false);
    }
  };

  // Product items table
  const [items, setItems] = useState<QuotationItem[]>(() => {
    if (savedItems && savedItems.length > 0) {
      return savedItems.map((item) => {
        const costPrice = item.costPrice ?? null;
        const exchangeRate = item.exchangeRate ?? null;
        return {
          id: generateId(),
          image: item.image || "",
          name: item.name || "",
          costPrice,
          exchangeRate,
          hkdCostPrice:
            item.hkdCostPrice ??
            computeHkdCostPrice(costPrice, exchangeRate),
          unitPrice: item.unitPrice || 0,
          quantity: item.quantity || 1,
          unit: (item as { unit?: string }).unit || "",
          category: item.category,
          material: item.material,
          color: item.color,
          remarks: item.remarks,
          remarksImage: item.remarksImage,
          referenceImage: item.referenceImage,
          dimensionLMm: item.dimensionLMm ?? null,
          dimensionWMm: item.dimensionWMm ?? null,
          dimensionHMm: item.dimensionHMm ?? null,
          deliveryTermName: item.deliveryTermName,
          isCustomTerm: (item as { isCustomTerm?: boolean }).isCustomTerm,
        };
      });
    }
    return DEFAULT_ITEMS;
  });

  const addItem = () => {
    setItems((prev) => [...prev, createBlankProductItem()]);
  };

  const addCustomTerm = () => {
    setItems((prev) => [
      ...prev,
      {
        id: generateId(),
        image: "",
        name: "",
        costPrice: null,
        exchangeRate: null,
        hkdCostPrice: null,
        unitPrice: 0,
        quantity: 1,
        isCustomTerm: true,
      },
    ]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateItem = (
    id: string,
    field: keyof QuotationItem,
    value: string | number | null,
  ) => {
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

  const updateExchangeRate = (id: string, raw: string) => {
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

  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);

  const moveItem = useCallback((fromId: string, insertIndex: number) => {
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

  const handleQuoteRowDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      setDropInsertIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
    },
    [],
  );

  const handleQuoteRowDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain") || draggingItemId;
      if (fromId && dropInsertIndex !== null) {
        moveItem(fromId, dropInsertIndex);
      }
      setDraggingItemId(null);
      setDropInsertIndex(null);
    },
    [draggingItemId, dropInsertIndex, moveItem],
  );

  const clearQuoteRowDrag = useCallback(() => {
    setDraggingItemId(null);
    setDropInsertIndex(null);
  }, []);

  // Unit price multiplier (cost-based)
  const [priceMultiplier, setPriceMultiplier] = useState<string>("1");

  const applyPriceMultiplier = () => {
    const mult = parseFloat(priceMultiplier);
    if (isNaN(mult) || mult < 0) {
      toast.error("請輸入有效的倍率數字");
      return;
    }
    setItems((prev) =>
      prev.map((item) => {
        if (item.costPrice != null && item.costPrice > 0) {
          return { ...item, unitPrice: Math.round(item.costPrice * mult) };
        }
        return item;
      }),
    );
    toast.success(`已按成本倍率 ×${mult} 更新單價`);
  };

  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const discountValue = (() => {
    const n = parseFloat(discountNote);
    return isNaN(n) ? 0 : n;
  })();
  const isFreeInstallation = subtotal >= 12000;
  const installationAmount = isFreeInstallation ? 0 : (installationFee.amount ?? 0);
  const grandTotal = Math.max(0, subtotal - discountValue + installationAmount);
  const totalProductCost = items.reduce((sum, item) => {
    const hkdCost = item.hkdCostPrice != null ? Math.ceil(item.hkdCostPrice) : 0;
    return sum + hkdCost * item.quantity;
  }, 0);
  const gpValue = grandTotal - totalProductCost - gpSummary.ship - gpSummary.installation;
  const gpPercent = grandTotal > 0 ? (gpValue / grandTotal) * 100 : 0;
  const totalCostPrice = totalProductCost;

  // Version & submission modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const handleOpenSubmitReview = () => {
    if (
      !isDeliveryAddressFilled(termsContent.fullHtml, quoteMeta.deliveryAddress)
    ) {
      toast.error("送貨地址未填上");
      return;
    }
    setShowSubmitModal(true);
  };
  const [currentVersion] = useState(() => {
    if (existingQuote?.version) {
      // Increment the minor version: v1.1 -> v1.2, v1.2 -> v1.3
      const match = existingQuote.version.match(/^v(\d+)\.(\d+)$/);
      if (match) {
        const major = parseInt(match[1]);
        const minor = parseInt(match[2]) + 1;
        return `v${major}.${minor}`;
      }
    }
    return "v1.1";
  });

  // Product selector modal state
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Draft auto-save state
  const [draftLoaded, setDraftLoaded] = useState(false);
  const draftHydratedRef = useRef<string | null>(null);
  // True once 版本審核 has been done with the current content; cleared on edit.
  const [persisted, setPersisted] = useState(false);

  // Derive the draft key: use existing quoteId or "NEW"
  const rawQuoteId = existingQuote?.quoteId || "NEW";
  const storageKey = makeDraftKey(userEmail, rawQuoteId);

  // 報價內容 is considered "有數據" if any row has a product name.
  const hasQuoteData = items.some(hasQuoteItemContent);

  // Unsaved-work guard: dirty when there is quote data not yet submitted via 版本審核.
  const isDirty = draftLoaded && hasQuoteData && !persisted;

  useEffect(() => {
    unsavedGuard.set(isDirty, QUOTE_UNSAVED_LEAVE_MESSAGE);
    return () => unsavedGuard.clear();
  }, [isDirty]);

  useEffect(() => {
    unsavedGuard.setLeaveHandler(() => {
      deleteDraft(storageKey).catch(() => {});
      resetQuickQuoteSessionStorage(userEmail);
    });
    return () => unsavedGuard.setLeaveHandler(null);
  }, [storageKey, userEmail]);

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

  // Any edit to quote content re-arms the dirty state.
  useEffect(() => {
    setPersisted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, companyInfo, clientInfo, quoteMeta, deliveryDetails, termsContent, discountNote, installationFee, gpSummary]);

  // Load draft from IndexedDB on mount (only for NEW quotes without existingQuote)
  // For existing quotes, QuickQuoteView handles loading the draft before passing projectData.
  useEffect(() => {
    if (existingQuote) {
      draftHydratedRef.current = storageKey;
      setDraftLoaded(true);
      return;
    }
    if (draftHydratedRef.current === storageKey) {
      setDraftLoaded(true);
      return;
    }
    draftHydratedRef.current = storageKey;
    let cancelled = false;
    (async () => {
      try {
        const cached = await loadDraft(storageKey);
        if (cancelled || !cached) {
          setDraftLoaded(true);
          return;
        }
        // Hydrate state from the cached draft
        if (cached.companyInfo) {
          setCompanyInfo(cached.companyInfo as typeof companyInfo);
        }
        if (cached.clientInfo) {
          setClientInfo(cached.clientInfo as typeof clientInfo);
        }
        if (cached.quoteMeta) {
          setQuoteMeta(cached.quoteMeta as typeof quoteMeta);
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
          setItems(
            cached.items.map((item: Record<string, unknown>) => {
              const costPrice = (item.costPrice as number | null) ?? null;
              const exchangeRate = (item.exchangeRate as number | null) ?? null;
              return {
                id: generateId(),
                image: (item.image as string) || "",
                name: (item.name as string) || "",
                costPrice,
                exchangeRate,
                hkdCostPrice:
                  (item.hkdCostPrice as number | null) ??
                  computeHkdCostPrice(costPrice, exchangeRate),
                unitPrice: (item.unitPrice as number) || 0,
                quantity: (item.quantity as number) || 1,
                category: item.category as string | undefined,
                material: item.material as string | undefined,
                color: item.color as string | undefined,
                remarks: item.remarks as string | undefined,
                remarksImage: item.remarksImage as string | undefined,
                referenceImage: item.referenceImage as string | undefined,
                dimensionLMm: (item.dimensionLMm as number | null) ?? null,
                dimensionWMm: (item.dimensionWMm as number | null) ?? null,
                dimensionHMm: (item.dimensionHMm as number | null) ?? null,
                deliveryTermName: item.deliveryTermName as string | undefined,
                isCustomTerm: item.isCustomTerm as boolean | undefined,
              };
            }),
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
  }, [storageKey, existingQuote]);

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
    ],
  );

  // Auto-save draft locally while editing (no manual 儲存草稿 button).
  useEffect(() => {
    if (!draftLoaded || !hasQuoteData || persisted) return;
    const timer = window.setTimeout(() => {
      saveDraft(buildDraftData()).catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftLoaded, hasQuoteData, persisted, buildDraftData]);

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
    }[],
  ) => {
    if (products.length === 0) {
      setActiveItemId(null);
      return;
    }

    // Always append selected products as new rows (no deduplication)
    const newRows = products.map((p) => {
      const costPrice = p.costPrice ?? null;
      const exchangeRate = null;
      return {
        id: generateId(),
        image: p.image,
        name: p.name,
        costPrice,
        exchangeRate,
        hkdCostPrice: computeHkdCostPrice(costPrice, exchangeRate),
        unitPrice: p.unitPrice || p.costPrice || 0,
        quantity: 1,
        category: p.category?.trim() || "",
        material: p.material,
        color: p.color?.trim() || "",
        remarks: p.remarks,
        dimensionLMm: p.dimensionLMm,
        dimensionWMm: p.dimensionWMm,
        dimensionHMm: p.dimensionHMm,
        deliveryTermName: p.deliveryTermName,
      };
    });

    // Remove empty placeholder rows and append new ones
    const nonEmptyItems = items.filter(hasQuoteItemContent);
    setItems([...nonEmptyItems, ...newRows]);
    setActiveItemId(null);
  };

  const buildProjectData = () => ({
    formData,
    companyInfo,
    clientInfo,
    quoteMeta,
    deliveryDetails,
    termsContent,
    items: items.map(({ id, exchangeRateInput: _exchangeRateInput, ...rest }) => rest),
    subtotal,
    discountNote,
    discountValue,
    grandTotal,
    installationFee,
    gpSummary,
  });

  const buildPDFData = (): QuotationPDFData => {
    const deliveryAddress = resolveDeliveryAddress(
      termsContent.fullHtml,
      quoteMeta.deliveryAddress,
    );
    const fullHtmlForPdf = deliveryAddress
      ? injectDeliveryAddressIntoTermsHtml(termsContent.fullHtml, deliveryAddress)
      : termsContent.fullHtml;

    return {
    // gpSummary (Contract Sum / Cost / Ship / Installation / GP) is editor-only — excluded here.
    companyInfo,
    clientInfo,
    quoteMeta: {
      ...quoteMeta,
      deliveryAddress,
      quoteNumber: quoteMeta.projectName || existingQuote?.quoteId || "",
      date: new Date().toLocaleDateString("zh-HK", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }),
    },
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
        deliveryTermName: item.deliveryTermName,
        isCustomTerm: item.isCustomTerm,
        unit: item.unit,
      })),
    subtotal,
    discountNote,
    installationFee,
  };
  };

  return (
    <>
      <div className="h-full overflow-y-auto bg-background">
        {/* Header — span full available width (parent already adds small side
            padding) so 報價內容 stretches left-and-right and needs less scrolling */}
        <div className="mx-auto w-full max-w-none">
          {/* Info panels + action buttons — above 報價內容 */}
          <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="grid min-w-0 flex-1 grid-cols-2 items-start gap-2 xl:grid-cols-4">
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
                    value={companyInfo.address}
                    onChange={(e) =>
                      setCompanyInfo((p) => ({
                        ...p,
                        address: e.target.value,
                      }))
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
                    報價類型
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
                    服務範圍
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
                    姓名
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
                  <input
                    type="text"
                    value={quoteMeta.projectName}
                    onChange={(e) =>
                      setQuoteMeta((p) => ({
                        ...p,
                        projectName: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
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
                    onChange={(e) =>
                      setQuoteMeta((p) => ({
                        ...p,
                        deliveryAddress: e.target.value,
                      }))
                    }
                    placeholder="請輸入送貨地址"
                    rows={3}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </InfoPanelColumn>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 xl:pt-1">
              <button
                type="button"
                onClick={() => onOpenPdfPreview?.(buildPDFData())}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 font-body text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Eye className="h-4 w-4" />
                預覽 PDF
              </button>
              <button
                type="button"
                onClick={handleOpenSubmitReview}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98]"
              >
                <ShieldCheck className="h-4 w-4" />
                版本審核
              </button>
            </div>
          </div>

          <div className="space-y-5">
              {/* 報價內容表格 */}
              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-foreground/80">
                    報價內容
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 font-body text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新建欄位
                    </button>
                    <button
                      type="button"
                      onClick={addCustomTerm}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-500/50 px-3 py-1.5 font-body text-sm font-medium text-amber-600 transition-colors hover:bg-amber-500/5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      增值服務
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveItemId(null);
                        setShowProductSelector(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-1.5 font-body text-sm font-medium text-primary transition-colors hover:bg-primary/5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新增產品
                    </button>
                  </div>
                </div>

                <div
                  className="space-y-3"
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      clearQuoteRowDrag();
                    }
                  }}
                >
                  {items.map((item, index) =>
                    item.isCustomTerm ? (
                      <QuoteCustomTermCard
                        key={item.id}
                        item={item}
                        index={index}
                        draggingItemId={draggingItemId}
                        dropInsertIndex={dropInsertIndex}
                        onDragOver={handleQuoteRowDragOver}
                        onDrop={handleQuoteRowDrop}
                        onDragStart={setDraggingItemId}
                        onDragEnd={clearQuoteRowDrag}
                        updateItem={updateItem}
                        removeItem={removeItem}
                      />
                    ) : (
                      <QuoteProductItemCard
                        key={item.id}
                        item={item}
                        index={index}
                        draggingItemId={draggingItemId}
                        dropInsertIndex={dropInsertIndex}
                        onDragOver={handleQuoteRowDragOver}
                        onDrop={handleQuoteRowDrop}
                        onDragStart={setDraggingItemId}
                        onDragEnd={clearQuoteRowDrag}
                        updateItem={updateItem}
                        updateExchangeRate={updateExchangeRate}
                        removeItem={removeItem}
                      />
                    ),
                  )}
                </div>

                {/* Price Multiplier, GP Summary & Subtotal */}
                <div className="mt-4 grid grid-cols-1 items-end gap-4 border-t border-border pt-3 lg:grid-cols-3">
                  {/* 單價規則 - Unit price batch multiplier */}
                  <div className="flex items-center gap-2">
                    <span className="font-body text-xs text-primary font-medium">
                      單價規則：成本倍率
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
                      套用
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
                        合計:
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
                  訂單確認及交付細節
                </h2>
                <textarea
                  value={deliveryDetails}
                  onChange={(e) => setDeliveryDetails(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </section>

              {/* 條款及付款 */}
              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold text-foreground/80">
                    條款及付款
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      termsEditMode ? saveTermsToDb() : setTermsEditMode(true)
                    }
                    disabled={termsSaving}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-colors ${
                      termsEditMode
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "border border-border text-foreground/60 hover:bg-accent hover:text-foreground"
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    {termsSaving ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        保存中...
                      </>
                    ) : termsEditMode ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        完成編輯
                      </>
                    ) : (
                      <>
                        <Pencil className="h-3.5 w-3.5" />
                        編輯條款
                      </>
                    )}
                  </button>
                </div>

                <TermsRichEditor
                  value={termsContent.fullHtml}
                  onChange={(html) =>
                    setTermsContent((prev) => ({ ...prev, fullHtml: html }))
                  }
                  editable={termsEditMode}
                />
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
        onSuccess={(quoteId) => {
          setShowSubmitModal(false);
          // Mark as persisted so the unsaved-work guard no longer blocks navigation.
          setPersisted(true);
          unsavedGuard.clear();
          // Clean up local draft after successful submission
          deleteDraft(storageKey).catch(() => {});
          if (quoteId) deleteDraft(makeDraftKey(userEmail, quoteId)).catch(() => {});
          resetQuickQuoteSessionStorage(userEmail);
        }}
        totalAmount={grandTotal}
        totalCostPrice={totalCostPrice}
        version={currentVersion}
        projectData={buildProjectData()}
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
      />

    </>
  );
}
