import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { LoadingImage } from "@/components/ui/loading-image";
import {
  buildExportItem,
  type CaseExportItem,
} from "@/lib/caseExport";
import {
  brandName,
  caseDate,
  imageUrl,
  matchesSystem,
  type CaseBrand,
} from "@/lib/caseShowcase";
import {
  EMPTY_CASE_LIST_FILTERS,
  matchesBrandListFilters,
  uniqueSorted,
  type CaseListFilterState,
} from "@/lib/caseListFilters";
import {
  CaseEmpty,
  CaseFilter,
  CaseListFilters,
  CasePagination,
  CaseShell,
  CaseSearch,
  useCaseData,
} from "./CaseShared";
import { CaseExportDialog } from "./CaseExportDialog";

const BRAND_PAGE_SIZE = 24;

export function CaseBrandsPage() {
  const data = useCaseData<CaseBrand>("brands");
  const [search, setSearch] = useState("");
  const [system, setSystem] = useState("");
  const [projectType, setProjectType] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [logo, setLogo] = useState("");
  const [listFilters, setListFilters] = useState<CaseListFilterState>(
    EMPTY_CASE_LIST_FILTERS,
  );
  const [page, setPage] = useState(1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportItems, setExportItems] = useState<CaseExportItem[] | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    urls: string[];
    index: number;
  } | null>(null);
  const filtered = useMemo(
    () =>
      data.items
        .filter(
          (b) =>
            matchesSystem(b.view_system, system) &&
            (!projectType || b.project_type_ids.includes(projectType)) &&
            (!serviceType || b.service_type_ids.includes(serviceType)) &&
            (!logo ||
              Boolean(imageUrl(b.branding_icon)) === (logo === "with")) &&
            matchesBrandListFilters(b, listFilters) &&
            [b.brand_name_cn, b.brand_name_en, b.company_name, b.display_name]
              .join(" ")
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .sort((a, b) => brandName(a).localeCompare(brandName(b), "zh-Hant")),
    [data.items, search, system, projectType, serviceType, logo, listFilters],
  );
  useEffect(() => {
    setPage(1);
    scrollContainerRef.current?.scrollTo({ top: 0 });
    setSelected(new Set());
    setPreview(null);
  }, [data.items, search, system, projectType, serviceType, logo, listFilters]);
  const selectable = filtered.filter((b) => imageUrl(b.branding_icon));
  const selectedRows = selectable.filter((b) => selected.has(b.id));
  const visibleBrands = filtered.slice(
    (page - 1) * BRAND_PAGE_SIZE,
    page * BRAND_PAGE_SIZE,
  );
  return (
    <CaseShell
      {...data}
      scrollContainerRef={scrollContainerRef}
      footer={
        filtered.length > BRAND_PAGE_SIZE ? (
          <CasePagination
            page={page}
            total={filtered.length}
            pageSize={BRAND_PAGE_SIZE}
            onChange={(nextPage) => {
              setPage(nextPage);
              scrollContainerRef.current?.scrollTo({ top: 0 });
            }}
          />
        ) : undefined
      }
      toolbar={
        <>
          <div className="space-y-3">
            <CaseSearch
              label="搜尋品牌"
              value={search}
              onChange={setSearch}
              placeholder="品牌名稱或公司名稱"
              onReload={data.reload}
              searchClassName="w-full sm:w-96 sm:flex-1"
              filtersClassName="sm:flex-none"
            >
              <CaseFilter
                label="系統"
                value={system}
                onChange={setSystem}
                options={["BWA", "BWF"]}
              />
              <CaseFilter
                label="項目類型"
                value={projectType}
                onChange={setProjectType}
                options={(data.project_types || []).map((o) => ({
                  value: o.id,
                  label: o.display,
                }))}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={!selectedRows.length}
                onClick={() =>
                  setExportItems(
                    selectedRows.map((b) => buildExportItem("brand", b.id, b)),
                  )
                }
              >
                <Send className="mr-2 h-4 w-4" />
                加入導出／發布（{selectedRows.length}）
              </Button>
            </CaseSearch>
            <div className="flex flex-wrap items-center gap-2">
              <CaseFilter
                label="服務類型"
                value={serviceType}
                onChange={setServiceType}
                options={(data.service_types || []).map((o) => ({
                  value: o.id,
                  label: o.display,
                }))}
              />
              <CaseFilter
                label="Logo"
                value={logo}
                onChange={setLogo}
                options={[
                  { value: "with", label: "有 Logo" },
                  { value: "without", label: "沒有 Logo" },
                ]}
              />
              <CaseListFilters
                state={listFilters}
                onChange={(patch) =>
                  setListFilters((current) => ({ ...current, ...patch }))
                }
                industries={uniqueSorted(
                  data.items.flatMap((brand) => brand.industries || []),
                )}
                furnitureTypes={uniqueSorted(
                  data.items.flatMap((brand) =>
                    (brand.filter_projects || []).flatMap(
                      (project) => project.furniture_types,
                    ),
                  ),
                )}
                brands={[]}
                showBrand={false}
              />
            </div>
            <p role="status" className="text-xs text-muted-foreground">
              共 {filtered.length} 個品牌
            </p>
          </div>
        </>
      }
    >
      {!filtered.length ? (
        <CaseEmpty />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleBrands.map((b) => {
            const url = imageUrl(b.branding_icon);
            const name = brandName(b);
            return (
              <li
                key={b.id}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="flex items-center justify-between px-4 pt-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      id={`case-brand-pick-${b.id}`}
                      aria-label={`選取 ${name} Logo`}
                      checked={selected.has(b.id)}
                      disabled={!url}
                      onCheckedChange={(checked) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (checked === true) next.add(b.id);
                          else next.delete(b.id);
                          return next;
                        })
                      }
                    />
                    <label htmlFor={`case-brand-pick-${b.id}`} className="cursor-pointer">
                      選取 Logo
                    </label>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {b.view_system || "未設定系統"}
                  </span>
                </div>
                <button
                  className="block w-full p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={!url}
                  aria-label={`放大 ${name} Logo`}
                  onClick={() =>
                    setPreview({ title: name, urls: [url!], index: 0 })
                  }
                >
                  <LoadingImage
                    src={url}
                    alt={`${name} Logo`}
                    loading="lazy"
                    decoding="async"
                    className="h-28 w-full"
                    imgClassName="bg-white object-contain"
                  />
                </button>
                <div className="space-y-2 border-t border-border px-4 py-3">
                  <p className="text-[15px] font-semibold leading-snug">
                    {name}
                  </p>
                  {b.brand_name_en && b.brand_name_en !== name && (
                    <p className="text-sm text-muted-foreground">
                      {b.brand_name_en}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    相關項目 {b.project_count} 個
                  </p>
                  {b.recent_projects.map((p) => (
                    <div key={p.id} className="text-xs">
                      <p>
                        {p.project_code || "—"} ·{" "}
                        {p.project_name || "未命名項目"}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        簽約：{caseDate(p.signed_date)}
                      </p>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ImageLightbox
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        images={preview?.urls ?? []}
        startIndex={preview?.index ?? 0}
        title={preview?.title}
        simple
      />
      <CaseExportDialog
        open={exportItems !== null}
        onOpenChange={(open) => !open && setExportItems(null)}
        items={exportItems || []}
        onChange={setExportItems}
      />
    </CaseShell>
  );
}
