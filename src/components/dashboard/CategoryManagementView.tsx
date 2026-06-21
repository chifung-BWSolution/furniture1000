import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  FolderTree, Upload, Save, Plus, Trash2, Loader2, Search, X, Check,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface L3Item { id: string; name: string; isNew?: boolean }
interface L2Item { id: string; name: string; isNew?: boolean; l3s: L3Item[] }
interface L1Group { id: string; name: string; isNew?: boolean; l2s: L2Item[] }

function isTemp(id: string) {
  return id.startsWith('new-') || id.startsWith('imp-') || id.startsWith('empty-');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTree(cats: any[]): L1Group[] {
  const l1s = cats.filter((c) => c.level === 1).sort((a, b) => a.sort_order - b.sort_order);
  const byParent = new Map<string, any[]>();
  cats.filter((c) => c.level === 2).forEach((c) => {
    const k = c.parent_id ?? '__root__';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(c);
  });

  return l1s.map((l1) => {
    const l2Records = (byParent.get(l1.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const l2s: L2Item[] = l2Records.map((l2) => {
      const l3Records = (byParent.get(l2.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
      return { id: l2.id, name: l2.name, l3s: l3Records.map((l3) => ({ id: l3.id, name: l3.name })) };
    });
    if (l2s.length === 0) {
      l2s.push({ id: `empty-${l1.id}`, name: '', isNew: true, l3s: [] });
    }
    return { id: l1.id, name: l1.name, l2s };
  });
}

function buildTreeFromExcel(rows: { l1: string; l2: string; l3: string }[]): L1Group[] {
  const l1Map = new Map<string, L1Group>();
  let li = 0, l2i = 0, l3i = 0;
  for (const row of rows) {
    if (!l1Map.has(row.l1)) {
      l1Map.set(row.l1, { id: `imp-l1-${li++}`, name: row.l1, isNew: true, l2s: [] });
    }
    const g = l1Map.get(row.l1)!;
    let l2 = g.l2s.find((x) => x.name === row.l2);
    if (!l2) {
      l2 = { id: `imp-l2-${l2i++}`, name: row.l2, isNew: true, l3s: [] };
      g.l2s.push(l2);
    }
    if (row.l3) {
      if (!l2.l3s.find((x) => x.name === row.l3)) {
        l2.l3s.push({ id: `imp-l3-${l3i++}`, name: row.l3, isNew: true });
      }
    }
  }
  return Array.from(l1Map.values());
}

function parseExcel(buf: ArrayBuffer): { l1: string; l2: string; l3: string }[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
  let curL1 = '', curL2 = '';
  const out: { l1: string; l2: string; l3: string }[] = [];
  rows.slice(1).forEach((r) => {
    const a = (r?.[0] ?? '').toString().trim();
    const b = (r?.[1] ?? '').toString().trim();
    const c = (r?.[2] ?? '').toString().trim();
    if (a) curL1 = a;
    if (b) curL2 = b;
    if (curL1 && curL2) out.push({ l1: curL1, l2: curL2, l3: c });
  });
  return out;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CategoryManagementView() {
  const [groups, setGroups] = useState<L1Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [deletedL1Ids, setDeletedL1Ids] = useState<string[]>([]);
  const [deletedL2Ids, setDeletedL2Ids] = useState<string[]>([]);
  const [deletedL3Ids, setDeletedL3Ids] = useState<string[]>([]);
  const [pendingImport, setPendingImport] = useState<L1Group[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bwf_product_categories')
        .select('id, name, parent_id, level, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;

      const cats = data || [];

      // Auto-purge orphan L1s (no L2 children) — these are garbled stale rows
      // from old migrations. The cascade delete also removes any orphan L2s.
      const l1Ids = new Set(cats.filter((c) => c.level === 1).map((c) => c.id));
      const l1sWithChildren = new Set(cats.filter((c) => c.level === 2 && c.parent_id && l1Ids.has(c.parent_id)).map((c) => c.parent_id));
      const orphanL1Ids = [...l1Ids].filter((id) => !l1sWithChildren.has(id));
      if (orphanL1Ids.length > 0) {
        await supabase.from('bwf_product_categories').delete().in('id', orphanL1Ids);
        // Reload after purge
        const { data: data2, error: err2 } = await supabase
          .from('bwf_product_categories')
          .select('id, name, parent_id, level, sort_order')
          .order('sort_order', { ascending: true });
        if (err2) throw err2;
        setGroups(buildTree(data2 || []));
      } else {
        setGroups(buildTree(cats));
      }

      setDeletedL1Ids([]);
      setDeletedL2Ids([]);
      setDeletedL3Ids([]);
      setDirty(false);
    } catch (err) {
      toast.error('載入分類失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Counts ──────────────────────────────────────────────────────────────────
  const totalL1 = groups.length;
  const totalL2 = groups.reduce((s, g) => s + g.l2s.filter((l) => l.name.trim()).length, 0);
  const totalL3 = groups.reduce((s, g) => s + g.l2s.reduce((s2, l2) => s2 + l2.l3s.filter((l) => l.name.trim()).length, 0), 0);

  // ── Filtered ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        l2s: g.l2s.filter(
          (l2) => g.name.includes(q) || l2.name.includes(q) || l2.l3s.some((l3) => l3.name.includes(q))
        ),
      }))
      .filter((g) => g.name.includes(q) || g.l2s.length > 0);
  }, [groups, search]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const setG = (fn: (prev: L1Group[]) => L1Group[]) => { setGroups(fn); setDirty(true); };

  const renameL1 = (id: string, name: string) =>
    setG((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));

  const renameL2 = (l1Id: string, l2Id: string, name: string) =>
    setG((prev) => prev.map((g) => g.id !== l1Id ? g : {
      ...g, l2s: g.l2s.map((l2) => (l2.id === l2Id ? { ...l2, name } : l2)),
    }));

  const renameL3 = (l1Id: string, l2Id: string, l3Id: string, name: string) =>
    setG((prev) => prev.map((g) => g.id !== l1Id ? g : {
      ...g, l2s: g.l2s.map((l2) => l2.id !== l2Id ? l2 : {
        ...l2, l3s: l2.l3s.map((l3) => (l3.id === l3Id ? { ...l3, name } : l3)),
      }),
    }));

  const addL1 = () =>
    setG((prev) => [...prev, {
      id: `new-l1-${Date.now()}`, name: '新分類', isNew: true,
      l2s: [{ id: `new-l2-${Date.now()}`, name: '', isNew: true, l3s: [] }],
    }]);

  const addL2 = (l1Id: string) =>
    setG((prev) => prev.map((g) => g.id !== l1Id ? g : {
      ...g, l2s: [...g.l2s, { id: `new-l2-${Date.now()}`, name: '', isNew: true, l3s: [] }],
    }));

  const addL3 = (l1Id: string, l2Id: string) =>
    setG((prev) => prev.map((g) => g.id !== l1Id ? g : {
      ...g, l2s: g.l2s.map((l2) => l2.id !== l2Id ? l2 : {
        ...l2, l3s: [...l2.l3s, { id: `new-l3-${Date.now()}`, name: '', isNew: true }],
      }),
    }));

  const deleteL1 = (id: string) => {
    if (!isTemp(id)) setDeletedL1Ids((d) => [...d, id]);
    setG((prev) => prev.filter((g) => g.id !== id));
  };

  const deleteL2 = (l1Id: string, l2Id: string) => {
    if (!isTemp(l2Id)) setDeletedL2Ids((d) => [...d, l2Id]);
    setG((prev) => prev.map((g) => g.id !== l1Id ? g : {
      ...g, l2s: g.l2s.filter((l2) => l2.id !== l2Id),
    }));
  };

  const deleteL3 = (l1Id: string, l2Id: string, l3Id: string) => {
    if (!isTemp(l3Id)) setDeletedL3Ids((d) => [...d, l3Id]);
    setG((prev) => prev.map((g) => g.id !== l1Id ? g : {
      ...g, l2s: g.l2s.map((l2) => l2.id !== l2Id ? l2 : {
        ...l2, l3s: l2.l3s.filter((l3) => l3.id !== l3Id),
      }),
    }));
  };

  // ── Excel import ─────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    try {
      const parsed = parseExcel(await file.arrayBuffer());
      if (parsed.length === 0) {
        toast.error('Excel 沒有可導入的分類', { description: '請確認格式：第一欄一級、第二欄二級、第三欄三級（可空）' });
        return;
      }
      setPendingImport(buildTreeFromExcel(parsed));
    } catch (err) {
      toast.error('Excel 解析失敗', { description: err instanceof Error ? err.message : '檔案格式錯誤' });
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    // Delete all existing real IDs — L1 cascade handles L2/L3
    const l1Del = groups.filter((g) => !isTemp(g.id)).map((g) => g.id);
    setDeletedL1Ids(l1Del);
    setDeletedL2Ids([]);
    setDeletedL3Ids([]);
    setGroups(pendingImport);
    setDirty(true);
    setPendingImport(null);
    const l2Count = pendingImport.reduce((s, g) => s + g.l2s.length, 0);
    const l3Count = pendingImport.reduce((s, g) => s + g.l2s.reduce((s2, l2) => s2 + l2.l3s.length, 0), 0);
    toast.success(`已導入 ${pendingImport.length} 個一級 · ${l2Count} 個二級 · ${l3Count} 個三級`, {
      description: '請按「儲存」寫入資料庫',
    });
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const save = async () => {
    setIsSaving(true);
    try {
      // 1) Delete removed L1s (cascade removes their L2/L3 children)
      const realL1Del = deletedL1Ids.filter((id) => !isTemp(id));
      if (realL1Del.length > 0) {
        const { error } = await supabase.from('bwf_product_categories').delete().in('id', realL1Del);
        if (error) throw error;
      }
      // 2) Delete removed L2s (cascade removes their L3 children)
      const realL2Del = deletedL2Ids.filter((id) => !isTemp(id));
      if (realL2Del.length > 0) {
        const { error } = await supabase.from('bwf_product_categories').delete().in('id', realL2Del);
        if (error) throw error;
      }
      // 3) Delete removed L3s
      const realL3Del = deletedL3Ids.filter((id) => !isTemp(id));
      if (realL3Del.length > 0) {
        const { error } = await supabase.from('bwf_product_categories').delete().in('id', realL3Del);
        if (error) throw error;
      }

      // 4) Upsert L1s → build id map
      const l1IdMap: Record<string, string> = {};
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (!g.name.trim()) continue;
        if (isTemp(g.id)) {
          const { data, error } = await supabase
            .from('bwf_product_categories')
            .insert({ name: g.name.trim(), parent_id: null, level: 1, sort_order: i })
            .select('id').single();
          if (error) throw error;
          l1IdMap[g.id] = data.id;
        } else {
          const { error } = await supabase
            .from('bwf_product_categories')
            .update({ name: g.name.trim(), sort_order: i })
            .eq('id', g.id);
          if (error) throw error;
          l1IdMap[g.id] = g.id;
        }
      }

      // 5) Upsert L2s → build id map
      const l2IdMap: Record<string, string> = {};
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const l1DbId = l1IdMap[g.id];
        if (!l1DbId) continue;
        for (let j = 0; j < g.l2s.length; j++) {
          const l2 = g.l2s[j];
          if (!l2.name.trim()) continue;
          if (isTemp(l2.id)) {
            const { data, error } = await supabase
              .from('bwf_product_categories')
              .insert({ name: l2.name.trim(), parent_id: l1DbId, level: 2, sort_order: j })
              .select('id').single();
            if (error) throw error;
            l2IdMap[l2.id] = data.id;
          } else {
            const { error } = await supabase
              .from('bwf_product_categories')
              .update({ name: l2.name.trim(), parent_id: l1DbId, sort_order: j })
              .eq('id', l2.id);
            if (error) throw error;
            l2IdMap[l2.id] = l2.id;
          }
        }
      }

      // 6) Upsert L3s (stored as level=2 with parent=L2.id)
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        for (let j = 0; j < g.l2s.length; j++) {
          const l2 = g.l2s[j];
          const l2DbId = l2IdMap[l2.id] ?? (!isTemp(l2.id) ? l2.id : null);
          if (!l2DbId) continue;
          for (let k = 0; k < l2.l3s.length; k++) {
            const l3 = l2.l3s[k];
            if (!l3.name.trim()) continue;
            if (isTemp(l3.id)) {
              const { error } = await supabase
                .from('bwf_product_categories')
                .insert({ name: l3.name.trim(), parent_id: l2DbId, level: 2, sort_order: k });
              if (error) throw error;
            } else {
              const { error } = await supabase
                .from('bwf_product_categories')
                .update({ name: l3.name.trim(), parent_id: l2DbId, sort_order: k })
                .eq('id', l3.id);
              if (error) throw error;
            }
          }
        }
      }

      toast.success('已儲存 Shopify 分類', {
        description: `${totalL1} 個一級 · ${totalL2} 個二級 · ${totalL3} 個三級`,
      });
      await load();
    } catch (err) {
      toast.error('儲存失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setIsSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">Shopify 分類</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">
            {totalL1} 個一級分類 · {totalL2} 個二級分類 · {totalL3} 個三級分類
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
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            儲存
          </button>
        </div>
      </div>

      {/* ── Info Banner ── */}
      <div className="flex items-center gap-2 border-b border-border bg-indigo-500/5 px-6 py-1.5">
        <FolderTree className="h-3 w-3 text-indigo-500" />
        <span className="text-[11px] text-indigo-500 font-body">
          管理 Shopify 產品分類（支援三級）。Excel 格式：第一欄一級、第二欄二級、第三欄三級（可空），由第二行起。儲存後寫入 bwf_product_categories。
        </span>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <FolderTree className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-display text-sm text-muted-foreground">尚無分類</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground"
            >
              <Upload className="h-3.5 w-3.5" /> 導入 Excel
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-4">
            {filtered.map((g) => (
              <div key={g.id} className="overflow-hidden rounded-xl border border-border bg-card">
                {/* L1 header */}
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                  <input
                    value={g.name}
                    onChange={(e) => renameL1(g.id, e.target.value)}
                    className="rounded-md border border-transparent bg-transparent px-2 py-1 font-display text-sm font-bold text-foreground hover:border-border focus:border-primary/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="flex items-center gap-2">
                    <span className="font-mono-data text-[11px] text-muted-foreground">
                      {g.l2s.filter((l) => l.name.trim()).length} 項
                    </span>
                    <button
                      onClick={() => deleteL1(g.id)}
                      className="rounded p-1 text-muted-foreground/60 hover:bg-rose-500/10 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* L2 + L3 rows */}
                <div className="divide-y divide-border/60">
                  {g.l2s.map((l2) => (
                    <div key={l2.id}>
                      {/* L2 row */}
                      <div className="flex items-center gap-2 px-4 py-2 hover:bg-muted/20">
                        <span className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold',
                          l2.isNew ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                        )}>
                          {l2.isNew ? '新' : '·'}
                        </span>
                        <input
                          value={l2.name}
                          onChange={(e) => renameL2(g.id, l2.id, e.target.value)}
                          placeholder="二級分類名稱"
                          className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-body text-[13px] text-foreground hover:border-border focus:border-primary/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                        <button
                          onClick={() => addL3(g.id, l2.id)}
                          title="新增三級分類"
                          className="rounded p-1 text-muted-foreground/40 hover:bg-primary/10 hover:text-primary"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteL2(g.id, l2.id)}
                          className="rounded p-1 text-muted-foreground/60 hover:bg-rose-500/10 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* L3 rows — indented */}
                      {l2.l3s.map((l3) => (
                        <div key={l3.id} className="flex items-center gap-2 py-1.5 pl-14 pr-4 hover:bg-muted/10">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/60 text-[9px] font-bold text-muted-foreground">
                            三
                          </span>
                          <input
                            value={l3.name}
                            onChange={(e) => renameL3(g.id, l2.id, l3.id, e.target.value)}
                            placeholder="三級分類名稱"
                            className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-0.5 font-body text-[12px] text-muted-foreground hover:border-border focus:border-primary/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <button
                            onClick={() => deleteL3(g.id, l2.id, l3.id)}
                            className="rounded p-1 text-muted-foreground/60 hover:bg-rose-500/10 hover:text-rose-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* Add L2 */}
                  <div className="px-4 py-1.5">
                    <button
                      onClick={() => addL2(g.id)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    >
                      <Plus className="h-3 w-3" /> 新增二級分類
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Add L1 */}
            <button
              onClick={addL1}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Plus className="h-4 w-4" /> 新增一級分類
            </button>
          </div>
        )}
      </div>

      {/* ── Import confirm dialog ── */}
      {pendingImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPendingImport(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-base font-bold">確認導入</h3>
              <button onClick={() => setPendingImport(null)} className="rounded p-1 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="font-body text-[13px] text-muted-foreground">
              已從 Excel 解析出{' '}
              <span className="font-bold text-primary">{pendingImport.length}</span> 個一級 ·{' '}
              <span className="font-bold text-primary">
                {pendingImport.reduce((s, g) => s + g.l2s.length, 0)}
              </span> 個二級 ·{' '}
              <span className="font-bold text-primary">
                {pendingImport.reduce((s, g) => s + g.l2s.reduce((s2, l2) => s2 + l2.l3s.length, 0), 0)}
              </span> 個三級分類。
              導入會<span className="font-semibold text-rose-500">取代</span>目前所有分類（儲存後才寫入資料庫）。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingImport(null)}
                className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={confirmImport}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" /> 確認導入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
