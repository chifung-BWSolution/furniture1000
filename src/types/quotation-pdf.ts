import type { PhotoLayoutGroup } from '@/lib/quotePhotoLayouts';

export type QuotationDimensionMode = 'lwh' | 'dh';

export interface QuotationPDFData {
  /** Compact PM quotation without company details or confirmation terms. */
  quickQuote?: boolean;
  /** Optional title for compact reference quotations. */
  referenceTitle?: string;
  // Customer-facing PDF only. Editor-internal fields (gpSummary, priceMultiplier, etc.)
  // must never be passed into QuotationPDFPreview / QuotationDocument.
  companyInfo: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };
  clientInfo: {
    /** Client company / org (公司名稱). */
    name: string;
    /** Contact person (客戶名稱). */
    contactName?: string;
    phone: string;
    email: string;
  };
  quoteMeta: {
    projectName: string;
    pmName: string;
    validity: string;
    deliveryAddress: string;
    quoteNumber?: string;
    /** e.g. v1, v2 — used in PDF download filename. */
    version?: string;
    date?: string;
  };
  /** Company quote-format settings applied to this PDF. */
  format?: {
    zoneSubtotalPlacement?: 'section_and_summary' | 'summary_only' | 'hidden';
    qrCaption?: string;
    qrDataUrl?: string;
  };
  deliveryDetails: string;
  /**
   * 報價單圖片：圖片庫快照，按清單次序 3 張一列，
   * 印在總價之後、訂單確認及交付細節之前。
   */
  quotePhotos?: {
    id: string;
    title: string;
    url: string;
    caption?: string;
  }[];
  /**
   * 報價單圖片排版（QMS 版）：每個 group 一組版式，印在總價之後、訂單確認及交付細節之前。
   * assets 是圖片庫快照（assetId → url），欄位位置見 src/lib/quotePhotoLayouts.ts。
   */
  quotePhotoLayouts?: {
    groups: PhotoLayoutGroup[];
    assets: { id: string; title: string; url: string; isGenerated?: boolean }[];
  };
  /**
   * 圖片庫設定為封面／封底的圖片（照 FCCD 的做法）：每張各佔一整頁 A4，
   * 封面排在正文之前（第 1 頁起）、封底排在簽署欄之後。
   * 這不是單一報價的資料，是圖片庫的全域設定，所以不寫進 project_data。
   */
  quoteCoverPages?: {
    id: string;
    title: string;
    placement: 'cover' | 'back';
    url: string;
  }[];
  /**
   * 圖片庫設定為「內頁獨立整頁」的圖片：每張各佔一整頁 A4，
   * 插在正文第 pageNumber 頁之後（超出正文頁數時排在正文最後一頁之後）。
   * 跟封面／封底一樣是圖片庫的全域設定，不寫進 project_data。
   */
  quoteContentPages?: {
    id: string;
    title: string;
    url: string;
    pageNumber: number;
  }[];
  termsContent?: {
    transport?: string;
    extraFees?: string;
    warranty?: string;
    other?: string;
    payment?: string;
    fullHtml?: string;
  };
  /** UI/PDF language for this preview. Product data values are unchanged. */
  locale?: 'zh' | 'en';
  /** Reference images uploaded before any zone. Shown above the line items. */
  leadImages?: string[];
  /** Photo layouts printed under each zone subtotal. Key is the section-title id, or `unzoned`. */
  zonePhotoLayouts?: Record<string, PhotoLayoutGroup[]>;
  items: {
    image: string;
    referenceImage?: string;
    name: string;
    unitPrice: number;
    quantity: number;
    /** Exact reference-quote specification and rounded line subtotal. */
    referenceSpec?: string;
    referenceLineTotal?: number;
    // Additional fields from bwf_product_master
    category?: string;
    material?: string;
    color?: string;
    remarks?: string;
    remarksImage?: string;
    dimensionLMm?: string | number | null;
    dimensionWMm?: string | number | null;
    dimensionHMm?: string | number | null;
    /** lwh = 長×闊×高 (default); dh = 直徑×高 */
    dimensionMode?: QuotationDimensionMode;
    isCustomTerm?: boolean;
    /** Reference-only line — excluded from totals & GP cost; PDF shows 可選產品 + checkbox. */
    isOptional?: boolean;
    /** Omitted from PDF / Quotation Preview when true (still in draft editor). */
    hideInPdf?: boolean;
    /** Section-title row id, used to attach images under that zone's subtotal. */
    id?: string;
    /** Section heading (一、開放區) — full-width title row in PDF. */
    isSectionTitle?: boolean;
    /** Images uploaded on that zone heading. */
    zoneImages?: string[];
    unit?: string;
    /**
     * Item 的全部圖片（產品圖＋參考圖＋備註圖），供 PDF 圖例自適應排版使用。
     * 未提供時由 PDF 從 image / referenceImage / remarks 自行組合，舊資料不必改。
     */
    images?: {
      url: string;
      kind?: 'product' | 'reference' | 'remarks' | 'drawing' | 'other';
      /** 原始像素寬高；未提供時由 PDF 預載圖片量測。 */
      width?: number;
      height?: number;
    }[];
  }[];
  subtotal: number;
  discountNote?: string;
  installationFee?: {
    title?: string;
    subtitle?: string;
    conditionText?: string;
    freeLabel?: string;
    chargeLabel?: string;
    amount?: number | null;
  };
  /** Catalog pages appended after the quotation. crop is a top-left fraction of that page. */
  catalogPages?: {
    documentId: string;
    pageNo: number;
    factoryName: string;
    title: string | null;
    documentYear: number | null;
    series: string | null;
    crop?: { x: number; y: number; width: number; height: number } | null;
  }[];
}
