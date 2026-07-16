export type QuotationDimensionMode = 'lwh' | 'dh';

export interface QuotationPDFData {
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
    name: string;
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
  deliveryDetails: string;
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
  items: {
    image: string;
    referenceImage?: string;
    name: string;
    unitPrice: number;
    quantity: number;
    // Additional fields from bwf_product_master
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
    isCustomTerm?: boolean;
    /** Reference-only line — excluded from totals & GP cost; PDF shows 可選產品 + checkbox. */
    isOptional?: boolean;
    /** Section heading (一、開放區) — full-width title row in PDF. */
    isSectionTitle?: boolean;
    unit?: string;
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
}
