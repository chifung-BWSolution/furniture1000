import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  FileText, Sparkles, Image as ImageIcon, History, Eye, ShieldCheck, ChevronLeft, RotateCcw,
} from 'lucide-react';
import { MOCK_COPY_PRODUCTS, type CopyProduct } from '@/constants/analytics-mock';
import { TIER_META } from '@/types/solutions';
import { toast } from 'sonner';

const COPY_STATUS_META: Record<CopyProduct['copyStatus'], { label: string; className: string }> = {
  optimized: { label: '已優化', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  draft: { label: '草稿', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  needs_work: { label: '待補充', className: 'bg-rose-500/15 text-rose-600 border-rose-500/30' },
};

const MOCK_VERSIONS = [
  { id: 'v3', label: 'v3', note: 'AI 優化描述', at: '2026-06-01 14:20', current: true },
  { id: 'v2', label: 'v2', note: '補充材質明細', at: '2026-05-28 10:00' },
  { id: 'v1', label: 'v1', note: '初版文案', at: '2026-05-20 09:00' },
];

export function PublishCopywritingView() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const product = MOCK_COPY_PRODUCTS.find((p) => p.id === activeId) ?? null;

  // editable draft state
  const [desc, setDesc] = useState('');
  const [material, setMaterial] = useState('');
  const [workmanship, setWorkmanship] = useState('');

  const openProduct = (p: CopyProduct) => {
    setActiveId(p.id);
    setDesc(p.description);
    setMaterial(p.material);
    setWorkmanship(p.workmanship);
  };

  // --- list view ---
  if (!product) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-6 py-3">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">產品文案</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">{MOCK_COPY_PRODUCTS.length} 件產品</span>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">產品</th>
                  <th className="px-3 py-2.5 text-left font-medium">分級</th>
                  <th className="px-3 py-2.5 text-left font-medium">60 字描述</th>
                  <th className="px-3 py-2.5 text-left font-medium">文案狀態</th>
                  <th className="px-3 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {MOCK_COPY_PRODUCTS.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-10 w-10 rounded-md object-cover bg-muted" />
                        <span className="font-body text-[13px] font-medium text-foreground">{p.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', TIER_META[p.tier].className)}>{TIER_META[p.tier].label}</span></td>
                    <td className="px-3 py-2.5 max-w-[280px]"><p className="line-clamp-1 text-[12px] text-muted-foreground">{p.description}</p></td>
                    <td className="px-3 py-2.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', COPY_STATUS_META[p.copyStatus].className)}>{COPY_STATUS_META[p.copyStatus].label}</span></td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => openProduct(p)} className="rounded-lg bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/20">編輯文案</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // --- editor view ---
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <button onClick={() => setActiveId(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> 返回列表
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => toast.success('已套用 AI 建議文案', { description: '描述、材質、做工已優化' })} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90">
            <Sparkles className="h-3.5 w-3.5" /> AI 建議文案
          </button>
          <button onClick={() => toast.success('正在生成氛圍圖...', { description: 'AI 氛圍圖約需 10 秒' })} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            <ImageIcon className="h-3.5 w-3.5" /> 生成氛圍圖
          </button>
          <button onClick={() => toast.success('已儲存，前往發佈前檢查')} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90">
            <ShieldCheck className="h-3.5 w-3.5" /> 儲存並檢查
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* editor */}
        <div className="flex-1 overflow-auto border-r border-border p-6">
          <div className="mx-auto max-w-xl space-y-4">
            <div className="flex items-center gap-3">
              <img src={product.imageUrl} alt={product.title} className="h-12 w-12 rounded-lg object-cover bg-muted" />
              <div>
                <h3 className="font-display text-base font-bold">{product.title}</h3>
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', TIER_META[product.tier].className)}>{TIER_META[product.tier].label}</span>
              </div>
            </div>
            <Field label="60 字描述" hint={`${desc.length}/60`}>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={80} rows={3} className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
            <Field label="材質明細">
              <input value={material} onChange={(e) => setMaterial(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
            <Field label="做工說明">
              <textarea value={workmanship} onChange={(e) => setWorkmanship(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>

            {/* version history */}
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="mb-2 flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h4 className="font-display text-sm font-bold">版本歷史</h4></div>
              <div className="space-y-1.5">
                {MOCK_VERSIONS.map((v) => (
                  <div key={v.id} className={cn('flex items-center justify-between rounded-lg border px-3 py-1.5', v.current ? 'border-primary/30 bg-primary/5' : 'border-border')}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-data text-[11px] font-bold">{v.label}</span>
                      {v.current && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] text-primary">目前</span>}
                      <span className="text-[11px] text-muted-foreground">{v.note}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-data text-[10px] text-muted-foreground/60">{v.at}</span>
                      {!v.current && <button onClick={() => toast.success(`已還原至 ${v.label}`)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><RotateCcw className="h-3.5 w-3.5" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* live preview */}
        <aside className="flex w-[380px] shrink-0 flex-col overflow-auto bg-sidebar p-5">
          <div className="mb-3 flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /><h4 className="font-display text-sm font-bold">即時預覽</h4></div>
          {/* lifestyle image */}
          <div className="aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted">
            {product.lifestyleImageUrl
              ? <img src={product.lifestyleImageUrl} alt="氛圍圖" className="h-full w-full object-cover" />
              : <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/50"><ImageIcon className="h-8 w-8" /><span className="text-[11px]">尚無氛圍圖</span></div>}
          </div>
          {/* card preview (as shown in quote / client scheme) */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <img src={product.imageUrl} alt={product.title} className="aspect-[4/3] w-full object-cover" />
            <div className="p-3">
              <h5 className="font-display text-[13.5px] font-semibold">{product.title}</h5>
              <p className="mt-1 line-clamp-2 font-body text-[11.5px] text-muted-foreground">{desc}</p>
              <p className="mt-2 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">材質：</span>{material}</p>
              <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">做工：</span>{workmanship}</p>
            </div>
          </div>
          <p className="mt-3 text-center text-[10.5px] text-muted-foreground/60">預覽文案在報價單與客戶方案中的顯示效果</p>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="font-body text-[12px] font-medium text-muted-foreground">{label}</label>
        {hint && <span className="font-mono-data text-[10px] text-muted-foreground/60">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
