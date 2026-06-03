import { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  FolderTree, Upload, Save, Plus, Trash2, Loader2, Search, X, Check,
} from 'lucide-react';

interface CategoryRow {
  id: string;
  level1: string;
  level2: string;
  sortOrder: number;
  // local-only: marks rows added in the UI that aren't yet in DB
  isNew?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): CategoryRow {
  return { id: r.id, level1: r.level1, level2: r.level2, sortOrder: r.sort_order ?? 0 };
}

/** Parse the FDS category Excel: forward-fill 一級分類 down the rows. */
function parseCategoryExcel(buf: ArrayBuffer): { level1: string; level2: string }[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
  let cur = '';
  const out: { level1: string; level2: string }[] = [];
  // skip header row (index 0)
  rows.slice(1).forEach((r) => {
    const a = (r?.[0] ?? '').toString().trim();
    const b = (r?.[1] ?? '').toString().trim();
    if (a) cur = a;
    if (b) out.push({ level1: cur, level2: b });
  });
  return out;
}

export function ProductCategoryView() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  // ids of rows that exist in DB and were removed in the UI — deleted on save
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // pending rows from an Excel import, awaiting confirm-replace
  const [pendingImport, setPendingImport] = useState<{ level1: string; level2: string }[] | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('product_category')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setRows((data || []).map(mapRow));
      setDeletedIds([]);
      setDirty(false);
    } catch (err) {
      toast.error('載入分類失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // group by level1 for display, respecting current order
  const grouped = useMemo(() => {
    const q = search.trim();
    const filtered = q
      ? rows.filter((r) => r.level1.includes(q) || r.level2.includes(q))
      : rows;
    const map = new Map<string, CategoryRow[]>();
    filtered.forEach((r) => {
      if (!map.has(r.level1)) map.set(r.level1, []);
      map.get(r.level1)!.push(r);
    });
    return Array.from(map.entries());
  }, [rows, search]);

  const updateField = (id: string, field: 'level1' | 'level2', value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const addRow = (level1: string) => {
    const tempId = 'new-' + level1 + '-' + rows.length + '-' + rows.filter((r) => r.isNew).length;
    setRows((prev) => [...prev, { id: tempId, level1, level2: '', sortOrder: prev.length, isNew: true }]);
    setDirty(true);
  };

  const addCategory = () => {
    const tempId = 'new-cat-' + rows.length;
    setRows((prev) => [...prev, { id: tempId, level1: '新分類', level2: '', sortOrder: prev.length, isNew: true }]);
    setDirty(true);
  };

  const deleteRow = (id: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      // existing DB rows must be deleted on save; new rows just vanish
      if (target && !target.isNew) setDeletedIds((d) => [...d, id]);
      return prev.filter((r) => r.id !== id);
    });
    setDirty(true);
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseCategoryExcel(buf);
      if (parsed.length === 0) {
        toast.error('Excel 沒有可導入的分類', { description: '請確認第一欄為一級分類、第二欄為二級分類' });
        return;
      }
      setPendingImport(parsed);
    } catch (err) {
      toast.error('Excel 解析失敗', { description: err instanceof Error ? err.message : '檔案格式錯誤' });
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    // import replaces everything — existing DB rows must be deleted on save
    setDeletedIds((d) => [...d, ...rows.filter((r) => !r.isNew).map((r) => r.id)]);
    setRows(pendingImport.map((p, i) => ({
      id: 'imp-' + i, level1: p.level1, level2: p.level2, sortOrder: i, isNew: true,
    })));
    setDirty(true);
    setPendingImport(null);
    toast.success(`已導入 ${pendingImport.length} 筆分類`, { description: '請按「儲存」寫入資料庫' });
  };

  // Persist incrementally: delete removed rows, update existing rows, insert new
  // ones. sort_order is recomputed from each row's current position on screen.
  const save = async () => {
    setIsSaving(true);
    try {
      const valid = rows.filter((r) => r.level1.trim() && r.level2.trim());
      // sort_order = position in the current (full) row list, so ordering is stable
      const orderOf = new Map(rows.map((r, i) => [r.id, i]));

      // 1) delete rows the user removed (that existed in DB)
      if (deletedIds.length > 0) {
        const { error: delErr } = await supabase
          .from('product_category')
          .delete()
          .in('id', deletedIds);
        if (delErr) throw delErr;
      }

      // 2) update existing rows (id is a real DB uuid → not isNew)
      const existing = valid.filter((r) => !r.isNew);
      for (const r of existing) {
        const { error: updErr } = await supabase
          .from('product_category')
          .update({
            level1: r.level1.trim(),
            level2: r.level2.trim(),
            sort_order: orderOf.get(r.id) ?? 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', r.id);
        if (updErr) throw updErr;
      }

      // 3) insert new rows (let DB assign the uuid)
      const fresh = valid.filter((r) => r.isNew);
      if (fresh.length > 0) {
        const payload = fresh.map((r) => ({
          level1: r.level1.trim(),
          level2: r.level2.trim(),
          sort_order: orderOf.get(r.id) ?? 0,
        }));
        const { error: insErr } = await supabase.from('product_category').insert(payload);
        if (insErr) throw insErr;
      }

      toast.success('已儲存產品分類', {
        description: `更新 ${existing.length} 筆、新增 ${fresh.length} 筆、刪除 ${deletedIds.length} 筆`,
      });
      await load();
    } catch (err) {
      toast.error('儲存失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setIsSaving(false);
    }
  };

  const totalLevel2 = rows.filter((r) => r.level2.trim()).length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">產品分類</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">
            {grouped.length} 個一級分類 · {totalLevel2} 個二級分類
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋分類..."
              className="h-8 w-44 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Upload className="h-3.5 w-3.5" /> 導入 Excel
          </button>
          <button
            onClick={save}
            disabled={isSaving || !dirty}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 儲存
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-center gap-2 border-b border-border bg-indigo-500/5 px-6 py-1.5">
        <FolderTree className="h-3 w-3 text-indigo-500" />
        <span className="text-[11px] text-indigo-500 font-body">
          記錄目前產品分類。可直接編輯文字、新增/刪除分類，或由 Excel 導入（第一欄一級分類、第二欄二級分類）。儲存後寫入 Supabase product_category 表。
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <FolderTree className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-display text-sm text-muted-foreground">尚無產品分類</p>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground">
              <Upload className="h-3.5 w-3.5" /> 導入 Excel
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-4">
            {grouped.map(([level1, items]) => (
              <div key={level1} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                  <input
                    value={level1}
                    onChange={(e) => {
                      // rename the whole group's level1
                      const oldName = level1;
                      setRows((prev) => prev.map((r) => (r.level1 === oldName ? { ...r, level1: e.target.value } : r)));
                      setDirty(true);
                    }}
                    className="rounded-md border border-transparent bg-transparent px-2 py-1 font-display text-sm font-bold text-foreground hover:border-border focus:border-primary/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="font-mono-data text-[11px] text-muted-foreground">{items.length} 項</span>
                </div>
                <div className="divide-y divide-border/60">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 px-4 py-2 hover:bg-muted/20">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary">
                        {item.isNew ? '新' : '·'}
                      </span>
                      <input
                        value={item.level2}
                        onChange={(e) => updateField(item.id, 'level2', e.target.value)}
                        placeholder="二級分類名稱"
                        className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-body text-[13px] text-foreground hover:border-border focus:border-primary/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <button
                        onClick={() => deleteRow(item.id)}
                        className="rounded p-1 text-muted-foreground/60 hover:bg-rose-500/10 hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="px-4 py-1.5">
                    <button
                      onClick={() => addRow(level1)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    >
                      <Plus className="h-3 w-3" /> 新增二級分類
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={addCategory}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Plus className="h-4 w-4" /> 新增一級分類
            </button>
          </div>
        )}
      </div>

      {/* Import confirm dialog */}
      {pendingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPendingImport(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-base font-bold">確認導入</h3>
              <button onClick={() => setPendingImport(null)} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <p className="font-body text-[13px] text-muted-foreground">
              已從 Excel 解析出 <span className="font-bold text-primary">{pendingImport.length}</span> 筆二級分類。
              導入會<span className="font-semibold text-rose-500">取代</span>目前畫面上的所有分類（儲存後才寫入資料庫）。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingImport(null)} className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent">取消</button>
              <button onClick={confirmImport} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
                <Check className="h-3.5 w-3.5" /> 確認導入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
