import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { FileText, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchQuoteUsageRankings } from '@/lib/quoteUsageReports';
import { buildCustomerPortalQuoteShareUrl } from '@/lib/customerPortalRoutes';
import { formatListMoney } from '@/lib/listTableUtils';
import {
  BW_COMPANY,
  BW_CONTACT_HIGHLIGHTS,
  BW_CREDENTIALS,
  BW_PUBLIC_CASES,
} from '@/content/bwCorporate';
import { Button } from '@/components/ui/button';

type QuoteHit = {
  id: string;
  quoteId: string;
  version: string;
  totalAmount: number;
};

type QuoteLine = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  factoryName: string;
  section: boolean;
  hidden: boolean;
};

const TRASH = '回收桶';
const COMMON_FACTORY_QUOTES = 3;

function readParam(params: URLSearchParams, key: string): string {
  return (params.get(key) || '').trim();
}

export function ProPdfView() {
  const [params] = useSearchParams();
  const [title, setTitle] = useState(() => readParam(params, 'briefTitle'));
  const [client, setClient] = useState(() => readParam(params, 'client'));
  const [project, setProject] = useState(() => readParam(params, 'project'));
  const [purpose, setPurpose] = useState(() => readParam(params, 'purpose'));
  const [quoteQuery, setQuoteQuery] = useState('');
  const [hits, setHits] = useState<QuoteHit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [factories, setFactories] = useState<string[]>([]);
  const [pickedFactories, setPickedFactories] = useState<string[]>([]);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchQuoteUsageRankings()
      .then((usage) => {
        if (cancelled) return;
        const names = usage.factories
          .filter((row) => row.quoteCount >= COMMON_FACTORY_QUOTES)
          .map((row) => row.factoryName);
        setFactories(names);
        setPickedFactories(names.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setFactories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = quoteQuery.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void supabase
        .from('bwf_quote')
        .select('id, quote_id, version, total_amount, status')
        .ilike('quote_id', `%${q}%`)
        .neq('status', TRASH)
        .order('created_at', { ascending: false })
        .limit(8)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            setQuoteError(error.message);
            setHits([]);
            return;
          }
          setQuoteError(null);
          setHits(
            (data || []).map((row) => ({
              id: String(row.id),
              quoteId: String(row.quote_id || ''),
              version: String(row.version || ''),
              totalAmount: Number(row.total_amount) || 0,
            })),
          );
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [quoteQuery]);

  useEffect(() => {
    if (!selectedId) {
      setLines([]);
      setShareUrl(null);
      return;
    }
    let cancelled = false;
    setLoadingQuote(true);
    void (async () => {
      const [itemRes, linkRes] = await Promise.all([
        supabase
          .from('bwf_quote_item')
          .select('id, name, quantity, unit_price, factory_name, hide_in_pdf, is_section_title, sort_order')
          .eq('quote_uuid', selectedId)
          .order('sort_order', { ascending: true }),
        supabase
          .from('bwf_quote_share_links')
          .select('share_token, status')
          .eq('quote_uuid', selectedId)
          .eq('status', 'active')
          .limit(1),
      ]);
      if (cancelled) return;
      if (itemRes.error) setQuoteError(itemRes.error.message);
      else setQuoteError(null);
      setLines(
        (itemRes.data || []).map((row) => ({
          id: String(row.id),
          name: String(row.name || '').trim() || '未命名',
          quantity: Number(row.quantity) || 0,
          unitPrice: Number(row.unit_price) || 0,
          factoryName: String(row.factory_name || '').trim(),
          section: row.is_section_title === true,
          hidden: row.hide_in_pdf === true,
        })),
      );
      const token = linkRes.data?.[0]?.share_token;
      const origin = window.location.origin;
      setShareUrl(token ? buildCustomerPortalQuoteShareUrl(origin, String(token)) : null);
      setLoadingQuote(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!shareUrl) {
      setQr(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(shareUrl, { margin: 1, width: 180 }).then((url) => {
      if (!cancelled) setQr(url);
    }).catch(() => {
      if (!cancelled) setQr(null);
    });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  const visibleLines = useMemo(
    () => lines.filter((line) => line.section || !line.hidden),
    [lines],
  );
  const saleTotal = useMemo(
    () => visibleLines.reduce((sum, line) => sum + (line.section ? 0 : line.unitPrice * line.quantity), 0),
    [visibleLines],
  );
  const factoryBlocks = useMemo(() => {
    return pickedFactories.map((name) => ({
      name,
      products: visibleLines
        .filter((line) => !line.section && line.factoryName === name)
        .map((line) => line.name),
    }));
  }, [pickedFactories, visibleLines]);

  const toggleFactory = (name: string) => {
    setPickedFactories((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background print:bg-white">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-6 print:max-w-none print:px-0">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm print:hidden sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">PM報價</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <FileText className="h-5 w-5 text-primary" />
            專業說明 PDF
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            七段式說明，售價來自所選報價單。成本不出現在這份文件。簡報頁傳來的標題只作封面，版面與 Canva 分開。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              標題
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" />
            </label>
            <label className="text-sm">
              客戶
              <input value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" />
            </label>
            <label className="text-sm">
              專案
              <input value={project} onChange={(event) => setProject(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" />
            </label>
            <label className="text-sm">
              搜尋報價單號
              <input value={quoteQuery} onChange={(event) => setQuoteQuery(event.target.value)} placeholder="至少 2 個字" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" />
            </label>
          </div>
          <label className="mt-3 block text-sm">
            說明
            <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1 min-h-[5rem] w-full rounded-lg border border-border bg-background px-3 py-2" />
          </label>
          {hits.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${selectedId === hit.id ? 'bg-primary/10' : ''}`}
                    onClick={() => setSelectedId(hit.id)}
                  >
                    <span>{hit.quoteId} · {hit.version}</span>
                    <span>HK$ {formatListMoney(hit.totalAmount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {quoteError && <p className="mt-2 text-sm text-destructive">{quoteError}</p>}
          {factories.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">常用廠家（至少出現在 {COMMON_FACTORY_QUOTES} 張報價單）</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {factories.map((name) => {
                  const on = pickedFactories.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleFactory(name)}
                      className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-primary bg-primary/10' : 'border-border'}`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Button type="button" className="mt-4" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            列印／存成 PDF
          </Button>
        </section>

        <article className="space-y-4 print:space-y-6">
          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:break-after-page print:border-0 print:shadow-none">
            <p className="text-xs tracking-[0.2em] text-muted-foreground">{BW_COMPANY.brandName}</p>
            <h2 className="mt-3 text-2xl font-bold">{title || '專業說明'}</h2>
            <p className="mt-2 text-sm">{client || '客戶'}{project ? ` · ${project}` : ''}</p>
            {purpose && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{purpose}</p>}
            <p className="mt-6 text-xs text-muted-foreground">{BW_COMPANY.address}</p>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">報價內容</h3>
            {loadingQuote && <p className="mt-2 text-sm text-muted-foreground">載入報價項目…</p>}
            {!selectedId && <p className="mt-2 text-sm text-muted-foreground">先搜尋並選一張報價單，這裡才會列出售價。</p>}
            <ul className="mt-3 space-y-2">
              {visibleLines.map((line) =>
                line.section ? (
                  <li key={line.id} className="pt-2 text-sm font-semibold">{line.name}</li>
                ) : (
                  <li key={line.id} className="flex justify-between gap-3 text-sm">
                    <span>{line.name} × {line.quantity}</span>
                    <span>HK$ {formatListMoney(line.unitPrice * line.quantity)}</span>
                  </li>
                ),
              )}
            </ul>
            {selectedId && (
              <p className="mt-4 text-sm font-semibold">售價合計 HK$ {formatListMoney(saleTotal)}</p>
            )}
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">公司資質</h3>
            <p className="mt-2 text-sm leading-relaxed">{BW_COMPANY.intro}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {BW_CREDENTIALS.map((item) => (
                <li key={item.title} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-background">
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-muted-foreground">{item.description}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">成功案例</h3>
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">
              {BW_PUBLIC_CASES.slice(0, 3).map((item) => (
                <li key={item.title} className="overflow-hidden rounded-xl border border-border">
                  <img src={item.image} alt={item.title} className="h-28 w-full object-cover" />
                  <p className="p-2 text-sm font-semibold">{item.title}</p>
                  <p className="px-2 pb-2 text-xs text-muted-foreground">{item.location} · {item.size}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">服務承諾</h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {BW_CONTACT_HIGHLIGHTS.map((item) => (
                <li key={item.title} className="text-sm">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-muted-foreground">{item.lines.join(' · ')}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">廠家與產品</h3>
            {factoryBlocks.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">尚未有達到常用次數的廠家，或這張報價單沒有對上的廠家名稱。</p>
            )}
            <ul className="mt-3 space-y-3">
              {factoryBlocks.map((block) => (
                <li key={block.name}>
                  <p className="text-sm font-semibold">{block.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {block.products.length > 0 ? block.products.join('、') : '這張報價單沒有該廠家的項目'}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">線上選擇／修改產品</h3>
            {qr && shareUrl ? (
              <div className="mt-3 flex items-center gap-4">
                <img src={qr} alt="報價單客戶連結 QR Code" className="h-36 w-36" />
                <a href={shareUrl} className="break-all text-sm underline">{shareUrl}</a>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                這張報價單還沒有有效的客戶連結。請在報價單裡生成 QR 後再回到這裡。
              </p>
            )}
          </section>
        </article>
      </div>
    </div>
  );
}
