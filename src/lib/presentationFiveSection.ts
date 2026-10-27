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
  const { error } = await supabase
    .from('fds_presentation_company_profile')
    .update({
      background: clip(profile.background),
      strengths: clip(profile.strengths),
      services: clip(profile.services),
      qualifications: clip(profile.qualifications),
      capabilities: clip(profile.capabilities),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (error) throw new Error(error.message.includes('permission') ? '沒有權限修改公司介紹' : error.message);
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

  blocks.push([
    heading('公司介紹'),
    ...linesOf([
      ['背景', input.company.background],
      ['優勢', input.company.strengths],
      ['主要服務', input.company.services],
      ['專業資質', input.company.qualifications],
      ['相關能力', input.company.capabilities],
    ]),
  ].filter((line) => line.trim()).join('\n') || '2. 公司介紹');

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
