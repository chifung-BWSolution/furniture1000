import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  fetchCaseShowcase,
  type CaseKind,
  type CaseResult,
} from "@/lib/caseShowcase";
import type { CaseListFilterState } from "@/lib/caseListFilters";

export function useCaseData<T>(kind: CaseKind) {
  const [result, setResult] = useState<CaseResult<T>>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult({ items: [] });
    fetchCaseShowcase<T>(kind, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "載入失敗");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, revision]);
  return { ...result, loading, error, reload: () => setRevision((n) => n + 1) };
}

export function CaseShell({
  loading,
  error,
  toolbar,
  scrollContainerRef,
  footer,
  children,
}: {
  loading: boolean;
  error: string;
  toolbar?: ReactNode;
  scrollContainerRef?: RefObject<HTMLDivElement>;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="h-full min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col fds-page-padding">
        {loading ? (
          <div
            role="status"
            className="flex min-h-0 flex-1 items-center justify-center gap-2 text-muted-foreground"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            載入中…
          </div>
        ) : error ? (
          <div className="min-h-0 flex-1">
            <ErrorState description={error} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {toolbar ? <div className="shrink-0 pb-3">{toolbar}</div> : null}
            <div
              ref={scrollContainerRef}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <div className="space-y-4">{children}</div>
            </div>
            {footer ? <div className="shrink-0 pt-3">{footer}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function CaseFilter({
  label,
  value,
  onChange,
  options,
  includeAll = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | { value: string; label: string }[];
  includeAll?: boolean;
}) {
  return (
    <Select
      value={value || "__all__"}
      onValueChange={(next) => onChange(next === "__all__" ? "" : next)}
    >
      <SelectTrigger aria-label={label} className="w-40 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeAll && <SelectItem value="__all__">全部{label}</SelectItem>}
        {options.map((option) => {
          const item =
            typeof option === "string"
              ? { value: option, label: option }
              : option;
          return (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function CaseListFilters({
  state,
  onChange,
  industries,
  furnitureTypes,
  brands,
  showBrand = true,
  showFurniture = true,
}: {
  state: CaseListFilterState;
  onChange: (patch: Partial<CaseListFilterState>) => void;
  industries: string[];
  furnitureTypes: string[];
  brands: string[];
  showBrand?: boolean;
  showFurniture?: boolean;
}) {
  return (
    <>
      <CaseFilter
        label="行業"
        value={state.industry}
        onChange={(industry) => onChange({ industry })}
        options={industries}
      />
      {showFurniture && (
        <CaseFilter
          label="傢俬類型"
          value={state.furniture}
          onChange={(furniture) => onChange({ furniture })}
          options={furnitureTypes}
        />
      )}
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        aria-label="項目金額最少"
        placeholder="金額最少"
        value={state.priceMin}
        onChange={(event) => onChange({ priceMin: event.target.value })}
        className="h-9 w-28 text-sm"
      />
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        aria-label="項目金額最多"
        placeholder="金額最多"
        value={state.priceMax}
        onChange={(event) => onChange({ priceMax: event.target.value })}
        className="h-9 w-28 text-sm"
      />
      <Input
        type="date"
        aria-label="訂單日期由"
        value={state.dateFrom}
        onChange={(event) => onChange({ dateFrom: event.target.value })}
        className="h-9 w-36 text-sm"
      />
      <Input
        type="date"
        aria-label="訂單日期至"
        value={state.dateTo}
        onChange={(event) => onChange({ dateTo: event.target.value })}
        className="h-9 w-36 text-sm"
      />
      {showBrand ? (
        <CaseFilter
          label="知名品牌"
          value={state.brand}
          onChange={(brand) => onChange({ brand })}
          options={brands}
        />
      ) : null}
    </>
  );
}

export function CaseSearch({
  label,
  value,
  onChange,
  placeholder,
  onReload,
  searchClassName = "w-80",
  filtersClassName = "flex-1",
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onReload: () => void;
  searchClassName?: string;
  filtersClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className={`relative max-w-full min-w-0 ${searchClassName}`}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="pl-8 text-sm"
        />
      </div>
      {children ? (
        <div className={`flex min-w-0 max-w-full flex-wrap items-center gap-2 ${filtersClassName}`}>
          {children}
        </div>
      ) : (
        <div className="min-w-0 flex-1" />
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onReload}
        className="h-9 w-9 shrink-0"
        aria-label="重新整理"
        title="重新整理"
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function CasePagination({
  page,
  total,
  pageSize = 20,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav
      aria-label="案例分頁"
      className="flex items-center justify-center gap-2 text-sm"
    >
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="上一頁"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span role="status" className="tabular-nums">
        {page} / {pages}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="下一頁"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
export function CaseEmpty() {
  return <EmptyState />;
}
