// ============================================================================
// Mock data for 傢俬方案 / 客戶專區 pages.
// Used as a graceful fallback until the Supabase tables are populated.
// ============================================================================
import type {
  DesignProject,
  ProjectZone,
  ZoneProduct,
  ProjectInvitation,
  ClientCompany,
  ProductDiscussion,
  SearchProduct,
} from '@/types/solutions';

const IMG = (seed: string) =>
  `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=400&q=70`;

export const MOCK_PROJECTS: DesignProject[] = [
  {
    id: 'p1',
    name: '匯豐中環辦公室翻新',
    clientName: '陳大文',
    clientCompany: '匯豐銀行',
    floorPlanUrl: null,
    floorPlanType: null,
    status: 'in_progress',
    activeScheme: 'A',
    progress: 62,
    createdBy: 'CF',
    createdAt: '2026-05-12T09:00:00Z',
    updatedAt: '2026-06-01T14:20:00Z',
  },
  {
    id: 'p2',
    name: '科技園共享辦公空間',
    clientName: '李小芳',
    clientCompany: 'StartHub',
    floorPlanUrl: null,
    floorPlanType: null,
    status: 'confirmed',
    activeScheme: 'B',
    progress: 100,
    createdBy: 'CF',
    createdAt: '2026-04-20T09:00:00Z',
    updatedAt: '2026-05-28T10:00:00Z',
  },
  {
    id: 'p3',
    name: '尖沙咀精品酒店大堂',
    clientName: '黃經理',
    clientCompany: '半島集團',
    floorPlanUrl: null,
    floorPlanType: null,
    status: 'draft',
    activeScheme: 'A',
    progress: 15,
    createdBy: 'CF',
    createdAt: '2026-05-30T09:00:00Z',
    updatedAt: '2026-06-02T08:00:00Z',
  },
];

export const MOCK_ZONES: ProjectZone[] = [
  { id: 'z1', projectId: 'p1', code: 'B1', name: '老闆區', bounds: { x: 6, y: 8, w: 34, h: 40 }, aiSuggested: true, sortOrder: 0 },
  { id: 'z2', projectId: 'p1', code: 'M1', name: '會議室', bounds: { x: 46, y: 8, w: 30, h: 32 }, aiSuggested: true, sortOrder: 1 },
  { id: 'z3', projectId: 'p1', code: 'O1', name: '開放辦公區', bounds: { x: 6, y: 54, w: 70, h: 38 }, aiSuggested: true, sortOrder: 2 },
];

export const MOCK_ZONE_PRODUCTS: ZoneProduct[] = [
  { id: 'zp1', projectId: 'p1', zoneId: 'z1', productId: 'r54', productTitle: '行政辦公桌 1.8m', productImageUrl: IMG('1524758631624-e2822e304c36'), salePrice: 4800, scheme: 'A', status: 'confirmed', quantity: 1, sortOrder: 0 },
  { id: 'zp2', projectId: 'p1', zoneId: 'z1', productId: 'r55', productTitle: '真皮行政座椅', productImageUrl: IMG('1505843490538-5133c6c7d0e1'), salePrice: 2600, scheme: 'A', status: 'discussing', quantity: 1, sortOrder: 1 },
  { id: 'zp3', projectId: 'p1', zoneId: 'z2', productId: 'r56', productTitle: '會議長桌 3.2m', productImageUrl: IMG('1497366216548-37526070297c'), salePrice: 8900, scheme: 'A', status: 'confirmed', quantity: 1, sortOrder: 0 },
  { id: 'zp4', projectId: 'p1', zoneId: 'z2', productId: 'r57', productTitle: '會議椅（網布）', productImageUrl: IMG('1580480055273-228ff5388ef8'), salePrice: 980, scheme: 'A', status: 'pending', quantity: 10, sortOrder: 1 },
  { id: 'zp5', projectId: 'p1', zoneId: 'z3', productId: 'r58', productTitle: '開放式工作站', productImageUrl: IMG('1497215728101-856f4ea42174'), salePrice: 3200, scheme: 'A', status: 'discussing', quantity: 12, sortOrder: 0 },
];

export const MOCK_DESIGN_BASKET: ZoneProduct[] = [
  { id: 'b1', projectId: 'p1', zoneId: null, productId: 'r60', productTitle: '矮櫃收納組', productImageUrl: IMG('1538688525198-9b88f6f53126'), salePrice: 1500, scheme: 'A', status: 'pending', quantity: 1, sortOrder: 0 },
  { id: 'b2', projectId: 'p1', zoneId: null, productId: 'r61', productTitle: '休閒沙發（雙人）', productImageUrl: IMG('1567538096630-e0c55bd6374c'), salePrice: 5400, scheme: 'A', status: 'pending', quantity: 1, sortOrder: 1 },
  { id: 'b3', projectId: 'p1', zoneId: null, productId: 'r62', productTitle: '茶几（實木）', productImageUrl: IMG('1532372320572-cda25653a26d'), salePrice: 1200, scheme: 'A', status: 'pending', quantity: 1, sortOrder: 2 },
];

export const MOCK_INVITATIONS: ProjectInvitation[] = [
  { id: 'i1', projectId: 'p1', channel: 'email', email: 'chan@hsbc.com', shareToken: 'tok_a1b2c3', status: 'viewed', viewedAt: '2026-05-29T11:00:00Z', createdAt: '2026-05-28T09:00:00Z' },
  { id: 'i2', projectId: 'p1', channel: 'email', email: 'project@hsbc.com', shareToken: 'tok_d4e5f6', status: 'sent', viewedAt: null, createdAt: '2026-05-30T09:00:00Z' },
  { id: 'i3', projectId: 'p1', channel: 'link', email: null, shareToken: 'tok_g7h8i9', status: 'viewed', viewedAt: '2026-06-01T16:30:00Z', createdAt: '2026-05-31T09:00:00Z' },
];

export const MOCK_CLIENT_COMPANY: ClientCompany = {
  id: 'c1',
  name: '匯豐銀行（香港）',
  contactPerson: '陳大文',
  contactEmail: 'chan@hsbc.com',
  contactPhone: '+852 2822 1111',
  address: '香港中環皇后大道中 1 號',
  pendingChanges: {},
  createdAt: '2026-01-10T09:00:00Z',
  updatedAt: '2026-05-20T09:00:00Z',
};

export const MOCK_DISCUSSIONS: ProductDiscussion[] = [
  { id: 'd1', projectId: 'p1', zoneProductId: 'zp2', author: '陳大文', authorRole: 'client', body: '座椅顏色可否換成深啡色？ @設計師', mentions: ['設計師'], createdAt: '2026-05-30T10:00:00Z' },
  { id: 'd2', projectId: 'p1', zoneProductId: 'zp2', author: 'Amy（設計師）', authorRole: 'designer', body: '可以的，我們提供深啡色真皮選項，已加入方案 B 供比較。', mentions: [], createdAt: '2026-05-30T10:30:00Z' },
];

export const MOCK_SEARCH_PRODUCTS: SearchProduct[] = [
  { id: 's1', title: '行政辦公桌 1.8m', description: '胡桃木飾面，內建走線槽與三抽櫃，適合主管辦公室使用。', imageUrl: IMG('1524758631624-e2822e304c36'), salePrice: 4800, category: '辦公桌', color: '胡桃啡', material: '實木貼皮', tier: 'A', inStock: true, deliveryDays: 14 },
  { id: 's2', title: '真皮行政座椅', description: '高背人體工學設計，頭層牛皮，鋁合金五星腳。', imageUrl: IMG('1505843490538-5133c6c7d0e1'), salePrice: 2600, category: '座椅', color: '黑色', material: '真皮', tier: 'A', inStock: true, deliveryDays: 10 },
  { id: 's3', title: '會議長桌 3.2m', description: '可坐 10-12 人，內嵌電源與網路接口，現代簡約風格。', imageUrl: IMG('1497366216548-37526070297c'), salePrice: 8900, category: '會議桌', color: '白色', material: '密底板', tier: 'A', inStock: false, deliveryDays: 30 },
  { id: 's4', title: '會議椅（網布）', description: '透氣網布椅背，可調節扶手，適合長時間會議。', imageUrl: IMG('1580480055273-228ff5388ef8'), salePrice: 980, category: '座椅', color: '灰色', material: '網布', tier: 'B', inStock: true, deliveryDays: 7 },
  { id: 's5', title: '開放式工作站', description: '模組化設計，可拼接成 2/4/6 人組合，附隔音屏風。', imageUrl: IMG('1497215728101-856f4ea42174'), salePrice: 3200, category: '工作站', color: '原木色', material: '三聚氰胺板', tier: 'B', inStock: true, deliveryDays: 21 },
  { id: 's6', title: '休閒沙發（雙人）', description: '布藝雙人沙發，適合接待區與休息區，多色可選。', imageUrl: IMG('1567538096630-e0c55bd6374c'), salePrice: 5400, category: '沙發', color: '米白', material: '布藝', tier: 'C', inStock: true, deliveryDays: 25 },
  { id: 's7', title: '矮櫃收納組', description: '雙門矮櫃配開放層架，可作隔斷與收納兩用。', imageUrl: IMG('1538688525198-9b88f6f53126'), salePrice: 1500, category: '收納櫃', color: '白橡', material: '密底板', tier: 'C', inStock: true, deliveryDays: 14 },
  { id: 's8', title: '茶几（實木）', description: '北歐風實木茶几，圓角設計，適合洽談與休息區。', imageUrl: IMG('1532372320572-cda25653a26d'), salePrice: 1200, category: '茶几', color: '原木色', material: '實木', tier: 'C', inStock: true, deliveryDays: 18 },
];

export const PRODUCT_CATEGORIES = ['全部', '辦公桌', '座椅', '會議桌', '工作站', '沙發', '收納櫃', '茶几'];
