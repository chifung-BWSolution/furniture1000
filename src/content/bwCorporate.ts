import {
  DEFAULT_COMPANY_ADDRESS,
  DEFAULT_COMPANY_WEBSITE,
} from '@/lib/quotationLocale';
import { DEFAULT_QUOTE_COMPANY } from '@/lib/pmsQuotePrefill';

export const BW_COMPANY = {
  legalName: DEFAULT_QUOTE_COMPANY,
  brandName: 'BW Furniture',
  intro:
    'BW Furniture 專注商業空間的整體傢俬方案，從需求分析、空間規劃、產品選配與訂製，到送貨安裝及項目協調，為企業、學校、政府及非牟利機構提供一站式服務。',
  mission:
    '以專屬連結取代傳統單向報價單，讓客戶在同一網站查看版本、產品、售價、公司實力及服務進度，提升信任、互動與決策效率。',
  address: DEFAULT_COMPANY_ADDRESS.zh,
  website: DEFAULT_COMPANY_WEBSITE,
  email: 'sales@brandingworks-furniture.com',
  phone: '(+852) 2127 4839',
  phoneTel: '+85221274839',
  whatsapp: '(+852) 9717 3545',
  whatsappUrl: 'https://wa.me/85297173545',
  youtube: 'https://www.youtube.com/@brandingworks',
} as const;

export const BW_CONTACT_HIGHLIGHTS = [
  {
    title: '實力工廠',
    lines: ['16+年經驗、1000+產品', '專員一對一服務'],
  },
  {
    title: '極速交期',
    lines: ['現貨 3-7 天送裝', '廠方訂造 14–28 天'],
  },
  {
    title: '免費度尺',
    lines: ['免費上門度尺', '快速提供預算及報價'],
  },
  {
    title: '機構特惠',
    lines: ['接受 P-Card 付款', '學校及 NGO 享九折'],
  },
] as const;

export const BW_TRUST_STATS = [
  { value: '16+', label: '年項目經驗' },
  { value: '1000+', label: '產品選擇' },
  { value: '3–7 天', label: '現貨送裝' },
  { value: '14–28 天', label: '廠方訂造' },
] as const;

export const BW_CREDENTIALS = [
  {
    title: 'P-Card 採購',
    description: '支援機構 P-Card 採購流程及正式報價文件。',
  },
  {
    title: '免費上門度尺',
    description: '由專員了解場地、尺寸及實際使用需求。',
  },
  {
    title: '專員一對一服務',
    description: '由需求、選品、版本確認到安裝交付全程跟進。',
  },
  {
    title: '機構採購方案',
    description: '為學校、NGO、企業及公共機構提供批量採購支援。',
  },
] as const;

export const BW_PUBLIC_CASES = [
  {
    title: '歐陸貿易中心',
    location: '中環',
    size: '5,261 sq ft',
    image:
      'https://cdn.shopify.com/s/files/1/0614/6070/9575/files/500x333-case-1_3000x3000.jpg?v=1651640442',
  },
  {
    title: '瑞信集團大廈',
    location: '尖沙咀',
    size: '2,858 sq ft',
    image:
      'https://cdn.shopify.com/s/files/1/0614/6070/9575/files/500x333-case-2_3000x3000.jpg?v=1651640442',
  },
  {
    title: '東海商業中心',
    location: '尖沙咀',
    size: '2,667 sq ft',
    image:
      'https://cdn.shopify.com/s/files/1/0614/6070/9575/files/500x333-case-3_3000x3000.jpg?v=1651640442',
  },
  {
    title: '香港科學園',
    location: '大埔',
    size: '9,000 sq ft',
    image:
      'https://cdn.shopify.com/s/files/1/0614/6070/9575/files/500x333-case-4_3000x3000.jpg?v=1651640442',
  },
  {
    title: '新港中心',
    location: '尖沙咀',
    size: '5,000 sq ft',
    image:
      'https://cdn.shopify.com/s/files/1/0614/6070/9575/files/500x333-case-5_3000x3000.jpg?v=1651640442',
  },
  {
    title: '富通中心',
    location: '九龍灣',
    size: '9,000 sq ft',
    image:
      'https://cdn.shopify.com/s/files/1/0614/6070/9575/files/500x333-case-6_3000x3000.jpg?v=1651640442',
  },
] as const;

/** Public case names shown as a trust/logo-style wall; no private CRM data. */
export const BW_PUBLIC_CLIENT_MARKS = [
  '香港科學園',
  '時代廣場',
  '新港中心',
  '富通中心',
  '光大中心',
  '聖佐治大廈',
  '歐陸貿易中心',
  '瑞信集團大廈',
  '東海商業中心',
  'TML 廣場',
  'One Midtown',
  '京瑞廣場',
] as const;

export const BW_CLIENT_LOGO_WALL_IMAGE =
  'https://cdn.shopify.com/s/files/1/0614/6070/9575/files/logo___1_0ee55f1b-84b5-44da-b0ef-4c587de2575e.jpg';

export const BW_YOUTUBE_VIDEOS = [
  { id: 'RgqhXyJJ2ak', title: 'BW 商業空間項目案例' },
  { id: '-dahDTPekig', title: '辦公室設計及傢俬配置' },
  { id: 'VVNd0X3PmAw', title: '工程與安裝實錄' },
] as const;

export const BW_FACTORY_INFO = [
  {
    title: '實力工廠網絡',
    description: '支援標準產品、尺寸修改及全訂製傢俬生產。',
  },
  {
    title: '訂造交期管理',
    description: '一般廠方訂造參考交期為 14–28 天，按物料及項目確認。',
  },
  {
    title: '品質與安裝協調',
    description: '由生產規格、送貨安排到現場安裝，由專員統一跟進。',
  },
] as const;

export const BW_SERVICES = [
  '專屬 Client Portal 與互動報價',
  '商業空間傢俬規劃及產品選配',
  '訂製傢俬、物料與尺寸建議',
  '企業、學校、政府及 NGO 批量採購',
  '送貨、安裝與項目進度協調',
  '報價版本、確認紀錄與售後跟進',
] as const;

export const BW_SERVICE_MODULES = [
  {
    category: 'Furniture',
    title: '商業傢俬訂購及訂製',
    description:
      '提供辦公枱椅、會議室、接待、儲物、學校及機構傢俬；支援現貨、批量採購、尺寸修改及全訂製。',
    scope: ['產品選配與報價', '上門度尺', '訂製物料與尺寸', '送貨及安裝'],
    href: 'https://brandingworks-furniture.com/',
  },
  {
    category: 'Interior Design & Build',
    title: '辦公室設計工程',
    description:
      '由平面規劃、品牌形象、工作動線與空間配置，到裝修施工、傢俬及入伙協調的一站式工程。',
    scope: ['空間及樓層規劃', '室內設計', '裝修及機電協調', '傢俬配置入伙'],
    href: 'https://hkofficedesign.com/',
  },
  {
    category: 'Commercial Interiors',
    title: '商業、零售及餐飲工程',
    description:
      '涵蓋商業空間、零售店、時裝店、美妝店、餐廳、廚房及通風設備等專業設計工程。',
    scope: ['商業及零售店', '餐廳及 F&B', '廚房與通風', '品牌化空間'],
    href: 'https://brandingworks360.com/',
  },
  {
    category: 'Community & Institution',
    title: '學校、診所及社區工程',
    description:
      '為教育、醫療、安老院舍、NGO 及公共機構提供符合使用需要的耐用傢俬與工程整合。',
    scope: ['學校及課室', '診所與醫療空間', '安老院舍', '政府及 NGO 採購'],
    href: 'https://brandingworks-clinic.com/',
  },
  {
    category: 'Specialist Engineering',
    title: '專項及配套工程',
    description:
      '整合清拆、地板、牆身、冷氣、冷房、無塵空間、水務及空氣淨化等工程配套。',
    scope: ['清拆與復修', '地板及牆身', '冷氣與水務', '無塵及空氣淨化'],
    href: 'https://dismantle360.com/',
  },
  {
    category: 'Technology & Sustainability',
    title: '商業科技與可持續方案',
    description:
      '提供商業網絡、LED 顯示屏、創新建材及太陽能光伏等科技與環保工程。',
    scope: ['商業網絡系統', 'LED 顯示屏', '創新建材', '太陽能光伏'],
    href: 'https://www.brandingworks-network.com/',
  },
] as const;
