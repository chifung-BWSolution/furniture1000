import { supabase } from "@/lib/supabase";

export type CaseKind = "orders" | "photos" | "brands";
export interface CaseOrder {
  id: string;
  project_id: string;
  project_code: string | null;
  project_name: string | null;
  pm_name: string | null;
  product_name: string | null;
  factory_name: string | null;
  quantity: number | null;
  status: string | null;
  est_delivery_date: string | null;
  est_installation_date: string | null;
  actual_installation_date: string | null;
}
export interface CasePhotoProject {
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
  const { data, error } = await supabase.functions.invoke(
    "supabase-functions-fetch-bwa-works",
    {
      body: { action: `cases-${kind}` },
      signal,
    },
  );
  if (error) {
    let message = "資料載入失敗，請稍後重試。";
    try {
      const details = await error.context?.json();
      if (details?.error) message = details.error;
    } catch {
      /* Non-JSON gateway error. */
    }
    throw new Error(message);
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
