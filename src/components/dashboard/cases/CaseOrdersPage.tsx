import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import {
  buildExportItem,
  type CaseExportItem,
} from "@/lib/caseExport";
import { caseDate, type CaseOrder } from "@/lib/caseShowcase";
import {
  CaseEmpty,
  CaseFilter,
  CasePagination,
  CaseShell,
  CaseSearch,
  useCaseData,
} from "./CaseShared";
import { CaseExportDialog } from "./CaseExportDialog";

const ORDERS_PAGE_SIZE = 20;

export function CaseOrdersPage() {
  const data = useCaseData<CaseOrder>("orders");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [pm, setPm] = useState("");
  const [factory, setFactory] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<CaseOrder[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exportItems, setExportItems] = useState<CaseExportItem[] | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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
  const grouped = useMemo(() => {
    const matchingKeys = new Set(
      filtered.map((item) => `${item.project_id}:${item.project_code || ""}`),
    );
    const groups = new Map<string, CaseOrder[]>();
    for (const item of data.items) {
      // PMS project code is the displayed order number; project ID keeps
      // same-numbered projects from being merged accidentally.
      const key = `${item.project_id}:${item.project_code || ""}`;
      if (!matchingKeys.has(key)) continue;
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.values()];
  }, [data.items, filtered]);
  useEffect(() => {
    setPage(1);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [search, status, pm, factory, data.items]);
  useEffect(() => {
    setPicked(new Set());
  }, [search, status, pm, factory]);
  const openExport = () => {
    setExportItems(
      grouped
        .filter((items) => picked.has(`${items[0].project_id}:${items[0].project_code || ""}`))
        .map((items) =>
          buildExportItem(
            "order",
            `${items[0].project_id}:${items[0].project_code || ""}`,
            items,
          ),
        ),
    );
  };
  const options = (key: "status" | "pm_name" | "factory_name") =>
    [
      ...new Set(
        data.items.map((r) => r[key]).filter((s): s is string => Boolean(s)),
      ),
    ].sort();
  const visibleGroups = grouped.slice(
    (page - 1) * ORDERS_PAGE_SIZE,
    page * ORDERS_PAGE_SIZE,
  );
  return (
    <CaseShell
      {...data}
      scrollContainerRef={scrollContainerRef}
      footer={
        grouped.length > ORDERS_PAGE_SIZE ? (
          <CasePagination
            page={page}
            total={grouped.length}
            pageSize={ORDERS_PAGE_SIZE}
            onChange={(nextPage) => {
              setPage(nextPage);
              scrollContainerRef.current?.scrollTo({ top: 0 });
            }}
          />
        ) : undefined
      }
      toolbar={
        <div className="space-y-3">
          <CaseSearch
            label="搜尋訂單"
            value={search}
            onChange={setSearch}
            placeholder="項目編號、名稱、產品、工廠或 PM"
            onReload={data.reload}
          >
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
              size="sm"
              className="h-9 text-sm"
              onClick={() => {
                setSearch("");
                setStatus("");
                setPm("");
                setFactory("");
              }}
            >
              清除篩選
            </Button>
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
          <div className="text-xs text-muted-foreground" role="status">
            共 {grouped.length} 個項目
          </div>
        </div>
      }
    >
      {!filtered.length ? (
        <CaseEmpty />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[950px] text-left text-xs">
            <caption className="sr-only">
              PMS 訂單及交付進度，點擊訂單查看產品明細
            </caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {[
                  "",
                  "項目",
                  "PM",
                  "產品數",
                  "總數量",
                  "工廠",
                  "訂單狀態",
                  "預計到場",
                  "預計安裝",
                  "實際安裝",
                ].map((h, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2.5 text-[11px] font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleGroups.map((items) => {
                const r = items[0];
                const rowKey = `${r.project_id}:${r.project_code || ""}`;
                const factories = [
                  ...new Set(items.map((x) => x.factory_name).filter(Boolean)),
                ];
                const statuses = [
                  ...new Set(items.map((x) => x.status).filter(Boolean)),
                ];
                const quantities = items
                  .map((x) => x.quantity)
                  .filter((x): x is number => x !== null);
                const totalQuantity = quantities.length
                  ? quantities.reduce((sum, n) => sum + n, 0)
                  : null;
                return (
                  <tr
                    key={rowKey}
                    className="cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    tabIndex={0}
                    onClick={() => setSelectedOrder(items)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedOrder(items);
                      }
                    }}
                    aria-label={`查看訂單 ${r.project_code || r.project_name || "詳情"}`}
                  >
                    <td
                      className="px-3 py-3"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        aria-label={`選取訂單 ${r.project_code || r.project_name || ""}`}
                        checked={picked.has(rowKey)}
                        onCheckedChange={(checked) =>
                          setPicked((old) => {
                            const next = new Set(old);
                            if (checked === true) next.add(rowKey);
                            else next.delete(rowKey);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="max-w-64 px-3 py-3">
                      <p className="font-medium">{r.project_code || "—"}</p>
                      <p className="mt-1 text-muted-foreground">
                        {r.project_name || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-3">{r.pm_name || "—"}</td>
                    <td className="px-3 py-3">{items.length}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {totalQuantity ?? "—"}
                    </td>
                    <td className="px-3 py-3">{factories.join("、") || "—"}</td>
                    <td className="px-3 py-3">
                      <span className="whitespace-nowrap rounded bg-muted px-2 py-1 text-xs">
                        {statuses.length === 1
                          ? statuses[0]
                          : statuses.length
                            ? "多種狀態"
                            : "未設定"}
                      </span>
                    </td>
                    {[
                      items
                        .map((x) => x.est_delivery_date)
                        .filter(Boolean)
                        .sort()
                        .at(-1) || null,
                      items
                        .map((x) => x.est_installation_date)
                        .filter(Boolean)
                        .sort()
                        .at(-1) || null,
                      items
                        .map((x) => x.actual_installation_date)
                        .filter(Boolean)
                        .sort()
                        .at(-1) || null,
                    ].map((date, i) => (
                      <td
                        key={i}
                        className="whitespace-nowrap px-3 py-3 tabular-nums"
                      >
                        {caseDate(date)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={selectedOrder !== null}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        size="3xl"
        title={`訂單詳情 · ${selectedOrder?.[0]?.project_code || selectedOrder?.[0]?.project_name || "—"}`}
        description={`${selectedOrder?.[0]?.project_name || "—"}　·　PM：${selectedOrder?.[0]?.pm_name || "—"}`}
      >
        <div className="max-h-[65vh] space-y-4 overflow-auto pr-1">
          {selectedOrder?.map((item, index) => (
            <section key={item.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
                <div>
                  <h3 className="font-semibold">
                    {item.product_name || "未指定產品"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.product_type || "產品類型未設定"} · 第 {index + 1} 項
                  </p>
                </div>
                <span className="rounded bg-muted px-2 py-1 text-sm">
                  數量 {item.quantity ?? "—"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <OrderDetailField
                  label="廠商 Factory"
                  value={item.factory_name}
                />
                <OrderDetailField label="狀態 Status" value={item.status} />
                <OrderDetailField
                  label="生產開始日期"
                  value={caseDate(item.production_start_date)}
                />
                <OrderDetailField
                  label="預計生產完結日期"
                  value={caseDate(item.production_finish_date_est)}
                />
                <OrderDetailField
                  label="實際生產完結日期"
                  value={caseDate(item.production_finish_date)}
                />
                <OrderDetailField
                  label="送貨目標 Factory Delivery Target"
                  value={deliveryTargetLabel(item.delivery_target)}
                />
                <OrderDetailField
                  label="預計送貨到場日期"
                  value={caseDate(item.est_delivery_date)}
                />
                <OrderDetailField
                  label="實際送貨到場日期"
                  value={caseDate(item.actual_delivery_date)}
                />
                <OrderDetailField
                  label="預計完成安裝日期"
                  value={caseDate(item.est_installation_date)}
                />
                <OrderDetailField
                  label="實際完成安裝日期"
                  value={caseDate(item.actual_installation_date)}
                />
                <OrderDetailField
                  label="需要安排安裝"
                  value={
                    item.installer_needed === null
                      ? "—"
                      : item.installer_needed
                        ? "是"
                        : "否"
                  }
                />
                <OrderDetailField
                  label="安裝團隊"
                  value={item.installation_team_name}
                />
                <div className="sm:col-span-2 lg:col-span-3">
                  <OrderDetailField label="備註 Remarks" value={item.remarks} />
                </div>
              </div>
            </section>
          ))}
        </div>
      </Modal>
      <CaseExportDialog
        open={exportItems !== null}
        onOpenChange={(open) => !open && setExportItems(null)}
        items={exportItems || []}
        onChange={setExportItems}
      />
    </CaseShell>
  );
}

function deliveryTargetLabel(value: string | null): string {
  if (value === "Factory") return "廠商 Factory";
  if (value === "Warehouse") return "倉庫 Warehouse";
  if (value === "Client") return "客戶 Client";
  return value || "—";
}

function OrderDetailField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">
        {value || "—"}
      </p>
    </div>
  );
}
