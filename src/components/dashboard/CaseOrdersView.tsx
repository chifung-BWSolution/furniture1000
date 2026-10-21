import { ClipboardList } from 'lucide-react';
import { BW_PUBLIC_CASES } from '@/content/bwCorporate';

export function CaseOrdersView() {
  const caseCount = BW_PUBLIC_CASES.length;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">成功案例</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <ClipboardList className="h-5 w-5 text-primary" />
            訂單數據
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            公開網站上的完工工程。每筆有名稱、地區、面積和相片。這裡沒有內部訂單金額。
          </p>
          <p className="mt-3 text-sm">公開工程 {caseCount} 筆</p>
        </section>

        <ul className="grid gap-3 sm:grid-cols-2">
          {BW_PUBLIC_CASES.map((item) => (
            <li key={item.title} className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
              <img src={item.image} alt={item.title} className="h-40 w-full object-cover" />
              <div className="space-y-1 px-4 py-3">
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.location}</p>
                <p className="text-sm">{item.size}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
