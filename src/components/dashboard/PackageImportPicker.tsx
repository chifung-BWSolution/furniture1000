import { useEffect, useState } from 'react';
import { ProductSelectorModal } from '@/components/dashboard/ProductSelectorModal';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listPackageSourceQuotes, loadPackageSourceItems, searchPackagePitchings, type PackagePitching, type PackageSourceQuote, type PackageSourceItem, type PackageSourceSection } from '@/lib/packagePricing';
import { parsePackageQuantity, type PackageLine } from '@/lib/packagePricingMath';

function normal(value: string) { return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''); }

export function PackageImportPicker({ template, onImport, onStageChange }: { template: PackageLine[]; onImport: (lines: PackageLine[], title: string) => void; onStageChange?: (stage: number) => void }) {
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
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [products, setProducts] = useState<Record<string, { name: string; image: string; category?: string; productId?: string | null }>>({});
  const [candidates, setCandidates] = useState<Record<string, string[]>>({});
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [itemSearch, setItemSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');
  useEffect(() => { onStageChange?.(items.length ? 2 : 1); }, [items.length, onStageChange]);
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
    let active = true; setLoading(true); setError(''); setQuotes([]); setQuote(''); setItems([]); setSections([]); setMatches({}); setProducts({}); setCandidates({});
    void listPackageSourceQuotes(pitching.id).then(rows => { if (active) setQuotes(rows); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pitching]);
  useEffect(() => {
    if (!pitching || !quote) return;
    let active = true; setLoading(true); setError(''); setItems([]); setSections([]); setMatches({}); setProducts({}); setCandidates({});
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
    const quoteRow = quotes.find((row) => row.id === quote) ?? null;
    const lines = items.flatMap(item => {
      const base = template.find(line => line.id === matches[item.id]);
      if (!base) return [];
      const quantity = parsePackageQuantity(String(item.quantity ?? ''));
      const section = sections.find(section => section.id === item.section_id);
      return [{
        ...base,
        id: item.id,
        templateId: base.id,
        sourcePitchingId: pitching?.id,
        sourcePitchingCode: pitching?.pitching_code || undefined,
        sourceQuotationId: quote,
        sourceQuotationNo: quoteRow ? [quoteRow.quotation_no || quoteRow.name, quoteRow.version_number != null ? `V${quoteRow.version_number}` : ''].filter(Boolean).join(' ') : undefined,
        sourceSectionId: item.section_id,
        sourceSectionName: section?.name || undefined,
        selectedProduct: products[item.id],
        sourceItem: item.item || '',
        sourceDescription: item.description || '',
        quantity: Number.isFinite(quantity) ? quantity : Number.NaN,
      }];
    });
    onImport(lines, `${pitching?.pitching_code || '項目'} 套餐參考報價`);
  };
  const matchedCount = items.filter(item => Boolean(matches[item.id])).length;
  const remainingCount = items.length - matchedCount;
  return <section className="rounded-xl border bg-card">
    <div className="border-b px-5 py-4">
      <h2 className="font-semibold">選擇來源報價</h2>
      <p className="mt-1 text-sm text-muted-foreground">從項目報價帶入傢俬明細，再選擇傢俬並配對參考價目。</p>
    </div>
    <div className="space-y-4 p-5">
      {!pitching ? <div className="space-y-3">
        <Input aria-label="搜尋 PMS 項目" placeholder="搜尋項目編號、客戶或大廈" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="max-h-60 divide-y overflow-auto rounded-lg border">{pitchings.map(row => <button className="block w-full px-3 py-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" type="button" key={row.id} onClick={() => setPitching(row)}>
          <span className="font-medium">{row.pitching_code || row.id}</span>
          <span className="ml-3 text-muted-foreground">{[row.real_customer_display_name, row.real_building_name].filter(Boolean).join(' · ')}</span>
        </button>)}</div>
        {!loading && !pitchings.length && !error ? <p className="py-4 text-sm text-muted-foreground">找不到項目，請嘗試其他關鍵字。</p> : null}
      </div> : <>
        <div className="grid items-end gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">來源項目</span><Button type="button" variant="ghost" size="sm" onClick={() => setPitching(null)}>更換項目</Button></div>
            <p className="text-sm font-semibold">{pitching.pitching_code || pitching.id}</p>
            <p className="mt-1 text-sm text-muted-foreground">{[pitching.real_customer_display_name, pitching.real_building_name].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="min-w-0"><p className="mb-2 text-sm text-muted-foreground">來源報價單</p>
            <Select value={quote} onValueChange={setQuote}><SelectTrigger className="bg-background" aria-label="選擇項目報價"><SelectValue placeholder="選擇項目的報價" /></SelectTrigger><SelectContent>{quotes.map(q => <SelectItem key={q.id} value={q.id}>{[q.quotation_no || q.name || q.id, q.version_number != null ? `V${q.version_number}` : '', q.status, q.modified_date?.slice(0, 10)].filter(Boolean).join(' · ')}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        {!loading && !quotes.length && !error ? <p className="text-sm text-muted-foreground">此項目沒有關聯報價，請更換項目。</p> : null}
        {quote && !loading && !error && !sections.length ? <p className="text-sm text-muted-foreground">此報價沒有傢俬分區。</p> : null}
        {quote && !loading && !error && sections.length > 0 && !items.length ? <p className="text-sm text-muted-foreground">傢俬分區沒有明細。</p> : null}
      </>}
      {loading ? <p role="status" className="py-3 text-sm text-muted-foreground">載入中…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
    {items.length > 0 ? <>
      <div className="grid gap-4 border-t p-4 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-5 py-3">
        <h3 className="text-sm font-semibold">傢俬明細配對 <span className="ml-2 font-normal text-muted-foreground">{items.length} 項</span></h3>
        <p role="status" className="text-sm tabular-nums">已配對 {matchedCount} / {items.length}<span className="ml-3 text-muted-foreground">{remainingCount ? `尚餘 ${remainingCount} 項` : '全部完成，可導入'}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        {(['all', 'unmatched', 'matched'] as const).map(value => <Button key={value} type="button" size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>{value === 'all' ? `全部 ${items.length}` : value === 'matched' ? `已配對 ${matchedCount}` : `未配對 ${remainingCount}`}</Button>)}
        <Select value={sectionFilter} onValueChange={setSectionFilter}><SelectTrigger className="w-40" aria-label="篩選分區"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部分區</SelectItem>{sections.map(section => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}</SelectContent></Select>
        <Input className="ml-auto w-full sm:w-64" aria-label="搜尋明細" placeholder="搜尋項目或規格" value={itemSearch} onChange={event => setItemSearch(event.target.value)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed text-left text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>
            <th scope="col" className="w-12 px-4 py-3 font-medium">#</th>
            <th scope="col" className="w-[42%] px-4 py-3 font-medium">原報價項目 / 分區</th>
            <th scope="col" className="w-20 px-3 py-3 text-right font-medium">數量</th>
            <th scope="col" className="px-4 py-3 font-medium">傢俬及參考價目</th>
          </tr></thead>
          {sections.filter(section => sectionFilter === 'all' || sectionFilter === section.id).map(section => <tbody key={section.id} className="divide-y"><tr className="bg-primary/10"><th colSpan={4} scope="rowgroup" className="px-4 py-3 font-semibold text-primary">{section.name} <span className="ml-2 text-muted-foreground">({items.filter(item => item.section_id === section.id).length} 項)</span></th></tr>{items.map((item, index) => {
            if (item.section_id !== section.id || (sectionFilter !== 'all' && sectionFilter !== section.id)) return null;
            if ((sectionFilter !== 'all' && item.section_id !== sectionFilter) || (filter === 'matched' && !matches[item.id]) || (filter === 'unmatched' && matches[item.id]) || !`${item.item || ''} ${item.description || ''}`.toLowerCase().includes(itemSearch.trim().toLowerCase())) return null;
            const selected = template.find(line => line.id === matches[item.id]);
            return <tr key={item.id} className="align-top transition-colors hover:bg-muted/25">
              <td className="px-4 py-4 text-xs tabular-nums text-muted-foreground">{index + 1}</td>
              <td className="px-4 py-3"><p className="break-words font-medium leading-6">{item.item || '未命名項目'}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{sections.find(section => section.id === item.section_id)?.name}</p>
                {item.description ? <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.description}</p> : null}
              </td>
              <td className="px-3 py-4 text-right tabular-nums">{item.quantity ?? '—'}<span className="ml-1 text-xs text-muted-foreground">{item.unit || ''}</span></td>
              <td className="px-4 py-3"><Button type="button" variant="outline" className="mb-2 w-full justify-start" onClick={() => setActiveItem(item.id)}>{products[item.id]?.name || '選擇傢俬'}</Button><Select value={matches[item.id] || ''} onValueChange={value => setMatches(current => ({ ...current, [item.id]: value }))}>
                <SelectTrigger className="h-auto min-h-10 bg-background text-left whitespace-normal [&>span]:line-clamp-none" aria-label={`選擇 ${item.item || '未命名項目'} 的參考價目`}><SelectValue placeholder="選擇對應價目">{selected ? selected.itemName : undefined}</SelectValue></SelectTrigger>
                <SelectContent position="popper" className="max-w-[min(90vw,640px)]">{template.filter(line => !candidates[item.id]?.length || candidates[item.id].includes(line.id)).map(line => <SelectItem className="py-2" key={line.id} value={line.id}><span className="block font-medium">{line.itemName}</span><span className="block text-xs text-muted-foreground">{[line.area, line.grade, line.material, line.dimension, line.unit].filter(Boolean).join(' · ')}</span></SelectItem>)}</SelectContent>
              </Select>
              {selected ? <p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">{[selected.area, selected.grade, selected.material, selected.dimension, selected.unit].filter(Boolean).join(' · ')}</p> : <p className="mt-1.5 text-xs text-muted-foreground">尚未配對</p>}
              </td>
            </tr>;
          })}</tbody>)}
        </table>
      </div>
      </div>
      <aside className="h-fit rounded-lg border bg-card p-5 xl:sticky xl:top-4">
        <h3 className="font-semibold">報價進度</h3>
        <div className="mt-4 flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-primary text-sm font-semibold tabular-nums">{Math.round(matchedCount / items.length * 100)}%</div><div className="text-sm text-muted-foreground">已配對 <strong className="block text-xl text-foreground">{matchedCount} / {items.length}</strong></div><div className="text-sm text-muted-foreground">尚餘 <strong className="block text-xl text-foreground">{remainingCount}</strong></div></div>
        <div className="mt-5 space-y-3 border-t pt-4 text-sm"><div><p className="text-muted-foreground">來源項目</p><p className="mt-1 font-medium">{pitching?.pitching_code}</p></div><div><p className="text-muted-foreground">來源報價單</p><p className="mt-1 font-medium">{quotes.find(row => row.id === quote)?.quotation_no || '—'}</p></div></div>
        <Button type="button" variant="outline" className="mt-4 w-full" onClick={() => { setMatches(current => { const next = { ...current }; for (const item of items) { if (next[item.id]) continue; const name = normal(item.item || ''); const possible = name ? template.filter(line => normal(line.itemName) === name && normal(line.unit) === normal(item.unit || '')) : []; if (possible.length === 1) next[item.id] = possible[0].id; } return next; }); }}>自動推薦</Button>
        <p className="mt-2 text-xs text-muted-foreground">名稱及單位完全一致時自動配對，其餘項目請手動選擇。</p>
        <div className="mt-5 border-t pt-4"><h4 className="text-sm font-semibold">項目分布</h4>{sections.map(section => <div key={section.id} className="mt-2 flex justify-between gap-2 text-sm text-muted-foreground"><span>{section.name}</span><span>{items.filter(item => item.section_id === section.id).length}</span></div>)}</div>
      </aside>
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-card px-5 py-4">
        <p className="text-sm text-muted-foreground">{remainingCount ? `完成剩餘 ${remainingCount} 項配對後，即可導入試算。` : '所有項目已配對，導入後可調整數量。'}</p>
        <Button type="button" disabled={loading || remainingCount > 0} onClick={importLines}>導入 {items.length} 個項目</Button>
      </div>
    </> : null}
    <ProductSelectorModal singleSelect open={Boolean(activeItem)} onClose={() => setActiveItem(null)} onSelect={async selectedProducts => {
      const itemId = activeItem;
      if (!itemId || selectedProducts.length !== 1) { if (selectedProducts.length !== 1) setError('請只選擇一件傢俬。'); return; }
      const product = selectedProducts[0];
      setError('');
      setProducts(current => ({ ...current, [itemId]: product }));
      let category = product.category || '';
      if (product.productCategoryId) {
        const result = await supabase.from('product_category').select('level1,level2').eq('id', product.productCategoryId).maybeSingle();
        category = [result.data?.level2, result.data?.level1, category].filter(Boolean).join(' ');
      }
      const terms = category.split(/[\s/／,，]+/).map(normal).filter(term => term.length >= 2);
      const exact = template.filter(line => terms.some(term => normal(line.itemName) === term));
      const compatible = exact.length ? exact : template.filter(line => terms.some(term => normal(line.itemName).includes(term) || (normal(line.itemName).length >= 2 && term.includes(normal(line.itemName)))));
      setCandidates(current => ({ ...current, [itemId]: compatible.map(line => line.id) }));
      setMatches(current => { const next = { ...current }; delete next[itemId]; if (compatible.length === 1) next[itemId] = compatible[0].id; return next; });
    }} />
  </section>;
}
