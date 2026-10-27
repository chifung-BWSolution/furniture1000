import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LoadingImage } from '@/components/ui/loading-image';
import {
  QUOTE_CATALOG_PAGE_LIMIT,
  catalogPageKey,
  catalogPageLabel,
  fetchQuoteCatalogPdf,
  listQuoteCatalogs,
  type QuoteCatalogOption,
  type QuoteCatalogPage,
} from '@/lib/quoteCatalogPages';
import { renderQuotePdfPages } from '@/lib/quotationPdfCanvas';

interface QuoteCatalogPagesDialogProps {
  open: boolean;
  pages: QuoteCatalogPage[];
  showSource: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (pages: QuoteCatalogPage[], showSource: boolean) => void;
}

function pageFromCatalog(catalog: QuoteCatalogOption, pageNo: number): QuoteCatalogPage {
  return {
    documentId: catalog.id,
    pageNo,
    factoryName: catalog.factory_name,
    title: catalog.title,
    documentYear: catalog.document_year,
    series: catalog.series,
  };
}

export function QuoteCatalogPagesDialog({
  open,
  pages,
  showSource,
  onOpenChange,
  onConfirm,
}: QuoteCatalogPagesDialogProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [catalogs, setCatalogs] = useState<QuoteCatalogOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftPages, setDraftPages] = useState<QuoteCatalogPage[]>([]);
  const [draftSource, setDraftSource] = useState(true);
  const [manualPage, setManualPage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraftPages(pages);
    setDraftSource(showSource);
    setPreviewUrl(null);
    setError(null);
    setManualPage('');
  }, [open, pages, showSource]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listQuoteCatalogs(debouncedQuery)
      .then((rows) => {
        if (cancelled) return;
        setCatalogs(rows);
        setActiveId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '圖冊未能載入');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedQuery]);

  const active = catalogs.find((catalog) => catalog.id === activeId) ?? null;
  const selectedKeys = new Set(draftPages.map(catalogPageKey));

  const togglePage = (catalog: QuoteCatalogOption, pageNo: number) => {
    const key = catalogPageKey({ documentId: catalog.id, pageNo });
    setError(null);
    setDraftPages((current) => {
      if (current.some((page) => catalogPageKey(page) === key)) {
        return current.filter((page) => catalogPageKey(page) !== key);
      }
      if (current.length >= QUOTE_CATALOG_PAGE_LIMIT) {
        setError(`一次最多 ${QUOTE_CATALOG_PAGE_LIMIT} 頁`);
        return current;
      }
      return [...current, pageFromCatalog(catalog, pageNo)];
    });
  };

  const addManualPage = () => {
    if (!active) return;
    const pageNo = Number(manualPage);
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      setError('請輸入正整數頁碼');
      return;
    }
    if (active.page_count != null && pageNo > active.page_count) {
      setError('頁碼超出這份圖冊的頁數');
      return;
    }
    togglePage(active, pageNo);
    setManualPage('');
  };

  const movePage = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= draftPages.length) return;
    setDraftPages((current) => {
      const copy = [...current];
      const [row] = copy.splice(index, 1);
      copy.splice(next, 0, row);
      return copy;
    });
  };

  const previewPage = async (page: QuoteCatalogPage) => {
    setPreviewing(true);
    setError(null);
    try {
      const bytes = await fetchQuoteCatalogPdf([page]);
      const rendered = await renderQuotePdfPages(bytes);
      setPreviewUrl(rendered[0]?.dataUrl ?? null);
      if (!rendered[0]) setError('這一頁未能預覽');
    } catch (err) {
      setError(err instanceof Error ? err.message : '這一頁未能預覽');
    } finally {
      setPreviewing(false);
    }
  };

  const pageNumbers = active?.page_count && active.page_count > 0
    ? Array.from({ length: Math.min(active.page_count, 240) }, (_, index) => index + 1)
    : [];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="5xl"
      title="圖冊附件"
      description="選擇圖冊的整頁。頁碼可以不連續，也可以來自不同圖冊。框選裁剪稍後再做。"
      footer={
        <>
          <ModalButton variant="secondary" onClick={() => onOpenChange(false)}>取消</ModalButton>
          <ModalButton onClick={() => onConfirm(draftPages, draftSource)}>完成</ModalButton>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋廠家、系列或標題"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在讀取圖冊
            </p>
          ) : catalogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">沒有可選的圖冊。</p>
          ) : (
            <div className="flex max-h-36 flex-wrap gap-2 overflow-auto">
              {catalogs.map((catalog) => (
                <button
                  key={catalog.id}
                  type="button"
                  onClick={() => setActiveId(catalog.id)}
                  className={`rounded-md border px-2 py-1 text-left text-xs ${
                    catalog.id === activeId ? 'border-primary bg-primary/10' : 'border-border'
                  }`}
                >
                  <span className="font-medium">{catalog.factory_name}</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    {[catalog.document_year, catalog.series, catalog.title].filter(Boolean).join(' · ') || '未命名圖冊'}
                    {catalog.page_count ? ` · ${catalog.page_count} 頁` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          {active ? (
            <div>
              {pageNumbers.length > 0 ? (
                <div className="flex max-h-48 flex-wrap gap-1 overflow-auto">
                  {pageNumbers.map((pageNo) => {
                    const on = selectedKeys.has(catalogPageKey({ documentId: active.id, pageNo }));
                    return (
                      <button
                        key={pageNo}
                        type="button"
                        onClick={() => togglePage(active, pageNo)}
                        className={`h-8 min-w-8 rounded border px-2 text-xs ${
                          on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                        }`}
                      >
                        {pageNo}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={manualPage}
                    onChange={(event) => setManualPage(event.target.value)}
                    inputMode="numeric"
                    placeholder="頁碼"
                    className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addManualPage}>加入頁碼</Button>
                </div>
              )}
              {active.page_count != null && active.page_count > pageNumbers.length ? (
                <p className="mt-2 text-xs text-muted-foreground">頁數較多，這裡先列出前 {pageNumbers.length} 頁。</p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>頁底顯示來源</span>
            <Switch checked={draftSource} onCheckedChange={setDraftSource} />
          </label>
          <p className="text-xs text-muted-foreground">已選 {draftPages.length} / {QUOTE_CATALOG_PAGE_LIMIT} 頁，順序即報價 PDF 附件順序。</p>
          <ul className="max-h-52 space-y-1 overflow-auto">
            {draftPages.map((page, index) => (
              <li key={catalogPageKey(page)} className="flex items-center gap-1 rounded border border-border px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-xs">{catalogPageLabel(page)}</span>
                <button type="button" className="text-muted-foreground" onClick={() => void previewPage(page)} aria-label="預覽">預覽</button>
                <button type="button" onClick={() => movePage(index, -1)} aria-label="上移"><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => movePage(index, 1)} aria-label="下移"><ChevronDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => setDraftPages((current) => current.filter((_, item) => item !== index))} aria-label="移除">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {previewing ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 正在預覽</p>
          ) : previewUrl ? (
            <LoadingImage src={previewUrl} alt="圖冊頁預覽" className="max-h-64 w-full rounded-md bg-muted" imgClassName="object-contain" />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
