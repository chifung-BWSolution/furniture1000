import { useEffect, useMemo, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CompactEmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import type { RfqDraftItem } from '@/lib/rfq';

interface QuoteRow {
  id: string;
  quote_id: string;
  version: string | null;
  status: string | null;
  created_at: string | null;
  client_name: string | null;
}

interface QuoteItemRow {
  id: string;
  sort_order: number | null;
  name: string;
  sku: string | null;
  quantity: number | string | null;
  unit: string | null;
  category: string | null;
  material: string | null;
  color: string | null;
  remarks: string | null;
  dimension_l_mm: string | number | null;
  dimension_w_mm: string | number | null;
  dimension_h_mm: string | number | null;
  image: string | null;
  reference_image: string | null;
  product_id: string | null;
  is_section_title: boolean | null;
}

interface RfqQuotePickerModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (items: RfqDraftItem[]) => void;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dimensionsOf(row: QuoteItemRow): string | null {
  const parts = [row.dimension_l_mm, row.dimension_w_mm, row.dimension_h_mm]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(' × ') : null;
}

function specificationsOf(row: QuoteItemRow): string | null {
  const parts = [row.category, row.material, row.color, row.remarks]
    .map((value) => (value || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function toDraftItem(row: QuoteItemRow): RfqDraftItem {
  return {
    name: row.name.trim(),
    model: (row.sku || '').trim() || null,
    quantity: Math.max(numberOrNull(row.quantity) ?? 1, 0.0001),
    unit: (row.unit || '').trim() || null,
    specifications: specificationsOf(row),
    dimensions: dimensionsOf(row),
    image_url: (row.image || row.reference_image || '').trim() || null,
    product_id: row.product_id || null,
    source_quote_id: null,
    source_quote_item_id: row.id,
  };
}

export function RfqQuotePickerModal({ open, onClose, onAdd }: RfqQuotePickerModalProps) {
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quoteId, setQuoteId] = useState('');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [items, setItems] = useState<QuoteItemRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingQuotes(true);
    setError(null);
    void supabase
      .from('bwf_quote')
      .select(
        'id,quote_id,version,status,created_at,client_name:project_data->formData->>clientName',
      )
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          setError(loadError.message);
          setQuotes([]);
        } else {
          setQuotes((data || []) as unknown as QuoteRow[]);
        }
        setLoadingQuotes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !quoteId) {
      setItems([]);
      setSelectedIds(new Set());
      return;
    }
    let cancelled = false;
    setLoadingItems(true);
    setError(null);
    void supabase
      .from('bwf_quote_item')
      .select(
        'id,sort_order,name,sku,quantity,unit,category,material,color,remarks,dimension_l_mm,dimension_w_mm,dimension_h_mm,image,reference_image,product_id,is_section_title',
      )
      .eq('quote_uuid', quoteId)
      .order('sort_order', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          setError(loadError.message);
          setItems([]);
        } else {
          const rows = ((data || []) as unknown as QuoteItemRow[]).filter(
            (row) => !row.is_section_title && (row.name || '').trim() !== '',
          );
          setItems(rows);
          setSelectedIds(new Set(rows.map((row) => row.id)));
        }
        setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, quoteId]);

  const visibleQuotes = useMemo(() => {
    const term = quoteSearch.trim().toLowerCase();
    if (!term) return quotes;
    return quotes.filter((row) =>
      [row.quote_id, row.version, row.client_name, row.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [quotes, quoteSearch]);

  const selectedCount = selectedIds.size;
  const allSelected = items.length > 0 && selectedCount === items.length;

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(items.map((row) => row.id)));
  };

  const addSelected = () => {
    const picked = items.filter((row) => selectedIds.has(row.id)).map(toDraftItem);
    if (picked.length === 0) return;
    const quote = quotes.find((row) => row.id === quoteId);
    onAdd(
      picked.map((item) => ({
        ...item,
        source_quote_id: quote?.id ?? null,
      })),
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="4xl"
      title="從報價加入項目"
      description="只複製名稱、型號、數量、單位、尺寸、規格與參考圖；不會複製售價、成本或毛利。"
      icon={<FileText className="h-5 w-5" />}
      footer={
        <>
          <ModalButton variant="secondary" onClick={onClose}>
            取消
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={addSelected}
            disabled={selectedCount === 0}
          >
            加入 {selectedCount} 行
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <label className="block text-sm font-medium">
            搜尋報價
            <div className="relative mt-1.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={quoteSearch}
                onChange={(event) => setQuoteSearch(event.target.value)}
                placeholder="客戶、報價編號、版本"
                className="h-9 pl-9"
              />
            </div>
          </label>
          <div className="block text-sm font-medium">
            報價版本
            <Select value={quoteId} onValueChange={setQuoteId}>
              <SelectTrigger className="mt-1.5 h-9" aria-label="選擇報價版本">
                <SelectValue placeholder={loadingQuotes ? '讀取報價…' : '選擇一個報價版本'} />
              </SelectTrigger>
              <SelectContent>
                {visibleQuotes.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {[
                      row.client_name || row.quote_id,
                      row.version ? `v${String(row.version).replace(/^v/i, '')}` : '',
                      row.status || '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {quoteId && items.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={toggleAll}
              >
                {allSelected ? '取消全選' : '全選'}
              </button>
              <span className="text-xs text-muted-foreground">
                已選 {selectedCount} / {items.length} 行
              </span>
            </div>
            <div className="max-h-[48vh] overflow-y-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2 font-medium">名稱</th>
                    <th className="px-3 py-2 font-medium">型號</th>
                    <th className="px-3 py-2 text-right font-medium">數量</th>
                    <th className="px-3 py-2 font-medium">單位</th>
                    <th className="px-3 py-2 font-medium">尺寸</th>
                    <th className="px-3 py-2 font-medium">規格</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const checked = selectedIds.has(row.id);
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border/60 last:border-b-0 hover:bg-muted/30"
                        onClick={() => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          });
                        }}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={checked}
                            aria-label={`選擇 ${row.name}`}
                            onCheckedChange={(value) => {
                              setSelectedIds((current) => {
                                const next = new Set(current);
                                if (value === true) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium">{row.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.sku || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.quantity ?? '—'}</td>
                        <td className="px-3 py-2">{row.unit || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{dimensionsOf(row) || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{specificationsOf(row) || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <CompactEmptyState
            icon={FileText}
            title={loadingItems ? '讀取報價行…' : quoteId ? '這個版本沒有可加入的行' : '先選一個報價版本'}
            description="項目只會複製產品資料，不會帶入任何價格。"
          />
        )}

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">不複製售價</Badge>
          <Badge variant="outline">不複製成本</Badge>
          <Badge variant="outline">不複製毛利</Badge>
        </div>
      </div>
    </Modal>
  );
}
