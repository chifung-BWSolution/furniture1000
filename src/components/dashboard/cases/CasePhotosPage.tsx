import { useEffect, useMemo, useState } from "react";
import { Images } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { caseDate, photoUrls, type CasePhotoProject } from "@/lib/caseShowcase";
import {
  CaseEmpty,
  CaseFilter,
  CaseImage,
  CaseLightbox,
  CasePagination,
  CaseShell,
  useCaseData,
} from "./CaseShared";

export function CasePhotosPage() {
  const data = useCaseData<CasePhotoProject>("photos");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pm, setPm] = useState("");
  const [year, setYear] = useState("");
  const [page, setPage] = useState(1);
  const [lightbox, setLightbox] = useState<{
    title: string;
    urls: string[];
    index: number;
  } | null>(null);
  const filtered = useMemo(
    () =>
      data.items.filter(
        (p) =>
          photoUrls(p.completion_photos).length &&
          (!status || p.status === status) &&
          (!pm || p.pm_name === pm) &&
          (!year || p.financial_year === year) &&
          [
            p.project_code,
            p.project_name,
            p.real_customer_display_name,
            p.site_address,
          ]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [data.items, search, status, pm, year],
  );
  useEffect(() => {
    setPage(1);
    setLightbox(null);
  }, [data.items, search, status, pm, year]);
  const options = (key: "status" | "pm_name" | "financial_year") =>
    [
      ...new Set(
        data.items.map((r) => r[key]).filter((s): s is string => Boolean(s)),
      ),
    ].sort();
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / 20)),
  );
  return (
    <CaseShell
      title="完工相片"
      description="按 PMS 項目檢視完工相片，點擊相片可放大瀏覽。"
      icon={Images}
      {...data}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-52 flex-[2] flex-col gap-1 text-sm">
          <span className="text-muted-foreground">搜尋項目</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="項目編號、名稱、客戶或地址"
          />
        </label>
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
        <Button
          variant="ghost"
          onClick={() => {
            setSearch("");
            setStatus("");
            setPm("");
            setYear("");
          }}
        >
          清除篩選
        </Button>
      </div>
      <CasePagination
        page={currentPage}
        total={filtered.length}
        onChange={setPage}
      />
      {!filtered.length ? (
        <CaseEmpty />
      ) : (
        <div className="space-y-5">
          {filtered.slice((currentPage - 1) * 20, currentPage * 20).map((p) => {
            const urls = photoUrls(p.completion_photos);
            const title =
              [p.project_code, p.project_name].filter(Boolean).join(" · ") ||
              "未命名項目";
            return (
              <section
                key={p.id}
                className="overflow-hidden rounded-lg border border-border"
              >
                <div className="flex flex-wrap justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <div>
                    <h2 className="font-medium">{title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {p.real_customer_display_name || "未設定客戶"} ·{" "}
                      {p.site_address || "未設定地址"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      PM：{p.pm_name || "—"} · 設計師：{p.designer_name || "—"}{" "}
                      · 交付：{caseDate(p.handover_date)}
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {p.status || "未設定狀態"} · {urls.length} 張
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-5">
                  {urls.slice(0, 5).map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setLightbox({ title, urls, index })}
                      aria-label={`放大 ${title} 第 ${index + 1} 張相片`}
                      className="group relative overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <CaseImage
                        src={url}
                        alt={`${title} 第 ${index + 1} 張`}
                        className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none"
                      />
                      {index === 4 && urls.length > 5 && (
                        <span className="absolute inset-x-0 bottom-0 bg-black/75 py-1 text-sm text-white">
                          另有 {urls.length - 5} 張
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {filtered.length > 20 && (
        <CasePagination
          page={currentPage}
          total={filtered.length}
          onChange={setPage}
        />
      )}
      <CaseLightbox
        value={lightbox}
        onClose={() => setLightbox(null)}
        onIndex={(index) =>
          setLightbox((current) => (current ? { ...current, index } : null))
        }
      />
    </CaseShell>
  );
}
