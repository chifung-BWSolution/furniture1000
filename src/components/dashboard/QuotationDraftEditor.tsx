import { useState, useEffect, useCallback, lazy, Suspense, useRef, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronDown,
  Plus,
  Trash2,
  Save,
  ShieldCheck,
  ImagePlus,
  Eye,
  Pencil,
  Check,
  Loader2,
  Upload,
  X,
  GripVertical,
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
  type DraftData,
} from "@/lib/draftStore";
import { unsavedGuard } from "@/lib/unsavedGuard";

const LazyQuotationPDFPreviewModal = lazy(() =>
  import("@/components/dashboard/QuotationPDFPreview").then((mod) => ({
    default: mod.QuotationPDFPreviewModal,
  })),
);

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
  unitPrice: number;
  quantity: number;
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
  onDragStart,
  onDragEnd,
}: {
  itemId: string;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  return (
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
      aria-label="拖曳調整順序"
    >
      <GripVertical className="h-4 w-4" />
    </button>
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

// Sub-component: Image Upload Modal
function ImageUploadModal({
  open,
  onClose,
  onSelect,
  title,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (dataUrl: string) => void;
  title: string;
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
    // Auto-focus drop area so right-click → paste context menu works
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
        className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl"
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
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 transition-colors ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5"
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-primary" />
          )}
          <span className="font-body text-xs font-medium text-foreground">
            {busy ? "上傳中..." : "點擊、拖放或貼上 (Ctrl+V) 圖片"}
          </span>
          <span className="font-body text-[10px] text-muted-foreground">
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
const QUOTE_EDITOR_IMAGE_CELL_PX = 96; // 2× previous 48px thumbnail

function ReferenceImageCell({
  value,
  onChange,
  modalTitle = "上傳圖片",
}: {
  value: string;
  onChange: (url: string) => void;
  modalTitle?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30 cursor-pointer group"
        style={{ width: QUOTE_EDITOR_IMAGE_CELL_PX, height: QUOTE_EDITOR_IMAGE_CELL_PX }}
        onClick={() => setModalOpen(true)}
        title="點擊上傳圖片"
      >
        {value ? (
          <>
            <img src={value} alt="" className="h-full w-full object-cover" />
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
      />
    </>
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

function createBlankProductItem(): QuotationItem {
  return {
    id: generateId(),
    image: "",
    referenceImage: "",
    name: "",
    costPrice: null,
    unitPrice: 0,
    quantity: 1,
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
    unitPrice: 0,
    quantity: 1,
  },
  {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    unitPrice: 0,
    quantity: 1,
  },
  {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    unitPrice: 0,
    quantity: 1,
  },
  {
    id: generateId(),
    image: "",
    name: "",
    costPrice: null,
    unitPrice: 0,
    quantity: 1,
  },
];

export function QuotationDraftEditor({
  formData,
  onBack,
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

  // Terms content (editable)
  const DEFAULT_TERMS = {
    transport: `2.1 本報價包含於單一地址的一次性運輸及安裝費用。
2.2 交付暫不涵蓋大嶼山、長洲、坪洲、南丫島及其他離島地區，包括禁區、5.5噸貨車無法進入路段、展覽場地、倉庫、酒店、裝修單位、船屋、地盤或貨櫃碼頭。若需特殊運送（如經露台懸掛），客戶須自行安排或者另行收費。
2.3 送貨及安裝的標準時間：星期一至六，09:00-18:00（公眾假期除外）。超出時間須另行收費。
2.4 遇惡劣天氣 、洪水或道路封閉，交付可能延遲。本公司將於24 小時內聯絡，並於7 天內補送。
2.5 送貨及安裝期間，現場須安全、清潔且無阻礙，否則本公司保留拒絕權利。
2.6 安裝不包括電工服務（如電插座安裝）、吊櫃上牆和收口服務，建議聘請合格技工。
2.7 運輸過程若需要叩關，因叩關過程導致的送貨及安裝延誤，本公司不負任何責任。並可重新安排送貨時間。`,
    extraFees: `3.1 卸貨區高度須達3.3 米，否則街上卸貨每件加收HKD 200。
3.2 更改交付日期須於3 天前電郵通知，否則收取HKD 500 行政費。本公司提供首5 天免費儲存，逾期每日每立方米收取HKD80。
3.3 若交付當日無人接收，須重新安排並收取額外交付費。
3.4 清拆舊家具不包括在內，須另行報價。
3.5 樓梯搬運每層每立方米收取HKD 100（限8 層）。
3.6 交付限 100 米範圍，超出每100 米加收HKD 500。`,
    warranty: `4.1 保養期為 1 年，自交付日起計算。不適用於不當使用、意外損壞或正常磨損。超過保養期后，進行維修，只收取材料及運輸安裝費用。
4.2 如貨品有任何損壞或問題，客戶須於產品交付後7天内通知本公司。如貨品有任何損壞或問題而客人不接受時，上限只賠償為貨價10%。
4.3 瑕疵評估以 1000mm 距離觀察為準，輕微差異（如顏色或收邊）不在範圍。`,
    other: `5.1 產品貨款未全部付清之前，產品歸屬權為本公司。
5.2 若需家具安裝固定上墻，需要保證所安裝墻體具有足夠的受力，且必須安裝墻體背板用作安裝上墻的結構件。
5.3 產品顏色及花紋可能有輕微差異（因顯示器或批次），屬正常，不接受退換。
5.4 本報價以發票內容為準，圖片及樣本僅供參考。任何更改須以書面通知，本公司不接受口頭承諾。
5.5 所有規格經確認無誤。本合同經雙方簽署及蓋印後生效。
5.6 如合約產生任何爭議，雙方無法達成共識，爭議無法解決，將提交香港國際仲裁中心仲裁。
5.7 本報價有效期為30 天。
5.8 責任限制：本公司對間接損失（如延誤造成的商業損失）不承擔責任。最高賠償限於訂單總額。
5.9 不可抗力：如疫情、自然災害等不可控事件，本公司免除相關責任，但將盡力通知並減輕影響。`,
    payment: `付款條款: 須支付70%訂金於生產前，餘下30%於交付前支付。若未支付餘款，本公司將不安排交付或安裝。

銀行賬戶資料:
戶口名稱: Branding Works Design Ltd
銀行名稱: 香港上海匯豐銀行
戶口號碼: 747-058683-001

若以支票轉賬/信用卡付款，貨期以實際款項到賬日期爲準。`,
  };

  const buildDefaultFullHtml = (t: typeof DEFAULT_TERMS) =>
    [
      `<h3>1&nbsp;&nbsp;付款資料</h3>`,
      t.payment
        .split("\n")
        .map((l) => (l.trim() ? `<p>${l}</p>` : "<p></p>"))
        .join(""),
      `<h3>2&nbsp;&nbsp;運輸及安裝條款</h3>`,
      t.transport
        .split("\n")
        .map((l) => (l.trim() ? `<p>${l}</p>` : "<p></p>"))
        .join(""),
      `<h3>3&nbsp;&nbsp;額外費用</h3>`,
      t.extraFees
        .split("\n")
        .map((l) => (l.trim() ? `<p>${l}</p>` : "<p></p>"))
        .join(""),
      `<h3>4&nbsp;&nbsp;保養及維修</h3>`,
      t.warranty
        .split("\n")
        .map((l) => (l.trim() ? `<p>${l}</p>` : "<p></p>"))
        .join(""),
      `<h3>5&nbsp;&nbsp;其他</h3>`,
      t.other
        .split("\n")
        .map((l) => (l.trim() ? `<p>${l}</p>` : "<p></p>"))
        .join(""),
    ].join("");

  // Detect if saved terms still use old (incorrect) numbering, e.g. "3.1 本報價".
  // If so, discard saved terms and fall back to corrected DEFAULT_TERMS.
  const savedTransportIsOld =
    typeof savedTermsContent?.transport === 'string' &&
    savedTermsContent.transport.trimStart().startsWith('3.');
  const effectiveSavedTerms = savedTransportIsOld ? undefined : savedTermsContent;

  const [termsContent, setTermsContent] = useState({
    transport: effectiveSavedTerms?.transport || DEFAULT_TERMS.transport,
    extraFees: effectiveSavedTerms?.extraFees || DEFAULT_TERMS.extraFees,
    warranty: effectiveSavedTerms?.warranty || DEFAULT_TERMS.warranty,
    other: effectiveSavedTerms?.other || DEFAULT_TERMS.other,
    payment: effectiveSavedTerms?.payment || DEFAULT_TERMS.payment,
    fullHtml:
      effectiveSavedTerms?.fullHtml || buildDefaultFullHtml(DEFAULT_TERMS),
  });
  const [termsEditMode, setTermsEditMode] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);

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
      return savedItems.map((item) => ({
        id: generateId(),
        image: item.image || "",
        name: item.name || "",
        costPrice: item.costPrice ?? null,
        unitPrice: item.unitPrice || 0,
        quantity: item.quantity || 1,
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
      }));
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
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
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
    (e: React.DragEvent<HTMLTableRowElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      setDropInsertIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
    },
    [],
  );

  const handleQuoteRowDrop = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>) => {
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
  const totalProductCost = items.reduce(
    (sum, item) => sum + (item.costPrice ?? 0) * item.quantity,
    0,
  );
  const gpValue = grandTotal - totalProductCost - gpSummary.ship - gpSummary.installation;
  const gpPercent = grandTotal > 0 ? (gpValue / grandTotal) * 100 : 0;
  const totalCostPrice = totalProductCost;

  // Version & submission modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
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

  // PDF Preview modal state
  const [showPDFPreview, setShowPDFPreview] = useState(false);

  // Draft save state
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  // True once 已儲存 or 版本審核 has been done with the current content; cleared on edit.
  const [persisted, setPersisted] = useState(false);

  // Derive the draft key: use existing quoteId or "NEW"
  const draftKey = existingQuote?.quoteId || "NEW";

  // 報價內容 is considered "有數據" if any row has a product name.
  const hasQuoteData = items.some(hasQuoteItemContent);

  // Unsaved-work guard: dirty when there is quote data that has NOT been saved
  // (已儲存) or submitted for review (版本審核). Registered to a module-level guard
  // that AppShell + beforeunload check before navigating away.
  const isDirty = draftLoaded && hasQuoteData && !persisted;

  useEffect(() => {
    unsavedGuard.set(
      isDirty,
      '報價內容尚未儲存。離開前請按「已儲存」或「版本審核」，否則內容將會遺失。',
    );
    return () => unsavedGuard.clear();
  }, [isDirty]);

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
      // Already hydrated from QuickQuoteView which checks IndexedDB
      setDraftLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cached = await loadDraft(draftKey);
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
          setTermsContent(cached.termsContent as typeof termsContent);
        }
        if (cached.items && cached.items.length > 0) {
          setItems(
            cached.items.map((item: Record<string, unknown>) => ({
              id: generateId(),
              image: (item.image as string) || "",
              name: (item.name as string) || "",
              costPrice: (item.costPrice as number | null) ?? null,
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
            })),
          );
        }
        setDraftSavedAt(cached.updatedAt);
        toast.info("已從本地草稿恢復", {
          description: `上次儲存於 ${new Date(cached.updatedAt).toLocaleString("zh-HK")}`,
        });
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
  }, [draftKey]);

  // Build draft data for saving
  const buildDraftData = useCallback(
    (): DraftData => ({
      quoteId: draftKey,
      updatedAt: Date.now(),
      formData: formData as unknown as Record<string, unknown>,
      companyInfo: companyInfo as unknown as Record<string, unknown>,
      clientInfo: clientInfo as unknown as Record<string, unknown>,
      quoteMeta: quoteMeta as unknown as Record<string, unknown>,
      deliveryDetails,
      termsContent: termsContent as unknown as Record<string, unknown>,
      items: items.map(
        ({ id, ...rest }) => rest as unknown as Record<string, unknown>,
      ),
      subtotal,
      discountNote,
      installationFee,
      gpSummary,
    }),
    [
      draftKey,
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

  // Save draft handler
  const handleSaveDraft = useCallback(async () => {
    setIsSavingDraft(true);
    try {
      await saveDraft(buildDraftData());
      const now = Date.now();
      setDraftSavedAt(now);
      setPersisted(true);
      toast.success("草稿已儲存到本地", {
        description: `儲存時間: ${new Date(now).toLocaleString("zh-HK")}`,
      });
    } catch (err) {
      console.warn("Failed to save draft to IndexedDB", err);
      toast.error("草稿儲存失敗");
    } finally {
      setIsSavingDraft(false);
    }
  }, [buildDraftData]);

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
    const newRows = products.map((p) => ({
      id: generateId(),
      image: p.image,
      name: p.name,
      costPrice: p.costPrice ?? null,
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
    }));

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
    items: items.map(({ id, ...rest }) => rest),
    subtotal,
    discountNote,
    discountValue,
    grandTotal,
    installationFee,
    gpSummary,
  });

  const buildPDFData = (): QuotationPDFData => ({
    // gpSummary (Contract Sum / Cost / Ship / Installation / GP) is editor-only — excluded here.
    companyInfo,
    clientInfo,
    quoteMeta: {
      ...quoteMeta,
      quoteNumber: quoteMeta.projectName || existingQuote?.quoteId || "",
      date: new Date().toLocaleDateString("zh-HK", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }),
    },
    deliveryDetails,
    termsContent,
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
      })),
    subtotal,
    discountNote,
    installationFee,
  });

  return (
    <>
      <div className="h-full overflow-y-auto bg-background">
        {/* Header — span full available width (parent already adds small side
            padding) so 報價內容 stretches left-and-right and needs less scrolling */}
        <div className="mx-auto w-full max-w-none">
          <div className="mb-4 flex items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="返回"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {existingQuote && (
              <div>
                <p className="font-body text-sm text-muted-foreground">
                  <span className="font-mono-data text-xs tracking-wider text-primary">
                    {existingQuote.quoteId}
                  </span>
                  <span className="mx-2 text-border">·</span>
                  目前版本{" "}
                  <span className="font-semibold">
                    {existingQuote.version}
                  </span>
                  <span className="mx-2 text-border">·</span>
                  送出新版本將為{" "}
                  <span className="font-semibold text-primary">
                    {currentVersion}
                  </span>
                </p>
              </div>
            )}
          </div>

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
                        className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 font-body text-[10px] font-medium text-primary"
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
                        className="inline-flex rounded-full bg-orange-500/10 px-2.5 py-0.5 font-body text-[10px] font-medium text-orange-600 dark:text-orange-400"
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
                        className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-body text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
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
                <p className="font-body text-[10px] text-muted-foreground/60">
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
                onClick={() => setShowPDFPreview(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 font-body text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Eye className="h-4 w-4" />
                預覽 PDF
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSavingDraft}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-body text-sm font-medium transition-colors ${
                  isSavingDraft
                    ? "border-border text-muted-foreground cursor-not-allowed opacity-60"
                    : draftSavedAt
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                      : "border-border text-foreground hover:bg-accent"
                }`}
              >
                {isSavingDraft ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : draftSavedAt ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSavingDraft
                  ? "儲存中..."
                  : draftSavedAt
                    ? "已儲存"
                    : "儲存草稿"}
              </button>
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
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

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="w-8 pb-2 pr-1 font-body text-xs font-medium text-muted-foreground"></th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "100px" }}>
                          圖片
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "120px" }}>
                          參考圖
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "60px" }}>
                          類別
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "280px" }}>
                          材質及明細
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "120px" }}>
                          尺寸(mm), 長x闊x高
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "80px" }}>
                          顏色
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "80px" }}>
                          成本價
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "80px" }}>
                          單價
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "60px" }}>
                          數量
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "240px" }}>
                          備註
                        </th>
                        <th className="pb-2 pr-2 font-body text-xs font-medium text-muted-foreground" style={{ minWidth: "70px" }}>
                          小計
                        </th>
                        <th className="pb-2 font-body text-xs font-medium text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          clearQuoteRowDrag();
                        }
                      }}
                    >
                      {items.map((item, index) => (
                        item.isCustomTerm ? (
                          <tr
                            key={item.id}
                            className={quoteRowReorderClass(
                              index,
                              item.id,
                              draggingItemId,
                              dropInsertIndex,
                              "border-b border-border/50 last:border-b-0 bg-amber-500/5",
                            )}
                            onDragOver={(e) => handleQuoteRowDragOver(e, index)}
                            onDrop={handleQuoteRowDrop}
                          >
                            <td className="py-2 pr-1 align-middle">
                              <QuoteRowDragHandle
                                itemId={item.id}
                                onDragStart={setDraggingItemId}
                                onDragEnd={clearQuoteRowDrag}
                              />
                            </td>
                            {/* full-width description spans 圖片→成本價 (7 cols) */}
                            <td className="py-2 pr-2" colSpan={7}>
                              <input
                                type="text"
                                value={item.name || ""}
                                placeholder="輸入額外增值服務（例如：清拆、拆裝舊家私等）..."
                                onChange={(e) =>
                                  updateItem(item.id, "name", e.target.value)
                                }
                                className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-body text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                              />
                            </td>
                            {/* 單價 */}
                            <td className="py-2 pr-2">
                              <input
                                type="number"
                                value={item.unitPrice || ""}
                                placeholder="0"
                                onChange={(e) =>
                                  updateItem(item.id, "unitPrice", e.target.value ? parseFloat(e.target.value) : 0)
                                }
                                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                              />
                            </td>
                            {/* 數量 */}
                            <td className="py-2 pr-2">
                              <input
                                type="number"
                                value={item.quantity || ""}
                                placeholder="1"
                                onChange={(e) =>
                                  updateItem(item.id, "quantity", e.target.value ? parseInt(e.target.value) : 0)
                                }
                                className="w-14 rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                              />
                            </td>
                            {/* 備註 — empty for value-add service */}
                            <td className="py-2 pr-2"></td>
                            {/* 小計 */}
                            <td className="py-2 pr-2">
                              <span className="font-mono-data text-xs font-medium text-foreground">
                                ${(item.unitPrice * item.quantity).toLocaleString()}
                              </span>
                            </td>
                            <td className="py-2">
                              <button
                                type="button"
                                onClick={() => removeItem(item.id)}
                                className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ) : (
                        <tr
                          key={item.id}
                          className={quoteRowReorderClass(
                            index,
                            item.id,
                            draggingItemId,
                            dropInsertIndex,
                            "border-b border-border/50 last:border-b-0",
                          )}
                          onDragOver={(e) => handleQuoteRowDragOver(e, index)}
                          onDrop={handleQuoteRowDrop}
                        >
                          <td className="py-2 pr-1 align-middle">
                            <QuoteRowDragHandle
                              itemId={item.id}
                              onDragStart={setDraggingItemId}
                              onDragEnd={clearQuoteRowDrag}
                            />
                          </td>
                          {/* 圖片 (Product Image) - editable */}
                          <td className="py-2 pr-2">
                            <ReferenceImageCell
                              value={item.image || ""}
                              onChange={(url) => updateItem(item.id, "image", url)}
                              modalTitle="上傳產品圖片"
                            />
                          </td>
                          {/* 參考圖 (Reference Image) */}
                          <td className="py-2 pr-2">
                            <ReferenceImageCell
                              value={item.referenceImage || ""}
                              onChange={(url) => updateItem(item.id, "referenceImage", url)}
                              modalTitle="上傳參考圖"
                            />
                          </td>
                          {/* 類別 (Category) */}
                          <td className="py-2 pr-2">
                            <input
                              type="text"
                              value={item.category || ""}
                              placeholder="—"
                              onChange={(e) =>
                                updateItem(item.id, "category", e.target.value)
                              }
                              className="w-full min-w-[50px] rounded-md border border-border bg-background px-2 py-1.5 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                            />
                          </td>
                          {/* 材質及明細 */}
                          <td className="py-2 pr-2">
                            <textarea
                              value={item.material || ""}
                              placeholder="材質及明細..."
                              rows={4}
                              onChange={(e) =>
                                updateItem(item.id, "material", e.target.value)
                              }
                              className="w-full min-w-[260px] rounded-md border border-border bg-background px-2 py-1.5 font-body text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
                            />
                          </td>
                          {/* 尺寸 */}
                          <td className="py-2 pr-2">
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number"
                                value={item.dimensionLMm ?? ""}
                                placeholder="L"
                                onChange={(e) =>
                                  updateItem(item.id, "dimensionLMm", e.target.value ? parseInt(e.target.value) : null)
                                }
                                className="w-12 rounded-md border border-border bg-background px-1 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                              />
                              <span className="text-xs text-muted-foreground">×</span>
                              <input
                                type="number"
                                value={item.dimensionWMm ?? ""}
                                placeholder="W"
                                onChange={(e) =>
                                  updateItem(item.id, "dimensionWMm", e.target.value ? parseInt(e.target.value) : null)
                                }
                                className="w-12 rounded-md border border-border bg-background px-1 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                              />
                              <span className="text-xs text-muted-foreground">×</span>
                              <input
                                type="number"
                                value={item.dimensionHMm ?? ""}
                                placeholder="H"
                                onChange={(e) =>
                                  updateItem(item.id, "dimensionHMm", e.target.value ? parseInt(e.target.value) : null)
                                }
                                className="w-12 rounded-md border border-border bg-background px-1 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                              />
                            </div>
                          </td>
                          {/* 顏色 */}
                          <td className="py-2 pr-2">
                            <input
                              type="text"
                              value={item.color || ""}
                              placeholder="—"
                              onChange={(e) => updateItem(item.id, "color", e.target.value)}
                              className="w-full min-w-[80px] rounded-md border border-border bg-background px-2 py-1.5 font-body text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                            />
                          </td>
                          {/* 成本價 */}
                          <td className="py-2 pr-2">
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
                              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                            />
                          </td>
                          {/* 單價 */}
                          <td className="py-2 pr-2">
                            <input
                              type="number"
                              value={item.unitPrice || ""}
                              placeholder="0"
                              min={0}
                              onChange={(e) =>
                                updateItem(
                                  item.id,
                                  "unitPrice",
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                            />
                          </td>
                          {/* 數量 */}
                          <td className="py-2 pr-2">
                            <input
                              type="number"
                              value={item.quantity || ""}
                              placeholder="1"
                              min={1}
                              onChange={(e) =>
                                updateItem(
                                  item.id,
                                  "quantity",
                                  parseInt(e.target.value) || 1,
                                )
                              }
                              className="w-16 rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                            />
                          </td>
                          {/* 備註 (Remarks) — rich text + images */}
                          <td className="py-2 pr-2 align-top">
                            <RemarksRichEditor
                              key={item.id}
                              value={item.remarks || ""}
                              legacyImage={item.remarksImage}
                              onChange={(val) => updateItem(item.id, "remarks", val)}
                            />
                          </td>
                          {/* 小計 */}
                          <td className="py-2 pr-2">
                            <span className="font-mono-data text-xs font-medium text-foreground">
                              $
                              {(
                                item.unitPrice * item.quantity
                              ).toLocaleString()}
                            </span>
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                        )
                      ))}
                    </tbody>
                  </table>
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
                <div className="hidden space-y-4 font-body text-[11px] leading-relaxed text-foreground/80">
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
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
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
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
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
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
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
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
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
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
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

          {/* Footer Navigation */}
          <div className="mt-8 flex items-center justify-between border-t border-border pt-6 pb-8">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 font-body text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" />
              上一步
            </button>
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
          deleteDraft(draftKey).catch(() => {});
          if (quoteId) deleteDraft(quoteId).catch(() => {});
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

      {/* PDF Preview Modal */}
      {showPDFPreview && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="text-white">Loading PDF Preview...</div>
            </div>
          }
        >
          <LazyQuotationPDFPreviewModal
            open={showPDFPreview}
            onClose={() => setShowPDFPreview(false)}
            data={buildPDFData()}
          />
        </Suspense>
      )}
    </>
  );
}
