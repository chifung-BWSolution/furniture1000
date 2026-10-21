import { Star } from 'lucide-react';
import { BW_CLIENT_LOGO_WALL_IMAGE, BW_PUBLIC_CLIENT_MARKS } from '@/content/bwCorporate';

export function CaseClientsView() {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">成功案例</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <Star className="h-5 w-5 text-primary" />
            知名客户
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            公開網站上的客戶名稱與 Logo 牆。沒有私人客戶資料。共 {BW_PUBLIC_CLIENT_MARKS.length} 個名稱。
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
          <img src={BW_CLIENT_LOGO_WALL_IMAGE} alt="公開客戶 Logo 牆" className="w-full object-contain" />
        </section>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BW_PUBLIC_CLIENT_MARKS.map((name) => (
            <li key={name} className="rounded-2xl border border-border/80 bg-card px-4 py-5 text-center shadow-sm">
              <p className="font-medium">{name}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
