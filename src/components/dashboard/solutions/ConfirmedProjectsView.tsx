import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, MessageSquare, ChevronDown, Clock, Loader2,
} from 'lucide-react';
import {
  fetchDiscussions,
  fetchProjects,
  fetchZones,
  fetchZoneProducts,
} from '@/lib/solutionsApi';
import type {
  DesignProject,
  ProductDiscussion,
  ProjectZone,
  ZoneProduct,
} from '@/types/solutions';

function fmt(d: string) {
  const x = new Date(d);
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export function ConfirmedProjectsView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);
  const [discussions, setDiscussions] = useState<ProductDiscussion[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchProjects().then((rows) => {
      const list = rows.filter((p) => p.status === 'confirmed');
      setProjects(list);
      if (list.length > 0) setProjectId((cur) => cur || list[0].id);
    }).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      fetchZones(projectId),
      fetchZoneProducts(projectId),
      fetchDiscussions(projectId),
    ]).then(([z, zp, records]) => {
      setZones(z);
      setZoneProducts(zp);
      setDiscussions(records);
    });
  }, [projectId]);

  const confirmedProjects = projects;
  const project = projects.find((p) => p.id === projectId);
  const confirmed = zoneProducts.filter((zp) => zp.status === 'confirmed');
  const total = confirmed.reduce((sum, zp) => sum + zp.salePrice * zp.quantity, 0);

  if (!project) {
    if (!loaded) {
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <CheckCircle2 className="h-8 w-8 text-primary" />
        </div>
        <h2 className="font-display text-lg font-bold">尚無已確定方案</h2>
        <p className="font-body text-sm text-muted-foreground">當客戶確認設計方案後，會在此顯示完整產品清單與總價</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight">已確定方案</h1>
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> 已確認
              </span>
            </div>
            <div className="relative mt-3 max-w-xl">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-border bg-card pl-3 pr-9 font-display text-sm font-semibold focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20">
                {confirmedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard label="已確認產品" value={`${confirmed.length} 件`} />
          <SummaryCard label="分區數" value={`${zones.length} 區`} />
          <SummaryCard label="方案總價" value={`$${total.toLocaleString()}`} highlight />
        </div>

        {/* Zone-grouped confirmed products */}
        <div className="space-y-4">
          {zones.map((zone) => {
            const items = confirmed.filter((zp) => zp.zoneId === zone.id);
            if (items.length === 0) return null;
            const zoneTotal = items.reduce((s, zp) => s + zp.salePrice * zp.quantity, 0);
            return (
              <div key={zone.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-2.5">
                  <h3 className="flex items-center gap-2 font-display text-sm font-bold">
                    {zone.code && <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono-data text-xs text-primary">{zone.code}</span>}
                    {zone.name}
                  </h3>
                  <span className="font-mono-data text-[12px] text-muted-foreground">小計 ${zoneTotal.toLocaleString()}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border/60">
                    {items.map((zp) => (
                      <tr key={zp.id} className="hover:bg-muted/20">
                        <td className="py-2.5 pl-5 pr-3">
                          <div className="flex items-center gap-3">
                            <img src={zp.productImageUrl} alt={zp.productTitle} loading="lazy" className="h-10 w-10 rounded-md object-cover bg-muted" />
                            <span className="font-body text-[13px] text-foreground">{zp.productTitle}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-muted-foreground">× {zp.quantity}</td>
                        <td className="px-3 py-2.5 text-right font-mono-data text-foreground">${zp.salePrice.toLocaleString()}</td>
                        <td className="py-2.5 pl-3 pr-5 text-right font-mono-data font-semibold text-primary">${(zp.salePrice * zp.quantity).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* Real project discussion records from Supabase */}
        <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-bold">專案互動紀錄</h3>
            </div>
            {discussions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Supabase 暫無互動紀錄</p>
            ) : (
              <div className="space-y-3">
              {discussions.map((record, i) => (
                <div key={record.id} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10"><Clock className="h-3 w-3 text-primary" /></span>
                    {i < discussions.length - 1 && <span className="mt-1 h-full w-px bg-border" />}
                  </div>
                  <div className="pb-2">
                    <p className="font-body text-[12.5px] text-foreground">
                      <span className="font-semibold">{record.author}</span> {record.body}
                    </p>
                    <p className="font-mono-data text-xs text-muted-foreground/70">{fmt(record.createdAt)}</p>
                  </div>
                </div>
              ))}
              </div>
            )}
            </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', highlight ? 'border-primary/30' : 'border-border')}>
      <p className="font-body text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-display text-xl font-bold', highlight ? 'text-primary' : 'text-foreground')}>{value}</p>
    </div>
  );
}
