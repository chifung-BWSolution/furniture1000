/**
 * Portal content draft helpers (localStorage only).
 * Staff "Portal 內容" editor page was removed from 傢俬方案 nav;
 * client portal pages still read this draft for display copy.
 */

const STORAGE_KEY = 'fds-portal-content-draft';

type PortalContent = {
  companyIntro: string;
  credentials: string;
  clients: string;
  factory: string;
  awards: string;
  youtubeUrl: string;
  freeDeliveryPolicy: string;
};

const DEFAULT_CONTENT: PortalContent = {
  companyIntro:
    'Branding Works Design Ltd（BWF）專注辦公室與機構傢俬方案，結合設計、採購與安裝一站式服務，服務政府、NGO、學校與企業客戶。',
  credentials:
    'ISO 品質管理流程 · 政府供應商經驗 · 專業室內設計與項目管理團隊',
  clients:
    '仁濟醫院 · 消防處 · 匯豐 · 半島集團 · 多間中小學及社福機構',
  factory:
    '華南合作工廠網絡，支援來樣訂製、批量生產與品質抽檢；可安排工廠參觀與生產進度追蹤。',
  awards:
    '設計與項目案例曾獲客戶內部表揚；持續以交付準時率與安裝滿意度作為服務指標。',
  youtubeUrl: 'https://www.youtube.com/@brandingworks',
  freeDeliveryPolicy:
    '訂單滿 HK$12,000 可享標準範圍免費送貨安裝（離島／特殊場地除外，詳見報價條款）。',
};

function loadContent(): PortalContent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONTENT;
    return { ...DEFAULT_CONTENT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONTENT;
  }
}

export function readPortalContentDraft(): PortalContent {
  return loadContent();
}
