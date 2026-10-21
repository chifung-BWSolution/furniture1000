import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import { BWA_PM_BRAND } from '@/content/bwaPm';
import {
  getFurnitureInquiry,
  inquiryErrorMessage,
  inquiryStatusLabel,
  type BwaInquiryDetail,
} from '@/lib/bwaFurnitureInquiry';
import { formatListMoney } from '@/lib/listTableUtils';
import { Button } from '@/components/ui/button';

function money(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '未回覆';
  const text = formatListMoney(value);
  return text === 'N/A' ? '未回覆' : `HK$ ${text}`;
}

export function ProPdfView() {
  const [params] = useSearchParams();
  const inquiryId = (params.get('inquiry') || '').trim();
  const [title, setTitle] = useState(() => (params.get('briefTitle') || '').trim());
  const [client, setClient] = useState(() => (params.get('client') || '').trim());
  const [project, setProject] = useState(() => (params.get('project') || '').trim());
  const [purpose, setPurpose] = useState(() => (params.get('purpose') || '').trim());
  const [inquiry, setInquiry] = useState<BwaInquiryDetail | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!inquiryId) return;
    let cancelled = false;
    void getFurnitureInquiry(inquiryId).then((result) => {
      if (cancelled) return;
      if (result.error || !result.inquiry) {
        setMessage(result.error ? inquiryErrorMessage(result.error) : '找不到這張詢價。');
        return;
      }
      setInquiry(result.inquiry);
      setTitle((current) => current || result.inquiry?.bwa_project_name || '');
      setProject((current) => current || result.inquiry?.bwa_project_ref || '');
    });
    return () => {
      cancelled = true;
    };
  }, [inquiryId]);

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
            只列 BWA 送出的傢俬項目，以及 BWF 回覆的賣價。不含成本、廠家或毛利。
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
              工程編號
              <input value={project} onChange={(event) => setProject(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" />
            </label>
          </div>
          <label className="mt-3 block text-sm">
            說明
            <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1 min-h-[5rem] w-full rounded-lg border border-border bg-background px-3 py-2" />
          </label>
          <Button type="button" className="mt-4" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            列印／存成 PDF
          </Button>
          {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
        </section>

        <article className="space-y-4 print:space-y-6">
          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <p className="text-xs tracking-[0.2em] text-muted-foreground">{BWA_PM_BRAND.brandName}</p>
            <h2 className="mt-3 text-2xl font-bold">{title || '傢俬詢價'}</h2>
            <p className="mt-2 text-sm">{client || '客戶'}{project ? ` · ${project}` : ''}</p>
            {inquiry && <p className="mt-2 text-sm text-muted-foreground">{inquiryStatusLabel(inquiry.status)}</p>}
            {purpose && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{purpose}</p>}
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm print:border-0 print:shadow-none">
            <h3 className="text-lg font-bold">傢俬項目與 BWF 賣價</h3>
            {!inquiry && (
              <p className="mt-2 text-sm text-muted-foreground">先從詢價頁打開。金額只會是 BWF 回覆的賣價。</p>
            )}
            {inquiry && (
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 font-medium">項目</th>
                    <th className="py-2 font-medium">數量</th>
                    <th className="py-2 text-right font-medium">BWF 賣價</th>
                  </tr>
                </thead>
                <tbody>
                  {inquiry.items.map((item) => (
                    <tr key={item.id} className="border-b border-border/70">
                      <td className="py-2">
                        <span className="font-medium">{item.name || '未命名'}</span>
                        {item.spec && <span className="mt-0.5 block text-xs text-muted-foreground">{item.spec}</span>}
                      </td>
                      <td className="py-2">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</td>
                      <td className="py-2 text-right font-semibold">{money(item.returned_unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {inquiry?.note && <p className="mt-3 text-sm text-muted-foreground">{inquiry.note}</p>}
          </section>
        </article>
      </div>
    </div>
  );
}
