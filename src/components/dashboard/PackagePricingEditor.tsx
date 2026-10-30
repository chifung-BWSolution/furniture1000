import { toast } from 'sonner';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlatformRole } from '@/hooks/use-platform-role';
import {
  ensurePackageShareToken,
  listPackageQuotes,
  loadPackageQuote,
  loadPackageTemplate,
  packageQuoteErrorMessage,
  savePackageBasePrice,
  savePackageQuote,
  type SavedPackageQuote,
} from '@/lib/packagePricing';
import {
  areaTotals,
  formatPackageMoney,
  lineCents,
  packageSharePath,
  parsePackagePrice,
  parsePackageQuantity,
  toCents,
  totalCents,
  validatePackageLines,
  type PackageLine,
} from '@/lib/packagePricingMath';
import { PackageImportPicker } from '@/components/dashboard/PackageImportPicker';
import { QuotationPDFPreviewModal } from '@/components/dashboard/QuotationPDFPreview';
import type { QuotationPDFData } from '@/types/quotation-pdf';

function moneyInput(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '' : String(value);
}

/**
 * 套餐參考報價編輯頁：?quote=<id> 開舊單，?mode=new 開新單。
 * 列表頁（PackagePricingListView）負責入口，這裡只做單張報價的編輯與輸出。
 */
export function PackagePricingEditor() {
  const { profileRole } = usePlatformRole();
  const canEditPrice = profileRole === 'admin';
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const quoteId = (params.get('quote') || '').trim();
  const [title, setTitle] = useState('套餐參考報價');
  const [sourceStage, setSourceStage] = useState(1);
  const onStageChange = useCallback((stage: number) => setSourceStage(stage), []);
  const [areaFilter, setAreaFilter] = useState('all');
  const [lines, setLines] = useState<PackageLine[]>([]);
  const [template, setTemplate] = useState<PackageLine[]>([]);
  const [imported, setImported] = useState(false);
  const [, setSaved] = useState<SavedPackageQuote[]>([]);
  const [pdfPreview, setPdfPreview] = useState<QuotationPDFData | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const setMessage = (value: string) => { if (value) toast.success(value); };
  const setErrorMessage = (value: string) => { if (value) toast.error(value); };

  const frozen = Boolean(quoteId);

  /** 列表頁（參考報價一覽）在同一路徑上以 ?mode=reference 顯示。 */
  const goToList = () => {
    navigate({ pathname: location.pathname, search: '?mode=reference' }, { replace: true });
  };

  const areas = useMemo(() => areaTotals(lines), [lines]);
  const total = useMemo(() => totalCents(lines), [lines]);
  const problems = useMemo(() => (lines.length === 0 ? [] : validatePackageLines(lines)), [lines]);
  const problemsByLine = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const problem of problems) {
      if (!problem.lineId) continue;
      const list = map.get(problem.lineId) || [];
      if (!list.includes(problem.message)) list.push(problem.message);
      map.set(problem.lineId, list);
    }
    return map;
  }, [problems]);
  const blockedReason = problems.length > 0 ? problems[0].message : '';

  const reloadSaved = async () => {
    const result = await listPackageQuotes();
    if (!result.error) setSaved(result.quotes);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    const run = async () => {
      if (quoteId) {
        const result = await loadPackageQuote(quoteId);
        if (cancelled) return;
        if (result.error) {
          setErrorMessage(packageQuoteErrorMessage(result.error));
          setLines([]);
        } else {
          setTitle(result.title || '套餐參考報價');
          setLines(result.lines);
          setImported(true);
          setShareToken(result.shareToken);
        }
      } else {
        const result = await loadPackageTemplate();
        if (cancelled) return;
        if (result.error) {
          setErrorMessage(packageQuoteErrorMessage(result.error));
          setLines([]);
        } else {
          setTitle('套餐參考報價');
          setTemplate(result.lines);
          setLines([]);
          setImported(false);
          setShareToken(null);
        }
      }
      if (!cancelled) {
        await reloadSaved();
        setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const setQuantity = (id: string, raw: string) => {
    const quantity = parsePackageQuantity(raw);
    setLines((current) => current.map((line) => (line.id === id ? { ...line, quantity } : line)));
  };

  const setPrice = (id: string, raw: string) => {
    const unitPrice = parsePackagePrice(raw);
    setLines((current) => current.map((line) => (line.id === id ? { ...line, unitPrice } : line)));
  };

  const persist = async (): Promise<string | null> => {
    const blocking = validatePackageLines(lines);
    if (blocking.length > 0) {
      setErrorMessage(blocking[0].message);
      return null;
    }
    const result = await savePackageQuote({ id: quoteId || null, title, lines });
    if (result.error || !result.id) {
      setErrorMessage(packageQuoteErrorMessage(result.error));
      return null;
    }
    if (result.id !== quoteId) {
      const next = new URLSearchParams(params);
      next.delete('mode');
      next.set('quote', result.id);
      setParams(next, { replace: true });
    }
    await reloadSaved();
    return result.id;
  };

  const save = async () => {
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    const id = await persist();
    setBusy(false);
    if (id) setMessage('已儲存。之後改基準價不會改這張單。');
  };

  const writeBasePrice = async (line: PackageLine) => {
    if (line.unitPrice == null || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      setMessage('');
      setErrorMessage('基準價未寫入：平均價必須是 0 或正數。');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    const error = await savePackageBasePrice(line.templateId || line.id, line.unitPrice);
    setBusy(false);
    setMessage(error ? '' : '基準價已更新，只影響之後新開的單。');
    if (error) setErrorMessage(packageQuoteErrorMessage(error));
  };

  const share = async () => {
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    const id = await persist();
    if (!id) {
      setBusy(false);
      return;
    }
    const result = await ensurePackageShareToken(id);
    setBusy(false);
    if (result.error || !result.token) {
      setErrorMessage(packageQuoteErrorMessage(result.error));
      return;
    }
    setShareToken(result.token);
    const url = `${window.location.origin}${packageSharePath(result.token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage('客戶連結已複製。');
    } catch {
      toast.error('無法複製連結，請從下方客戶連結複製。');
    }
  };

  const previewPdf = () => {
    if (problems.length > 0 || !lines.length) return;
    const items: QuotationPDFData['items'] = [];
    for (const area of areas) {
      items.push({ id: `area-${area.area}`, isSectionTitle: true, name: area.area, image: '', unitPrice: 0, quantity: 0 });
      for (const line of lines.filter(item => item.area === area.area)) {
        items.push({
          image: line.selectedProduct?.image || '',
          name: line.selectedProduct?.name || line.itemName,
          unitPrice: line.unitPrice ?? 0,
          quantity: line.quantity,
          unit: line.unit,
          material: line.material,
          referenceSpec: [line.grade, line.dimension].filter(Boolean).join("\n"),
          referenceLineTotal: lineCents(line.quantity, line.unitPrice) / 100,
          remarks: [
            line.selectedProduct ? `參考價目：${line.itemName}` : '',
            line.sourceItem ? `原項目：${line.sourceItem}${line.sourceDescription ? ` · ${line.sourceDescription}` : ''}` : '',
            line.sourceItem || line.sourceQuotationNo || line.sourceSectionName ? `來源：${[line.sourcePitchingCode, line.sourceQuotationNo, line.sourceSectionName].filter(Boolean).join(' · ')}` : '',
            line.standardNote ? `標準價錢：${line.standardNote}` : '',
            line.premiumNote ? `高品質：${line.premiumNote}` : '',
          ].filter(Boolean).join('\n'),
        });
      }
    }
    setPdfPreview({
      quickQuote: true,
      referenceTitle: title,
      companyInfo: { name: '', address: '', phone: '', email: '', website: '' },
      clientInfo: { name: '', phone: '', email: '' },
      quoteMeta: { projectName: title, pmName: '', validity: '', deliveryAddress: '' },
      deliveryDetails: '',
      items,
      subtotal: total / 100,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30 text-foreground">
      <div className="z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2 sm:px-6">
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={goToList}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回列表
        </Button>
        <h1 className="sr-only">{frozen ? '參考報價明細' : '新增參考報價'}</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
          <nav aria-label="報價流程" className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
            {['選擇來源', '傢俬配對', '調整單價', '完成輸出'].map((label, index) => {
              const current = quoteId || imported ? (shareToken ? 4 : 3) : sourceStage;
              return <div key={label} className="flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${index + 1 <= current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{index + 1 < current ? '✓' : index + 1}</span><span className={index + 1 === current ? 'font-semibold text-primary' : 'text-muted-foreground'}>{label}</span>{index < 3 ? <span className="mx-2 h-px w-8 bg-border sm:w-14" /> : null}</div>;
            })}
          </nav>

          <label className="block max-w-lg text-sm font-medium">
            報價標題
            <Input
              className="mt-2 bg-background font-normal"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          {loading ? <p className="text-sm">載入中…</p> : null}

          {!loading && !quoteId && !imported ? (
            <PackageImportPicker
              template={template}
              onStageChange={onStageChange}
              onImport={(importedLines, nextTitle) => {
                setLines(importedLines);
                setTitle(nextTitle);
                setImported(true);
              }}
            />
          ) : null}

          {(imported || quoteId) && lines.length > 0 ? <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">總額</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatPackageMoney(total)}</p></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">傢俬項目</p><p className="mt-1 text-xl font-semibold">{lines.length} 項</p></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">分區</p><p className="mt-1 text-xl font-semibold">{areas.length} 個</p></div></div> : null}
          {areas.length > 0 ? <div className="flex flex-wrap gap-2" aria-label="篩選分區"><Button type="button" size="sm" variant={areaFilter === 'all' ? 'default' : 'outline'} onClick={() => setAreaFilter('all')}>全部分區 ({lines.length})</Button>{areas.map(area => <Button type="button" size="sm" key={area.area} variant={areaFilter === area.area ? 'default' : 'outline'} onClick={() => setAreaFilter(area.area)}>{area.area} ({lines.filter(line => line.area === area.area).length})</Button>)}</div> : null}
          {areas.filter(area => areaFilter === 'all' || area.area === areaFilter).map((area) => (
            <section key={area.area} className="overflow-x-auto rounded-xl border bg-card">
              <div className="flex items-center justify-between bg-primary/10 px-4 py-3">
                <h2 className="font-medium">{area.area}</h2>
                <span className="text-sm">小計 {formatPackageMoney(area.cents)}</span>
              </div>
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-2 font-medium">項目</th>
                    <th className="px-2 py-2 font-medium">規格</th>
                    <th className="px-2 py-2 font-medium">材質</th>
                    <th className="px-2 py-2 font-medium">尺寸</th>
                    <th className="px-2 py-2 font-medium">單位</th>
                    <th className="px-2 py-2 font-medium">數量</th>
                    <th className="px-2 py-2 font-medium">平均價</th>
                    <th className="px-2 py-2 font-medium">小計</th>
                    <th className="px-2 py-2 font-medium">標準價錢</th>
                    <th className="px-2 py-2 font-medium">高品質</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.filter((line) => line.area === area.area).map((line) => (
                    <tr key={line.id} className="border-b">
                      <td className="px-3 py-3">
                        {line.selectedProduct?.name || line.itemName}
                        {line.selectedProduct ? <div className="text-xs text-muted-foreground">參考價目：{line.itemName}</div> : null}
                        {line.sourceItem ? (
                          <div className="text-xs text-muted-foreground">
                            原項目：{line.sourceItem}{line.sourceDescription ? ` · ${line.sourceDescription}` : ''}
                          </div>
                        ) : null}
                        {line.sourceItem || line.sourceQuotationNo || line.sourceSectionName ? (
                          <div className="text-xs text-muted-foreground">
                            來源：{[line.sourcePitchingCode, line.sourceQuotationNo, line.sourceSectionName].filter(Boolean).join(' · ')}
                          </div>
                        ) : null}
                        {problemsByLine.get(line.id)?.length ? (
                          <div className="text-xs text-destructive">{problemsByLine.get(line.id)!.join('；')}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">{line.grade}</td>
                      <td className="px-3 py-3">{line.material}</td>
                      <td className="px-3 py-3">{line.dimension}</td>
                      <td className="px-3 py-3">{line.unit}</td>
                      <td className="px-3 py-3">
                        <input
                          className="w-20 rounded border bg-background px-2 py-1"
                          type="number"
                          min={0}
                          step="any"
                          value={Number.isFinite(line.quantity) ? line.quantity : ''}
                          onChange={(event) => setQuantity(line.id, event.target.value)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        {canEditPrice && !frozen ? (
                          <span className="flex items-center gap-1">
                            <input
                              className="w-24 rounded border bg-background px-2 py-1"
                              inputMode="decimal"
                              value={moneyInput(line.unitPrice)}
                              onChange={(event) => setPrice(line.id, event.target.value)}
                            />
                            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void writeBasePrice(line)}>
                              寫入
                            </Button>
                          </span>
                        ) : (
                          line.unitPrice == null ? '' : formatPackageMoney(toCents(line.unitPrice) ?? 0)
                        )}
                      </td>
                      <td className="px-3 py-3">{formatPackageMoney(lineCents(line.quantity, line.unitPrice))}</td>
                      <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">{line.standardNote}</td>
                      <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">{line.premiumNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>

      {imported || quoteId ? (
        <div className="z-20 flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_-12px_rgba(15,23,42,0.35)] sm:px-6">
          <div className="mr-auto min-w-0">
            <p className="text-sm font-semibold">
              總額
              <span className="ml-2 text-xl tabular-nums text-primary sm:text-2xl">{formatPackageMoney(total)}</span>
            </p>
            {blockedReason ? <p className="text-xs text-destructive">未能儲存或分享：{blockedReason}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy || loading || !imported || lines.length === 0 || problems.length > 0} onClick={() => void save()}>
              儲存
            </Button>
            <Button type="button" variant="outline" disabled={busy || loading || !imported || lines.length === 0 || problems.length > 0} onClick={() => void share()}>
              客戶連結
            </Button>
            <Button type="button" variant="outline" disabled={busy || loading || !imported || lines.length === 0 || problems.length > 0} onClick={previewPdf}>
              預覽 PDF
            </Button>
          </div>
        </div>
      ) : null}
      {pdfPreview ? <QuotationPDFPreviewModal open onClose={() => setPdfPreview(null)} data={pdfPreview} /> : null}
    </div>
  );
}
