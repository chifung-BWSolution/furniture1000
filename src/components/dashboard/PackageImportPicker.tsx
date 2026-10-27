import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listPackageSourceQuotes, loadPackageSourceItems, searchPackagePitchings, type PackagePitching, type PackageSourceQuote, type PackageSourceItem, type PackageSourceSection } from '@/lib/packagePricing';
import type { PackageLine } from '@/lib/packagePricingMath';

function normal(value: string) { return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''); }

export function PackageImportPicker({ template, onImport }: { template: PackageLine[]; onImport: (lines: PackageLine[], title: string) => void }) {
  const [search, setSearch] = useState('');
  const [pitchings, setPitchings] = useState<PackagePitching[]>([]);
  const [pitching, setPitching] = useState<PackagePitching | null>(null);
  const [quotes, setQuotes] = useState<PackageSourceQuote[]>([]);
  const [quote, setQuote] = useState('');
  const [items, setItems] = useState<PackageSourceItem[]>([]);
  const [sections, setSections] = useState<PackageSourceSection[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (pitching) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      void searchPackagePitchings(search).then(rows => { if (active) setPitchings(rows); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, pitching]);
  useEffect(() => {
    if (!pitching) return;
    let active = true; setLoading(true); setError(''); setQuotes([]); setQuote(''); setItems([]); setSections([]); setMatches({});
    void listPackageSourceQuotes(pitching.id).then(rows => { if (active) setQuotes(rows); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pitching]);
  useEffect(() => {
    if (!pitching || !quote) return;
    let active = true; setLoading(true); setError(''); setItems([]); setSections([]); setMatches({});
    void loadPackageSourceItems(pitching.id, quote).then(result => {
      if (!active) return;
      setSections(result.sections); setItems(result.items);
      const initial: Record<string, string> = {};
      for (const item of result.items) {
        const name = normal(item.item || '');
        const candidates = name ? template.filter(line => normal(line.itemName) === name && normal(line.unit) === normal(item.unit || '')) : [];
        if (candidates.length === 1) initial[item.id] = candidates[0].id;
      }
      setMatches(initial);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pitching, quote, template]);
  const importLines = () => {
    const lines = items.flatMap(item => {
      const base = template.find(line => line.id === matches[item.id]);
      if (!base) return [];
      const quantity = Number(item.quantity);
      return [{ ...base, id: item.id, templateId: base.id, sourcePitchingId: pitching?.id, sourceQuotationId: quote, sourceSectionId: item.section_id, sourceItem: item.item || '', sourceDescription: item.description || '', quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0 }];
    });
    onImport(lines, `${pitching?.pitching_code || '項目'} 套餐參考報價`);
  };
  return <div className="space-y-4 rounded-lg border p-4">
    <h2 className="font-medium">選擇項目及報價</h2>
    {!pitching ? <div className="space-y-2"><Input aria-label="搜尋 PMS 項目" placeholder="搜尋項目編號、客戶或大廈" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="max-h-60 overflow-auto divide-y">{pitchings.map(row => <button className="block w-full px-2 py-2 text-left text-sm hover:bg-muted" type="button" key={row.id} onClick={() => setPitching(row)}>{[row.pitching_code, row.real_customer_display_name, row.real_building_name].filter(Boolean).join(' · ') || row.id}</button>)}</div>
      {!loading && !pitchings.length && !error ? <p className="text-sm text-muted-foreground">找不到項目，請嘗試其他關鍵字。</p> : null}</div> : <>
      <div className="flex items-center justify-between gap-2 text-sm"><span>項目：{[pitching.pitching_code, pitching.real_customer_display_name, pitching.real_building_name].filter(Boolean).join(' · ')}</span><Button type="button" variant="outline" size="sm" onClick={() => setPitching(null)}>更換項目</Button></div>
      <Select value={quote} onValueChange={setQuote}><SelectTrigger aria-label="選擇項目報價"><SelectValue placeholder="選擇項目的報價" /></SelectTrigger><SelectContent>{quotes.map(q => <SelectItem key={q.id} value={q.id}>{[q.quotation_no || q.name || q.id, q.version_number != null ? `V${q.version_number}` : '', q.status, q.modified_date?.slice(0, 10)].filter(Boolean).join(' · ')}</SelectItem>)}</SelectContent></Select>
      {!loading && !quotes.length && !error ? <p className="text-sm text-muted-foreground">此項目沒有關聯報價。</p> : null}
      {quote && !loading && !error && !sections.length ? <p className="text-sm text-muted-foreground">此報價沒有傢私 section。</p> : null}
      {quote && !loading && !error && sections.length > 0 && !items.length ? <p className="text-sm text-muted-foreground">傢私 section 沒有明細。</p> : null}
      {items.length > 0 ? <div className="space-y-3"><p className="text-sm">請為每個傢私項目選擇 2026 工作表價目；名稱及單位完全相同且只有一個選項時會自動匹配。</p>{items.map(item => <div key={item.id} className="grid gap-2 border-t pt-3 sm:grid-cols-2"><div className="min-w-0 text-sm"><div className="font-medium">{item.item || '未命名項目'} · {item.quantity ?? '—'} {item.unit || ''}</div><div className="text-muted-foreground">{sections.find(section => section.id === item.section_id)?.name}{item.description ? ` · ${item.description}` : ''}</div></div><Select value={matches[item.id] || ''} onValueChange={value => setMatches(current => ({ ...current, [item.id]: value }))}><SelectTrigger aria-label={`選擇 ${item.item || '未命名項目'} 的 2026 價目`}><SelectValue placeholder="未匹配：選擇 2026 價目" /></SelectTrigger><SelectContent>{template.map(line => <SelectItem key={line.id} value={line.id}>{[line.area, line.itemName, line.grade, line.material, line.dimension, line.unit].filter(Boolean).join(' · ')}</SelectItem>)}</SelectContent></Select></div>)}<Button type="button" disabled={loading || items.some(item => !matches[item.id])} onClick={importLines}>導入 {items.length} 個項目</Button>{items.some(item => !matches[item.id]) ? <p className="text-sm text-muted-foreground">請先為所有未匹配項目選擇價目。</p> : null}</div> : null}
    </>}
    {loading ? <p className="text-sm">載入中…</p> : null}{error ? <p className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
