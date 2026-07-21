import { useEffect, useState } from 'react';
import {
  Briefcase,
  Building2,
  Film,
  Landmark,
  Loader2,
  Mail,
  PackageCheck,
  PenLine,
  Phone,
  Search,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';
import {
  fetchPortalBrowseProducts,
  fetchSearchProducts,
} from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import type { SearchProduct } from '@/types/solutions';
import { toast } from 'sonner';

function NoSupabaseRecords({
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
                  現有 Supabase 產品目錄未找到相近結果，建議保留圖片及詳細需求由 PM 跟進訂製。
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
      subtitle="唯讀顯示現有 Supabase 訂單與送貨紀錄。"
    >
      <NoSupabaseRecords
        icon={PackageCheck}
        title="暫無訂單紀錄"
        description="目前沒有可與此登入客戶配對的 Supabase 訂單資料；不再顯示預設完成進度或前端模擬狀態。"
      />
    </PortalPageShell>
  );
}

export function CustomerCaseStudiesView() {
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSearchProducts(12)
      .then(setProducts)
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalPageShell
      title="成功案例"
      badge="Client Portal"
      subtitle="唯讀展示 Supabase 產品資料；不使用前端客戶名單或示意 Logo。"
    >
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold">
          <Film className="h-4 w-4 text-primary" />
          產品案例
        </h2>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : products.length === 0 ? (
          <NoSupabaseRecords
            icon={Film}
            title="暫無案例產品"
            description="Supabase 產品目錄目前沒有可展示的資料。"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <article
                key={product.id}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="aspect-square bg-muted/30">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="p-3">
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
    </PortalPageShell>
  );
}

export function CustomerServicesView() {
  return (
    <PortalPageShell
      title="服務一覽"
      badge="Client Portal"
      subtitle="唯讀顯示 Supabase 服務資料。"
    >
      <NoSupabaseRecords
        icon={Briefcase}
        title="暫無服務資料"
        description="目前 Supabase 沒有服務目錄資料表，因此不顯示硬編碼服務卡片。"
      />
    </PortalPageShell>
  );
}

export function CustomerContactView() {
  const { loading, company, clientEmail } = useClientZoneContext();
  return (
    <PortalPageShell
      title="聯絡我們"
      badge="Client Portal"
      subtitle="唯讀顯示此登入客戶在 Supabase 的公司聯絡資料。"
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !company ? (
        <NoSupabaseRecords
          icon={Phone}
          title="找不到聯絡資料"
          description={`Supabase 沒有與 ${clientEmail || '目前登入帳戶'} 配對的公司資料。`}
        />
      ) : (
        <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:grid-cols-2">
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
      )}
    </PortalPageShell>
  );
}

export function CustomerOrgAccountView() {
  const { loading, company, clientEmail } = useClientZoneContext();
  return (
    <PortalPageShell
      title="機構採購帳號"
      badge="Client Portal"
      subtitle="唯讀顯示 Supabase 現有機構帳戶資料。"
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !company ? (
        <NoSupabaseRecords
          icon={Landmark}
          title="暫無機構帳戶"
          description="Supabase 沒有與目前登入電郵配對的機構資料；不顯示本機暫存成員。"
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
