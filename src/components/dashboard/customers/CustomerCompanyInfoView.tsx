import {
  Award,
  Building2,
  CheckCircle2,
  ExternalLink,
  Factory,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';
import {
  CorporateLogoWall,
  CorporateSection,
  CorporateTrustStats,
} from '@/components/corporate/CorporateModules';
import {
  BW_COMPANY,
  BW_CREDENTIALS,
  BW_FACTORY_INFO,
} from '@/content/bwCorporate';

interface CustomerCompanyInfoViewProps {
  onOpenProject?: (projectId: string) => void;
}

export function CustomerCompanyInfoView(
  _props: CustomerCompanyInfoViewProps,
) {
  return (
    <PortalPageShell
      title="公司資料"
      badge="Client Portal"
      subtitle="公司介紹、資質、公開客戶案例、工廠資料與已核實紀錄，建立報價以外的完整信任。"
      maxWidthClass="max-w-7xl"
    >
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.3fr_0.7fr] lg:p-8">
          <div>
            <p className="text-sm font-semibold text-primary">ABOUT BW FURNITURE</p>
            <h2 className="mt-2 font-display text-2xl font-bold">
              {BW_COMPANY.legalName}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {BW_COMPANY.intro}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {BW_COMPANY.mission}
            </p>
          </div>
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <Building2 className="h-6 w-6 text-primary" />
            <p className="mt-3 font-display text-lg font-bold">
              {BW_COMPANY.tagline}
            </p>
            <a
              href={BW_COMPANY.website}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 font-semibold text-primary"
            >
              瀏覽公司網站 <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      <CorporateTrustStats />

      <CorporateSection
        title="資質與服務能力"
        subtitle="依據 B&W Office 公開網站所列服務能力整理。"
        icon={<ShieldCheck className="h-5 w-5 text-primary" />}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {BW_CREDENTIALS.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h3 className="mt-3 font-display text-base font-bold">
                {item.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.description}
              </p>
            </article>
          ))}
        </div>
      </CorporateSection>

      <CorporateSection
        title="公開客戶案例"
        subtitle="以公開成功案例頁列出的項目名稱呈現，不讀取或公開私人 CRM 名單。"
        icon={<Users className="h-5 w-5 text-primary" />}
      >
        <CorporateLogoWall />
      </CorporateSection>

      <CorporateSection
        title="工廠與交付能力"
        icon={<Factory className="h-5 w-5 text-primary" />}
      >
        <div className="grid gap-4 md:grid-cols-3">
          {BW_FACTORY_INFO.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <Factory className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-bold">
                {item.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.description}
              </p>
            </article>
          ))}
        </div>
      </CorporateSection>

      <CorporateSection
        title="得獎及表揚紀錄"
        icon={<Award className="h-5 w-5 text-primary" />}
      >
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6">
          <p className="font-semibold">待 BW 補充已核實紀錄</p>
          <p className="mt-2 text-sm text-muted-foreground">
            參考的公開成功案例頁未列出具體獎項名稱，因此本頁不會自行加入未核實資料。
          </p>
        </div>
      </CorporateSection>
    </PortalPageShell>
  );
}
