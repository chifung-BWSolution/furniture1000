// ============================================================================
// Mock data + shared config for 網上發佈 / 分析報表 / 設定 pages.
// These pages are dashboards/admin surfaces with no dedicated Supabase tables,
// so they render from this static data. Replace with real queries later.
// ============================================================================

// Brand palette for recharts (primary purple + supporting hues)
export const CHART_COLORS = {
  primary: '#6B46C1',
  primarySoft: '#A78BFA',
  sky: '#0EA5E9',
  emerald: '#10B981',
  amber: '#F59E0B',
  rose: '#F43F5E',
  slate: '#64748B',
};
export const PIE_COLORS = ['#6B46C1', '#A78BFA', '#0EA5E9', '#10B981', '#F59E0B', '#F43F5E', '#64748B'];

export const TIME_RANGES = [
  { key: 'month', label: '本月' },
  { key: 'quarter', label: '本季' },
  { key: 'year', label: '本年' },
] as const;
export type TimeRangeKey = (typeof TIME_RANGES)[number]['key'];

// ----------------------------------------------------------------------------
// 網上發佈 — 產品文案 (copywriting)
// ----------------------------------------------------------------------------
export interface CopyProduct {
  id: string;
  title: string;
  imageUrl: string;
  description: string;
  material: string;
  workmanship: string;
  lifestyleImageUrl: string | null;
  tier: 'A' | 'B' | 'C';
  copyStatus: 'optimized' | 'draft' | 'needs_work';
}

const IMG = (s: string) => `https://images.unsplash.com/photo-${s}?auto=format&fit=crop&w=400&q=70`;

export const MOCK_COPY_PRODUCTS: CopyProduct[] = [
  { id: 'c1', title: '行政辦公桌 1.8m', imageUrl: IMG('1524758631624-e2822e304c36'), description: '胡桃木飾面，內建走線槽與三抽櫃，適合主管辦公室使用。', material: '實木貼皮 + 鋼製桌腳', workmanship: 'CNC 精密開料、環保水性漆、封邊機收邊', lifestyleImageUrl: IMG('1497366216548-37526070297c'), tier: 'A', copyStatus: 'optimized' },
  { id: 'c2', title: '真皮行政座椅', imageUrl: IMG('1505843490538-5133c6c7d0e1'), description: '高背人體工學設計，頭層牛皮，鋁合金五星腳。', material: '頭層牛皮 + 鋁合金', workmanship: '手工縫線、加厚海綿、防爆氣壓棒', lifestyleImageUrl: null, tier: 'A', copyStatus: 'draft' },
  { id: 'c3', title: '會議長桌 3.2m', imageUrl: IMG('1497366216548-37526070297c'), description: '可坐 10-12 人，內嵌電源與網路接口，現代簡約風格。', material: '密底板 + 三聚氰胺飾面', workmanship: '一體成型、隱藏式線盒', lifestyleImageUrl: IMG('1524758631624-e2822e304c36'), tier: 'A', copyStatus: 'needs_work' },
  { id: 'c4', title: '會議椅（網布）', imageUrl: IMG('1580480055273-228ff5388ef8'), description: '透氣網布椅背，可調節扶手，適合長時間會議。', material: '高彈網布 + 尼龍底座', workmanship: '一體注塑、可拆洗椅套', lifestyleImageUrl: null, tier: 'B', copyStatus: 'draft' },
  { id: 'c5', title: '開放式工作站', imageUrl: IMG('1497215728101-856f4ea42174'), description: '模組化設計，可拼接成 2/4/6 人組合，附隔音屏風。', material: '三聚氰胺板 + 吸音棉屏風', workmanship: '模組拼接、可現場組裝', lifestyleImageUrl: null, tier: 'B', copyStatus: 'optimized' },
];

// ----------------------------------------------------------------------------
// 網上發佈 — 發佈前檢查 (pre-check)
// ----------------------------------------------------------------------------
export interface CheckItem {
  id: string;
  product: string;
  imageResolution: boolean;
  requiredFields: boolean;
  pricingFormula: boolean;
  tierTag: boolean;
}
export const MOCK_CHECK_ITEMS: CheckItem[] = [
  { id: 'k1', product: '行政辦公桌 1.8m', imageResolution: true, requiredFields: true, pricingFormula: true, tierTag: true },
  { id: 'k2', product: '真皮行政座椅', imageResolution: true, requiredFields: false, pricingFormula: true, tierTag: true },
  { id: 'k3', product: '會議長桌 3.2m', imageResolution: false, requiredFields: true, pricingFormula: false, tierTag: true },
  { id: 'k4', product: '會議椅（網布）', imageResolution: true, requiredFields: true, pricingFormula: true, tierTag: false },
  { id: 'k5', product: '開放式工作站', imageResolution: true, requiredFields: true, pricingFormula: true, tierTag: true },
];
export const CHECK_LABELS: Record<keyof Omit<CheckItem, 'id' | 'product'>, string> = {
  imageResolution: '圖片解析度',
  requiredFields: '必填欄位完整',
  pricingFormula: '定價公式正確',
  tierTag: 'A/B/C 分類標記',
};

// ----------------------------------------------------------------------------
// 網上發佈 — 已上載產品 (published)
// ----------------------------------------------------------------------------
export type PublishState = 'published' | 'unpublished' | 'delisted';
export interface PublishedProduct {
  id: string;
  title: string;
  imageUrl: string;
  factory: string;
  state: PublishState;
  publishedAt: string;
  views: number;
  lastEditor: string;
}
export const MOCK_PUBLISHED: PublishedProduct[] = [
  { id: 'pp1', title: '行政辦公桌 1.8m', imageUrl: IMG('1524758631624-e2822e304c36'), factory: '華座 HUAZUO', state: 'published', publishedAt: '2026-05-20T09:00:00Z', views: 1240, lastEditor: 'CF' },
  { id: 'pp2', title: '真皮行政座椅', imageUrl: IMG('1505843490538-5133c6c7d0e1'), factory: '華座 HUAZUO', state: 'published', publishedAt: '2026-05-18T09:00:00Z', views: 980, lastEditor: 'Amy' },
  { id: 'pp3', title: '會議長桌 3.2m', imageUrl: IMG('1497366216548-37526070297c'), factory: '華座 HUAZUO', state: 'unpublished', publishedAt: '2026-05-10T09:00:00Z', views: 320, lastEditor: 'CF' },
  { id: 'pp4', title: '會議椅（網布）', imageUrl: IMG('1580480055273-228ff5388ef8'), factory: '永豐 WINGFUNG', state: 'delisted', publishedAt: '2026-04-28T09:00:00Z', views: 540, lastEditor: 'Ken' },
  { id: 'pp5', title: '開放式工作站', imageUrl: IMG('1497215728101-856f4ea42174'), factory: '永豐 WINGFUNG', state: 'published', publishedAt: '2026-05-22T09:00:00Z', views: 2100, lastEditor: 'Amy' },
];
export const PUBLISH_STATE_META: Record<PublishState, { label: string; className: string }> = {
  published: { label: '已發佈', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  unpublished: { label: '未發佈', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  delisted: { label: '已下架', className: 'bg-rose-500/15 text-rose-600 border-rose-500/30' },
};

// ----------------------------------------------------------------------------
// 分析報表 — 廠家報告 (factory report)
// ----------------------------------------------------------------------------
export interface FactoryStat {
  id: string;
  name: string;
  orders: number;
  quoteWinRate: number; // %
  avgLeadDays: number;
  returnRate: number; // %
}
export const MOCK_FACTORY_STATS: FactoryStat[] = [
  { id: 'f1', name: '華座 HUAZUO', orders: 482, quoteWinRate: 68, avgLeadDays: 18, returnRate: 1.2 },
  { id: 'f2', name: '永豐 WINGFUNG', orders: 356, quoteWinRate: 61, avgLeadDays: 22, returnRate: 2.1 },
  { id: 'f3', name: '宏發 WANGFAT', orders: 298, quoteWinRate: 57, avgLeadDays: 25, returnRate: 1.8 },
  { id: 'f4', name: '金日 KAMYAT', orders: 210, quoteWinRate: 49, avgLeadDays: 30, returnRate: 3.0 },
  { id: 'f5', name: '美亞 MEIAH', orders: 175, quoteWinRate: 44, avgLeadDays: 28, returnRate: 2.6 },
];
export const MOCK_FACTORY_TREND = [
  { month: '1月', 華座: 38, 永豐: 28, 宏發: 22 },
  { month: '2月', 華座: 42, 永豐: 31, 宏發: 24 },
  { month: '3月', 華座: 45, 永豐: 33, 宏發: 26 },
  { month: '4月', 華座: 40, 永豐: 30, 宏發: 28 },
  { month: '5月', 華座: 48, 永豐: 35, 宏發: 25 },
  { month: '6月', 華座: 52, 永豐: 38, 宏發: 30 },
];

// ----------------------------------------------------------------------------
// 分析報表 — 產品報告 (product report)
// ----------------------------------------------------------------------------
export interface ProductStat {
  id: string;
  title: string;
  imageUrl: string;
  tier: 'A' | 'B' | 'C';
  quotes: number;
  favorites: number;
  usage: number;
  conversion: number; // %
  searchWeight: number; // 0-100
}
export const MOCK_PRODUCT_STATS: ProductStat[] = [
  { id: 'q1', title: '行政辦公桌 1.8m', imageUrl: IMG('1524758631624-e2822e304c36'), tier: 'A', quotes: 320, favorites: 145, usage: 89, conversion: 42, searchWeight: 90 },
  { id: 'q2', title: '會議長桌 3.2m', imageUrl: IMG('1497366216548-37526070297c'), tier: 'A', quotes: 280, favorites: 120, usage: 76, conversion: 38, searchWeight: 85 },
  { id: 'q3', title: '真皮行政座椅', imageUrl: IMG('1505843490538-5133c6c7d0e1'), tier: 'A', quotes: 245, favorites: 98, usage: 64, conversion: 35, searchWeight: 80 },
  { id: 'q4', title: '開放式工作站', imageUrl: IMG('1497215728101-856f4ea42174'), tier: 'B', quotes: 180, favorites: 64, usage: 52, conversion: 28, searchWeight: 55 },
  { id: 'q5', title: '會議椅（網布）', imageUrl: IMG('1580480055273-228ff5388ef8'), tier: 'B', quotes: 150, favorites: 40, usage: 38, conversion: 22, searchWeight: 45 },
  { id: 'q6', title: '休閒沙發（雙人）', imageUrl: IMG('1567538096630-e0c55bd6374c'), tier: 'C', quotes: 90, favorites: 25, usage: 20, conversion: 15, searchWeight: 30 },
];
export const MOCK_PRODUCT_TREND = [
  { week: 'W1', 報價: 120, 收藏: 45 },
  { week: 'W2', 報價: 145, 收藏: 52 },
  { week: 'W3', 報價: 138, 收藏: 60 },
  { week: 'W4', 報價: 170, 收藏: 72 },
  { week: 'W5', 報價: 165, 收藏: 68 },
  { week: 'W6', 報價: 195, 收藏: 85 },
];

// ----------------------------------------------------------------------------
// 分析報表 — 銷售報告 (sales report)
// ----------------------------------------------------------------------------
export const MOCK_SALES_KPIS = [
  { label: '報價成功率', value: '62%', delta: '+5%', positive: true },
  { label: '平均報價金額', value: '$48,200', delta: '+8%', positive: true },
  { label: '本月成交額', value: '$1.86M', delta: '+12%', positive: true },
  { label: '目標達成率', value: '83%', delta: '-4%', positive: false },
];
export const MOCK_SALES_TREND = [
  { month: '1月', 報價額: 1200000, 成交額: 720000 },
  { month: '2月', 報價額: 1350000, 成交額: 810000 },
  { month: '3月', 報價額: 1480000, 成交額: 920000 },
  { month: '4月', 報價額: 1390000, 成交額: 880000 },
  { month: '5月', 報價額: 1620000, 成交額: 1050000 },
  { month: '6月', 報價額: 1860000, 成交額: 1180000 },
];
export const MOCK_CATEGORY_SHARE = [
  { name: '辦公桌', value: 32 },
  { name: '座椅', value: 26 },
  { name: '會議桌', value: 18 },
  { name: '工作站', value: 12 },
  { name: '沙發', value: 7 },
  { name: '其他', value: 5 },
];

// ----------------------------------------------------------------------------
// 設定 — 用戶管理 (user management)
// ----------------------------------------------------------------------------
export type UserRole = 'admin' | 'uploader' | 'pm' | 'designer' | 'client';
export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastLogin: string;
}
export const ROLE_META: Record<UserRole, { label: string; className: string }> = {
  admin: { label: '系統管理員', className: 'bg-primary/15 text-primary border-primary/30' },
  uploader: { label: '上載同事', className: 'bg-sky-500/15 text-sky-600 border-sky-500/30' },
  pm: { label: '項目經理', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  designer: { label: '設計師', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  client: { label: '客戶', className: 'bg-slate-500/15 text-slate-600 border-slate-500/30' },
};
export const MOCK_USERS: PlatformUser[] = [
  { id: 'u1', name: '陳志峰 CF', email: 'cf@bwsolution.com', role: 'admin', active: true, lastLogin: '2026-06-03T08:30:00Z' },
  { id: 'u2', name: 'Amy Wong', email: 'amy@bwsolution.com', role: 'pm', active: true, lastLogin: '2026-06-02T17:10:00Z' },
  { id: 'u3', name: 'Ken Lau', email: 'ken@bwsolution.com', role: 'uploader', active: true, lastLogin: '2026-06-03T09:05:00Z' },
  { id: 'u4', name: 'Siu Ming', email: 'ming@bwsolution.com', role: 'designer', active: false, lastLogin: '2026-05-20T14:00:00Z' },
  { id: 'u5', name: '匯豐 陳大文', email: 'chan@hsbc.com', role: 'client', active: true, lastLogin: '2026-06-01T16:30:00Z' },
];
// permission matrix: role × capability
export const PERMISSIONS = ['查看產品', '編輯產品', '上架發佈', '管理報價', '查看成本', '管理用戶'];
export const ROLE_PERMISSIONS: Record<UserRole, boolean[]> = {
  admin: [true, true, true, true, true, true],
  uploader: [true, true, true, false, true, false],
  pm: [true, true, false, true, true, false],
  designer: [true, true, false, false, false, false],
  client: [true, false, false, false, false, false],
};

// ----------------------------------------------------------------------------
// 設定 — 登入紀錄 (login history)
// ----------------------------------------------------------------------------
export type LogType = 'login' | 'logout' | 'failed' | 'edit' | 'publish';
export interface LoginLog {
  id: string;
  user: string;
  type: LogType;
  ip: string;
  location: string;
  at: string;
  suspicious: boolean;
}
export const LOG_TYPE_META: Record<LogType, { label: string; className: string }> = {
  login: { label: '登入', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  logout: { label: '登出', className: 'bg-slate-500/15 text-slate-600 border-slate-500/30' },
  failed: { label: '登入失敗', className: 'bg-rose-500/15 text-rose-600 border-rose-500/30' },
  edit: { label: '編輯', className: 'bg-sky-500/15 text-sky-600 border-sky-500/30' },
  publish: { label: '發佈', className: 'bg-primary/15 text-primary border-primary/30' },
};
export const MOCK_LOGS: LoginLog[] = [
  { id: 'l1', user: '陳志峰 CF', type: 'login', ip: '203.198.12.4', location: '香港', at: '2026-06-03T08:30:00Z', suspicious: false },
  { id: 'l2', user: 'Ken Lau', type: 'publish', ip: '203.198.12.9', location: '香港', at: '2026-06-03T09:20:00Z', suspicious: false },
  { id: 'l3', user: 'Amy Wong', type: 'failed', ip: '45.62.118.7', location: '美國洛杉磯', at: '2026-06-03T03:14:00Z', suspicious: true },
  { id: 'l4', user: 'Amy Wong', type: 'failed', ip: '45.62.118.7', location: '美國洛杉磯', at: '2026-06-03T03:15:00Z', suspicious: true },
  { id: 'l5', user: 'Siu Ming', type: 'login', ip: '116.48.x.x', location: '香港', at: '2026-06-02T14:02:00Z', suspicious: false },
  { id: 'l6', user: 'Ken Lau', type: 'edit', ip: '203.198.12.9', location: '香港', at: '2026-06-02T11:40:00Z', suspicious: false },
  { id: 'l7', user: '陳志峰 CF', type: 'logout', ip: '203.198.12.4', location: '香港', at: '2026-06-02T18:50:00Z', suspicious: false },
];
export const MOCK_SECURITY_TREND = [
  { day: '5/28', 成功: 42, 失敗: 2 },
  { day: '5/29', 成功: 38, 失敗: 1 },
  { day: '5/30', 成功: 45, 失敗: 0 },
  { day: '5/31', 成功: 40, 失敗: 3 },
  { day: '6/1', 成功: 50, 失敗: 1 },
  { day: '6/2', 成功: 48, 失敗: 2 },
  { day: '6/3', 成功: 52, 失敗: 4 },
];
