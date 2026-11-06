/**
 * 客戶報價頁「相關家具」的推薦用途（application scenario）。
 *
 * 首版不新增用途資料表：商品沿用 `products.tags` 既有可多選標籤
 * （OFFICIAL_PRODUCT_TAGS，例如「學校傢俬」「餐廳傢俬」「辦公枱」）。
 * 推薦來源是客戶對應設計專案的工程類型（`design_projects.meta.projectType`）；
 * 沒有關聯專案或工程類型未設定時，才用 PMS 客戶行業
 * （`project_data.formData.clientIndustry`）推算。
 *
 * 用途只是排序依據：沒有用途或沒有相符商品時，仍然顯示正常 A 類目錄。
 */

export type QuoteScenarioCode =
  | 'office'
  | 'school'
  | 'restaurant'
  | 'retail'
  | 'hotel'
  | 'clinic'
  | 'residential'
  | 'outdoor';

export interface QuoteScenario {
  code: QuoteScenarioCode;
  label: string;
  labelEn: string;
  /** `products.tags` 內屬於這個用途的官方標籤。 */
  productTags: string[];
  /** 商品標籤以外的回退比對字（一、二級分類與標題）。 */
  categoryKeywords: string[];
}

export const QUOTE_SCENARIOS: QuoteScenario[] = [
  {
    code: 'office',
    label: '辦公',
    labelEn: 'Office',
    productTags: [
      '辦公枱',
      '辦公椅',
      '主管枱',
      '行政枱',
      '老闆枱',
      '員工椅',
      '大班椅',
      '工作枱',
      '工作枱配套',
      '現貨工作枱',
      '現貨行政枱',
      '升降枱',
      '會議室',
      '會議枱',
      '洽談枱',
      '培訓枱',
      '培訓椅',
      '接待處家具',
      '接待桌椅組合',
      '文件櫃',
      '儲物櫃',
      '鋼制櫃',
      '木製櫃',
      '電話亭',
      '顯示器支架',
      '學校辦公',
    ],
    categoryKeywords: ['辦公', '職員', '會議', '行政', '主管', '接待', '屏風', '文件櫃', '儲物', '培訓'],
  },
  {
    code: 'school',
    label: '學校',
    labelEn: 'School',
    productTags: [
      '學校傢俬',
      '中小學',
      '學生課室',
      '課室家具',
      '圖書館',
      '幼兒園',
      '科學室',
      '培訓枱',
      '培訓椅',
      '學校辦公',
    ],
    categoryKeywords: ['學校', '課室', '學生', '圖書館', '幼兒', '科學室', '教育', '校園'],
  },
  {
    code: 'restaurant',
    label: '餐廳',
    labelEn: 'Restaurant',
    productTags: ['餐廳傢俬', '酒吧桌椅', '茶檯'],
    categoryKeywords: ['餐', '酒吧', '咖啡', 'cafe', 'dining', 'restaurant'],
  },
  {
    code: 'retail',
    label: '零售',
    labelEn: 'Retail',
    productTags: ['接待處家具', '接待桌椅組合', '裝飾櫃', '牆身裝飾'],
    categoryKeywords: ['零售', '商店', '門市', '陳列', '美容', 'retail', 'shop'],
  },
  {
    code: 'hotel',
    label: '酒店',
    labelEn: 'Hotel',
    productTags: ['休閒家具', '茶檯', '接待處家具'],
    categoryKeywords: ['酒店', '旅館', '客房', 'hotel', 'resort'],
  },
  {
    code: 'clinic',
    label: '醫療',
    labelEn: 'Clinic',
    productTags: ['接待處家具', '儲物櫃', '文件櫃'],
    categoryKeywords: ['醫療', '診所', '醫院', '診室', 'clinic', 'medical', 'hospital'],
  },
  {
    code: 'residential',
    label: '住宅',
    labelEn: 'Residential',
    productTags: ['SOFA梳化', '休閒家具', '茶檯'],
    categoryKeywords: ['住宅', '家居', '客廳', '睡房', 'residential', 'home'],
  },
  {
    code: 'outdoor',
    label: '戶外',
    labelEn: 'Outdoor',
    productTags: ['戶外傢俬', '工業家具'],
    categoryKeywords: ['戶外', '室外', '花園', 'outdoor'],
  },
];

const SCENARIO_BY_CODE = new Map(QUOTE_SCENARIOS.map((row) => [row.code, row] as const));

/**
 * 客戶對應設計專案的工程類型 → 推薦用途。
 * `other`（其他工程）沒有特定用途，回傳空陣列，交由客戶行業回退或正常 A 類目錄。
 */
const PROJECT_TYPE_SCENARIOS: Record<string, QuoteScenarioCode[]> = {
  office: ['office'],
  school: ['school'],
  clinic: ['clinic'],
  hotel: ['hotel'],
  other: [],
};

export function scenariosFromProjectType(type: unknown): QuoteScenarioCode[] {
  const key = String(type ?? '').trim();
  return PROJECT_TYPE_SCENARIOS[key] ?? [];
}

const INDUSTRY_SCENARIO_RULES: { code: QuoteScenarioCode; pattern: RegExp }[] = [
  { code: 'school', pattern: /教育|學校|大學|學院|培訓|補習|幼稚園|幼兒|education|school|university|college|learning|academy|training/i },
  { code: 'restaurant', pattern: /餐飲|飲食|餐廳|酒樓|咖啡|食品|food|beverage|restaurant|catering|coffee|cafe|f&b/i },
  { code: 'clinic', pattern: /醫療|診所|醫院|牙科|保健|medical|clinic|hospital|dental|health/i },
  { code: 'hotel', pattern: /酒店|旅館|旅業|度假|hospitality|hotel|resort/i },
  { code: 'retail', pattern: /零售|商店|門市|百貨|美容|salon|retail|shop|store|beauty|boutique/i },
  { code: 'residential', pattern: /住宅|家居|地產發展|住宅項目|residential|home|housing/i },
  { code: 'outdoor', pattern: /戶外|園藝|outdoor|landscape/i },
  {
    code: 'office',
    pattern: /金融|銀行|保險|證券|地產|法律|會計|科技|資訊|軟件|電訊|貿易|物流|製造|工業|企業|集團|辦公|政府|非牟利|顧問|finance|bank|insurance|securities|property|legal|accounting|technology|software|telecom|trading|logistics|manufacturing|industrial|corporate|enterprise|government|ngo|consulting|agency/i,
  },
];

/** 由 PMS 客戶行業標籤推算用途；沒有相符行業就回傳空陣列。 */
export function scenariosFromIndustries(industries: unknown): QuoteScenarioCode[] {
  if (!Array.isArray(industries)) return [];
  const found = new Set<QuoteScenarioCode>();
  for (const industry of industries) {
    const text = String(industry ?? '').trim();
    if (!text) continue;
    for (const rule of INDUSTRY_SCENARIO_RULES) {
      if (rule.pattern.test(text)) {
        found.add(rule.code);
        break;
      }
    }
  }
  return [...found];
}

type QuoteProjectDataLike = Record<string, unknown> | null | undefined;

function formDataOf(projectData: QuoteProjectDataLike): Record<string, unknown> {
  const form = projectData?.formData;
  return form && typeof form === 'object' && !Array.isArray(form)
    ? (form as Record<string, unknown>)
    : {};
}

/**
 * 本次推薦用途：客戶對應設計專案的工程類型優先；
 * 沒有工程類型時才用 PMS 客戶行業推算。
 * 兩者都沒有就回傳空陣列（顯示正常 A 類目錄）。
 */
export function resolveQuoteScenarios(
  projectData: QuoteProjectDataLike,
  engineeringType?: string | null,
): QuoteScenarioCode[] {
  const byProject = scenariosFromProjectType(engineeringType);
  if (byProject.length > 0) return byProject;
  return scenariosFromIndustries(formDataOf(projectData).clientIndustry);
}

export interface ScenarioMatchable {
  title?: string;
  level1Category?: string | null;
  level2Category?: string | null;
  category?: string | null;
  tags?: string[] | null;
}

/** 商品符合哪些用途（0 = 只屬於一般目錄）。 */
export function productScenarioMatches(
  product: ScenarioMatchable,
  codes: QuoteScenarioCode[],
): QuoteScenarioCode[] {
  if (codes.length === 0) return [];
  const tags = new Set((product.tags ?? []).map((tag) => String(tag).trim()));
  const haystack = [
    product.title,
    product.level1Category,
    product.level2Category,
    product.category,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');
  const matched: QuoteScenarioCode[] = [];
  for (const code of codes) {
    const scenario = SCENARIO_BY_CODE.get(code);
    if (!scenario) continue;
    if (scenario.productTags.some((tag) => tags.has(tag))) {
      matched.push(code);
      continue;
    }
    if (scenario.categoryKeywords.some((word) => haystack.includes(word.toLowerCase()))) {
      matched.push(code);
    }
  }
  return matched;
}

/**
 * 相關家具排序：符合越多指定用途越前；其餘商品保持原本目錄次序排在後面。
 * 不刪除任何商品，客戶仍可瀏覽其他分類。
 */
export function rankProductsForScenarios<T extends ScenarioMatchable>(
  products: T[],
  codes: QuoteScenarioCode[],
): T[] {
  if (codes.length === 0) return products;
  const scored = products.map((product, index) => ({
    product,
    index,
    score: productScenarioMatches(product, codes).length,
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map((row) => row.product);
}

/** 一、二級分類選項（保留目錄既有分類，不自行合併）。 */
export function categoryOptionsFromProducts<
  T extends { level1Category?: string | null; level2Category?: string | null },
>(products: T[]): { level1: string[]; level2: Record<string, string[]> } {
  const level1 = new Set<string>();
  const level2 = new Map<string, Set<string>>();
  for (const product of products) {
    const l1 = String(product.level1Category ?? '').trim();
    if (!l1) continue;
    level1.add(l1);
    const bucket = level2.get(l1) ?? new Set<string>();
    const l2 = String(product.level2Category ?? '').trim();
    if (l2) bucket.add(l2);
    level2.set(l1, bucket);
  }
  return {
    level1: [...level1].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    level2: Object.fromEntries(
      [...level2.entries()].map(([key, value]) => [
        key,
        [...value].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
      ]),
    ),
  };
}
