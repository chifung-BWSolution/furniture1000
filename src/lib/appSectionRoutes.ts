import type { ViewType } from '@/types/product';

/**
 * Stable deep links for primary sections (mirror 客戶專區 /customer/… pattern).
 * Quote stays under /quote; customer under /customer; design project detail under
 * /project/design-projects/:id.
 */

export const PROJECT_BASE = '/project';
export const PRODUCTS_BASE = '/products';
export const PUBLISH_BASE = '/publish';
export const REPORTS_BASE = '/reports';
export const SETTINGS_BASE = '/settings';
export const FDS_BASE = '/fds';
/** 廠家目錄。詳情為 `${FACTORIES_PATH}/:code`，留在後台殼內。 */
export const FACTORIES_PATH = `${FDS_BASE}/factories`;

/** Segments under /fds/factories that are other pages, not a factory code. */
const FACTORY_PATH_RESERVED = new Set(['sales', 'zones', 'login', 'info', 'upload-pdf']);

/** view → absolute path (no trailing slash; design-projects list only — id appended elsewhere). */
const VIEW_PATHS: { view: ViewType; path: string }[] = [
  { view: 'dashboard', path: '/' },

  { view: 'solution-project-list', path: `${PROJECT_BASE}/project-list` },
  { view: 'design-projects', path: `${PROJECT_BASE}/design-projects` },
  { view: 'invite-clients', path: `${PROJECT_BASE}/invite-clients` },
  /** Legacy alias → design-projects */
  { view: 'product-search', path: `${PROJECT_BASE}/design-projects` },

  /** Legacy list screens → 廠家目錄. 上載報價 PDF stays on its own page. */
  { view: 'manufacturer-catalog', path: `${FDS_BASE}/factories` },
  { view: 'ai-processor', path: `${PRODUCTS_BASE}/ai-processor` },
  { view: 'listed-products', path: `${PRODUCTS_BASE}/listed-products` },
  { view: 'product-catalog', path: `${PRODUCTS_BASE}/product-catalog` },

  { view: 'publish-copywriting', path: `${PUBLISH_BASE}/copywriting` },
  { view: 'publish-product-info', path: `${PUBLISH_BASE}/product-info` },
  { view: 'furniture-group-check', path: `${PUBLISH_BASE}/furniture-group-check` },
  { view: 'ready-to-publish', path: `${PUBLISH_BASE}/ready-to-publish` },
  { view: 'published-products', path: `${PUBLISH_BASE}/published-products` },
  { view: 'abnormal-price-products', path: `${PUBLISH_BASE}/abnormal-price-products` },

  { view: 'report-factory', path: `${REPORTS_BASE}/factory` },
  { view: 'report-product', path: `${REPORTS_BASE}/product` },
  { view: 'upload-product-log', path: `${REPORTS_BASE}/upload-product-log` },
  /** Legacy 銷售報告 → 廠家報告 */
  { view: 'report-sales', path: `${REPORTS_BASE}/factory` },

  { view: 'user-management', path: `${SETTINGS_BASE}/user-management` },
  { view: 'login-history', path: `${SETTINGS_BASE}/login-history` },
  { view: 'category-management', path: `${SETTINGS_BASE}/category-management` },
  { view: 'category-registry', path: `${SETTINGS_BASE}/category-registry` },
  { view: 'settings', path: `${SETTINGS_BASE}/system` },

  { view: 'fds2-designer-types', path: `${FDS_BASE}/designer/types` },
  { view: 'fds2-designer-pdf', path: `${FDS_BASE}/designer/pdf` },
  { view: 'fds2-designer-common', path: `${FDS_BASE}/designer/common` },
  { view: 'fds2-designer-latest', path: `${FDS_BASE}/designer/latest` },
  { view: 'fds2-pm-budget', path: `${FDS_BASE}/pm/budget` },
  { view: 'fds2-pm-quick', path: `${FDS_BASE}/pm/quick` },
  { view: 'fds2-pm-pro-pdf', path: `${FDS_BASE}/pm/pro-pdf` },
  { view: 'fds2-pm-presentation', path: `${FDS_BASE}/pm/presentation` },
  { view: 'fds2-cases-orders', path: `${FDS_BASE}/cases/orders` },
  { view: 'fds2-cases-photos', path: `${FDS_BASE}/cases/photos` },
  { view: 'fds2-cases-clients', path: `${FDS_BASE}/cases/clients` },
  /** 傢俬報價裡的廠家目錄已併入「廠家目錄」 */
  { view: 'fds2-quote-factories', path: `${FDS_BASE}/factories` },
  { view: 'fds2-quote-quick', path: `${FDS_BASE}/quote/quick` },
  { view: 'fds2-quote-common', path: `${FDS_BASE}/quote/common` },
  { view: 'fds2-quote-list', path: `${FDS_BASE}/quote/list` },
  { view: 'fds2-quote-large', path: `${FDS_BASE}/quote/large` },
  { view: 'fds2-quote-trash', path: `${FDS_BASE}/quote/trash` },
  { view: 'fds2-quote-format', path: `${FDS_BASE}/quote/format` },
  { view: 'fds2-quote-photos', path: `${FDS_BASE}/quote/photos` },
  /** 廠家資訊、上載產品 PDF 已併入「廠家目錄」 */
  { view: 'fds2-factory-info', path: `${FDS_BASE}/factories` },
  { view: 'fds2-factory-upload', path: `${FDS_BASE}/factories` },
  { view: 'fds2-factory-sales', path: `${FDS_BASE}/factories/sales` },
  { view: 'fds2-factory-zones', path: `${FDS_BASE}/factories/zones` },
  { view: 'fds2-factory-login', path: `${FDS_BASE}/factories/login` },
  { view: 'fds2-products-factories', path: FACTORIES_PATH },
  { view: 'fds2-products-quote-pdf', path: `${FDS_BASE}/factories` },
  { view: 'fds2-products-ai-review', path: `${FDS_BASE}/products/ai-review` },
  { view: 'fds2-products-pending', path: `${FDS_BASE}/products/pending` },
  { view: 'fds2-products-catalog', path: `${FDS_BASE}/products/catalog` },
  { view: 'fds2-quote-report', path: `${FDS_BASE}/products/report` },
  { view: 'fds2-publish-copy', path: `${FDS_BASE}/publish/copywriting` },
  { view: 'fds2-publish-price', path: `${FDS_BASE}/publish/price` },
  { view: 'fds2-publish-check', path: `${FDS_BASE}/publish/check` },
  { view: 'fds2-publish-ready', path: `${FDS_BASE}/publish/ready` },
  { view: 'fds2-publish-done', path: `${FDS_BASE}/publish/published` },
  { view: 'fds2-publish-abnormal', path: `${FDS_BASE}/publish/abnormal-price` },
  { view: 'fds2-publish-similar', path: `${FDS_BASE}/publish/similar` },
  { view: 'fds2-report-factory', path: `${FDS_BASE}/reports/factory` },
  { view: 'fds2-report-product', path: `${FDS_BASE}/reports/product` },
  { view: 'fds2-report-upload-log', path: `${FDS_BASE}/reports/upload-log` },
  { view: 'fds2-admin-users', path: `${FDS_BASE}/settings/users` },
  { view: 'fds2-admin-logins', path: `${FDS_BASE}/settings/login-history` },
  { view: 'fds2-admin-shopify', path: `${FDS_BASE}/settings/shopify-categories` },
  { view: 'fds2-admin-categories', path: `${FDS_BASE}/settings/product-categories` },
  { view: 'fds2-admin-settings', path: `${FDS_BASE}/settings/system` },
  { view: 'fds2-admin-prd', path: `${FDS_BASE}/settings/prd` },
  { view: 'fds2-admin-command-logs', path: `${FDS_BASE}/settings/daily-command-logs` },
  { view: 'fds2-admin-usage', path: `${FDS_BASE}/settings/usage` },
  { view: 'fds2-admin-dev-cost', path: `${FDS_BASE}/settings/development-cost` },
  { view: 'fds2-admin-email', path: `${FDS_BASE}/settings/email` },
  { view: 'fds2-customer-quotes', path: `${FDS_BASE}/customer/quote-schemes` },
  { view: 'fds2-customer-search', path: `${FDS_BASE}/customer/product-search` },
  { view: 'fds2-customer-custom', path: `${FDS_BASE}/customer/custom` },
  { view: 'fds2-customer-pay', path: `${FDS_BASE}/customer/payment` },
  { view: 'fds2-customer-orders', path: `${FDS_BASE}/customer/orders` },
  { view: 'fds2-customer-cases', path: `${FDS_BASE}/customer/cases` },
  { view: 'fds2-customer-services', path: `${FDS_BASE}/customer/services` },
  { view: 'fds2-customer-company', path: `${FDS_BASE}/customer/company` },
  { view: 'fds2-customer-contact', path: `${FDS_BASE}/customer/contact` },
  { view: 'fds2-customer-org', path: `${FDS_BASE}/customer/org-account` },
];

const PATH_BY_VIEW = new Map(
  VIEW_PATHS.map((row) => [row.view, row.path] as const),
);

const VIEW_BY_PATH = new Map(
  VIEW_PATHS.filter(
    (row) =>
      row.view !== 'product-search' &&
      row.view !== 'report-sales' &&
      row.view !== 'manufacturer-catalog' &&
      row.view !== 'fds2-quote-factories' &&
      row.view !== 'fds2-factory-info' &&
      row.view !== 'fds2-factory-upload' &&
      row.view !== 'fds2-products-quote-pdf',
  ).map((row) => [row.path, row.view] as const),
);

const SECTION_PREFIXES = [
  PROJECT_BASE,
  PRODUCTS_BASE,
  PUBLISH_BASE,
  REPORTS_BASE,
  SETTINGS_BASE,
  FDS_BASE,
] as const;

const FDS_PREFIX_DEFAULTS: { prefix: string; view: ViewType }[] = [
  { prefix: `${FDS_BASE}/designer`, view: 'fds2-designer-types' },
  { prefix: `${FDS_BASE}/pm`, view: 'fds2-pm-budget' },
  { prefix: `${FDS_BASE}/cases`, view: 'fds2-cases-orders' },
  { prefix: `${FDS_BASE}/quote`, view: 'fds2-quote-quick' },
  { prefix: `${FDS_BASE}/factories`, view: 'fds2-products-factories' },
  { prefix: `${FDS_BASE}/products`, view: 'fds2-products-ai-review' },
  { prefix: `${FDS_BASE}/publish`, view: 'fds2-publish-copy' },
  { prefix: `${FDS_BASE}/reports`, view: 'fds2-report-factory' },
  { prefix: `${FDS_BASE}/settings`, view: 'fds2-admin-shopify' },
  { prefix: `${FDS_BASE}/customer`, view: 'fds2-customer-quotes' },
];

export function pathFromAppView(view: ViewType): string | null {
  return PATH_BY_VIEW.get(view) ?? null;
}

/** Menus that used to open the factory list. One sidebar item remains. */
const DIRECTORY_ALIAS_VIEWS = new Set<ViewType>([
  'manufacturer-catalog',
  'fds2-quote-factories',
  'fds2-factory-info',
  'fds2-factory-upload',
  'fds2-products-quote-pdf',
]);

export function canonicalizeDirectoryView(view: ViewType): ViewType {
  return DIRECTORY_ALIAS_VIEWS.has(view) ? 'fds2-products-factories' : view;
}

/** 產品類型 list. A product opens at `${DESIGNER_TYPES_PATH}/:productId`. */
export const DESIGNER_TYPES_PATH = `${FDS_BASE}/designer/types`;

export function buildDesignerProductPath(productId: string): string {
  const id = productId.trim();
  if (!id) return DESIGNER_TYPES_PATH;
  return `${DESIGNER_TYPES_PATH}/${encodeURIComponent(id)}`;
}

/** Shareable factory detail inside the app shell. */
export function buildFactoryDetailPath(code: string): string {
  const id = code.trim();
  if (!id || FACTORY_PATH_RESERVED.has(id)) return FACTORIES_PATH;
  return `${FACTORIES_PATH}/${encodeURIComponent(id)}`;
}

/** Factory code from `/fds/factories/:code`, or null on the list and sibling pages. */
export function factoryCodeFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const prefix = `${FACTORIES_PATH}/`;
  if (!path.startsWith(prefix)) return null;
  const segment = path.slice(prefix.length);
  if (!segment || segment.includes('/')) return null;
  let code = segment;
  try {
    code = decodeURIComponent(segment);
  } catch {
    return null;
  }
  code = code.trim();
  if (!code || FACTORY_PATH_RESERVED.has(code)) return null;
  return code;
}

/** Product id from `/fds/designer/types/:productId`, or null on the list. */
export function designerProductIdFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const prefix = `${DESIGNER_TYPES_PATH}/`;
  if (!path.startsWith(prefix)) return null;
  const segment = path.slice(prefix.length);
  if (!segment || segment.includes('/')) return null;
  try {
    const id = decodeURIComponent(segment).trim();
    return id || null;
  } catch {
    return null;
  }
}

export function isAppSectionPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return false;
  return SECTION_PREFIXES.some(
    (base) => path === base || path.startsWith(`${base}/`),
  );
}

/**
 * Parse a section deep link into a ViewType.
 * Design project detail `/project/design-projects/:id` → design-projects.
 * Unknown slugs under a known prefix fall back to that section's first mapped view.
 */
export function appViewFromPath(pathname: string): ViewType | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'dashboard';

  const exact = VIEW_BY_PATH.get(path);
  if (exact) return exact;

  // /project/design-projects/<uuid>
  if (path.startsWith(`${PROJECT_BASE}/design-projects/`)) {
    return 'design-projects';
  }

  // Removed 銷售報告 — old bookmarks land on 廠家報告
  if (path === `${REPORTS_BASE}/sales`) return 'report-factory';

  // SU／3D 模型頁已從設計師選傢俬拿掉，舊連結回到產品類型。
  if (path === `${FDS_BASE}/designer/su` || path === `${FDS_BASE}/designer/3d`) {
    return 'fds2-designer-types';
  }

  // Moved Shopify 上載產品紀錄 from 設定 → 分析報表
  if (path === `${SETTINGS_BASE}/upload-product-log`) {
    return 'upload-product-log';
  }

  // 產品報告已從傢俬報價移到產品管理，舊連結仍開啟同一頁。
  if (path === `${FDS_BASE}/quote/report`) return 'fds2-quote-report';

  // Retired directory / PDF menus all open 廠家目錄.
  if (
    path === `${PRODUCTS_BASE}/manufacturer-catalog` ||
    path === PRODUCTS_BASE ||
    path === `${FDS_BASE}/quote/factories` ||
    path === `${FDS_BASE}/factories/info` ||
    path === `${FDS_BASE}/factories/upload-pdf` ||
    path === `${FDS_BASE}/products/factories` ||
    path === `${FDS_BASE}/products/quote-pdf`
  ) {
    return 'fds2-products-factories';
  }

  // 已確定方案併入客戶專區的報價方案。
  if (path === `${PROJECT_BASE}/confirmed-projects`) return 'fds2-customer-quotes';

  // Prefix-only e.g. /project → 平面圖與房間
  if (path === PROJECT_BASE) return 'solution-project-list';
  if (path === PUBLISH_BASE) return 'publish-copywriting';
  if (path === REPORTS_BASE) return 'report-factory';
  if (path === SETTINGS_BASE) return 'category-management';

  if (path === FDS_BASE) return 'dashboard';
  const fdsMatch = FDS_PREFIX_DEFAULTS.find(
    (row) => path === row.prefix || path.startsWith(`${row.prefix}/`),
  );
  if (fdsMatch) return fdsMatch.view;

  return null;
}

export function isAppSectionView(view: ViewType): boolean {
  return PATH_BY_VIEW.has(view);
}
