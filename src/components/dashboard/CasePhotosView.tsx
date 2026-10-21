import { useState } from 'react';
import { Images } from 'lucide-react';
import { BW_PUBLIC_CASES } from '@/content/bwCorporate';

export function CasePhotosView() {
  const [activeTitle, setActiveTitle] = useState<string>(BW_PUBLIC_CASES[0]?.title ?? '');
  const active = BW_PUBLIC_CASES.find((item) => item.title === activeTitle) ?? BW_PUBLIC_CASES[0];

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">成功案例</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <Images className="h-5 w-5 text-primary" />
            完工相片
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            公開完工工程的相片。點一張可放大。共 {BW_PUBLIC_CASES.length} 張。
          </p>
        </section>

        {active && (
          <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
            <img src={active.image} alt={active.title} className="max-h-[420px] w-full object-cover" />
            <div className="px-4 py-3">
              <p className="font-medium">{active.title}</p>
              <p className="text-sm text-muted-foreground">{active.location} · {active.size}</p>
            </div>
          </section>
        )}

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BW_PUBLIC_CASES.map((item) => {
            const selected = item.title === active?.title;
            return (
              <li key={item.title}>
                <button
                  type="button"
                  onClick={() => setActiveTitle(item.title)}
                  className={`w-full overflow-hidden rounded-xl border bg-card text-left shadow-sm ${
                    selected ? 'border-primary' : 'border-border/80'
                  }`}
                >
                  <img src={item.image} alt="" className="h-28 w-full object-cover" />
                  <p className="px-3 py-2 text-sm">{item.title}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
