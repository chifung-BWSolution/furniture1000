import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  FileDown, Database, History, CheckCircle2, MessageSquare, ChevronDown,
  Clock, RotateCcw, GitCompare, Loader2,
} from 'lucide-react';
import { fetchProjects, fetchZones, fetchZoneProducts } from '@/lib/solutionsApi';
import type { DesignProject, ProjectZone, ZoneProduct } from '@/types/solutions';

const VERSIONS = [
  { id: 'v3', label: 'v1.3', date: '2026-06-01T14:20:00Z', note: '客戶確認最終版', current: true },
  { id: 'v2', label: 'v1.2', date: '2026-05-28T10:00:00Z', note: '調整會議室座椅' },
  { id: 'v1', label: 'v1.1', date: '2026-05-20T09:00:00Z', note: '初版方案' },
];

const CONFIRM_LOG = [
  { who: '陳大文（客戶）', action: '確認方案 A 全部產品', at: '2026-06-01T14:18:00Z' },
  { who: 'Amy（設計師）', action: '提交最終方案供確認', at: '2026-06-01T09:00:00Z' },
];

function fmt(d: string) {
  const x = new Date(d);
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export function ConfirmedProjectsView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);

  useEffect(() => {
    fetchProjects().then((rows) => {
      const eligible = rows.filter((p) => p.status === 'confirmed' || p.progress >= 60);
      const list = eligible.length > 0 ? eligible : rows;
      setProjects(list);
      if (list.length > 0) setProjectId((cur) => cur || list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([fetchZones(projectId), fetchZoneProducts(projectId)])
      .then(([z, zp]) => { setZones(z); setZoneProducts(zp); });
  }, [projectId]);

  const confirmedProjects = projects;
  const project = projects.find((p) => p.id === projectId);
  const confirmed = zoneProducts.filter((zp) => zp.status === 'confirmed');
  const total = confirmed.reduce((sum, zp) => sum + zp.salePrice * zp.quantity, 0);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 appearance-none rounded-lg border border-border bg-card pl-3 pr-9 font-display text-lg font-bold focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20">
                {confirmedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> 已確認
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Database className="h-3.5 w-3.5" /> 匯出至 PMS
            </button>
            <button className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90">
              <FileDown className="h-3.5 w-3.5" /> 生成方案 PDF
            </button>
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
                    {zone.code && <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono-data text-[10px] text-primary">{zone.code}</span>}
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

        {/* History versions + confirmation log */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-bold">歷史版本</h3>
            </div>
            <div className="space-y-2">
              {VERSIONS.map((v) => (
                <div key={v.id} className={cn('flex items-center justify-between rounded-lg border px-3 py-2', v.current ? 'border-primary/30 bg-primary/5' : 'border-border')}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-data text-[12px] font-bold text-foreground">{v.label}</span>
                    {v.current && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">目前</span>}
                    <span className="text-[11px] text-muted-foreground">{v.note}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono-data text-[10.5px] text-muted-foreground/70">{fmt(v.date)}</span>
                    {!v.current && (
                      <>
                        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="重新載入"><RotateCcw className="h-3.5 w-3.5" /></button>
                        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="比對"><GitCompare className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-bold">確認紀錄</h3>
            </div>
            <div className="space-y-3">
              {CONFIRM_LOG.map((log, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10"><Clock className="h-3 w-3 text-primary" /></span>
                    {i < CONFIRM_LOG.length - 1 && <span className="mt-1 h-full w-px bg-border" />}
                  </div>
                  <div className="pb-2">
                    <p className="font-body text-[12.5px] text-foreground"><span className="font-semibold">{log.who}</span> {log.action}</p>
                    <p className="font-mono-data text-[10.5px] text-muted-foreground/70">{fmt(log.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', highlight ? 'border-primary/30' : 'border-border')}>
      <p className="font-body text-[11.5px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-display text-xl font-bold', highlight ? 'text-primary' : 'text-foreground')}>{value}</p>
    </div>
  );
}
