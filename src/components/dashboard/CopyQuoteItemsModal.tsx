import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { BwfQuoteItemInput } from "@/lib/bwfQuoteItems";
import { loadQuoteLineItemsForPicker } from "@/lib/quoteCopy";
import {
  loadPitchingsForQuoteRows,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from "@/lib/pmsPitchings";
import { compareQuoteVersion, displayQuoteVersion } from "@/lib/quoteVersions";
import type { QuoteUiLabels } from "@/lib/quotationLocale";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type QuoteOptionRow = {
  id: string;
  quote_id: string;
  version: string;
  status: string | null;
  created_at: string | null;
  pitching: PmsPitchingListItem | null;
};

type QuoteChainOption = {
  quoteId: string;
  label: string;
  versions: QuoteOptionRow[];
};

const QUOTE_PICKER_SELECT =
  "id, quote_id, version, status, bwf_pitching_id, created_at";

function chainDisplayName(row: QuoteOptionRow): string {
  if (row.pitching) return pitchingDisplayTitle(row.pitching);
  return row.quote_id?.trim() || "—";
}

function formatItemDimensions(item: BwfQuoteItemInput): string {
  const parts = [item.dimensionLMm, item.dimensionWMm, item.dimensionHMm]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" × ") : "—";
}

function itemCategoryLabel(item: BwfQuoteItemInput, labels: QuoteUiLabels): string {
  if (item.isSectionTitle) {
    return item.name?.trim() || labels.sectionTitleLabel;
  }
  if (item.isCustomTerm) {
    return item.name?.trim() || labels.valueServiceDesc;
  }
  return item.category?.trim() || item.name?.trim() || "—";
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString();
}

function itemKey(item: BwfQuoteItemInput, index: number): string {
  return item.id?.trim() || `row-${index}`;
}

export function CopyQuoteItemsModal({
  open,
  onClose,
  onAddItems,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  onAddItems: (items: BwfQuoteItemInput[]) => void;
  labels: QuoteUiLabels;
}) {
  const [chains, setChains] = useState<QuoteChainOption[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [selectedVersionUuid, setSelectedVersionUuid] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [items, setItems] = useState<BwfQuoteItemInput[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());

  const resetPicker = useCallback(() => {
    setSelectedQuoteId("");
    setSelectedVersionUuid("");
    setItems([]);
    setSelectedKeys(new Set());
    setNameOpen(false);
    setNameQuery("");
  }, []);

  useEffect(() => {
    if (!open) {
      resetPicker();
      return;
    }
    let cancelled = false;
    setListLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("bwf_quote")
          .select(QUOTE_PICKER_SELECT)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const raw = (data || []) as Array<{
          id: string;
          quote_id: string;
          version: string;
          status: string | null;
          bwf_pitching_id: string | null;
          created_at: string | null;
        }>;
        const withPitching = await loadPitchingsForQuoteRows(raw);
        if (cancelled) return;

        const grouped = new Map<string, QuoteOptionRow[]>();
        for (const row of withPitching) {
          const quoteId = (row.quote_id || "").trim();
          if (!quoteId) continue;
          const list = grouped.get(quoteId) || [];
          list.push(row);
          grouped.set(quoteId, list);
        }

        const titleCounts = new Map<string, number>();
        for (const versions of grouped.values()) {
          versions.sort((a, b) => -compareQuoteVersion(a.version, b.version));
          const title = chainDisplayName(versions[0]);
          titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
        }

        const nextChains: QuoteChainOption[] = [...grouped.entries()].map(
          ([quoteId, versions]) => {
            const title = chainDisplayName(versions[0]);
            const label =
              (titleCounts.get(title) || 0) > 1 ? `${title} · ${quoteId}` : title;
            return { quoteId, label, versions };
          },
        );
        nextChains.sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
        setChains(nextChains);
      } catch (err: unknown) {
        if (!cancelled) {
          toast.error("載入報價單一覽失敗", {
            description: err instanceof Error ? err.message : "請稍後再試",
          });
          setChains([]);
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resetPicker]);

  const selectedChain = useMemo(
    () => chains.find((chain) => chain.quoteId === selectedQuoteId) ?? null,
    [chains, selectedQuoteId],
  );

  const filteredChains = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    if (!query) return chains;
    return chains.filter(
      (chain) =>
        chain.label.toLowerCase().includes(query) ||
        chain.quoteId.toLowerCase().includes(query),
    );
  }, [chains, nameQuery]);

  useEffect(() => {
    if (!selectedVersionUuid) {
      setItems([]);
      setSelectedKeys(new Set());
      return;
    }
    let cancelled = false;
    setItemsLoading(true);
    setSelectedKeys(new Set());
    void (async () => {
      try {
        const rows = await loadQuoteLineItemsForPicker(selectedVersionUuid);
        if (!cancelled) setItems(rows);
      } catch (err: unknown) {
        if (!cancelled) {
          toast.error("載入報價內容失敗", {
            description: err instanceof Error ? err.message : "請稍後再試",
          });
          setItems([]);
        }
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVersionUuid]);

  const handleSelectName = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setNameOpen(false);
    setNameQuery("");
    const chain = chains.find((row) => row.quoteId === quoteId);
    const latest = chain?.versions[0];
    setSelectedVersionUuid(latest?.id || "");
  };

  const toggleKey = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const allKeys = items.map((item, index) => itemKey(item, index));
  const allSelected = allKeys.length > 0 && allKeys.every((key) => selectedKeys.has(key));

  const addItems = (rows: BwfQuoteItemInput[]) => {
    if (rows.length === 0) return;
    onAddItems(rows);
  };

  const addSelected = () => {
    const rows = items.filter((item, index) => selectedKeys.has(itemKey(item, index)));
    addItems(rows);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] w-[min(1100px,calc(100vw-1.5rem))] max-w-none flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{labels.copyFromOtherQuoteTitle}</DialogTitle>
          <DialogDescription>{labels.copyFromOtherQuoteHint}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label className="font-body text-xs font-medium text-muted-foreground">
              {labels.copyFromOtherQuoteName}
            </label>
            <div className="space-y-1.5">
              <button
                type="button"
                disabled={listLoading}
                onClick={() => setNameOpen((prev) => !prev)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 font-body text-sm text-foreground disabled:opacity-60"
              >
                <span className="truncate">
                  {listLoading
                    ? labels.copyFromOtherQuoteLoading
                    : selectedChain?.label || labels.copyFromOtherQuotePickName}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </button>
              {nameOpen ? (
                <div className="overflow-hidden rounded-md border border-border bg-popover shadow-sm">
                  <input
                    type="text"
                    autoFocus
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    placeholder={labels.copyFromOtherQuoteSearch}
                    className="h-9 w-full border-b border-border bg-transparent px-3 font-body text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <div className="max-h-[220px] overflow-y-auto">
                    {filteredChains.length === 0 ? (
                      <p className="px-3 py-6 text-center font-body text-sm text-muted-foreground">
                        沒有符合的提案
                      </p>
                    ) : (
                      filteredChains.map((chain) => (
                        <button
                          type="button"
                          key={chain.quoteId}
                          onClick={() => handleSelectName(chain.quoteId)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left font-body text-sm hover:bg-accent",
                            selectedQuoteId === chain.quoteId && "bg-accent",
                          )}
                        >
                          <Check
                            className={cn(
                              "h-4 w-4 shrink-0",
                              selectedQuoteId === chain.quoteId ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">{chain.label}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <label className="font-body text-xs font-medium text-muted-foreground">
              {labels.copyFromOtherQuoteVersion}
            </label>
            <Select
              value={selectedVersionUuid || undefined}
              onValueChange={setSelectedVersionUuid}
              disabled={!selectedChain}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder={labels.copyFromOtherQuotePickVersion} />
              </SelectTrigger>
              <SelectContent>
                {(selectedChain?.versions || []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {displayQuoteVersion(row.version)}
                    {row.status ? ` · ${row.status}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          {!selectedQuoteId ? (
            <p className="px-4 py-10 text-center font-body text-sm text-muted-foreground">
              {labels.copyFromOtherQuotePickName}
            </p>
          ) : itemsLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 font-body text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {labels.copyFromOtherQuoteLoading}
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center font-body text-sm text-muted-foreground">
              {labels.copyFromOtherQuoteEmpty}
            </p>
          ) : (
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(value) => {
                        setSelectedKeys(value === true ? new Set(allKeys) : new Set());
                      }}
                      aria-label="全選"
                    />
                  </th>
                  <th className="px-2 py-2 font-body font-medium text-muted-foreground">
                    {labels.category}
                  </th>
                  <th className="px-2 py-2 font-body font-medium text-muted-foreground">
                    {labels.dimensionsMm}
                  </th>
                  <th className="px-2 py-2 font-body font-medium text-muted-foreground">
                    {labels.image}
                  </th>
                  <th className="px-2 py-2 font-body font-medium text-muted-foreground">
                    {labels.cnyCost}
                  </th>
                  <th className="px-2 py-2 font-body font-medium text-muted-foreground">
                    {labels.hkdUnitPrice}
                  </th>
                  <th className="px-2 py-2 font-body font-medium text-muted-foreground">
                    {labels.factory}
                  </th>
                  <th className="px-2 py-2 text-right font-body font-medium text-muted-foreground">
                    {labels.copyFromOtherQuoteAdd}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const key = itemKey(item, index);
                  const checked = selectedKeys.has(key);
                  return (
                    <tr
                      key={key}
                      className={cn(
                        "border-b border-border/70 last:border-0",
                        checked ? "bg-primary/5" : "bg-background",
                      )}
                    >
                      <td className="px-3 py-2 align-middle">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleKey(key, value === true)}
                          aria-label={`選擇第 ${index + 1} 項`}
                        />
                      </td>
                      <td className="max-w-[180px] px-2 py-2 align-middle font-body text-foreground">
                        <span className="line-clamp-2">{itemCategoryLabel(item, labels)}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-middle font-mono-data text-foreground">
                        {item.isSectionTitle || item.isCustomTerm
                          ? "—"
                          : formatItemDimensions(item)}
                      </td>
                      <td className="px-2 py-2 align-middle">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt=""
                            className="h-10 w-10 rounded-md border border-border object-cover"
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-middle font-mono-data">
                        {item.isSectionTitle ? "—" : formatMoney(item.costPrice)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-middle font-mono-data">
                        {item.isSectionTitle ? "—" : formatMoney(item.unitPrice)}
                      </td>
                      <td className="max-w-[140px] truncate px-2 py-2 align-middle font-body">
                        {item.isSectionTitle || item.isCustomTerm
                          ? "—"
                          : item.factoryName?.trim() || "—"}
                      </td>
                      <td className="px-2 py-2 text-right align-middle">
                        <button
                          type="button"
                          onClick={() => addItems([item])}
                          className="rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1 font-body text-xs font-medium text-primary hover:bg-primary/10"
                        >
                          {labels.copyFromOtherQuoteAdd}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 font-body text-sm text-foreground hover:bg-muted"
          >
            {labels.copyFromOtherQuoteClose}
          </button>
          <button
            type="button"
            disabled={selectedKeys.size === 0}
            onClick={addSelected}
            className="rounded-md bg-primary px-3 py-1.5 font-body text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {labels.copyFromOtherQuoteAddSelected}
            {selectedKeys.size > 0 ? ` (${selectedKeys.size})` : ""}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
