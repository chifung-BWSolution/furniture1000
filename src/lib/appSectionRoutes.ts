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
] as const;

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

  return null;
}

export function isAppSectionView(view: ViewType): boolean {
  return PATH_BY_VIEW.has(view);
}
