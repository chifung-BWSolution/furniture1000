import { useMemo, useState } from 'react';
import { BookOpenText, FileText, Search } from 'lucide-react';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { prdDocGroups, prdDocs, type PrdDoc, type PrdDocGroup } from '@/lib/prd-docs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const pageSize = 12;

export function PrdDescriptionsView() {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<'all' | PrdDocGroup>('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(prdDocs[0]?.id ?? '');

  const filtered = useMemo(
    () =>
      prdDocs.filter(
        (doc) =>
          (group === 'all' || doc.group === group) &&
          [doc.title, doc.slug, doc.path].join(' ').toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [group, search],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selected = prdDocs.find((doc) => doc.id === selectedId) ?? filtered[0] ?? null;
  const html = useMemo(
    () => (selected ? renderMarkdownToHtml(selected.content) : ''),
    [selected],
  );

  const selectDoc = (doc: PrdDoc) => setSelectedId(doc.id);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <BookOpenText className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold">PRD功能描述</h1>
          <p className="mt-1 max-w-3xl font-body text-sm text-muted-foreground">
            唯讀顯示本系統的 Markdown：逐頁功能描述（docs/prd）及系統說明。修改版面後請同步更新對應文檔。
          </p>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="space-y-3 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜尋文檔"
                value={search}
                placeholder="搜尋文檔名稱或路徑"
                className="pl-9"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {([['all', '全部'], ...prdDocGroups.map((item) => [item, item] as const)] as const).map(([key, label]) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={group === key ? 'default' : 'outline'}
                  onClick={() => {
                    setGroup(key);
                    setPage(1);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="p-6 text-center font-body text-sm text-muted-foreground">找不到符合條件的文檔</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((doc) => {
                const active = doc.id === selected?.id;
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => selectDoc(doc)}
                      className={`w-full px-4 py-3 text-left transition hover:bg-muted/60 ${active ? 'bg-primary/5' : ''}`}
                    >
                      <p className="font-body text-sm font-semibold text-foreground">{doc.title}</p>
                      <p className="mt-0.5 truncate font-mono-data text-[11px] text-muted-foreground">{doc.shortPath}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant="secondary">{doc.group}</Badge>
                        <span className="text-[11px] text-muted-foreground">{doc.date ?? '未標示日期'}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <span>{filtered.length} 份文檔</span>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一頁
              </Button>
              <span>{page} / {totalPages}</span>
              <Button type="button" size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一頁
              </Button>
            </div>
          </div>
        </section>

        <article className="min-w-0 rounded-xl border border-border bg-card">
          {selected ? (
            <>
              <div className="border-b border-border p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{selected.group}</Badge>
                  <Badge variant="outline">唯讀</Badge>
                </div>
                <h2 className="font-display text-lg font-bold">{selected.title}</h2>
                <p className="mt-1 break-all font-mono-data text-[11px] text-muted-foreground">{selected.path}</p>
                <p className="mt-1 text-xs text-muted-foreground">最後更新：{selected.date ?? '未標示日期'}</p>
              </div>
              <div
                className="prd-markdown max-w-none p-5 font-body text-sm leading-relaxed text-foreground [&_a]:text-primary [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol]:my-2 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <FileText className="h-6 w-6" />
              <p className="font-body text-sm">尚未有文檔</p>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
