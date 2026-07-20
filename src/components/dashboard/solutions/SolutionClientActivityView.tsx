import { useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, MessageSquare, Search, ShoppingCart } from 'lucide-react';
import { fetchProjects, fetchDiscussions } from '@/lib/solutionsApi';
import { supabase } from '@/lib/supabase';
import type { DesignProject, ProductDiscussion } from '@/types/solutions';

type ActivityRow = {
  id: string;
  at: string;
  kind: 'discussion' | 'quote_request' | 'cart';
  title: string;
  detail: string;
  projectName?: string;
};

function fmt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-HK');
}

export function SolutionClientActivityView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const projectList = await fetchProjects();
      if (cancelled) return;
      setProjects(projectList);

      const discussionBatches = await Promise.all(
        projectList.slice(0, 12).map(async (p) => {
          const list = await fetchDiscussions(p.id);
          return list.map((d: ProductDiscussion) => ({
            id: `d-${d.id}`,
            at: d.createdAt,
            kind: 'discussion' as const,
            title: d.authorRole === 'client' ? '客戶留言／修改要求' : '內部回覆',
            detail: d.body,
            projectName: p.name,
          }));
        }),
      );

      // Soft-enrich with recent quote touchpoints (read-only; no schema change)
      let quoteRows: ActivityRow[] = [];
      try {
        const { data } = await supabase
          .from('bwf_quote')
          .select('id, quote_id, version, status, created_at, project_data')
          .order('created_at', { ascending: false })
          .limit(20);
        quoteRows = (data || []).map((q) => {
          const pd = (q.project_data || {}) as Record<string, unknown>;
          const form = (pd.formData || {}) as Record<string, unknown>;
          const client =
            String(form.clientName || form.clientContactName || '').trim() || '客戶';
          return {
            id: `q-${q.id}`,
            at: String(q.created_at || ''),
            kind: 'quote_request' as const,
            title: `報價互動 · ${q.quote_id || '—'} ${q.version || ''}`.trim(),
            detail: `${client} · 狀態 ${q.status || '—'}（Portal 可批核／提出更改）`,
            projectName: String(form.clientName || ''),
          };
        });
      } catch {
        quoteRows = [];
      }

      const cartDemo: ActivityRow[] = projectList.slice(0, 3).map((p, i) => ({
        id: `cart-${p.id}`,
        at: p.updatedAt || p.createdAt,
        kind: 'cart',
        title: '查詢車／產品關注',
        detail: `客戶在 Portal 產品搜尋加入關注項目（示意 #${i + 1}）`,
        projectName: p.name,
      }));

      const merged = [...discussionBatches.flat(), ...quoteRows, ...cartDemo].sort(
        (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
      );
      if (!cancelled) setRows(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q) ||
        (r.projectName || '').toLowerCase().includes(q),
    );
  }, [rows, keyword]);

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">客戶互動</h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            彙整 Client Portal 查詢、報價修改要求與討論紀錄（前端彙整現有專案／報價資料）
          </p>
          <p className="mt-1 font-mono-data text-[11px] text-muted-foreground">
            專案 {projects.length} · 活動 {rows.length}
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋客戶、專案或內容…"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <Activity className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 font-body text-sm text-muted-foreground">暫無互動紀錄</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-body text-[11px] font-medium text-primary">
                    {r.kind === 'discussion' ? (
                      <MessageSquare className="h-3 w-3" />
                    ) : r.kind === 'cart' ? (
                      <ShoppingCart className="h-3 w-3" />
                    ) : (
                      <Activity className="h-3 w-3" />
                    )}
                    {r.title}
                  </span>
                  {r.projectName ? (
                    <span className="font-body text-[11px] text-muted-foreground">{r.projectName}</span>
                  ) : null}
                  <span className="ml-auto font-mono-data text-[11px] text-muted-foreground">
                    {fmt(r.at)}
                  </span>
                </div>
                <p className="mt-2 font-body text-sm text-foreground/90 whitespace-pre-wrap">{r.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
