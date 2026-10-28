import {
  Users, Calculator, Package, Globe, BarChart3, Settings as SettingsIcon,
  LayoutDashboard, Search, PenTool, Boxes, BookOpen, FileText, FileUp,
  Sofa, BadgeDollarSign, Sparkles, Wallet, Images, Star, Trash2,
  BookOpenText, ListChecks, Gauge,
  Building2, BarChart2, Map, LogIn, Mail, FolderTree, History,
  UserCog, ClipboardList, CircleDollarSign, Truck, PackageCheck, Film, Monitor,
  Briefcase, Phone, Landmark, Heart, Combine, Presentation,
  type LucideIcon,
} from 'lucide-react';
import { type PrimarySection, type ViewType } from '@/types/product';

export interface SecondaryItem {
  view: ViewType;
  label: string;
  icon: LucideIcon;
  /** Only visible to 系統管理員 (role = admin). */
  adminOnly?: boolean;
  /**
   * Kept out of the scrolling list and pinned above the theme toggle.
   * Still belongs to this section, so it only shows while the section is active.
   */
  pinned?: boolean;
}

export interface PrimaryItem {
  id: PrimarySection;
  label: string;
  icon: LucideIcon;
  children: SecondaryItem[];
}

export const NAV_CONFIG: PrimaryItem[] = [
  {
    id: 'home',
    label: '主頁',
    icon: LayoutDashboard,
    children: [
      { view: 'dashboard', label: '主頁', icon: LayoutDashboard },
    ],
  },
  {
    id: 'designer',
    label: '設計師選傢俬',
    icon: PenTool,
    children: [
      { view: 'fds2-designer-types', label: '產品類型', icon: Boxes },
      { view: 'fds2-designer-pdf', label: '產品PDF', icon: FileText },
      { view: 'fds2-designer-common', label: '常用傢俬', icon: Heart },
      { view: 'fds2-designer-latest', label: '最新產品', icon: Sparkles },
    ],
  },
  {
    id: 'pm',
    label: 'PM報價',
    icon: Wallet,
    children: [
      { view: 'fds2-pm-budget', label: '報價預算', icon: CircleDollarSign },
      { view: 'fds2-pm-quick', label: '快速報價', icon: Calculator },
      { view: 'fds2-pm-presentation', label: '簡報生成', icon: Presentation },
    ],
  },
  {
    id: 'cases',
    label: '成功案例',
    icon: Images,
    children: [
      { view: 'fds2-cases-orders', label: '項目列表', icon: ClipboardList },
      { view: 'fds2-cases-photos', label: '完工相片', icon: Images },
      { view: 'fds2-cases-clients', label: '知名客户', icon: Star },
    ],
  },
  {
    id: 'quote',
    label: '傢俬報價',
    icon: Calculator,
    children: [
      { view: 'fds2-quote-quick', label: '快速報價', icon: Calculator },
      { view: 'fds2-quote-common', label: '常用傢俬', icon: Heart },
      { view: 'fds2-quote-list', label: '報價一覽', icon: ClipboardList },
      { view: 'fds2-quote-large', label: '大金額投標 (>$50000)', icon: CircleDollarSign },
      { view: 'fds2-quote-trash', label: '報價回收桶', icon: Trash2, pinned: true },
      { view: 'fds2-quote-format', label: '報價單格式設定', icon: FileText },
      { view: 'fds2-quote-photos', label: '圖片庫', icon: Images },
    ],
  },
  {
    id: 'factories',
    label: '廠家目錄',
    icon: Building2,
    children: [
      { view: 'fds2-products-factories', label: '廠家目錄', icon: BookOpen },
      { view: 'fds2-factory-sales', label: '銷售表現', icon: BarChart2 },
      { view: 'fds2-factory-zones', label: '廠家分區', icon: Map },
      { view: 'fds2-factory-login', label: '廠家登入', icon: LogIn },
    ],
  },
  {
    id: 'products',
    label: '產品管理',
    icon: Package,
    children: [
      { view: 'fds2-products-ai-review', label: 'AI 提取審核', icon: ListChecks },
      { view: 'fds2-products-pending', label: '待處理產品', icon: Boxes },
      { view: 'fds2-products-catalog', label: '圖冊', icon: BookOpen },
      { view: 'fds2-quote-report', label: '產品報告', icon: BarChart2 },
    ],
  },
  {
    id: 'publish',
    label: '網上發布',
    icon: Globe,
    children: [
      { view: 'fds2-publish-copy', label: '產品文案', icon: FileText },
      { view: 'fds2-publish-price', label: '產品價錢', icon: CircleDollarSign },
      { view: 'fds2-publish-check', label: '傢俬組檢查', icon: Sofa },
      { view: 'fds2-publish-ready', label: '準備上載', icon: FileUp },
      { view: 'fds2-publish-done', label: '已上載產品', icon: PackageCheck },
      { view: 'fds2-publish-abnormal', label: '異常價錢產品', icon: BadgeDollarSign },
      { view: 'fds2-publish-similar', label: '整合相似', icon: Combine },
    ],
  },
  {
    id: 'reports',
    label: '分析報表',
    icon: BarChart3,
    children: [
      { view: 'fds2-report-factory', label: '廠家報告', icon: Building2 },
      { view: 'fds2-report-product', label: '報價單產品報告', icon: BarChart2 },
      { view: 'fds2-report-upload-log', label: 'Shopify 上載產品紀錄', icon: ClipboardList, adminOnly: true },
    ],
  },
  {
    id: 'admin',
    label: '系統設定',
    icon: SettingsIcon,
    children: [
      { view: 'fds2-admin-users', label: '用戶管理', icon: UserCog, adminOnly: true },
      { view: 'fds2-admin-logins', label: '登入紀錄', icon: History, adminOnly: true },
      { view: 'fds2-admin-shopify', label: 'Shopify 分類', icon: FolderTree },
      { view: 'fds2-admin-categories', label: '產品分類', icon: FolderTree },
      { view: 'fds2-admin-settings', label: '系統設定', icon: SettingsIcon, adminOnly: true },
      { view: 'fds2-admin-prd', label: 'PRD功能描述', icon: BookOpenText, adminOnly: true },
      { view: 'fds2-admin-command-logs', label: '每日指令記錄', icon: ListChecks, adminOnly: true },
      { view: 'fds2-admin-usage', label: 'AI用量統計', icon: Gauge, adminOnly: true },
      { view: 'fds2-admin-dev-cost', label: '開發成本', icon: CircleDollarSign, adminOnly: true },
      { view: 'fds2-admin-email', label: '電郵通知', icon: Mail, adminOnly: true },
      { view: 'fds2-admin-skp-workers', label: 'SKP Worker', icon: Monitor, adminOnly: true },
    ],
  },
  {
    id: 'customers',
    label: '客戶專區',
    icon: Users,
    children: [
      { view: 'fds2-customer-quotes', label: '報價方案', icon: FileText },
      { view: 'fds2-customer-search', label: '產品搜尋', icon: Search },
      { view: 'fds2-customer-custom', label: '傢俬訂製', icon: PenTool },
      { view: 'fds2-customer-pay', label: '付款+送貨', icon: Truck },
      { view: 'fds2-customer-orders', label: '訂單狀況', icon: PackageCheck },
      { view: 'fds2-customer-cases', label: '成功案例', icon: Film },
      { view: 'fds2-customer-services', label: '服務一覽', icon: Briefcase },
      { view: 'fds2-customer-company', label: '公司資料', icon: Building2 },
      { view: 'fds2-customer-contact', label: '聯絡我們', icon: Phone },
      { view: 'fds2-customer-org', label: '機構採購帳號', icon: Landmark },
    ],
  },
];

export function findSection(view: ViewType): PrimarySection {
  const primarySitemap = PRIMARY_SITEMAP_BY_LEGACY[view];
  const matchView = primarySitemap ?? view;
  for (const p of NAV_CONFIG) {
    if (p.children.some((c) => c.view === matchView)) return p.id;
  }
  // Removed 客戶專區 / 傢俬方案 pages — keep deep-links under customers / solutions
  if (
    view === 'customer-design-projects' ||
    view === 'customer-confirmed-products'
  ) {
    return 'customers';
  }
  if (
    view === 'design-projects' ||
    view === 'product-search' ||
    view === 'solution-project-list' ||
    view === 'invite-clients' ||
    view === 'solution-client-activity' ||
    view === 'solution-portal-content'
  ) {
    return 'quote';
  }
  if (view === 'factory-detail' || view === 'ai-processor') return 'factories';
  return 'home';
}

export function getSection(id: PrimarySection): PrimaryItem {
  return NAV_CONFIG.find((p) => p.id === id) ?? NAV_CONFIG[0];
}

/** Settings views restricted to 系統管理員. */
export const ADMIN_ONLY_VIEWS: ViewType[] = [
  'user-management',
  'login-history',
  'settings',
  'upload-product-log',
  'fds2-admin-users',
  'fds2-admin-logins',
  'fds2-admin-settings',
  'fds2-admin-prd',
  'fds2-admin-command-logs',
  'fds2-admin-usage',
  'fds2-admin-dev-cost',
  'fds2-admin-email',
  'fds2-report-upload-log',
];

/**
 * FDS 2.0 items that already exist. Opening them loads the original page
 * (same view, same URL) instead of the「待開發」shell.
 * `primary` is the menu item that stays highlighted for that original page.
 */
const MOVED_PAGES: { sitemap: ViewType; legacy: ViewType; primary?: boolean }[] = [
  { sitemap: 'fds2-quote-quick', legacy: 'quick-quote', primary: true },
  { sitemap: 'fds2-quote-list', legacy: 'quotation-list', primary: true },
  { sitemap: 'fds2-quote-large', legacy: 'quotation-large-amount', primary: true },
  { sitemap: 'fds2-products-factories', legacy: 'manufacturer-catalog', primary: true },
  { sitemap: 'fds2-products-pending', legacy: 'listed-products', primary: true },
  { sitemap: 'fds2-products-catalog', legacy: 'product-catalog', primary: true },
  { sitemap: 'fds2-publish-copy', legacy: 'publish-copywriting', primary: true },
  { sitemap: 'fds2-publish-price', legacy: 'publish-product-info', primary: true },
  { sitemap: 'fds2-publish-check', legacy: 'furniture-group-check', primary: true },
  { sitemap: 'fds2-publish-ready', legacy: 'ready-to-publish', primary: true },
  { sitemap: 'fds2-publish-done', legacy: 'published-products', primary: true },
  { sitemap: 'fds2-publish-abnormal', legacy: 'abnormal-price-products', primary: true },
  { sitemap: 'fds2-report-factory', legacy: 'report-factory', primary: true },
  { sitemap: 'fds2-report-product', legacy: 'report-product', primary: true },
  { sitemap: 'fds2-report-upload-log', legacy: 'upload-product-log', primary: true },
  { sitemap: 'fds2-admin-users', legacy: 'user-management', primary: true },
  { sitemap: 'fds2-admin-logins', legacy: 'login-history', primary: true },
  { sitemap: 'fds2-admin-shopify', legacy: 'category-management', primary: true },
  { sitemap: 'fds2-admin-categories', legacy: 'category-registry', primary: true },
  { sitemap: 'fds2-admin-settings', legacy: 'settings', primary: true },
  { sitemap: 'fds2-customer-quotes', legacy: 'customer-quote-schemes', primary: true },
  { sitemap: 'fds2-customer-search', legacy: 'customer-product-search', primary: true },
  { sitemap: 'fds2-customer-custom', legacy: 'customer-custom-furniture', primary: true },
  { sitemap: 'fds2-customer-pay', legacy: 'customer-payment-delivery', primary: true },
  { sitemap: 'fds2-customer-orders', legacy: 'customer-order-status', primary: true },
  { sitemap: 'fds2-customer-cases', legacy: 'customer-case-studies', primary: true },
  { sitemap: 'fds2-customer-services', legacy: 'customer-services', primary: true },
  { sitemap: 'fds2-customer-company', legacy: 'customer-company-info', primary: true },
  { sitemap: 'fds2-customer-contact', legacy: 'customer-contact', primary: true },
  { sitemap: 'fds2-customer-org', legacy: 'customer-org-account', primary: true },
];

const LEGACY_BY_SITEMAP: Partial<Record<ViewType, ViewType>> = {};
const PRIMARY_SITEMAP_BY_LEGACY: Partial<Record<ViewType, ViewType>> = {};
for (const row of MOVED_PAGES) {
  LEGACY_BY_SITEMAP[row.sitemap] = row.legacy;
  if (!PRIMARY_SITEMAP_BY_LEGACY[row.legacy] || row.primary) {
    PRIMARY_SITEMAP_BY_LEGACY[row.legacy] = row.sitemap;
  }
}

/** Original page for a moved sitemap item, if one already exists. */
export function implementedPage(view: ViewType): ViewType | null {
  return LEGACY_BY_SITEMAP[view] ?? null;
}

export function isImplementedLegacyView(view: ViewType): boolean {
  return PRIMARY_SITEMAP_BY_LEGACY[view] != null;
}

/**
 * 設計方案工作區（平面圖與房間、配置傢俬、邀請客戶）。
 * 不出現在側欄；PM 與其他內部同事仍可開這些頁。
 */
const SOLUTION_PAGES_IN_QUOTE: readonly ViewType[] = [
  'solution-project-list',
  'design-projects',
  'invite-clients',
  'product-search',
  'solution-client-activity',
  'solution-portal-content',
];

export function isSolutionPageInQuote(view: ViewType): boolean {
  return SOLUTION_PAGES_IN_QUOTE.includes(view);
}

export function isPmBlockedQuoteView(view: ViewType): boolean {
  return view === 'fds2-quote-format';
}

export function navItemIsActive(itemView: ViewType, currentView: ViewType): boolean {
  if (itemView === currentView) return true;
  const legacy = implementedPage(itemView);
  return legacy !== null && legacy === currentView;
}

export function isSitemapPlaceholderView(view: ViewType): boolean {
  return view.startsWith('fds2-') && LEGACY_BY_SITEMAP[view] == null;
}

export function isAdminOnlyView(view: ViewType): boolean {
  return ADMIN_ONLY_VIEWS.includes(view);
}

export function filterNavChildren(
  children: SecondaryItem[],
  isAdmin: boolean,
  opts?: {
    /**
     * Quote-share / invite no-login guest:
     * show full 客戶專區 menu except「機構採購帳號」.
     */
    quoteShareGuest?: boolean;
    /** @deprecated use quoteShareGuest — previously locked to 報價方案 only */
    quoteShareOnly?: boolean;
    /** PM 的傢俬報價只隱藏報價單格式設定。 */
    pm?: boolean;
  },
): SecondaryItem[] {
  let list = isAdmin ? children : children.filter((c) => !c.adminOnly);
  if (opts?.quoteShareOnly) {
    list = list.filter((c) => c.view === 'customer-quote-schemes');
  } else if (opts?.quoteShareGuest) {
    list = list.filter((c) => c.view !== 'customer-org-account' && c.view !== 'fds2-customer-org');
  }
  list = list.filter((child) => !child.pinned);
  if (opts?.pm) {
    list = list.filter((c) => !isPmBlockedQuoteView(c.view));
  }
  return list;
}

export function getFirstVisibleView(
  sectionId: PrimarySection,
  isAdmin: boolean,
  opts?: {
    quoteShareGuest?: boolean;
    quoteShareOnly?: boolean;
    pm?: boolean;
  },
): ViewType | undefined {
  const first = filterNavChildren(getSection(sectionId).children, isAdmin, opts)[0]?.view;
  if (first) return first;
  if (opts?.pm && sectionId === 'quote') return 'design-projects';
  return undefined;
}

export function getViewMeta(view: ViewType): { sectionLabel: string; viewLabel: string } {
  const primarySitemap = PRIMARY_SITEMAP_BY_LEGACY[view];
  const matchView = primarySitemap ?? view;
  for (const p of NAV_CONFIG) {
    const child = p.children.find((c) => c.view === matchView);
    if (child) return { sectionLabel: p.label, viewLabel: child.label };
  }
  if (
    view === 'customer-design-projects' ||
    view === 'customer-confirmed-products'
  ) {
    return { sectionLabel: '客戶專區', viewLabel: '報價方案' };
  }
  if (view === 'design-projects' || view === 'product-search') {
    return { sectionLabel: '傢俬報價', viewLabel: '配置傢俬' };
  }
  if (
    view === 'solution-project-list' ||
    view === 'solution-client-activity' ||
    view === 'solution-portal-content'
  ) {
    return { sectionLabel: '傢俬報價', viewLabel: '平面圖與房間' };
  }
  if (view === 'invite-clients') {
    return { sectionLabel: '傢俬報價', viewLabel: '邀請客戶' };
  }
  if (view === 'ai-processor') {
    return { sectionLabel: '廠家目錄', viewLabel: '上載報價 PDF' };
  }
  return { sectionLabel: '', viewLabel: view };
}
