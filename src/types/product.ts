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
  /** FK to products.id — needed for ready_to_shopify DB operations */
  productId?: string;
  size: string;
  color: string;
  sku: string;
  price: number;
  inventory: number;
  option1?: string;
  /** Per-variant image assigned in merge UI — used on Shopify upload */
  imageSrc?: string | null;
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
  /** 現貨 / 全訂製 — in_stock=true 顯示「現貨」，否則顯示 customize 內容 */
  inStock?: boolean | null;
  customize?: string | null;
  /** Lifestyle / scene image URL (效果圖) */
  lifestyleImageUrl?: string | null;
  /** 發佈前檢查通過後，按「進入準備上載」設為 true，準備上載頁只顯示此類產品 */
  readyToPublish?: boolean;
  /** FK to products.id stored alongside rts.id so variant modal can update the correct row */
  productId?: string;
}

export interface AppSettings {
  shopifyApiKey: string;
  shopifyStoreUrl: string;
  defaultCollection: string;
  aiModel: string;
  isConnected: boolean;
  geminiProxyUrl: string;
}

export type ViewType =
  // 儀表板
  | 'dashboard'
  // 產品管理
  | 'manufacturer-catalog'
  | 'factory-detail'
  | 'ai-processor'
  | 'listed-products'
  | 'product-catalog'
  | 'category-management'
  // 傢俬方案
  | 'solution-project-list'
  | 'design-projects'
  | 'product-search'
  | 'invite-clients'
  | 'confirmed-projects'
  | 'solution-client-activity'
  | 'solution-portal-content'
  // 客戶專區（Client Portal 微型網站）
  | 'customer-design-projects' // legacy — kept for deep-links
  | 'customer-quote-schemes'
  | 'customer-product-search'
  | 'customer-custom-furniture'
  | 'customer-payment-delivery'
  | 'customer-order-status'
  | 'customer-case-studies'
  | 'customer-services'
  | 'customer-confirmed-products' // legacy
  | 'customer-company-info'
  | 'customer-contact'
  | 'customer-org-account'
  // 傢俬報價
  | 'quick-quote'
  | 'quotation-list'
  // 網上發佈
  | 'publish-copywriting'
  | 'publish-product-info'
  | 'publish-precheck'
  | 'ready-to-publish'
  | 'furniture-group-check'
  | 'published-products'
  // 分析報表
  | 'report-factory'
  | 'report-product'
  | 'report-sales'
  // 設定
  | 'settings'
  | 'upload-product-log'
  | 'user-management'
  | 'login-history'
  | 'category-registry';

export type PrimarySection =
  | 'home'
  | 'solutions'
  | 'customers'
  | 'quote'
  | 'products'
  | 'publish'
  | 'reports'
  | 'admin';
