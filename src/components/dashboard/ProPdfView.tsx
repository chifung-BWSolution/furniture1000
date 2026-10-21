import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import { BWA_PM_BRAND } from '@/content/bwaPm';
import { formatListMoney } from '@/lib/listTableUtils';
import { Button } from '@/components/ui/button';

function readParam(params: URLSearchParams, key: string): string {
  return (params.get(key) || '').trim();
}

function money(value: number | string | null | undefined): string {
  const text = formatListMoney(value);
  return text === 'N/A' ? '未填' : `HK$ ${text}`;
}

export function ProPdfView() {
  const [params] = useSearchParams();
  const pitchingId = readParam(params, 'pmsPitchingId');
  const [title, setTitle] = useState(() => readParam(params, 'briefTitle'));
  const [client, setClient] = useState(() => readParam(params, 'client'));
  const [project, setProject] = useState(() => readParam(params, 'project'));
  const [purpose, setPurpose] = useState(() => readParam(params, 'purpose'));
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PmsPitchingListItem[]>([]);
  const [selected, setSelected] = useState<PmsPitchingListItem | null>(null);

  const applyPitching = (row: PmsPitchingListItem) => {
    setSelected(row);
    setTitle((current) => current || pitchingDisplayTitle(row));
    setClient((current) => current || row.customer_name || '');
    setProject((current) => current || row.pitching_code || '');
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchPmsPitchings({ search: q, limit: 8 }).then((rows) => {
        if (!cancelled) setHits(rows);
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!pitchingId) return;
    let cancelled = false;
    void fetchPmsPitchings({ ids: [pitchingId], limit: 1 }).then((rows) => {
      if (!cancelled && rows[0]) applyPitching(rows[0]);
    });
    return () => {
      cancelled = true;
    };
    // Cover fields from the URL are applied once for this pitching id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchingId]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background print:bg-white">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-6 print:max-w-none print:px-0">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm print:hidden sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            PM報價 · BWA
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <FileText className="h-5 w-5 text-primary" />
            專業說明 PDF
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            七段式說明使用 BWA 與所選 PMS Pitching。不讀傢俬報價明細，也不放 BW Furniture 的公司介紹。
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
              專案編號
              <input value={project} onChange={(event) => setProject(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" />
            </label>
            <label className="text-sm">
              搜尋 Pitching
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="至少 2 個字" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" />
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
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${selected?.id === hit.id ? 'bg-primary/10' : ''}`}
                    onClick={() => applyPitching(hit)}
                  >
                    <span>{pitchingDisplayTitle(hit)}</span>
                    <span>{money(hit.estimated_income)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button type="button" className="mt-4" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            列印／存成 PDF
          </Button>
        </section>

        <article className="space-y-4 print:space-y-6">
          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:break-after-page print:border-0 print:shadow-none">
            <p className="text-xs tracking-[0.2em] text-muted-foreground">{BWA_PM_BRAND.brandName}</p>
            <h2 className="mt-3 text-2xl font-bold">{title || '專業說明'}</h2>
            <p className="mt-2 text-sm">{client || '客戶'}{project ? ` · ${project}` : ''}</p>
            {purpose && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{purpose}</p>}
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">報價內容</h3>
            {!selected && (
              <p className="mt-2 text-sm text-muted-foreground">先選擇一個 Pitching。金額是 PMS 預算，不是傢俬報價明細。</p>
            )}
            {selected && (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt>預計收入</dt>
                  <dd className="font-semibold">{money(selected.estimated_income)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>預計支出</dt>
                  <dd className="font-semibold">{money(selected.estimated_expense)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>預計毛利</dt>
                  <dd className="font-semibold">{money(selected.estimated_gross_profit)}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">公司資質</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              本文件屬於 {BWA_PM_BRAND.brandName}。規格尚未寫明 BWA 的法定名稱、地址與電話，所以這裡不套用 BW Furniture 的公司介紹。
            </p>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">成功案例</h3>
            <p className="mt-2 text-sm text-muted-foreground">BWA 案例來源未定。此頁不使用傢俬公開案例。</p>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">服務承諾</h3>
            <p className="mt-2 text-sm text-muted-foreground">BWA 服務承諾尚未寫入規格。此頁不使用傢俬的交期與聯絡承諾。</p>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">廠家與產品</h3>
            <p className="mt-2 text-sm text-muted-foreground">常用廠家來自傢俬報價用量。PM 說明不引用該用量。</p>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">線上選擇／修改產品</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              不連結傢俬報價的客戶專區。BWA 的互動連結尚未定義。
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
