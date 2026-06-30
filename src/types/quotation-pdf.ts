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
    isCustomTerm?: boolean;
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
