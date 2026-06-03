import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  ChevronLeft, CheckCircle2, MessageCircle, Edit3, MapPin, ArrowRight,
} from 'lucide-react';
import { fetchProjects, fetchZones, fetchZoneProducts } from '@/lib/solutionsApi';
import type { DesignProject, ProjectZone, ZoneProduct } from '@/types/solutions';

export function CustomerDesignProjectsView() {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [invited, setInvited] = useState<DesignProject[]>([]); // 受邀專案
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [products, setProducts] = useState<ZoneProduct[]>([]);

  useEffect(() => {
    fetchProjects().then(setInvited);
  }, []);

  useEffect(() => {
    if (!openProjectId) return;
    Promise.all([fetchZones(openProjectId), fetchZoneProducts(openProjectId)])
      .then(([z, zp]) => { setZones(z); setProducts(zp.filter((p) => p.zoneId)); });
  }, [openProjectId]);

  if (!openProjectId) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-2xl font-bold tracking-tight">我的設計專案</h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">點擊專案查看分區與產品方案</p>
          <div className="mt-6 space-y-3">
            {invited.map((p) => (
              <button
                key={p.id}
                onClick={() => setOpenProjectId(p.id)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md"
              >
                <div>
                  <h3 className="font-display text-base font-bold text-foreground">{p.name}</h3>
                  <p className="mt-0.5 font-body text-[12.5px] text-muted-foreground">{p.clientCompany} · 設計師團隊</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                    </div>
                    <span className="font-mono-data text-[11px] text-muted-foreground">{p.progress}% 已確認</span>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const project = invited.find((p) => p.id === openProjectId);
  if (!project) return null;

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="mx-auto max-w-4xl">
        <button onClick={() => setOpenProjectId(null)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> 返回專案列表
        </button>
        <h1 className="font-display text-2xl font-bold tracking-tight">{project.name}</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">查看各分區的產品方案，並進行確認或提出討論</p>

        {/* Floor plan mini map */}
        <div className="relative mt-6 aspect-[16/7] w-full overflow-hidden rounded-xl border border-border bg-muted/20">
          {zones.map((z) => (
            <div key={z.id} className="absolute rounded-lg border-2 border-primary/40 bg-primary/5 px-2 py-1" style={{ left: `${z.bounds.x}%`, top: `${z.bounds.y}%`, width: `${z.bounds.w}%`, height: `${z.bounds.h}%` }}>
              <span className="flex items-center gap-1 font-display text-[11px] font-bold text-primary"><MapPin className="h-3 w-3" />{z.name}</span>
            </div>
          ))}
        </div>

        {/* Zones with products */}
        <div className="mt-6 space-y-6">
          {zones.map((zone) => {
            const items = products.filter((zp) => zp.zoneId === zone.id);
            if (items.length === 0) return null;
            return (
              <div key={zone.id}>
                <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold">
                  {zone.code && <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono-data text-[10px] text-primary">{zone.code}</span>}
                  {zone.name}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((zp) => (
                    <div key={zp.id} className="overflow-hidden rounded-xl border border-border bg-card">
                      <div className="aspect-[4/3] bg-muted">
                        <img src={zp.productImageUrl} alt={zp.productTitle} loading="lazy" className="h-full w-full object-cover" />
                      </div>
                      <div className="p-3">
                        <h3 className="font-display text-[13.5px] font-semibold text-foreground">{zp.productTitle}</h3>
                        {/* prices only — cost hidden */}
                        <p className="mt-1 font-mono-data text-base font-bold text-primary">${zp.salePrice.toLocaleString()}</p>
                        <p className="text-[11px] text-muted-foreground">數量 × {zp.quantity}</p>
                        <div className="mt-2.5 grid grid-cols-3 gap-1">
                          <button className="flex items-center justify-center gap-0.5 rounded-lg bg-emerald-500/10 px-1 py-1.5 text-[10.5px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20"><CheckCircle2 className="h-3 w-3" /> 確認</button>
                          <button className="flex items-center justify-center gap-0.5 rounded-lg bg-amber-500/10 px-1 py-1.5 text-[10.5px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20"><MessageCircle className="h-3 w-3" /> 討論</button>
                          <button className="flex items-center justify-center gap-0.5 rounded-lg border border-border px-1 py-1.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-accent"><Edit3 className="h-3 w-3" /> 修改</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
