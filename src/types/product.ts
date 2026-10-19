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
  | 'quotation-large-amount'
  // 網上發佈
  | 'publish-copywriting'
  | 'publish-product-info'
  | 'publish-precheck'
  | 'ready-to-publish'
  | 'furniture-group-check'
  | 'published-products'
  | 'abnormal-price-products'
  // 分析報表
  | 'report-factory'
  | 'report-product'
  /** @deprecated Removed — redirects to report-factory */
  | 'report-sales'
  // 設定
  | 'settings'
  | 'upload-product-log'
  | 'user-management'
  | 'login-history'
  | 'category-registry'
  // FDS 2.0 sitemap placeholders
  | 'fds2-designer-types'
  | 'fds2-designer-pdf'
  | 'fds2-designer-common'
  | 'fds2-designer-latest'
  | 'fds2-designer-su'
  | 'fds2-designer-3d'
  | 'fds2-pm-budget'
  | 'fds2-pm-quick'
  | 'fds2-pm-pro-pdf'
  | 'fds2-cases-orders'
  | 'fds2-cases-photos'
  | 'fds2-cases-clients'
  | 'fds2-quote-factories'
  | 'fds2-quote-quick'
  | 'fds2-quote-common'
  | 'fds2-quote-report'
  | 'fds2-quote-list'
  | 'fds2-quote-large'
  | 'fds2-quote-trash'
  | 'fds2-quote-format'
  | 'fds2-factory-info'
  | 'fds2-factory-upload'
  | 'fds2-factory-sales'
  | 'fds2-factory-zones'
  | 'fds2-factory-login'
  | 'fds2-products-factories'
  | 'fds2-products-quote-pdf'
  | 'fds2-products-ai-review'
  | 'fds2-products-pending'
  | 'fds2-products-catalog'
  | 'fds2-publish-copy'
  | 'fds2-publish-price'
  | 'fds2-publish-check'
  | 'fds2-publish-ready'
  | 'fds2-publish-done'
  | 'fds2-publish-abnormal'
  | 'fds2-publish-similar'
  | 'fds2-report-factory'
  | 'fds2-report-product'
  | 'fds2-report-upload-log'
  | 'fds2-admin-users'
  | 'fds2-admin-logins'
  | 'fds2-admin-shopify'
  | 'fds2-admin-categories'
  | 'fds2-admin-settings'
  | 'fds2-admin-prd'
  | 'fds2-admin-command-logs'
  | 'fds2-admin-dev-cost'
  | 'fds2-admin-email'
  | 'fds2-customer-quotes'
  | 'fds2-customer-search'
  | 'fds2-customer-custom'
  | 'fds2-customer-pay'
  | 'fds2-customer-orders'
  | 'fds2-customer-cases'
  | 'fds2-customer-services'
  | 'fds2-customer-company'
  | 'fds2-customer-contact'
  | 'fds2-customer-org';

export type PrimarySection =
  | 'home'
  | 'designer'
  | 'pm'
  | 'cases'
  | 'solutions'
  | 'customers'
  | 'quote'
  | 'factories'
  | 'products'
  | 'publish'
  | 'reports'
  | 'admin';
