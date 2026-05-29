export interface QuotationPDFData {
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
    name: string;
    unitPrice: number;
    quantity: number;
    // Additional fields from bwf_product_master
    category?: string;
    material?: string;
    color?: string;
    remarks?: string;
    dimensionLMm?: number | null;
    dimensionWMm?: number | null;
    dimensionHMm?: number | null;
  }[];
  subtotal: number;
}
