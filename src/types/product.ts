export type ProductStatus = 'draft' | 'publishing' | 'success' | 'error';
export type ProductSource = 'local' | 'shopify';
export type DeliveryTermType = 'stock' | 'custom';

export interface DeliveryTerm {
  id: string;
  name: string;
  type: DeliveryTermType;
  minDays: number;
  maxDays: number;
  parentId: string | null;
  sortOrder: number;
  children?: DeliveryTerm[];
}

export interface ProductVariant {
  id: string;
  size: string;
  color: string;
  sku: string;
  price: number;
  inventory: number;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  descriptionHtml?: string;
  tags: string[];
  price: number;
  compareAtPrice?: number;
  collection: string;
  status: ProductStatus;
  imageUrl: string;
  variants: ProductVariant[];
  createdAt: string;
  errorMessage?: string;
  shopifyProductId?: string | null;
  sku?: string;
  source: ProductSource;
  syncedAt?: string | null;
  uploadSessionId?: string | null;
  factoriesDisplayName?: string;
  // bwf_product_master fields
  category?: string;
  factoryName?: string;
  material?: string;
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
  costPrice?: number | null;
  salePrice?: number | null;
  shopifyPrice?: number | null;
  shopifyCompareAtPrice?: number | null;
  deliveryDays?: number | null;
  bwfMasterId?: string | null;
  factoryId?: string | null;
  // New sync fields
  productionLeadTime?: number | null;
  shippingDays?: number | null;
  shippingFee?: number | null;
  remarks?: string | null;
  /** W3C English color name (e.g., 'SaddleBrown', 'White') */
  color?: string | null;
  /** Factory highlights / product categories associated with this manufacturer */
  factoryHighlight?: string[];
  /** AI-generated bilingual names */
  titleEn?: string;
  titleZh?: string;
  /** Delivery term reference */
  deliveryTermId?: string | null;
  deliveryTermName?: string | null;
  deliveryTerm?: DeliveryTerm | null;
  /** Lifestyle / scene image URL (效果圖) */
  lifestyleImageUrl?: string | null;
}

export interface AppSettings {
  shopifyApiKey: string;
  shopifyStoreUrl: string;
  defaultCollection: string;
  aiModel: string;
  isConnected: boolean;
  geminiProxyUrl: string;
}

export type ViewType = 'dashboard' | 'ai-processor' | 'ready-to-publish' | 'listed-products' | 'settings' | 'manufacturer-catalog' | 'design-projects' | 'product-search' | 'invite-clients' | 'confirmed-projects' | 'factory-catalog-quote' | 'quick-quote' | 'product-report' | 'quotation-list' | 'category-management';
