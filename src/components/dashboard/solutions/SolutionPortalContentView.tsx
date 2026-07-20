import { useEffect, useState } from 'react';
import { Save, Building2, Award, Factory, Users } from 'lucide-react';
import { toast } from 'sonner';

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

export function SolutionPortalContentView() {
  const [content, setContent] = useState<PortalContent>(DEFAULT_CONTENT);

  useEffect(() => {
    setContent(loadContent());
  }, []);

  const update = (key: keyof PortalContent, value: string) => {
    setContent((prev) => ({ ...prev, [key]: value }));
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
    toast.success('已暫存 Portal 內容', {
      description: '此為前端本機草稿，不修改 Supabase；客戶專區頁面可讀取展示',
    });
  };

  const fields: { key: keyof PortalContent; label: string; icon: typeof Building2; rows?: number }[] = [
    { key: 'companyIntro', label: '公司介紹', icon: Building2, rows: 4 },
    { key: 'credentials', label: '資質', icon: Award, rows: 3 },
    { key: 'clients', label: '客戶名單', icon: Users, rows: 3 },
    { key: 'factory', label: '工廠資料', icon: Factory, rows: 3 },
    { key: 'awards', label: '得獎／表揚紀錄', icon: Award, rows: 3 },
    { key: 'youtubeUrl', label: 'YouTube 頻道連結', icon: Building2, rows: 1 },
    { key: 'freeDeliveryPolicy', label: '免費送貨／品質保證摘要', icon: Building2, rows: 3 },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Portal 內容</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              編輯客戶專區展示文案（公司介紹、資質、案例來源等）。僅前端暫存，不上傳資料庫。
            </p>
          </div>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Save className="h-4 w-4" />
            儲存草稿
          </button>
        </div>

        <div className="space-y-4">
          {fields.map(({ key, label, icon: Icon, rows = 3 }) => (
            <label key={key} className="block rounded-xl border border-border bg-card p-4 shadow-sm">
              <span className="mb-2 flex items-center gap-2 font-body text-sm font-medium">
                <Icon className="h-4 w-4 text-primary" />
                {label}
              </span>
              {rows === 1 ? (
                <input
                  value={content[key]}
                  onChange={(e) => update(key, e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              ) : (
                <textarea
                  value={content[key]}
                  onChange={(e) => update(key, e.target.value)}
                  rows={rows}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm leading-relaxed focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              )}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function readPortalContentDraft(): PortalContent {
  return loadContent();
}
