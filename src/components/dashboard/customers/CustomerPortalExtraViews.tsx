import { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Factory,
  Film,
  Globe,
  Landmark,
  Loader2,
  Mail,
  MessageCircle,
  PackageCheck,
  PenLine,
  Percent,
  Phone,
  Ruler,
  Search,
  Truck,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';
import { fetchPortalBrowseProducts } from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import type { SearchProduct } from '@/types/solutions';
import { toast } from 'sonner';
import {
  CorporateLogoWall,
  CorporateSection,
  CorporateTrustStats,
  CorporateYouTubeGrid,
} from '@/components/corporate/CorporateModules';
import {
  BW_COMPANY,
  BW_CONTACT_HIGHLIGHTS,
  BW_PUBLIC_CASES,
  BW_SERVICE_MODULES,
} from '@/content/bwCorporate';

const CONTACT_HIGHLIGHT_ICONS = [Factory, Truck, Ruler, Percent] as const;

function NoRecords({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof PenLine;
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <Icon className="mx-auto h-10 w-10 text-muted-foreground/40" />
      <h2 className="mt-3 font-display text-base font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        {description}
      </p>
    </section>
  );
}

export function CustomerCustomFurnitureView() {
  const [form, setForm] = useState({
    furnitureType: '',
    material: '',
    quantity: '1',
    budget: '',
    length: '',
    width: '',
    height: '',
    requirements: '',
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SearchProduct[]>([]);
  const [suggestions, setSuggestions] = useState<SearchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzed, setAnalyzed] = useState(false);

  useEffect(() => {
    fetchPortalBrowseProducts(300)
      .then(setCatalog)
      .finally(() => setLoading(false));
  }, []);

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setAnalyzed(false);
  };

  const analyzeRequest = () => {
    if (
      !form.furnitureType.trim() &&
      !form.requirements.trim() &&
      !imagePreview
    ) {
      toast.error('請上載圖片，或填寫傢俬類型／需求');
      return;
    }
    const tokens = [
      form.furnitureType,
      form.material,
      form.requirements,
    ]
      .join(' ')
      .toLowerCase()
      .split(/[\s,，、/]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    const ranked = catalog
      .map((product, index) => {
        const haystack = [
          product.title,
          product.description,
          product.material,
          product.category,
          product.level1Category,
          product.level2Category,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const score = tokens.reduce(
          (total, token) => total + (haystack.includes(token) ? 1 : 0),
          0,
        );
        return { product, score, index };
      })
      .filter((row) => tokens.length === 0 || row.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(Boolean(b.product.isOnShopify)) -
            Number(Boolean(a.product.isOnShopify)) ||
          a.index - b.index,
      )
      .slice(0, 6)
      .map((row) => row.product);
    setSuggestions(ranked);
    setAnalyzed(true);
  };

  const pickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('請選擇 JPG、PNG 或 WebP 圖片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('圖片不可大於 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  return (
    <PortalPageShell
      title="傢俬訂製"
      badge="Client Portal"
      subtitle="上載參考圖片並填寫傢俬類型、尺寸、材質及意見，從現有產品尋找參考，再整理需要訂製的部分。"
    >
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div>
            <h2 className="font-display text-base font-bold">上載參考圖片</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              可上載相片、草圖或網上參考款式，圖片只在目前頁面預覽。
            </p>
          </div>
          {imagePreview ? (
            <div className="relative overflow-hidden rounded-xl border border-border bg-muted/20">
              <img
                src={imagePreview}
                alt="訂製參考"
                className="max-h-[360px] w-full object-contain"
              />
              <button
                type="button"
                onClick={() => setImagePreview(null)}
                className="absolute right-2 top-2 rounded-full border border-border bg-card/95 p-2 shadow-sm"
                aria-label="移除圖片"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-primary/35 bg-primary/5 px-6 py-14 text-center transition-colors hover:bg-primary/10">
              <Upload className="h-8 w-8 text-primary" />
              <span className="font-semibold">點擊上載參考圖片</span>
              <span className="text-sm text-muted-foreground">
                JPG、PNG、WebP，最多 10MB
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => pickImage(event.target.files?.[0] || null)}
              />
            </label>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="想找的傢俬類型 *"
              value={form.furnitureType}
              placeholder="例如：接待櫃、儲物櫃、弧形梳化"
              onChange={(value) => update('furnitureType', value)}
            />
            <FormField
              label="偏好材質"
              value={form.material}
              placeholder="例如：木皮、不鏽鋼、布藝"
              onChange={(value) => update('material', value)}
            />
            <FormField
              label="數量"
              value={form.quantity}
              type="number"
              onChange={(value) => update('quantity', value)}
            />
            <FormField
              label="預算（HK$）"
              value={form.budget}
              type="number"
              placeholder="例如：15000"
              onChange={(value) => update('budget', value)}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">預計尺寸（毫米）</p>
            <div className="grid grid-cols-3 gap-3">
              <FormField
                label="長"
                value={form.length}
                type="number"
                placeholder="L"
                onChange={(value) => update('length', value)}
              />
              <FormField
                label="闊"
                value={form.width}
                type="number"
                placeholder="W"
                onChange={(value) => update('width', value)}
              />
              <FormField
                label="高"
                value={form.height}
                type="number"
                placeholder="H"
                onChange={(value) => update('height', value)}
              />
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">
              詳細需求／意見 *
            </span>
            <textarea
              value={form.requirements}
              onChange={(event) => update('requirements', event.target.value)}
              rows={5}
              placeholder="請說明用途、顏色、收納方式、安裝環境、交期或其他想法…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={analyzeRequest}
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            尋找參考產品並整理需求
          </button>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-display text-base font-bold">訂製需求摘要</h2>
            {!analyzed ? (
              <p className="mt-3 text-sm text-muted-foreground">
                填寫需求後按「尋找參考產品並整理需求」。
              </p>
            ) : (
              <dl className="mt-3 space-y-2 text-sm">
                <SummaryRow label="類型" value={form.furnitureType || '未填寫'} />
                <SummaryRow label="材質" value={form.material || '未指定'} />
                <SummaryRow label="數量" value={form.quantity || '1'} />
                <SummaryRow
                  label="尺寸"
                  value={
                    [form.length, form.width, form.height].some(Boolean)
                      ? `${form.length || '—'} × ${form.width || '—'} × ${form.height || '—'} mm`
                      : '未指定'
                  }
                />
                <SummaryRow
                  label="預算"
                  value={
                    form.budget
                      ? `HK$ ${Number(form.budget).toLocaleString()}`
                      : '未指定'
                  }
                />
              </dl>
            )}
          </section>

          {analyzed ? (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="font-display text-base font-bold">
                可參考的現有產品
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                用作款式及價錢參考；不符合的尺寸或細節可列入訂製要求。
              </p>
              {suggestions.length === 0 ? (
                <p className="mt-4 rounded-xl bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                  現有產品目錄未找到相近結果，建議保留圖片及詳細需求由 PM 跟進訂製。
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {suggestions.map((product) => (
                    <article
                      key={product.id}
                      className="flex items-center gap-3 rounded-xl border border-border p-2.5"
                    >
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.title}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <h3 className="line-clamp-2 text-sm font-semibold">
                          {product.title}
                        </h3>
                        <p className="mt-1 font-mono-data text-xs text-primary">
                          HK$ {product.salePrice.toLocaleString()}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </PortalPageShell>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        type={type}
        min={type === 'number' ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
      />
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

export { CustomerPaymentDeliveryView } from '@/components/dashboard/customers/CustomerPaymentDeliveryView';

export function CustomerOrderStatusView() {
  return (
    <PortalPageShell
      title="訂單狀況"
      badge="Client Portal"
      subtitle="唯讀顯示現有訂單與送貨紀錄。"
    >
      <NoRecords
        icon={PackageCheck}
        title="暫無訂單紀錄"
        description="目前沒有可與此登入客戶配對的訂單資料。"
      />
    </PortalPageShell>
  );
}

export function CustomerCaseStudiesView() {
  return (
    <PortalPageShell
      title="成功案例"
      badge="Client Portal"
      subtitle="公開工程案例、服務客戶 Logo 牆及公司 YouTube。"
    >
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-6 lg:p-8">
          <div>
            <p className="text-sm font-semibold text-primary">PROJECT SUCCESS STORIES</p>
            <h2 className="mt-2 font-display text-2xl font-bold">
              見證 BW 為各行各業打造理想商業空間
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              以 16+ 年實務經驗，從空間規劃、產品選配、訂製生產到送貨安裝，為客戶提供一站式落地方案。
            </p>
          </div>
        </div>
      </section>
      <CorporateTrustStats />

      <CorporateSection
        title="公開工程案例"
        subtitle="內容及圖片參考 B&W Office 公開成功案例頁。"
        icon={<Film className="h-5 w-5 text-primary" />}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {BW_PUBLIC_CASES.map((item) => (
            <article
              key={`${item.title}-${item.location}`}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="aspect-[3/2] overflow-hidden bg-muted">
                <img
                  src={item.image}
                  alt={`${item.title} ${item.location}`}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                />
              </div>
              <div className="p-4">
                <h3 className="font-display text-base font-bold">{item.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.location} · {item.size}
                </p>
              </div>
            </article>
          ))}
        </div>
      </CorporateSection>

      <CorporateSection
        title="服務客戶 Logo 牆"
        subtitle="取自 B&W Office 公開首頁，涵蓋教育、金融及專業服務、政府及法定機構、酒店、科技、醫療與社福等分類。"
        icon={<Building2 className="h-5 w-5 text-primary" />}
      >
        <CorporateLogoWall />
      </CorporateSection>

      <CorporateSection
        title="公司 YouTube"
        subtitle="觀看辦公室設計、工程及安裝案例。"
        icon={<Film className="h-5 w-5 text-primary" />}
      >
        <CorporateYouTubeGrid />
      </CorporateSection>
    </PortalPageShell>
  );
}

export function CustomerServicesView() {
  return (
    <PortalPageShell
      title="服務一覽"
      badge="Client Portal"
      subtitle="整合 Interior Design & Build 設計工程、傢俬、社區機構、專項工程及商業科技服務。"
    >
      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6">
        <p className="text-sm font-semibold text-primary">ONE-STOP PROJECT SERVICES</p>
        <h2 className="mt-2 font-display text-xl font-bold">
          從空間規劃、設計施工到傢俬及入伙
        </h2>
        <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          BW 服務網絡涵蓋辦公室、商業零售、餐飲、學校、診所、社區及專項工程；客戶可透過 Client Portal 在同一位置了解方案、產品與報價。
        </p>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {BW_SERVICE_MODULES.map((service, index) => (
          <article
            key={service.title}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-display font-bold text-primary">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
                {service.category}
              </span>
            </div>
            <h2 className="mt-4 font-display text-base font-bold">
              {service.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {service.description}
            </p>
            <ul className="mt-4 space-y-2">
              {service.scope.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  {item}
                </li>
              ))}
            </ul>
            <a
              href={service.href}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1 font-semibold text-primary"
            >
              了解服務 <ExternalLink className="h-4 w-4" />
            </a>
          </article>
        ))}
      </div>
    </PortalPageShell>
  );
}

export function CustomerContactView() {
  const { loading, company } = useClientZoneContext();
  return (
    <PortalPageShell
      title="聯絡我們"
      badge="Client Portal"
      subtitle="聯絡 BW Furniture 專員，查詢報價、產品、訂製、機構採購及項目安排。"
      maxWidthClass="max-w-none"
    >
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-semibold text-primary">BW FURNITURE</p>
          <h2 className="mt-2 font-display text-xl font-bold">
            {BW_COMPANY.legalName}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {BW_COMPANY.intro}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-4">
              <Phone className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">電話</p>
              <a
                href={`tel:${BW_COMPANY.phoneTel}`}
                className="mt-1 block font-semibold hover:text-primary"
              >
                {BW_COMPANY.phone}
              </a>
              <div className="mt-3 border-t border-border/70 pt-3">
                <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                  WhatsApp
                </p>
                <a
                  href={BW_COMPANY.whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block font-semibold text-emerald-700 hover:underline"
                >
                  {BW_COMPANY.whatsapp}
                </a>
              </div>
            </div>
            <a
              href={`mailto:${BW_COMPANY.email}`}
              className="rounded-xl border border-border p-4 hover:border-primary/40"
            >
              <Mail className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">電郵</p>
              <p className="break-all font-semibold">{BW_COMPANY.email}</p>
            </a>
            <a
              href={BW_COMPANY.website}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-border p-4 hover:border-primary/40"
            >
              <Globe className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">網站</p>
              <p className="inline-flex items-center gap-1 font-semibold">
                bwoffice.asia <ExternalLink className="h-4 w-4" />
              </p>
            </a>
            <div className="rounded-xl border border-border p-4">
              <Building2 className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">地址</p>
              <p className="font-semibold">{BW_COMPANY.address}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-semibold text-primary">服務優勢</p>
          <h2 className="mt-2 font-display text-lg font-bold">
            實力工廠・極速交期・免費度尺・機構特惠
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {BW_CONTACT_HIGHLIGHTS.map((item, index) => {
              const Icon = CONTACT_HIGHLIGHT_ICONS[index] ?? Factory;
              return (
                <article
                  key={item.title}
                  className="rounded-xl border border-border bg-muted/20 p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="font-display text-base font-bold">
                      {item.title}
                    </h3>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    {item.lines.map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : company ? (
        <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:grid-cols-2">
          <h2 className="sm:col-span-2 font-display text-base font-bold">
            您的機構聯絡資料
          </h2>
          <ReadOnlyField icon={Building2} label="公司" value={company.name} />
          <ReadOnlyField
            icon={UserRound}
            label="聯絡人"
            value={company.contactPerson}
          />
          <ReadOnlyField
            icon={Mail}
            label="電郵"
            value={company.contactEmail}
          />
          <ReadOnlyField
            icon={Phone}
            label="電話"
            value={company.contactPhone}
          />
        </section>
      ) : null}
    </PortalPageShell>
  );
}

export function CustomerOrgAccountView() {
  const { loading, company, clientEmail } = useClientZoneContext();
  const roles = [
    {
      name: 'Client Super Admin',
      description: '瀏覽所有機構成員報價、批核報價及管理成員存取。',
    },
    {
      name: 'Approver',
      description: '瀏覽及批核獲分派的報價與方案。',
    },
    {
      name: 'Viewer',
      description: '以電郵認證登入，只查看獲授權的報價及產品。',
    },
  ];
  return (
    <PortalPageShell
      title="機構採購帳號"
      badge="Client Portal"
      subtitle="由 BW 負責建立多用戶機構帳號、電郵認證、角色分派及報價存取權。"
    >
      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-primary">ORGANISATION PROCUREMENT</p>
            <h2 className="mt-2 font-display text-xl font-bold">
              一個機構，多個獲授權用戶
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              每位成員使用自己的電郵認證登入。BW 會按機構要求建立帳號、連結所屬專案與報價，並分派 Super Admin、Approver 或 Viewer 權限。
            </p>
          </div>
          <a
            href={`mailto:${BW_COMPANY.email}?subject=${encodeURIComponent('申請建立機構採購帳號')}`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground"
          >
            <Mail className="h-4 w-4" />
            聯絡 BW 建立帳號
          </a>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {roles.map((role) => (
          <article
            key={role.name}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <Users className="h-5 w-5 text-primary" />
            <h2 className="mt-3 font-display text-base font-bold">{role.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{role.description}</p>
          </article>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-display text-base font-bold">BW 開通流程</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            '確認機構及主要聯絡人',
            '收集成員電郵及角色',
            '以電郵認證建立登入',
            '連結報價並啟用批核權限',
          ].map((step, index) => (
            <div key={step} className="rounded-xl bg-muted/30 p-4">
              <span className="font-mono-data text-sm font-bold text-primary">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-2 font-semibold">{step}</p>
            </div>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !company ? (
        <NoRecords
          icon={Landmark}
          title="機構帳戶尚未開通"
          description="暫未有與目前登入電郵配對的機構資料，請聯絡 BW 由公司人員建立及分派權限。"
        />
      ) : (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold">{company.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                登入帳戶：{clientEmail || company.contactEmail || '—'}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            已找到機構資料
          </div>
        </section>
      )}
    </PortalPageShell>
  );
}

function ReadOnlyField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string | null;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </p>
      <p className="mt-2 text-sm font-medium">{value || '—'}</p>
    </div>
  );
}
