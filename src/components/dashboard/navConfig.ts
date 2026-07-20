import {
  Layers, Users, Calculator, Package, Globe, BarChart3, Settings as SettingsIcon,
  LayoutDashboard, Search, UserPlus, CheckCircle2,
  Building2, Zap, ClipboardList,
  FileUp, FolderTree, BookOpen, Boxes,
  FileText, UploadCloud, CheckCheck, Sofa,
  Building, BarChart2, TrendingUp,
  UserCog, History,
  Map, PenTool, Truck, PackageCheck,
  Film, Briefcase, Phone, Landmark,
  type LucideIcon,
} from 'lucide-react';
import { type PrimarySection, type ViewType } from '@/types/product';

export interface SecondaryItem {
  view: ViewType;
  label: string;
  icon: LucideIcon;
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
    label: '儀表板',
    icon: LayoutDashboard,
    children: [
      { view: 'dashboard', label: '儀表板', icon: LayoutDashboard },
    ],
  },
  {
    id: 'solutions',
    label: '傢俬方案',
    icon: Layers,
    children: [
      { view: 'solution-project-list', label: '方案列表', icon: Map },
      { view: 'design-projects', label: '設計專案', icon: LayoutDashboard },
      { view: 'invite-clients', label: '邀請客戶', icon: UserPlus },
      { view: 'confirmed-projects', label: '已確定方案', icon: CheckCircle2 },
    ],
  },
  {
    id: 'customers',
    label: '客戶專區',
    icon: Users,
    children: [
      { view: 'customer-quote-schemes', label: '報價方案', icon: FileText },
      { view: 'customer-product-search', label: '產品搜尋', icon: Search },
      { view: 'customer-custom-furniture', label: '傢俬訂製', icon: PenTool },
      { view: 'customer-payment-delivery', label: '付款+送貨', icon: Truck },
      { view: 'customer-order-status', label: '訂單狀況', icon: PackageCheck },
      { view: 'customer-case-studies', label: '成功案例', icon: Film },
      { view: 'customer-services', label: '服務一覽', icon: Briefcase },
      { view: 'customer-company-info', label: '公司資料', icon: Building2 },
      { view: 'customer-contact', label: '聯絡我們', icon: Phone },
      { view: 'customer-org-account', label: '機構採購帳號', icon: Landmark },
    ],
  },
  {
    id: 'quote',
    label: '傢俬報價',
    icon: Calculator,
    children: [
      { view: 'quick-quote', label: '快速報價', icon: Zap },
      { view: 'quotation-list', label: '報價一覽', icon: ClipboardList },
    ],
  },
  {
    id: 'products',
    label: '產品管理',
    icon: Package,
    children: [
      { view: 'manufacturer-catalog', label: '廠家目錄', icon: BookOpen },
      { view: 'ai-processor', label: '上載PDF', icon: FileUp },
      { view: 'listed-products', label: '待處理產品', icon: Boxes },
      { view: 'product-catalog', label: '產品目錄', icon: BookOpen },
    ],
  },
  {
    id: 'publish',
    label: '網上發佈',
    icon: Globe,
    children: [
      { view: 'publish-copywriting', label: '產品文案', icon: FileText },
      { view: 'publish-product-info', label: '產品價錢', icon: Boxes },
      { view: 'furniture-group-check', label: '傢俬組檢查', icon: Sofa },
      { view: 'ready-to-publish', label: '準備上載', icon: UploadCloud },
      { view: 'published-products', label: '已上載產品', icon: CheckCheck },
    ],
  },
  {
    id: 'reports',
    label: '分析報表',
    icon: BarChart3,
    children: [
      { view: 'report-factory', label: '廠家報告', icon: Building },
      { view: 'report-product', label: '產品報告', icon: BarChart2 },
      { view: 'report-sales', label: '銷售報告', icon: TrendingUp },
    ],
  },
  {
    id: 'admin',
    label: '設定',
    icon: SettingsIcon,
    children: [
      { view: 'user-management', label: '用戶管理', icon: UserCog },
      { view: 'login-history', label: '登入紀錄', icon: History },
      { view: 'category-management', label: 'Shopify 分類', icon: FolderTree },
      { view: 'category-registry', label: '產品分類', icon: FolderTree },
      { view: 'settings', label: '系統設定', icon: SettingsIcon },
      { view: 'upload-product-log', label: '上載產品紀錄', icon: ClipboardList },
    ],
  },
];

export function findSection(view: ViewType): PrimarySection {
  for (const p of NAV_CONFIG) {
    if (p.children.some((c) => c.view === view)) return p.id;
  }
  if (
    view === 'customer-design-projects' ||
    view === 'customer-confirmed-products'
  ) {
    return 'customers';
  }
  // Removed 傢俬方案 pages — keep deep-links under solutions
  if (
    view === 'solution-client-activity' ||
    view === 'solution-portal-content' ||
    view === 'product-search'
  ) {
    return 'solutions';
  }
  return 'home';
}

export function getSection(id: PrimarySection): PrimaryItem {
  return NAV_CONFIG.find((p) => p.id === id) ?? NAV_CONFIG[0];
}

export function getViewMeta(view: ViewType): { sectionLabel: string; viewLabel: string } {
  for (const p of NAV_CONFIG) {
    const child = p.children.find((c) => c.view === view);
    if (child) return { sectionLabel: p.label, viewLabel: child.label };
  }
  if (view === 'customer-design-projects') {
    return { sectionLabel: '客戶專區', viewLabel: '設計專案' };
  }
  if (view === 'customer-confirmed-products') {
    return { sectionLabel: '客戶專區', viewLabel: '確定產品' };
  }
  if (
    view === 'solution-client-activity' ||
    view === 'solution-portal-content' ||
    view === 'product-search'
  ) {
    return { sectionLabel: '傢俬方案', viewLabel: '方案列表' };
  }
  return { sectionLabel: '', viewLabel: view };
}
