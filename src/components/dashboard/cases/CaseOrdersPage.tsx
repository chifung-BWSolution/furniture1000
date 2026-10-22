import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { caseDate, type CaseOrder } from "@/lib/caseShowcase";
import {
  CaseEmpty,
  CaseFilter,
  CasePagination,
  CaseShell,
  useCaseData,
} from "./CaseShared";

export function CaseOrdersPage() {
  const data = useCaseData<CaseOrder>("orders");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pm, setPm] = useState("");
  const [factory, setFactory] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(
    () =>
      data.items.filter(
        (r) =>
          (!status || r.status === status) &&
          (!pm || r.pm_name === pm) &&
          (!factory || r.factory_name === factory) &&
          [
            r.project_code,
            r.project_name,
            r.product_name,
            r.factory_name,
            r.pm_name,
          ]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [data.items, search, status, pm, factory],
  );
  useEffect(() => setPage(1), [search, status, pm, factory, data.items]);
  const options = (key: "status" | "pm_name" | "factory_name") =>
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
      title="訂單數據"
      description="按 PMS 訂單列出產品、工廠及交付進度。"
      icon={ClipboardList}
      {...data}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-52 flex-[2] flex-col gap-1 text-sm">
          <span className="text-muted-foreground">搜尋訂單</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="項目編號、名稱、產品、工廠或 PM"
          />
        </label>
        <CaseFilter
          label="訂單狀態"
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
          label="工廠"
          value={factory}
          onChange={setFactory}
          options={options("factory_name")}
        />
        <Button
          variant="ghost"
          onClick={() => {
            setSearch("");
            setStatus("");
            setPm("");
            setFactory("");
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <caption className="sr-only">PMS 訂單及交付進度</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {[
                  "項目",
                  "PM",
                  "產品",
                  "數量",
                  "工廠",
                  "訂單狀態",
                  "預計到場",
                  "預計安裝",
                  "實際安裝",
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered
                .slice((currentPage - 1) * 20, currentPage * 20)
                .map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="max-w-64 px-4 py-3">
                      <p className="font-medium">{r.project_code || "—"}</p>
                      <p className="mt-1 text-muted-foreground">
                        {r.project_name || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3">{r.pm_name || "—"}</td>
                    <td className="max-w-64 px-4 py-3">
                      {r.product_name || "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {r.quantity ?? "—"}
                    </td>
                    <td className="px-4 py-3">{r.factory_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="whitespace-nowrap rounded bg-muted px-2 py-1 text-xs">
                        {r.status || "未設定"}
                      </span>
                    </td>
                    {[
                      r.est_delivery_date,
                      r.est_installation_date,
                      r.actual_installation_date,
                    ].map((date, i) => (
                      <td
                        key={i}
                        className="whitespace-nowrap px-4 py-3 tabular-nums"
                      >
                        {caseDate(date)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 20 && (
        <CasePagination
          page={currentPage}
          total={filtered.length}
          onChange={setPage}
        />
      )}
    </CaseShell>
  );
}
