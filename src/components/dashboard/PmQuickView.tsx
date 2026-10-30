import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link, useSearchParams } from 'react-router-dom';
import { PM_BUDGET_PATH } from '@/content/bwaPm';
import { useAuth } from '@/contexts/AuthProvider';
import { usePmsStaffName } from '@/hooks/use-pms-staff-name';
import { Plus, Eye, Save, Search, Trash2, ArrowLeft, FileText } from 'lucide-react';
import {
  formatHkMoney,
  getPmQuickQuote,
  pmQuoteErrorMessage,
  pmQuoteItemsTotal,
  savePmQuickQuote,
} from '@/lib/pmQuickQuote';
import { searchBwaWorks, type BwaWorkOption } from '@/lib/bwaWorks';
import { Button } from '@/components/ui/button';

import { QuotationPDFPreviewModal } from './QuotationPDFPreview';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import { DEFAULT_COMPANY_ADDRESS, DEFAULT_COMPANY_WEBSITE } from '@/lib/quotationLocale';
import { DEFAULT_QUOTE_COMPANY_PHONE, resolveQuoteCompanyPhone } from '@/lib/quoteCompanyPhone';
import { ProductSelectorModal } from './ProductSelectorModal';

interface DraftLine {
  key: string;
  image: string;
  name: string;
  spec: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

function blankLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    image: '',
    name: '',
    spec: '',
    quantity: '1',
    unit: '',
    unitPrice: '',
  };
}

function toMoneyInput(value: number): string {
  return Number.isFinite(value) && value !== 0 ? String(value) : '';
}

function lineSubtotal(line: DraftLine): number {
  return (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
}

function workKindLabel(kind: BwaWorkOption['kind']): string {
  return kind === 'project' ? '工程' : '提案';
}

function optionKey(option: BwaWorkOption): string {
  return `${option.kind}:${option.project_id || option.pitching_id || option.code}`;
}

export function PmQuickView() {
  const { user } = useAuth();
  const staffName = usePmsStaffName(user?.id);
  const [params, setParams] = useSearchParams();
  const quoteUuid = (params.get('quote') || '').trim();
  const [projectRef, setProjectRef] = useState('');
  const [projectName, setProjectName] = useState('');
  const [pitchingId, setPitchingId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [savedQuoteId, setSavedQuoteId] = useState('');
  const [partialQuoteId, setPartialQuoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(quoteUuid));
  const [saving, setSaving] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<QuotationPDFData | null>(null);
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const pickFurniture: React.ComponentProps<typeof ProductSelectorModal>['onSelect'] = (products) => {
    const product = products[0];
    if (!product || !pickerKey) return;
    const dimensions = [product.dimensionLMm, product.dimensionWMm, product.dimensionHMm].filter(value => value != null).join(' × ');
    updateLine(pickerKey, {
      image: product.image,
      name: product.name,
      spec: [product.sku, product.material, product.color, dimensions, product.remarks].filter(Boolean).join(' / '),
      unit: '件',
      unitPrice: product.salePrice != null && product.salePrice > 0 ? String(Math.round(product.salePrice * 80) / 100) : '',
    });
  };
  const previewPdf = () => {
    setErrorMessage('');
    const items = lines.filter(line => line.name.trim());
    if (!items.length) { setErrorMessage('至少要有一項有名稱的傢俬。'); return; }
    if (items.some(line => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || !line.unitPrice.trim() || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0)) {
      setErrorMessage('請填寫有效數量及非負賣價後再預覽 PDF。'); return;
    }
    setPdfPreview({
      quickQuote: true,
      companyInfo: { name: 'Branding Works Design Ltd', address: DEFAULT_COMPANY_ADDRESS.zh, phone: resolveQuoteCompanyPhone({ email: user?.email, name: staffName }) || DEFAULT_QUOTE_COMPANY_PHONE, email: 'sales@brandingworks-furniture.com', website: DEFAULT_COMPANY_WEBSITE },
      clientInfo: { name: '', phone: '', email: '' },
      quoteMeta: { projectName: projectName || projectRef, pmName: staffName || '', validity: '', deliveryAddress: '', quoteNumber: savedQuoteId || undefined },
      deliveryDetails: '',
      items: items.map(line => ({ image: line.image, name: line.name, remarks: line.spec, quantity: Number(line.quantity), unit: line.unit, unitPrice: Number(line.unitPrice) })),
      subtotal: total,
    });
  };
  const setErrorMessage = (value: string) => { if (value) toast.error(value); };
  const setMessage = (value: string) => { if (value) toast.success(value); };
  const [workQuery, setWorkQuery] = useState('');
  const [workOptions, setWorkOptions] = useState<BwaWorkOption[]>([]);
  const [workError, setWorkError] = useState('');
  const [workOpen, setWorkOpen] = useState(false);
  const [workLoading, setWorkLoading] = useState(false);

  useEffect(() => {
    if (!quoteUuid) {
      setProjectRef('');
      setProjectName('');
      setPitchingId(null);
      setProjectId(null);
      setLines([blankLine()]);
      setSavedQuoteId('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getPmQuickQuote(quoteUuid).then((result) => {
      if (cancelled) return;
      if (result.error || !result.quote) {
        setErrorMessage(
          result.error ? pmQuoteErrorMessage(result.error) : '找不到這張快速報價單。',
        );
        setLoading(false);
        return;
      }
      const quote = result.quote;
      setProjectRef(quote.bwaProjectRef);
      setProjectName(quote.bwaProjectName);
      setPitchingId(quote.bwaPitchingId);
      setProjectId(quote.bwaProjectId);
      setSavedQuoteId(quote.quoteId);
      setLines(
        quote.items.length > 0
          ? quote.items.map((item) => ({
            key: item.id,
            image: item.image || '',
            name: item.name,
            spec: item.spec,
            quantity: String(item.quantity || ''),
            unit: item.unit,
            unitPrice: toMoneyInput(item.unitPrice),
          }))
          : [blankLine()],
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [quoteUuid]);

  useEffect(() => {
    if (!workOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setWorkLoading(true);
      void searchBwaWorks(workQuery).then((result) => {
        if (cancelled) return;
        setWorkOptions(result.items);
        setWorkError(result.error);
        setWorkLoading(false);
      });
    }, workQuery.trim() ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workQuery, workOpen]);

  const total = useMemo(
    () => pmQuoteItemsTotal(
      lines.map((line) => ({
        id: line.key,
        sortOrder: 0,
        name: line.name,
        spec: line.spec,
        quantity: Number(line.quantity) || 0,
        unit: line.unit,
        unitPrice: Number(line.unitPrice) || 0,
      })),
    ),
    [lines],
  );

  const clearWorkLink = () => {
    setPitchingId(null);
    setProjectId(null);
  };

  const pickWork = (option: BwaWorkOption) => {
    setProjectRef(option.code);
    setProjectName(option.name);
    setPitchingId(option.pitching_id);
    setProjectId(option.project_id);
    setWorkQuery('');
    setWorkOpen(false);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    setErrorMessage('');
    const result = await savePmQuickQuote({
      id: quoteUuid || partialQuoteId || null,
      projectRef,
      projectName,
      pitchingId,
      projectId,
      submitter: (staffName || user?.email || '').trim(),
      items: lines.map((line) => ({
        image: line.image,
        name: line.name,
        spec: line.spec,
        quantity: Number(line.quantity) || 0,
        unit: line.unit,
        unitPrice: Number(line.unitPrice) || 0,
      })),
    });
    setSaving(false);
    if (result.id && result.error) setPartialQuoteId(result.id);
    if (result.id && !result.error && result.id !== quoteUuid) {
      const next = new URLSearchParams(params);
      next.set('quote', result.id);
      setParams(next, { replace: true });
    }
    if (result.quoteId) setSavedQuoteId(result.quoteId);
    if (result.error || !result.id) {
      const text = result.error
        ? (result.error.message === 'need_items'
          ? '至少要有一項有名稱的傢俬。'
          : result.error.message === 'need_submitter'
            ? '缺少提交者姓名，無法保存。'
            : pmQuoteErrorMessage(result.error))
        : '儲存沒有完成。';
      setErrorMessage(text);
      return;
    }
    setMessage('報價單已儲存。');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30 text-foreground">
      <div className="z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs"><Link to={PM_BUDGET_PATH}><ArrowLeft className="h-3.5 w-3.5" />返回報價預算</Link></Button>
          <span className="h-4 w-px shrink-0 bg-border" />
          <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate text-sm font-semibold">{projectName || '新增預算'}</span>
          {savedQuoteId && <span className="hidden rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground sm:inline">{savedQuoteId}</span>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        {loading && <p className="px-2 text-sm text-muted-foreground">載入報價單…</p>}
        {!loading && (
          <div className="space-y-5 pb-4">
          <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <h2 className="flex items-center gap-3 text-lg font-semibold"><span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">1</span>搜尋 BWA 工程或提案</h2>
            <div className="relative">
              <label className="text-sm" htmlFor="bwa-work-search">
                <span className="sr-only">搜尋 BWA 工程或提案</span>
                <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-primary" aria-hidden />
                <input
                  id="bwa-work-search"
                  value={workQuery}
                  role="combobox"
                  aria-expanded={workOpen}
                  aria-controls="bwa-work-list"
                  autoComplete="off"
                  placeholder="編號、名稱或客戶"
                  onFocus={() => setWorkOpen(true)}
                  onBlur={() => window.setTimeout(() => setWorkOpen(false), 150)}
                  onChange={(event) => {
                    setWorkQuery(event.target.value);
                    setWorkOpen(true);
                  }}
                  className="mt-1 h-12 w-full rounded-lg border border-primary/30 bg-muted/30 pl-10 pr-3"
                />
              </label>
              {workOpen && (
                <ul
                  id="bwa-work-list"
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-md"
                >
                  {workLoading && <li className="px-3 py-2 text-sm text-muted-foreground">搜尋中…</li>}
                  {!workLoading && workError && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">{workError}</li>
                  )}
                  {!workLoading && !workError && workOptions.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      沒有符合的工程或提案。可以直接手填下面的編號和名稱。
                    </li>
                  )}
                  {!workLoading && !workError && workOptions.map((option) => (
                    <li key={optionKey(option)}>
                      <button
                        type="button"
                        role="option"
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          pickWork(option);
                        }}
                      >
                        <span className="text-sm font-semibold">
                          {workKindLabel(option.kind)} · {option.code || '無編號'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {option.name || '無名稱'}
                          {option.customer_name && option.customer_name !== option.name ? ` · ${option.customer_name}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                工程編號
                <input
                  value={projectRef}
                  onChange={(event) => {
                    setProjectRef(event.target.value);
                    clearWorkLink();
                  }}
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-muted/30 px-3"
                />
              </label>
              <label className="text-sm">
                工程名稱
                <input
                  value={projectName}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    clearWorkLink();
                  }}
                  className="mt-1 h-12 w-full rounded-lg border border-border bg-muted/30 px-3"
                />
              </label>
            </div>

          </section>
          <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-3 text-lg font-semibold"><span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">2</span>報價項目 <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{lines.length} 項</span></h2>
              <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, blankLine()])}><Plus className="mr-2 h-4 w-4" />加一項</Button>
            </div>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={line.key} className="grid gap-2 rounded-xl bg-muted/30 p-3 lg:grid-cols-[1.4fr_1.4fr_5rem_5rem_7rem_7rem_auto]">
                  <label className="text-xs text-muted-foreground">
                    項目 {index + 1}
                    <input
                      aria-label={`項目 ${index + 1} 名稱`}
                      value={line.name}
                      readOnly
                      placeholder="點擊選擇傢俬"
                      aria-haspopup="dialog"
                      onClick={() => setPickerKey(line.key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setPickerKey(line.key);
                        }
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    規格
                    <input
                      aria-label={`項目 ${index + 1} 規格`}
                      value={line.spec}
                      onChange={(event) => updateLine(line.key, { spec: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    數量
                    <input
                      aria-label={`項目 ${index + 1} 數量`}
                      value={line.quantity}
                      inputMode="decimal"
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    單位
                    <input
                      aria-label={`項目 ${index + 1} 單位`}
                      value={line.unit}
                      onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    賣價 (HK$)
                    <input
                      aria-label={`項目 ${index + 1} 賣價`}
                      value={line.unitPrice}
                      inputMode="decimal"
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <div className="text-xs text-muted-foreground">
                    小計
                    <p className="mt-1 flex h-10 items-center text-sm font-semibold text-foreground">
                      {formatHkMoney(lineSubtotal(line))}
                    </p>
                  </div>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 self-end text-muted-foreground hover:text-destructive"
                      aria-label={`移除項目 ${index + 1}`}
                      onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
            </div>

          </section>
          </div>
        )}
      </div>
      </div>
      {!loading && (
          <div className="z-20 flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_-12px_rgba(15,23,42,0.35)] sm:px-6">
            <p className="mr-auto text-sm font-semibold">總額 <span className="ml-2 text-xl tabular-nums text-primary sm:text-2xl">{formatHkMoney(total)}</span></p>
            <Button type="button" variant="outline" disabled={saving} onClick={previewPdf}><Eye className="mr-2 h-4 w-4" />預覽</Button>
            <Button type="button" disabled={saving} onClick={() => void save()}><Save className="mr-2 h-4 w-4" />{saving ? '儲存中…' : '儲存報價單'}</Button>
          </div>
      )}
      {pdfPreview && <QuotationPDFPreviewModal open onClose={() => setPdfPreview(null)} data={pdfPreview} />}
      <ProductSelectorModal open={pickerKey !== null} singleSelect onClose={() => setPickerKey(null)} onSelect={pickFurniture} />
    </div>
  );
}
