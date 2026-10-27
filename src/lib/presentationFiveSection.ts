import { supabase } from '@/lib/supabase';

export interface PresentationCompanyProfile {
  background: string;
  strengths: string;
  services: string;
  qualifications: string;
  capabilities: string;
}

export interface FiveSectionZone {
  code: string | null;
  name: string;
}

export interface FiveSectionProduct {
  title: string;
  model?: string | null;
  spec?: string | null;
  quantity?: string | null;
  price?: string | null;
}

export interface FiveSectionCase {
  /** Brand or company label. Never a project name. */
  name: string;
  client?: string | null;
  industry?: string | null;
  /** Furniture types used by this case. */
  furniture?: string[];
}

export const EMPTY_COMPANY_PROFILE: PresentationCompanyProfile = {
  background: '',
  strengths: '',
  services: '',
  qualifications: '',
  capabilities: '',
};

/** Facts the company slide must show, taken from the public site copy. */
export const WEBSITE_COMPANY_PROFILE: PresentationCompanyProfile = {
  background: 'BW Furniture（Branding Works Furniture & Office Design）專注香港辦公室及商業傢俬方案，擁有超過 16 年行業經驗、逾 1,000 個空間實績，已服務超過 3,000 家香港企業與機構，整合空間設計、裝修工程與傢俬配置。',
  strengths: '自設「老木匠」傢俬廠房，採用工廠直供模式，配合一對一專員服務。提供超過 1,000 款傢俬，結合現貨及度身訂造選擇，並由產品開發、設計及客戶服務團隊協作跟進。',
  services: '免費上門度尺、空間規劃、報價預算、辦公室設計及裝修配套、傢俬訂製、送貨與安裝；接受企業、機構及政府部門的報價邀請與投標文件，並支援 P-Card 採購付款。',
  qualifications: 'Branding Works 設計工程業務的專業資歷：志豐集團官網記載，志豐商業工程設計於 2020 年獲得 ISO 9001:2015 品質管理體系認證；香港專業室內設計師協會（HKPIDA）企業會員名錄列有 Branding Works 志豐設計工程中心，會員編號 C2604-5。',
  capabilities: '整合辦公室動線、空間規劃、固定裝潢及活動傢俬，提供辦公枱、會議枱、辦公椅、儲物櫃、接待家具與靜音艙等配置。訂造可選微甲醛 E0 板材，並提供阻燃、防刮材料選項及電腦定位排孔工序；按產品及項目需要確認規格。',
};

const COMPANY_SLIDE_POINTS = ['超過 1,000 款傢俬', '超過 16 年行業經驗'] as const;

const PROFILE_COLUMNS = 'background, strengths, services, qualifications, capabilities';

function clip(value: string, max = 2000): string {
  return value.trim().slice(0, max);
}

export async function loadPresentationCompanyProfile(): Promise<PresentationCompanyProfile> {
  const { data, error } = await supabase
    .from('fds_presentation_company_profile')
    .select(PROFILE_COLUMNS)
    .eq('id', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    background: data?.background ?? '',
    strengths: data?.strengths ?? '',
    services: data?.services ?? '',
    qualifications: data?.qualifications ?? '',
    capabilities: data?.capabilities ?? '',
  };
}

export async function savePresentationCompanyProfile(
  profile: PresentationCompanyProfile,
): Promise<void> {
  const { data, error } = await supabase
    .from('fds_presentation_company_profile')
    .update({
      background: clip(profile.background),
      strengths: clip(profile.strengths),
      services: clip(profile.services),
      qualifications: clip(profile.qualifications),
      capabilities: clip(profile.capabilities),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message.includes('permission') ? '沒有權限修改公司介紹' : error.message);
  if (!data) throw new Error('沒有權限修改公司介紹，或公司介紹尚未設定');
}

function linesOf(pairs: [string, string][]): string[] {
  return pairs
    .map(([label, value]) => (value.trim() ? `${label}：${value.trim()}` : ''))
    .filter(Boolean);
}

/** Fixed order. The floor-plan section is omitted when the project has none. */
export function buildFiveSectionOutline(input: {
  title: string;
  client: string;
  date: string;
  company: PresentationCompanyProfile;
  floorPlan: { present: boolean; zones: FiveSectionZone[] };
  products: FiveSectionProduct[];
  cases: FiveSectionCase[];
}): string {
  const blocks: string[] = [];
  let index = 1;
  const heading = (title: string) => `${index++}. ${title}`;
  blocks.push([
    heading('封面'),
    ...linesOf([
      ['項目', input.title],
      ['客戶', input.client],
      ['日期', input.date],
    ]),
  ].join('\n'));

  const company = {
    background: input.company.background.trim() || WEBSITE_COMPANY_PROFILE.background,
    strengths: input.company.strengths.trim() || WEBSITE_COMPANY_PROFILE.strengths,
    services: input.company.services.trim() || WEBSITE_COMPANY_PROFILE.services,
    qualifications: input.company.qualifications.trim() || WEBSITE_COMPANY_PROFILE.qualifications,
    capabilities: input.company.capabilities.trim() || WEBSITE_COMPANY_PROFILE.capabilities,
  };
  blocks.push([
    heading('公司介紹'),
    ...COMPANY_SLIDE_POINTS.map((point) => `- ${point}`),
    `- 專業資質：${company.qualifications}`,
    ...linesOf([
      ['背景', company.background],
      ['優勢', company.strengths],
      ['主要服務', company.services],
      ['相關能力', company.capabilities],
    ]),
  ].filter((line) => line.trim()).join('\n'));

  if (input.floorPlan.present) {
    const zones = input.floorPlan.zones
      .map((zone) => `- ${[zone.code, zone.name].filter(Boolean).join(' ')}`.trim())
      .filter((line) => line !== '-');
    blocks.push([heading('平面圖'), zones.length > 0 ? zones.join('\n') : '已有平面圖，分區名稱尚未填寫。'].join('\n'));
  }

  const productLines = input.products.slice(0, 30).map((product) => {
    const bits = [product.title, product.model, product.spec, product.quantity, product.price].filter(Boolean);
    return `- ${bits.join('｜')}`;
  });
  if (input.products.length > 10) {
    productLines.push('- 項目超過 10 件，建議再分區。仍可繼續生成。');
  }
  blocks.push([heading('方案'), productLines.length > 0 ? productLines.join('\n') : '尚未選擇產品。'].join('\n'));

  if (input.cases.length === 0) {
    blocks.push([heading('參考案例'), '尚未選擇案例。'].join('\n'));
  } else {
    for (const item of input.cases) {
      const furniture = [...new Set((item.furniture ?? []).map((line) => line.trim()).filter(Boolean))].slice(0, 16);
      const lines = [
        heading(item.name.trim() || '未命名案例'),
        item.industry?.trim() ? `行業：${item.industry.trim()}` : '',
        furniture.length > 0 ? '用過的傢俬：' : '尚未記錄此案例用過的傢俬。',
        ...furniture.map((line) => `- ${line}`),
      ].filter(Boolean);
      blocks.push(lines.join('\n'));
    }
  }

  return blocks.join('\n\n');
}
