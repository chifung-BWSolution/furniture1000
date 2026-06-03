import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ShieldCheck, Check, X, Sparkles, Wand2, UploadCloud, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { MOCK_CHECK_ITEMS, CHECK_LABELS, type CheckItem } from '@/constants/analytics-mock';
import { toast } from 'sonner';

type CheckKey = keyof Omit<CheckItem, 'id' | 'product'>;
const CHECK_KEYS: CheckKey[] = ['imageResolution', 'requiredFields', 'pricingFormula', 'tierTag'];

export function PublishPrecheckView() {
  const [items, setItems] = useState<CheckItem[]>(MOCK_CHECK_ITEMS);

  const totalChecks = items.length * CHECK_KEYS.length;
  const passedChecks = items.reduce((sum, it) => sum + CHECK_KEYS.filter((k) => it[k]).length, 0);
  const passRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
  const failingItems = items.filter((it) => CHECK_KEYS.some((k) => !it[k]));
  const allPass = failingItems.length === 0;

  const fixOne = (id: string, key: CheckKey) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [key]: true } : it)));
    toast.success('已修正', { description: CHECK_LABELS[key] });
  };
  const fixAll = () => {
    setItems((prev) => prev.map((it) => ({ ...it, imageResolution: true, requiredFields: true, pricingFormula: true, tierTag: true })));
    toast.success('已套用全部建議修正', { description: '所有檢查項目已通過' });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">發佈前檢查</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">{items.length} 件待檢查</span>
        </div>
        <button
          disabled={!allPass}
          onClick={() => toast.success('已送往準備上載', { description: '檢查全部通過' })}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          <UploadCloud className="h-3.5 w-3.5" /> 進入準備上載
        </button>
      </div>

      {/* Pass-rate banner */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl', allPass ? 'bg-emerald-500/15' : 'bg-amber-500/15')}>
              {allPass ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-amber-600" />}
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-foreground">{passRate}%</p>
              <p className="font-body text-[11px] text-muted-foreground">整體通過率</p>
            </div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex gap-6">
            <div><p className="font-display text-lg font-bold text-emerald-600">{passedChecks}</p><p className="text-[11px] text-muted-foreground">通過項目</p></div>
            <div><p className="font-display text-lg font-bold text-rose-600">{totalChecks - passedChecks}</p><p className="text-[11px] text-muted-foreground">需修正項目</p></div>
          </div>
          <div className="ml-auto">
            <button onClick={fixAll} disabled={allPass} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50">
              <Wand2 className="h-3.5 w-3.5" /> 一鍵批量修正
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* checklist */}
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">產品</th>
                  {CHECK_KEYS.map((k) => <th key={k} className="px-3 py-2.5 text-center font-medium">{CHECK_LABELS[k]}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-body text-[13px] font-medium text-foreground">{it.product}</td>
                    {CHECK_KEYS.map((k) => (
                      <td key={k} className="px-3 py-2.5 text-center">
                        {it[k] ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600"><Check className="h-3.5 w-3.5" /></span>
                        ) : (
                          <button onClick={() => fixOne(it.id, k)} title="點擊修正" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 hover:bg-rose-500/25">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI suggestions */}
        <aside className="flex w-[340px] shrink-0 flex-col overflow-auto border-l border-border bg-sidebar p-5">
          <div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h4 className="font-display text-sm font-bold">AI 修正建議</h4></div>
          {allPass ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <p className="font-display text-sm font-bold text-emerald-700">全部檢查通過</p>
              <p className="text-[11px] text-muted-foreground">可進入準備上載流程</p>
            </div>
          ) : (
            <div className="space-y-2">
              {failingItems.map((it) => (
                <div key={it.id} className="rounded-xl border border-border bg-card p-3">
                  <p className="font-display text-[12.5px] font-semibold text-foreground">{it.product}</p>
                  <ul className="mt-1.5 space-y-1">
                    {CHECK_KEYS.filter((k) => !it[k]).map((k) => (
                      <li key={k} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground"><AlertTriangle className="h-3 w-3 text-amber-500" /> {CHECK_LABELS[k]} 不通過</span>
                        <button onClick={() => fixOne(it.id, k)} className="rounded bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary hover:bg-primary/20">修正</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
