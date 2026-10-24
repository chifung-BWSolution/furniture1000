import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  LayoutGrid,
  List,
  MapPin,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { LoadingImage } from "@/components/ui/loading-image";
import {
  buildExportItem,
  type CaseExportItem,
} from "@/lib/caseExport";
import { caseDate, photoUrls, type CasePhotoProject } from "@/lib/caseShowcase";
import {
  CaseEmpty,
  CasePagination,
  CaseShell,
  CaseSearch,
  CaseFilter,
  useCaseData,
} from "./CaseShared";
import { CaseExportDialog } from "./CaseExportDialog";

const PAGE_SIZE = 20;

type ViewMode = "grid" | "list";
type SortMode =
  "handover-desc" | "handover-asc" | "project-asc" | "customer-asc";

interface PhotoProjectCardProps {
  project: CasePhotoProject;
  urls: string[];
  viewMode: ViewMode;
  picked: boolean;
  onPick: (projectId: string, picked: boolean) => void;
  onOpenAlbum: (projectId: string) => void;
  onOpenPhoto: (project: CasePhotoProject, index: number) => void;
}

function PhotoStrip({
  urls,
  title,
  onOpenPhoto,
}: {
  urls: string[];
  title: string;
  onOpenPhoto: (index: number) => void;
}) {
  const hasOverflow = urls.length > 3;

  return (
    <div
      role="group"
      className="grid grid-cols-4 gap-1.5"
      aria-label={`${urls.length} 張完工相片`}
    >
      {urls.slice(0, 3).map((url, index) => (
        <button
          key={`${url}-${index}`}
          type="button"
          onClick={() => onOpenPhoto(index)}
          aria-label={`放大 ${title} 第 ${index + 1} 張相片`}
          className="group relative h-[60px] min-w-0 overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <LoadingImage
            src={url}
            alt={`${title} 第 ${index + 1} 張`}
            loading="lazy"
            decoding="async"
            className="h-full w-full"
            imgClassName="object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
          />
        </button>
      ))}
      {hasOverflow && (
        <button
          type="button"
          onClick={() => onOpenPhoto(3)}
          aria-label={`還有 ${urls.length - 3} 張相片，開啟相片瀏覽`}
          className="flex h-[60px] min-w-0 items-center justify-center rounded-md bg-foreground/70 text-sm font-semibold text-background transition-colors hover:bg-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          +{urls.length - 3}
        </button>
      )}
    </div>
  );
}

function PhotoProjectCard({
  project,
  urls,
  viewMode,
  picked,
  onPick,
  onOpenAlbum,
  onOpenPhoto,
}: PhotoProjectCardProps) {
  const projectCode =
    project.project_code || project.project_name || "未命名項目";
  const customer = project.real_customer_display_name || "未設定客戶";
  const title = `${projectCode} · ${customer}`;

  const details = (
    <button
      type="button"
      onClick={() => onOpenAlbum(project.id)}
      aria-label={`開啟 ${title} 完整相簿`}
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="w-full min-w-0">
        <span
          title={projectCode}
          className="block w-full truncate text-sm font-semibold leading-5 text-foreground"
        >
          {projectCode}
        </span>
      </div>
      <span
        title={customer}
        className="mt-0.5 block w-full truncate text-sm font-medium leading-5"
      >
        {customer}
      </span>
      <span className="mt-2 grid w-full grid-cols-2 gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">PM：{project.pm_name || "未設定"}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            交付：{caseDate(project.handover_date)}
          </span>
        </span>
        <span className="col-span-2 flex min-w-0 items-start gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span
            title={project.site_address || "未設定地址"}
            className="whitespace-normal break-words"
          >
            {project.site_address || "未設定地址"}
          </span>
        </span>
      </span>
    </button>
  );

  if (viewMode === "list") {
    return (
      <article className="relative flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 md:flex-row md:items-center">
        <div className="absolute left-2 top-2 z-10">
          <PickBox project={project} picked={picked} onPick={onPick} />
        </div>
        {details}
        <div className="w-full md:w-[300px] md:shrink-0">
          <PhotoStrip
            urls={urls}
            title={title}
            onOpenPhoto={(index) => onOpenPhoto(project, index)}
          />
        </div>
      </article>
    );
  }

  return (
    <article className="relative flex min-h-[220px] min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-primary/40">
      <div className="absolute left-2 top-2 z-10">
        <PickBox project={project} picked={picked} onPick={onPick} />
      </div>
      {details}
      <PhotoStrip
        urls={urls}
        title={title}
        onOpenPhoto={(index) => onOpenPhoto(project, index)}
      />
    </article>
  );
}

function PickBox({
  project,
  picked,
  onPick,
}: {
  project: CasePhotoProject;
  picked: boolean;
  onPick: (projectId: string, picked: boolean) => void;
}) {
  return (
    <span
      className="rounded-md border border-border bg-background/85 p-1 shadow-sm"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Checkbox
        aria-label={`選取專案 ${project.project_code || project.project_name || ""}`}
        checked={picked}
        onCheckedChange={(checked) => onPick(project.id, checked === true)}
      />
    </span>
  );
}

function PhotoAlbum({
  project,
  urls,
  onBack,
  onOpenPhoto,
}: {
  project: CasePhotoProject;
  urls: string[];
  onBack: () => void;
  onOpenPhoto: (project: CasePhotoProject, index: number) => void;
}) {
  const projectCode =
    project.project_code || project.project_name || "未命名項目";
  const customer = project.real_customer_display_name || "未設定客戶";
  const title = `${projectCode} · ${customer}`;

  return (
    <section className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        返回專案列表
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold">{projectCode}</h2>
          <p className="mt-1 whitespace-normal break-words text-sm font-medium">
            {customer}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              PM：{project.pm_name || "未設定"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="whitespace-normal break-words">
                {project.site_address || "未設定地址"}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              交付：{caseDate(project.handover_date)}
            </span>
          </div>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          {project.status || "未設定狀態"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        完整相簿 · {urls.length} 張相片
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
        {urls.map((url, index) => (
          <button
            key={`${url}-${index}`}
            type="button"
            onClick={() => onOpenPhoto(project, index)}
            aria-label={`放大 ${title} 第 ${index + 1} 張相片`}
            className="group relative overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <LoadingImage
              src={url}
              alt={`${title} 第 ${index + 1} 張`}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full"
              imgClassName="object-cover transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none"
            />
          </button>
        ))}
      </div>
    </section>
  );
}

export function CasePhotosPage() {
  const data = useCaseData<CasePhotoProject>("photos");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pm, setPm] = useState("");
  const [year, setYear] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("handover-desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [page, setPage] = useState(1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exportItems, setExportItems] = useState<CaseExportItem[] | null>(null);
  const [lightbox, setLightbox] = useState<{
    title: string;
    urls: string[];
    index: number;
  } | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return data.items
      .filter(
        (project) =>
          photoUrls(project.completion_photos).length > 0 &&
          (!status || project.status === status) &&
          (!pm || project.pm_name === pm) &&
          (!year || project.financial_year === year) &&
          [
            project.project_code,
            project.project_name,
            project.real_customer_display_name,
            project.site_address,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term),
      )
      .sort((a, b) => {
        if (sortMode === "project-asc")
          return (a.project_code || a.project_name || "").localeCompare(
            b.project_code || b.project_name || "",
            "zh-Hant",
          );
        if (sortMode === "customer-asc")
          return (a.real_customer_display_name || "").localeCompare(
            b.real_customer_display_name || "",
            "zh-Hant",
          );

        const aDate = a.handover_date ? Date.parse(a.handover_date) : NaN;
        const bDate = b.handover_date ? Date.parse(b.handover_date) : NaN;
        const normalizedA = Number.isNaN(aDate) ? -Infinity : aDate;
        const normalizedB = Number.isNaN(bDate) ? -Infinity : bDate;
        const dateOrder =
          sortMode === "handover-desc"
            ? normalizedB - normalizedA
            : normalizedA - normalizedB;
        if (dateOrder !== 0 && !Number.isNaN(dateOrder)) return dateOrder;
        return (a.project_code || "").localeCompare(b.project_code || "");
      });
  }, [data.items, search, status, pm, year, sortMode]);

  useEffect(() => {
    setPage(1);
    scrollContainerRef.current?.scrollTo({ top: 0 });
    setLightbox(null);
    setActiveAlbumId(null);
  }, [data.items, search, status, pm, year, sortMode]);
  useEffect(() => {
    setPicked(new Set());
  }, [search, status, pm, year, sortMode]);
  const openExport = () => {
    setExportItems(
      data.items
        .filter(
          (project) =>
            picked.has(project.id) &&
            photoUrls(project.completion_photos).length > 0,
        )
        .map((project) => buildExportItem("photo", project.id, project)),
    );
  };

  const options = (key: "status" | "pm_name" | "financial_year") =>
    [
      ...new Set(
        data.items
          .map((project) => project[key])
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const visibleItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeAlbum = data.items.find(
    (project) => project.id === activeAlbumId,
  );
  const activeAlbumUrls = activeAlbum
    ? photoUrls(activeAlbum.completion_photos)
    : [];

  const openLightbox = (project: CasePhotoProject, index: number) => {
    const urls = photoUrls(project.completion_photos);
    setLightbox({
      title: [project.project_code, project.real_customer_display_name]
        .filter(Boolean)
        .join(" · "),
      urls,
      index,
    });
  };

  return (
    <CaseShell
      {...data}
      scrollContainerRef={scrollContainerRef}
      footer={
        !activeAlbum && filtered.length > PAGE_SIZE ? (
          <CasePagination
            page={page}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onChange={(nextPage) => {
              setPage(nextPage);
              scrollContainerRef.current?.scrollTo({ top: 0 });
            }}
          />
        ) : undefined
      }
      toolbar={
        !activeAlbum ? (
          <>
            <div className="space-y-3">
              <CaseSearch
                label="搜尋專案"
                value={search}
                onChange={setSearch}
                placeholder="項目編號、名稱、客戶或地址"
                onReload={data.reload}
              >
                <CaseFilter
                  label="項目狀態"
                  value={status}
                  onChange={setStatus}
                  options={options("status")}
                />
                <CaseFilter
                  label="PM"
                  value={pm}
                  onChange={setPm}
                  options={options("pm_name")}
                />
                <CaseFilter
                  label="財政年度"
                  value={year}
                  onChange={setYear}
                  options={options("financial_year")}
                />
                <CaseFilter
                  label="排序"
                  value={sortMode}
                  onChange={(value) => setSortMode(value as SortMode)}
                  includeAll={false}
                  options={[
                    { value: "handover-desc", label: "交付日期（最新）" },
                    { value: "handover-asc", label: "交付日期（最早）" },
                    { value: "project-asc", label: "項目編號" },
                    { value: "customer-asc", label: "客戶名稱" },
                  ]}
                />
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                    size="icon"
                    className="h-9 w-9"
                    aria-label="格狀檢視"
                    aria-pressed={viewMode === "grid"}
                    title="格狀檢視"
                    onClick={() => setViewMode("grid")}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="icon"
                    className="h-9 w-9"
                    aria-label="列表檢視"
                    aria-pressed={viewMode === "list"}
                    title="列表檢視"
                    onClick={() => setViewMode("list")}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
                {(search || status || pm || year) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2 text-sm"
                    onClick={() => {
                      setSearch("");
                      setStatus("");
                      setPm("");
                      setYear("");
                    }}
                  >
                    清除篩選
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={!picked.size}
                  onClick={openExport}
                >
                  <Download className="mr-2 h-4 w-4" />
                  導出已選（{picked.size}）
                </Button>
              </CaseSearch>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <p role="status">共 {filtered.length} 個專案</p>
                {viewMode === "grid" && (
                  <p className="hidden text-xs sm:block">
                    每張卡片顯示最多 3 張相片
                  </p>
                )}
              </div>
            </div>
          </>
        ) : undefined
      }
    >
      {activeAlbum ? (
        <PhotoAlbum
          project={activeAlbum}
          urls={activeAlbumUrls}
          onBack={() => setActiveAlbumId(null)}
          onOpenPhoto={openLightbox}
        />
      ) : (
        <>
          {!filtered.length ? (
            <CaseEmpty />
          ) : (
            <div
              className={
                viewMode === "grid"
                  ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  : "space-y-2"
              }
            >
              {visibleItems.map((project) => (
                <PhotoProjectCard
                  key={project.id}
                  project={project}
                  urls={photoUrls(project.completion_photos)}
                  viewMode={viewMode}
                  picked={picked.has(project.id)}
                  onPick={(id, next) =>
                    setPicked((old) => {
                      const nextSet = new Set(old);
                      if (next) nextSet.add(id);
                      else nextSet.delete(id);
                      return nextSet;
                    })
                  }
                  onOpenAlbum={setActiveAlbumId}
                  onOpenPhoto={openLightbox}
                />
              ))}
            </div>
          )}
        </>
      )}
      <ImageLightbox
        open={Boolean(lightbox)}
        onClose={() => setLightbox(null)}
        images={lightbox?.urls ?? []}
        startIndex={lightbox?.index ?? 0}
        title={lightbox?.title}
        thumbWidth={160}
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
