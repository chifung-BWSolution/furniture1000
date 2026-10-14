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

/** view → absolute path (no trailing slash; design-projects list only — id appended elsewhere). */
const VIEW_PATHS: { view: ViewType; path: string }[] = [
  { view: 'dashboard', path: '/' },

  { view: 'solution-project-list', path: `${PROJECT_BASE}/project-list` },
  { view: 'design-projects', path: `${PROJECT_BASE}/design-projects` },
  { view: 'invite-clients', path: `${PROJECT_BASE}/invite-clients` },
  { view: 'confirmed-projects', path: `${PROJECT_BASE}/confirmed-projects` },
  /** Legacy alias → design-projects */
  { view: 'product-search', path: `${PROJECT_BASE}/design-projects` },

  { view: 'manufacturer-catalog', path: `${PRODUCTS_BASE}/manufacturer-catalog` },
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
  { view: 'fds2-designer-su', path: `${FDS_BASE}/designer/su` },
  { view: 'fds2-designer-3d', path: `${FDS_BASE}/designer/3d` },
  { view: 'fds2-pm-budget', path: `${FDS_BASE}/pm/budget` },
  { view: 'fds2-pm-quick', path: `${FDS_BASE}/pm/quick` },
  { view: 'fds2-pm-pro-pdf', path: `${FDS_BASE}/pm/pro-pdf` },
  { view: 'fds2-cases-orders', path: `${FDS_BASE}/cases/orders` },
  { view: 'fds2-cases-photos', path: `${FDS_BASE}/cases/photos` },
  { view: 'fds2-cases-clients', path: `${FDS_BASE}/cases/clients` },
  { view: 'fds2-quote-factories', path: `${FDS_BASE}/quote/factories` },
  { view: 'fds2-quote-quick', path: `${FDS_BASE}/quote/quick` },
  { view: 'fds2-quote-common', path: `${FDS_BASE}/quote/common` },
  { view: 'fds2-quote-report', path: `${FDS_BASE}/quote/report` },
  { view: 'fds2-quote-list', path: `${FDS_BASE}/quote/list` },
  { view: 'fds2-quote-large', path: `${FDS_BASE}/quote/large` },
  { view: 'fds2-quote-trash', path: `${FDS_BASE}/quote/trash` },
  { view: 'fds2-quote-format', path: `${FDS_BASE}/quote/format` },
  { view: 'fds2-factory-info', path: `${FDS_BASE}/factories/info` },
  { view: 'fds2-factory-upload', path: `${FDS_BASE}/factories/upload-pdf` },
  { view: 'fds2-factory-sales', path: `${FDS_BASE}/factories/sales` },
  { view: 'fds2-factory-zones', path: `${FDS_BASE}/factories/zones` },
  { view: 'fds2-factory-login', path: `${FDS_BASE}/factories/login` },
  { view: 'fds2-products-factories', path: `${FDS_BASE}/products/factories` },
  { view: 'fds2-products-quote-pdf', path: `${FDS_BASE}/products/quote-pdf` },
  { view: 'fds2-products-pending', path: `${FDS_BASE}/products/pending` },
  { view: 'fds2-products-catalog', path: `${FDS_BASE}/products/catalog` },
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
    (row) => row.view !== 'product-search' && row.view !== 'report-sales',
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
  { prefix: `${FDS_BASE}/quote`, view: 'fds2-quote-factories' },
  { prefix: `${FDS_BASE}/factories`, view: 'fds2-factory-info' },
  { prefix: `${FDS_BASE}/products`, view: 'fds2-products-factories' },
  { prefix: `${FDS_BASE}/publish`, view: 'fds2-publish-copy' },
  { prefix: `${FDS_BASE}/reports`, view: 'fds2-report-factory' },
  { prefix: `${FDS_BASE}/settings`, view: 'fds2-admin-shopify' },
  { prefix: `${FDS_BASE}/customer`, view: 'fds2-customer-quotes' },
];

export function pathFromAppView(view: ViewType): string | null {
  return PATH_BY_VIEW.get(view) ?? null;
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

  // Moved Shopify 上載產品紀錄 from 設定 → 分析報表
  if (path === `${SETTINGS_BASE}/upload-product-log`) {
    return 'upload-product-log';
  }

  // Prefix-only e.g. /project → project-list
  if (path === PROJECT_BASE) return 'solution-project-list';
  if (path === PRODUCTS_BASE) return 'manufacturer-catalog';
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
