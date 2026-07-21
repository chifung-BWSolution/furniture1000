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
  UserRound,
} from 'lucide-react';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';
import { fetchSearchProducts } from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import type { SearchProduct } from '@/types/solutions';

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
  return (
    <PortalPageShell
      title="傢俬訂製"
      badge="Client Portal"
      subtitle="唯讀顯示現有 Supabase 訂製查詢。"
    >
      <NoSupabaseRecords
        icon={PenLine}
        title="暫無訂製查詢紀錄"
        description="目前 Supabase 沒有可供此頁讀取的訂製查詢資料表，因此不顯示瀏覽器暫存或示意資料。"
      />
    </PortalPageShell>
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
