import { useEffect, useState } from 'react';
import { ChevronLeft, FileText, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SourcePageDialog } from '@/components/dashboard/SourcePageDialog';
import { FurnitureSearchView } from '@/components/dashboard/FurnitureSearchView';
import {
  fetchDesignerCatalogs,
  type CatalogDocType,
  type CatalogDocument,
  type CatalogList,
  type CatalogStatus,
} from '@/lib/designerCatalogs';

const ALL = '__all';

const DOC_TYPES: { id: '' | CatalogDocType; label: string }[] = [
  { id: '', label: '全部 PDF' },
  { id: 'catalog', label: '產品目錄' },
  { id: 'quote', label: '報價 PDF' },
];

const STATUS_LABEL: Record<CatalogStatus, string> = {
  uploaded: '已上載',
  parsing: '解析中',
  review: '待審',
  ready: '可瀏覽',
  failed: '分析失敗',
};

const KIND_LABEL: Record<string, string> = {
  cover: '封面',
  toc: '目錄',
  product: '產品',
  price_table: '報價表',
  terms: '條款',
  other: '其他',
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function segmentLabel(segment: CatalogDocument['segments'][number]): string {
  const pages = segment.start_page === segment.end_page
    ? `第 ${segment.start_page} 頁`
    : `第 ${segment.start_page}–${segment.end_page} 頁`;
  const name = segment.title?.trim() || KIND_LABEL[segment.kind] || '分段';
  return `${pages} · ${name}`;
}

export function DesignerPdfView() {
  const [query, setQuery] = useState('');
  const [factory, setFactory] = useState('');
  const [docType, setDocType] = useState<'' | CatalogDocType>('');
  const [list, setList] = useState<CatalogList | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CatalogDocument | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const debounced = useDebounced(query, 300);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => fetchDesignerCatalogs({ query: debounced, factory, docType })
      .then((next) => {
        if (!cancelled) {
          setList(next);
          if (next.items.some((doc) => doc.status === 'parsing' || doc.status === 'uploaded')) {
            timer = setTimeout(refresh, 5000);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) toast.error('讀取產品 PDF 失敗', { description: errorText(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    refresh();
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [debounced, factory, docType]);

  if (selected) {
    const firstProduct = selected.segments.find((segment) => segment.kind === 'product') ?? selected.segments[0];
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setSelected(null); setSourceOpen(false); }}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            全部 PDF
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{selected.title || '未命名 PDF'}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[selected.factory_name, selected.doc_type === 'quote' ? '報價 PDF' : '產品目錄', selected.page_count ? `${selected.page_count} 頁` : null, `${selected.product_count} 件產品`]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          {list?.can_open_source && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setSourceOpen(true)}>
              <FileText className="mr-1 h-3.5 w-3.5" />
              開原文
            </Button>
          )}
        </div>
        {selected.segments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2">
            {selected.segments.map((segment) => (
              <span
                key={segment.seq}
                className="shrink-0 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
              >
                {segmentLabel(segment)}
              </span>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <FurnitureSearchView documentId={selected.id} />
        </div>
        {sourceOpen && (
          <SourcePageDialog
            request={{
              documentId: selected.id,
              pageNo: firstProduct?.start_page ?? 1,
              title: selected.title,
            }}
            onClose={() => setSourceOpen(false)}
          />
        )}
      </div>
    );
  }

  const items = list?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 fds-page-padding">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-64 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋廠家、PDF 名稱或分段（例：辦公台）"
            className="pl-8"
          />
        </div>
        <Select value={factory || ALL} onValueChange={(v) => setFactory(v === ALL ? '' : v)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="廠家" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部廠家</SelectItem>
            {(list?.factories ?? []).map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {DOC_TYPES.map((type) => (
          <Button
            key={type.id || 'all'}
            size="sm"
            variant={docType === type.id ? 'default' : 'outline'}
            className="h-8"
            onClick={() => setDocType(type.id)}
          >
            {type.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? '載入中…' : `${items.length.toLocaleString()} 份 PDF`}
          {!list?.can_open_source && ' · 原文只限管理員與上載同事開啟'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !list ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
          </div>
        ) : items.length === 0 ? (
          <div className="py-24 text-center text-sm text-muted-foreground">沒有符合的產品 PDF</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="hidden grid-cols-[minmax(0,1fr)_8rem_10rem_5rem_6rem] gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground lg:grid" aria-hidden="true">
              <span>PDF 名稱 / 廠家</span><span>類型</span><span>狀態</span><span className="text-right">頁數</span><span className="text-right">產品數量</span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((doc) => {
                const progress = typeof doc.parsing_progress === 'number' && Number.isFinite(doc.parsing_progress)
                  ? Math.round(Math.max(0, Math.min(1, doc.parsing_progress)) * 100)
                  : null;
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(doc)}
                      className="grid w-full grid-cols-2 items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[minmax(0,1fr)_8rem_10rem_5rem_6rem]"
                    >
                      <div className="col-span-2 flex min-w-0 items-start gap-2 lg:col-span-1">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold">{doc.title || '未命名 PDF'}</div>
                          <div className="text-xs text-muted-foreground">{doc.factory_name || '未指定廠家'}</div>
                          {doc.segments.length > 0 && (
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {doc.segments.slice(0, 4).map(segmentLabel).join(' / ')}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{doc.doc_type === 'quote' ? '報價 PDF' : '產品目錄'}</span>
                      <span className="flex items-center gap-1.5 text-xs tabular-nums">
                        {doc.status === 'parsing' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none text-primary" />}
                        {STATUS_LABEL[doc.status] ?? doc.status}
                        {doc.status === 'parsing' && progress !== null && ` ${progress}%`}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground lg:text-right">{doc.page_count != null ? `${doc.page_count} 頁` : '—'}</span>
                      <span className="text-xs tabular-nums text-muted-foreground lg:text-right">{doc.product_count} 件產品</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
