export interface CaseListFilterState {
  industry: string;
  furniture: string;
  priceMin: string;
  priceMax: string;
  dateFrom: string;
  dateTo: string;
  brand: string;
}

export const EMPTY_CASE_LIST_FILTERS: CaseListFilterState = {
  industry: "",
  furniture: "",
  priceMin: "",
  priceMax: "",
  dateFrom: "",
  dateTo: "",
  brand: "",
};

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(
    (a, b) => a.localeCompare(b, "zh-Hant"),
  );
}

/** Calendar date in Hong Kong, YYYY-MM-DD, for range comparisons. */
export function hkDateKey(raw: string | null | undefined): string {
  if (!raw || Number.isNaN(Date.parse(raw))) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(raw));
}

function priceInRange(
  value: number | null | undefined,
  min: string,
  max: string,
): boolean {
  const hasMin = min.trim() !== "";
  const hasMax = max.trim() !== "";
  if (!hasMin && !hasMax) return true;
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return false;
  const amount = Number(value);
  if (hasMin && amount < Number(min)) return false;
  if (hasMax && amount > Number(max)) return false;
  return true;
}

function dateInRange(
  raw: string | null | undefined,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;
  const key = hkDateKey(raw);
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

export function matchesProjectListFilters(
  row: {
    industries?: string[] | null;
    furniture_types?: string[] | null;
    estimated_income?: number | null;
    signed_date?: string | null;
    famous_brand?: string | null;
  },
  filters: CaseListFilterState,
  options?: { brand?: boolean },
): boolean {
  if (filters.industry && !(row.industries || []).includes(filters.industry))
    return false;
  if (
    filters.furniture &&
    !(row.furniture_types || []).includes(filters.furniture)
  )
    return false;
  if (options?.brand !== false && filters.brand && row.famous_brand !== filters.brand)
    return false;
  if (!priceInRange(row.estimated_income, filters.priceMin, filters.priceMax))
    return false;
  if (!dateInRange(row.signed_date, filters.dateFrom, filters.dateTo))
    return false;
  return true;
}

export function matchesBrandListFilters(
  brand: {
    industries?: string[] | null;
    filter_projects?: {
      signed_date: string | null;
      estimated_income: number | null;
      furniture_types: string[];
    }[] | null;
  },
  filters: CaseListFilterState,
): boolean {
  if (filters.industry && !(brand.industries || []).includes(filters.industry))
    return false;
  const needsProject =
    Boolean(filters.furniture) ||
    filters.priceMin.trim() !== "" ||
    filters.priceMax.trim() !== "" ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);
  if (!needsProject) return true;
  return (brand.filter_projects || []).some(
    (project) =>
      (!filters.furniture ||
        project.furniture_types.includes(filters.furniture)) &&
      priceInRange(project.estimated_income, filters.priceMin, filters.priceMax) &&
      dateInRange(project.signed_date, filters.dateFrom, filters.dateTo),
  );
}
