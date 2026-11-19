import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, FileText, Package, Plus, Save, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CompactEmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProductSelectorModal } from './ProductSelectorModal';
import { RfqQuotePickerModal } from './RfqQuotePickerModal';
import {
  RFQ_CURRENCIES,
  hkDateTimeLocalToIso,
  publishRfq,
  reviseRfq,
  saveRfqDraft,
  stripFactorySortName,
  toHkDateTimeLocal,
  type RfqDetail,
  type RfqDraftItem,
  type RfqDraftInvitation,
} from '@/lib/rfq';
import { RFQ_LIST_PATH, buildRfqDetailPath } from '@/lib/appSectionRoutes';
import { loadDirectoryFactories, type DirectoryFactory } from '@/lib/supplierLogins';

type EditorMode = 'create' | 'draft' | 'revise';

interface EditorItem {
  key: string;
  name: string;
  model: string;
  quantity: string;
  unit: string;
  specifications: string;
  dimensions: string;
  image_url: string;
  product_id: string | null;
  source_quote_id: string | null;
  source_quote_item_id: string | null;
}

interface RfqEditorViewProps {
  mode?: EditorMode;
  detail?: RfqDetail | null;
  onCancel?: () => void;
  onSaved?: (id: string) => void;
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyItem(): EditorItem {
  return {
    key: newKey(),
    name: '',
    model: '',
    quantity: '1',
    unit: '',
    specifications: '',
    dimensions: '',
    image_url: '',
    product_id: null,
    source_quote_id: null,
    source_quote_item_id: null,
  };
}

function fromDraftItem(item: RfqDraftItem): EditorItem {
  return {
    key: newKey(),
    name: item.name,
    model: item.model ?? '',
    quantity: String(item.quantity ?? 1),
    unit: item.unit ?? '',
    specifications: item.specifications ?? '',
    dimensions: item.dimensions ?? '',
    image_url: item.image_url ?? '',
    product_id: item.product_id ?? null,
    source_quote_id: item.source_quote_id ?? null,
    source_quote_item_id: item.source_quote_item_id ?? null,
  };
}

function toPayloadItem(item: EditorItem): RfqDraftItem {
  return {
    name: item.name.trim(),
    model: item.model.trim() || null,
    quantity: Number(item.quantity),
    unit: item.unit.trim() || null,
    specifications: item.specifications.trim() || null,
    dimensions: item.dimensions.trim() || null,
    image_url: item.image_url.trim() || null,
    product_id: item.product_id,
    source_quote_id: item.source_quote_id,
    source_quote_item_id: item.source_quote_item_id,
  };
}

export function RfqEditorView({
  mode = 'create',
  detail = null,
  onCancel,
  onSaved,
}: RfqEditorViewProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [closeAt, setCloseAt] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<EditorItem[]>([emptyItem()]);
  const [invitations, setInvitations] = useState<RfqDraftInvitation[]>([]);
  const [factories, setFactories] = useState<DirectoryFactory[]>([]);
  const [factoryToAdd, setFactoryToAdd] = useState('');
  const [quotePickerOpen, setQuotePickerOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) {
      return;
    }
    setTitle(detail.rfq.title);
    setCurrency(detail.rfq.currency);
    setCloseAt(toHkDateTimeLocal(detail.rfq.close_at));
    setNotes(detail.rfq.notes ?? '');
    setItems(
      detail.items.length > 0
        ? detail.items.map((item) =>
            fromDraftItem({
              name: item.name,
              model: item.model,
              quantity: item.quantity,
              unit: item.unit,
              specifications: item.specifications,
              dimensions: item.dimensions,
              image_url: item.image_url,
              product_id: item.product_id,
              source_quote_id: item.source_quote_id,
              source_quote_item_id: item.source_quote_item_id,
            }),
          )
        : [emptyItem()],
    );
    setInvitations(
      detail.invitations.map((invitation) => ({
        factory_id: invitation.factory_id,
        factory_name: invitation.factory_name,
        contact_email: invitation.contact_email,
      })),
    );
  }, [detail?.rfq.id]);

  useEffect(() => {
    if (mode === 'revise') return;
    let cancelled = false;
    void loadDirectoryFactories().then((result) => {
      if (cancelled) return;
      setFactories(result.factories);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const currencyOptions = useMemo(() => {
    const list: string[] = [...RFQ_CURRENCIES];
    if (currency && !list.includes(currency)) list.push(currency);
    return list;
  }, [currency]);

  const updateItem = (key: string, patch: Partial<EditorItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const removeItem = (key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  };

  const addFactory = () => {
    const factory = factories.find((row) => row.id === factoryToAdd);
    if (!factory) return;
    setInvitations((current) => {
      if (current.some((row) => row.factory_id === factory.id)) return current;
      return [
        ...current,
        {
          factory_id: factory.id,
          factory_name: stripFactorySortName(factory.name) || factory.name,
          contact_email: null,
        },
      ];
    });
    setFactoryToAdd('');
  };

  const validate = (requireClose: boolean): string | null => {
    if (!title.trim()) return '請填 RFQ 標題。';
    if (!/^[A-Z]{3}$/.test(currency.trim())) return '幣別格式不正確。';
    if (requireClose && !closeAt) return '請填截止時間。';
    if (items.length === 0) return '至少要有一行項目。';
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.name.trim()) return `第 ${index + 1} 行未有項目名稱。`;
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `第 ${index + 1} 行的數量必須大於 0。`;
      }
    }
    if (mode !== 'revise' && invitations.length === 0) {
      return '至少要邀請一家廠家。';
    }
    return null;
  };

  const finish = (id: string) => {
    if (onSaved) onSaved(id);
    else navigate(buildRfqDetailPath(id));
  };

  const save = async (publish: boolean) => {
    const message = validate(publish || mode === 'revise');
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payloadItems = items.map(toPayloadItem);
      const closeIso = hkDateTimeLocalToIso(closeAt);

      if (mode === 'revise' && detail) {
        const result = await reviseRfq(detail.rfq.id, {
          title: title.trim(),
          currency,
          close_at: closeIso,
          notes: notes.trim() || null,
          items: payloadItems,
        });
        if (result.error) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success(`已升為修訂 R${result.revision ?? ''}`, {
          description: '舊連結已失效，請為每家廠重新複製連結。',
        });
        finish(detail.rfq.id);
        return;
      }

      const saved = await saveRfqDraft(
        mode === 'draft' && detail ? detail.rfq.id : null,
        {
          title: title.trim(),
          currency,
          close_at: closeIso,
          notes: notes.trim() || null,
          items: payloadItems,
          invitations,
        },
      );
      if (saved.error || !saved.id) {
        setError(saved.error || '未能儲存 RFQ。');
        toast.error(saved.error || '未能儲存 RFQ。');
        return;
      }

      if (publish) {
        const published = await publishRfq(saved.id);
        if (published.error) {
          setError(published.error);
          toast.error(`已存草稿，但未發布：${published.error}`);
          finish(saved.id);
          return;
        }
        toast.success('RFQ 已發布', {
          description: '請為每家受邀廠複製連結，並自行傳給對方。',
        });
      } else {
        toast.success('已儲存草稿', { description: `編號 ${saved.rfqNo ?? ''}` });
      }
      finish(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    else if (detail) navigate(buildRfqDetailPath(detail.rfq.id));
    else navigate(RFQ_LIST_PATH);
  };

  const heading =
    mode === 'create' ? '建立 RFQ' : mode === 'draft' ? '編輯 RFQ 草稿' : `修改 RFQ（升為 R${(detail?.rfq.revision ?? 0) + 1}）`;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <button
                type="button"
                onClick={handleCancel}
                className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                返回
              </button>
              <h1 className="fds-page-title">
                <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
                {heading}
              </h1>
              <p className="fds-page-description">
                項目可手填、從報價版本加入，或從產品目錄加入。只複製產品資料，不複製任何價格。
              </p>
            </div>
            {detail && (
              <Badge variant="outline" className="font-mono">
                {detail.rfq.rfq_no}
              </Badge>
            )}
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}

        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <p className="text-base font-semibold">基本資料</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium sm:col-span-2">
              RFQ 標題 <span className="text-destructive">*</span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：2026 年展廳沙發詢價"
                className="mt-1.5 h-10"
                maxLength={300}
              />
            </label>
            <div className="block text-sm font-medium">
              幣別 <span className="text-destructive">*</span>
              <Select
                value={currency}
                onValueChange={setCurrency}
                disabled={mode === 'revise'}
              >
                <SelectTrigger className="mt-1.5 h-10" aria-label="RFQ 幣別">
                  <SelectValue placeholder="選擇幣別" />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === 'revise' ? (
                <span className="mt-1 block text-xs text-muted-foreground">
                  發布後幣別已凍結；要改幣別請另開一張 RFQ。
                </span>
              ) : null}
            </div>
            <label className="block text-sm font-medium">
              截止時間（香港時間）
              {mode === 'revise' ? <span className="text-destructive"> *</span> : null}
              <Input
                type="datetime-local"
                value={closeAt}
                onChange={(event) => setCloseAt(event.target.value)}
                className="mt-1.5 h-10"
              />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              備註
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="給廠家的補充說明（不會顯示客戶資料）"
                className="mt-1.5 min-h-[80px]"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-base font-semibold">項目</p>
              <p className="text-xs text-muted-foreground">
                名稱、數量必填；廠家回價時不能改這些欄位。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => setItems((current) => [...current, emptyItem()])}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                新增一行
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => setQuotePickerOpen(true)}
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                從報價加入
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => setProductPickerOpen(true)}
              >
                <Package className="h-4 w-4" aria-hidden="true" />
                從產品目錄加入
              </Button>
            </div>
          </div>

          {items.length === 0 ? (
            <CompactEmptyState
              icon={Plus}
              title="還沒有項目"
              description="新增一行，或從報價／產品目錄加入。"
            />
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="w-8 px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">名稱 *</th>
                    <th className="px-3 py-2 font-medium">型號</th>
                    <th className="w-24 px-3 py-2 font-medium">數量 *</th>
                    <th className="w-20 px-3 py-2 font-medium">單位</th>
                    <th className="px-3 py-2 font-medium">規格</th>
                    <th className="px-3 py-2 font-medium">尺寸</th>
                    <th className="px-3 py-2 font-medium">參考圖 URL</th>
                    <th className="w-12 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.key} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{index + 1}</td>
                      <td className="px-3 py-2">
                        <Input
                          value={item.name}
                          onChange={(event) => updateItem(item.key, { name: event.target.value })}
                          placeholder="傢俬名稱"
                          className="h-9 min-w-[150px]"
                        />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.source_quote_item_id ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">報價行</span>
                          ) : null}
                          {item.product_id ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">目錄產品</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={item.model}
                          onChange={(event) => updateItem(item.key, { model: event.target.value })}
                          placeholder="型號"
                          className="h-9 min-w-[110px]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={item.quantity}
                          onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                          className="h-9"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={item.unit}
                          onChange={(event) => updateItem(item.key, { unit: event.target.value })}
                          placeholder="件"
                          className="h-9"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Textarea
                          value={item.specifications}
                          onChange={(event) => updateItem(item.key, { specifications: event.target.value })}
                          placeholder="材質、顏色、做法"
                          className="min-h-[36px] min-w-[180px]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={item.dimensions}
                          onChange={(event) => updateItem(item.key, { dimensions: event.target.value })}
                          placeholder="L × W × H"
                          className="h-9 min-w-[120px]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={item.image_url}
                          onChange={(event) => updateItem(item.key, { image_url: event.target.value })}
                          placeholder="https://…"
                          className="h-9 min-w-[180px]"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          aria-label={`刪除第 ${index + 1} 行`}
                          onClick={() => removeItem(item.key)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-base font-semibold">受邀廠家</p>
              <p className="text-xs text-muted-foreground">
                一張 RFQ、一個修訂、一家廠一條連結。第一期不代發信。
              </p>
            </div>
          </div>

          {mode === 'revise' ? (
            <div className="mt-4 space-y-2">
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                修訂沿用同一批廠家。儲存後 revision 會加一，所有舊連結即時失效；請為每家廠重新複製連結。
              </p>
              <div className="flex flex-wrap gap-2">
                {invitations.map((invitation) => (
                  <Badge key={invitation.factory_id} variant="outline" className="gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {invitation.factory_name || invitation.factory_id}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-[240px] flex-1">
                  <Select value={factoryToAdd} onValueChange={setFactoryToAdd}>
                    <SelectTrigger className="h-10" aria-label="選擇受邀廠家">
                      <SelectValue placeholder="選擇廠家" />
                    </SelectTrigger>
                    <SelectContent>
                      {factories
                        .filter(
                          (factory) =>
                            !invitations.some((invitation) => invitation.factory_id === factory.id),
                        )
                        .map((factory) => (
                          <SelectItem key={factory.id} value={factory.id}>
                            {factory.name}
                            {factory.code ? ` (${factory.code})` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 gap-1.5"
                  disabled={!factoryToAdd}
                  onClick={addFactory}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  加入廠家
                </Button>
              </div>

              {invitations.length === 0 ? (
                <CompactEmptyState
                  icon={Building2}
                  title="未邀請廠家"
                  description="發布前至少需要一家廠家。"
                />
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {invitations.map((invitation) => (
                    <li
                      key={invitation.factory_id}
                      className="flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-sm"
                    >
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      <span>{invitation.factory_name || invitation.factory_id}</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`移除 ${invitation.factory_name}`}
                        onClick={() =>
                          setInvitations((current) =>
                            current.filter((row) => row.factory_id !== invitation.factory_id),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-end gap-2 pb-6">
          <Button type="button" variant="ghost" onClick={handleCancel} disabled={saving}>
            取消
          </Button>
          {mode === 'revise' ? (
            <Button
              type="button"
              className="h-10 gap-2"
              onClick={() => void save(false)}
              disabled={saving}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? '儲存中…' : '儲存修訂'}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2"
                onClick={() => void save(false)}
                disabled={saving}
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                儲存草稿
              </Button>
              <Button
                type="button"
                className="h-10 gap-2"
                onClick={() => void save(true)}
                disabled={saving}
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {saving ? '處理中…' : '儲存並發布'}
              </Button>
            </>
          )}
        </div>
      </div>

      <RfqQuotePickerModal
        open={quotePickerOpen}
        onClose={() => setQuotePickerOpen(false)}
        onAdd={(rows) => {
          setItems((current) => {
            const next = [...current];
            if (next.length === 1 && !next[0].name.trim() && next[0].quantity === '1') next.pop();
            return [...next, ...rows.map(fromDraftItem)];
          });
        }}
      />

      <ProductSelectorModal
        open={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        onSelect={(products) => {
          const mapped: RfqDraftItem[] = products.map((product) => {
            const dimensions = [
              product.dimensionLMm,
              product.dimensionWMm,
              product.dimensionHMm,
            ]
              .filter((value) => value != null && String(value).trim() !== '')
              .join(' × ');
            const specifications = [product.material, product.color, product.remarks]
              .filter((value) => (value || '').trim() !== '')
              .join(' · ');
            return {
              name: (product.name || '').trim() || '未命名產品',
              model: (product.sku || '').trim() || null,
              quantity: 1,
              unit: null,
              specifications: specifications || null,
              dimensions: dimensions || null,
              image_url: (product.image || '').trim() || null,
              product_id: product.productId ?? null,
              source_quote_id: null,
              source_quote_item_id: null,
            };
          });
          setItems((current) => {
            const next = [...current];
            if (next.length === 1 && !next[0].name.trim() && next[0].quantity === '1') next.pop();
            return [...next, ...mapped.map(fromDraftItem)];
          });
          setProductPickerOpen(false);
        }}
      />
    </div>
  );
}
