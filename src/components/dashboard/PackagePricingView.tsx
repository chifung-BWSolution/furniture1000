import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
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
  PACKAGE_PRICE_NOTE,
  PACKAGE_PRICE_YEAR,
  areaTotals,
  formatPackageMoney,
  lineCents,
  packageSharePath,
  totalCents,
  type PackageLine,
} from '@/lib/packagePricingMath';
import { buildPackageQuotePdf } from '@/components/dashboard/packageQuotePdf';

function moneyInput(value: number | null): string {
  return value == null ? '' : String(value);
}

export function PackagePricingView() {
  const { profileRole } = usePlatformRole();
  const canEditPrice = profileRole === 'admin';
  const [params, setParams] = useSearchParams();
  const quoteId = (params.get('quote') || '').trim();
  const [title, setTitle] = useState('套餐參考報價');
  const [lines, setLines] = useState<PackageLine[]>([]);
  const [saved, setSaved] = useState<SavedPackageQuote[]>([]);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const frozen = Boolean(quoteId);
  const areas = useMemo(() => areaTotals(lines), [lines]);
  const total = useMemo(() => totalCents(lines), [lines]);

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
          setLines(result.lines);
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
    const quantity = raw === '' ? 0 : Number(raw);
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, quantity: Number.isFinite(quantity) ? quantity : 0 } : line)),
    );
  };

  const setPrice = (id: string, raw: string) => {
    const unitPrice = raw === '' ? null : Number(raw);
    setLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, unitPrice: unitPrice != null && Number.isFinite(unitPrice) ? unitPrice : null } : line,
      ),
    );
  };

  const persist = async (): Promise<string | null> => {
    const result = await savePackageQuote({ id: quoteId || null, title, lines });
    if (result.error || !result.id) {
      setErrorMessage(packageQuoteErrorMessage(result.error));
      return null;
    }
    if (result.id !== quoteId) {
      const next = new URLSearchParams(params);
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
    if (line.unitPrice == null) return;
    setBusy(true);
    setErrorMessage('');
    const error = await savePackageBasePrice(line.id, line.unitPrice);
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
      setMessage(url);
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    const id = await persist();
    if (!id) {
      setBusy(false);
      return;
    }
    let token = shareToken;
    if (quoteId && quoteId === id) {
      const existing = saved.find((quote) => quote.id === id);
      token = token || existing?.shareToken || null;
    }
    const qrDataUrl = token
      ? await QRCode.toDataURL(`${window.location.origin}${packageSharePath(token)}`, { margin: 1, width: 280 })
      : null;
    const blob = await buildPackageQuotePdf(
      { title, priceYear: PACKAGE_PRICE_YEAR, note: PACKAGE_PRICE_NOTE, lines },
      qrDataUrl,
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title || '套餐參考報價'}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    setBusy(false);
    setMessage(token ? 'PDF 已下載，並帶有客戶連結。' : 'PDF 已下載。尚未建立客戶連結，所以沒有 QR。');
  };

  const startNew = () => {
    const next = new URLSearchParams(params);
    next.delete('quote');
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">套餐計價</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{PACKAGE_PRICE_NOTE}</p>
        </div>
        <Button type="button" variant="outline" onClick={startNew}>
          新的一張
        </Button>
      </div>

      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {frozen ? <p className="text-sm">這張單用儲存時的平均價。改數量後再儲存，不會套用後來的基準價。</p> : null}

      <label className="block text-sm">
        標題
        <input
          className="mt-1 w-full max-w-md rounded-md border bg-background px-3 py-2"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      {loading ? <p className="text-sm">載入中…</p> : null}

      {areas.map((area) => (
        <section key={area.area} className="overflow-x-auto rounded-lg border">
          <div className="flex items-center justify-between bg-muted/50 px-3 py-2">
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
                  <td className="px-2 py-1">{line.itemName}</td>
                  <td className="px-2 py-1">{line.grade}</td>
                  <td className="px-2 py-1">{line.material}</td>
                  <td className="px-2 py-1">{line.dimension}</td>
                  <td className="px-2 py-1">{line.unit}</td>
                  <td className="px-2 py-1">
                    <input
                      className="w-20 rounded border bg-background px-2 py-1"
                      type="number"
                      min={0}
                      step="any"
                      value={line.quantity}
                      onChange={(event) => setQuantity(line.id, event.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
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
                      line.unitPrice == null ? '' : formatPackageMoney(Math.round(line.unitPrice * 100))
                    )}
                  </td>
                  <td className="px-2 py-1">{formatPackageMoney(lineCents(line.quantity, line.unitPrice))}</td>
                  <td className="px-2 py-1 text-muted-foreground">{line.standardNote}</td>
                  <td className="px-2 py-1 text-muted-foreground">{line.premiumNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">總額 {formatPackageMoney(total)}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || loading} onClick={() => void save()}>
            儲存
          </Button>
          <Button type="button" variant="outline" disabled={busy || loading} onClick={() => void share()}>
            客戶連結
          </Button>
          <Button type="button" variant="outline" disabled={busy || loading} onClick={() => void downloadPdf()}>
            下載 PDF
          </Button>
        </div>
      </div>

      {shareToken ? (
        <p className="text-sm break-all">
          客戶連結 {`${window.location.origin}${packageSharePath(shareToken)}`}
        </p>
      ) : null}
      {saved.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-medium">已儲存</h2>
          <ul className="space-y-1 text-sm">
            {saved.map((quote) => (
              <li key={quote.id}>
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set('quote', quote.id);
                    setParams(next);
                  }}
                >
                  {quote.title || '套餐參考報價'}
                </button>
                {quote.shareToken ? ' · 已有客戶連結' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
