import { invokeEdgeFunctionDirect } from "@/lib/invokeEdgeFunction";

export type CaseKind = "orders" | "photos" | "brands";

/** Project-list columns shared by 項目列表 and 完工相片 (from PMS bwf_projects). */
export interface CaseProjectListFields {
  signed_date?: string | null;
  service_type?: string | null;
  bu_code?: string | null;
  customer_name?: string | null;
  p2_code?: string | null;
  estimated_income?: number | null;
  estimated_profit?: number | null;
  designer_name?: string | null;
  project_status?: string | null;
  industries?: string[];
  famous_brand?: string | null;
  furniture_types?: string[];
}

export interface CaseOrder extends CaseProjectListFields {
  id: string;
  project_id: string;
  project_code: string | null;
  project_name: string | null;
  pm_name: string | null;
  /** 專案完工相片（對外材料，導出／發布用；舊版 edge function 無此欄位回 undefined）。 */
  completion_photos?: string | null;
  product_name: string | null;
  factory_name: string | null;
  quantity: number | null;
  product_type: string | null;
  status: string | null;
  production_start_date: string | null;
  production_finish_date_est: string | null;
  production_finish_date: string | null;
  est_delivery_date: string | null;
  actual_delivery_date: string | null;
  est_installation_date: string | null;
  actual_installation_date: string | null;
  delivery_target: string | null;
  installation_team_name: string | null;
  installer_needed: boolean | null;
  remarks: string | null;
}
export interface CasePhotoProject extends CaseProjectListFields {
  id: string;
  project_code: string | null;
  project_name: string | null;
  status: string | null;
  real_customer_display_name: string | null;
  pm_name: string | null;
  designer_name: string | null;
  financial_year: string | null;
  completion_photos: string | null;
  site_address: string | null;
  handover_date: string | null;
  modified_date: string | null;
}
export interface CaseBrand {
  id: string;
  brand_name_cn: string | null;
  brand_name_en: string | null;
  company_name: string | null;
  display_name: string | null;
  branding_icon: string | null;
  view_system: string | null;
  project_count: number;
  recent_projects: {
    id: string;
    project_code: string | null;
    project_name: string | null;
    signed_date: string | null;
  }[];
  project_type_ids: string[];
  service_type_ids: string[];
  industries?: string[];
  /** BWF projects used by the shared amount / date / furniture filters. */
  filter_projects?: {
    signed_date: string | null;
    estimated_income: number | null;
    furniture_types: string[];
  }[];
}
export interface CaseResult<T> {
  items: T[];
  project_types?: { id: string; display: string }[];
  service_types?: { id: string; display: string }[];
}

export async function fetchCaseShowcase<T>(
  kind: CaseKind,
  signal?: AbortSignal,
): Promise<CaseResult<T>> {
  // NOTE: do not use supabase.functions.invoke() here — the locked
  // @supabase/functions-js (2.4.x) has no `signal` option, so passing one
  // fails the type check on a clean install / CI build.
  const { data, error } = await invokeEdgeFunctionDirect<
    CaseResult<T> & { action?: string; error?: string }
  >(
    "supabase-functions-fetch-bwa-works",
    { action: `cases-${kind}` },
    { signal },
  );
  if (error) {
    throw new Error(error.message || "資料載入失敗，請稍後重試。");
  }
  if (data?.error) throw new Error(String(data.error));
  // An older function returns BWA selector rows. Never display those as cases.
  if (data?.action !== `cases-${kind}` || !Array.isArray(data?.items))
    throw new Error("案例資料服務尚未更新，請聯絡管理員。");
  return data;
}

export function imageUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim();
  if (!url) return null;
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  try {
    return ["https:", "http:"].includes(new URL(normalized).protocol)
      ? normalized
      : null;
  } catch {
    return null;
  }
}
export function photoUrls(raw: string | null | undefined): string[] {
  return [
    ...new Set(
      (raw || "")
        .split(",")
        .map(imageUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ];
}
export function brandName(b: CaseBrand): string {
  return (
    b.brand_name_cn ||
    b.brand_name_en ||
    b.company_name ||
    b.display_name ||
    "未命名品牌"
  );
}
const PROJECT_STATUS_LABELS: Record<string, string> = {
  "Work In Progress": "進行中",
  "Project Done": "已完成",
  "Case Closed": "已結案",
};

export function projectStatusLabel(status: string | null | undefined): string {
  if (!status) return "未設定";
  return PROJECT_STATUS_LABELS[status] || status;
}

export function caseMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "—";
  return `$${Number(value).toLocaleString("en-HK", { maximumFractionDigits: 0 })}`;
}

export function caseDate(raw: string | null | undefined): string {
  if (!raw || Number.isNaN(Date.parse(raw))) return "—";
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(raw));
}
export function matchesSystem(value: string | null, filter: string): boolean {
  if (!filter) return true;
  return (
    filter === "BWA"
      ? ["BWA", "Both", "PMS", "PMS,BWF2", "BWF2,PMS"]
      : ["BWF", "Both", "BWF2", "PMS,BWF2", "BWF2,PMS"]
  ).includes(value || "");
}
