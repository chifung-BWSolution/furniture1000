import { useEffect, useState, type PointerEvent } from 'react';
import { ChevronDown, ChevronUp, Loader2, RefreshCw, X } from 'lucide-react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { LoadingImage } from '@/components/ui/loading-image';
import {
  CATALOG_BOTTOM_HALF,
  CATALOG_TOP_HALF,
  QUOTE_CATALOG_PAGE_LIMIT,
  catalogPageKey,
  catalogPageLabel,
  fetchQuoteCatalogPdf,
  listQuoteCatalogs,
  newCatalogPageId,
  parseCatalogCrop,
  type QuoteCatalogCrop,
  type QuoteCatalogOption,
  type QuoteCatalogPage,
} from '@/lib/quoteCatalogPages';
import { renderQuotePdfPages } from '@/lib/quotationPdfCanvas';

interface QuoteCatalogPagesDialogProps {
  open: boolean;
  pages: QuoteCatalogPage[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (pages: QuoteCatalogPage[]) => void;
}

interface PagePreview {
  page: QuoteCatalogPage;
  url: string;
  width: number;
  height: number;
}

function pageFromCatalog(
  catalog: QuoteCatalogOption,
  pageNo: number,
  crop: QuoteCatalogCrop | null,
): QuoteCatalogPage {
  return {
    id: newCatalogPageId(),
    documentId: catalog.id,
    pageNo,
    factoryName: catalog.factory_name,
    title: catalog.title,
    documentYear: catalog.document_year,
    series: catalog.series,
    crop,
  };
}

function cropStyle(crop: QuoteCatalogCrop) {
  return {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  };
}

export function QuoteCatalogPagesDialog({
  open,
  pages,
  onOpenChange,
  onConfirm,
}: QuoteCatalogPagesDialogProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [catalogs, setCatalogs] = useState<QuoteCatalogOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusPageNo, setFocusPageNo] = useState(1);
  const [draftPages, setDraftPages] = useState<QuoteCatalogPage[]>([]);
  const [manualPage, setManualPage] = useState('');
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [cropDraft, setCropDraft] = useState<QuoteCatalogCrop | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDraftPages(pages);
    setPreview(null);
    setCropDraft(null);
    setError(null);
    setManualPage('');
    // 上次留下的搜尋字會令清單看起來「沒有圖冊」，每次開啟都重新由完整清單開始。
    setQuery('');
    setDebouncedQuery('');
  }, [open, pages]);

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
  }, [open, debouncedQuery, reloadToken]);

  const active = catalogs.find((catalog) => catalog.id === activeId) ?? null;

  const addAttachment = (pageNo: number, crop: QuoteCatalogCrop | null) => {
    if (!active) return;
    setError(null);
    setDraftPages((current) => {
      if (current.length >= QUOTE_CATALOG_PAGE_LIMIT) {
        setError(`一次最多 ${QUOTE_CATALOG_PAGE_LIMIT} 頁`);
        return current;
      }
      return [...current, pageFromCatalog(active, pageNo, crop)];
    });
  };

  const toggleWholePage = (catalog: QuoteCatalogOption, pageNo: number) => {
    setFocusPageNo(pageNo);
    setError(null);
    setDraftPages((current) => {
      const whole = current.find((page) => page.documentId === catalog.id && page.pageNo === pageNo && !page.crop);
      if (whole) return current.filter((page) => page.id !== whole.id);
      if (current.length >= QUOTE_CATALOG_PAGE_LIMIT) {
        setError(`一次最多 ${QUOTE_CATALOG_PAGE_LIMIT} 頁`);
        return current;
      }
      return [...current, pageFromCatalog(catalog, pageNo, null)];
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
    toggleWholePage(active, pageNo);
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

  const showPage = async (page: QuoteCatalogPage) => {
    setPreviewing(true);
    setError(null);
    setCropDraft(page.crop);
    try {
      const bytes = await fetchQuoteCatalogPdf([page]);
      const rendered = await renderQuotePdfPages(bytes);
      const first = rendered[0];
      if (!first) {
        setError('這一頁未能預覽');
        setPreview(null);
        return;
      }
      setPreview({ page, url: first.dataUrl, width: first.width, height: first.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : '這一頁未能預覽');
    } finally {
      setPreviewing(false);
    }
  };

  const pointInPreview = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
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
      description="可選整頁、上半頁、下半頁，或在預覽上拖出框選。頁面可以不連續，也可以來自不同圖冊。"
      footer={
        <>
          <ModalButton variant="secondary" onClick={() => onOpenChange(false)}>取消</ModalButton>
          <ModalButton onClick={() => onConfirm(draftPages)}>完成</ModalButton>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋廠家、系列、年份或標題（可多個關鍵字）"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1"
              disabled={loading}
              onClick={() => setReloadToken((n) => n + 1)}
            >
              <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              重新整理
            </Button>
          </div>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在讀取圖冊
            </p>
          ) : catalogs.length === 0 ? (
            <div className="space-y-1 rounded-md border border-dashed border-border px-3 py-2.5">
              <p className="text-sm text-muted-foreground">
                {query.trim() ? `找不到符合「${query.trim()}」的圖冊。` : '沒有可選的圖冊。'}
              </p>
              <p className="text-xs text-muted-foreground">
                這裡只列出文件類型為「圖冊」的上載文件。若那份 PDF 上載時標成報價單（報價單含成本，不會出現在客戶 PDF），
                請到「廠家詳情 → 廠家文件」把類型改成圖冊，再按「重新整理」。
              </p>
            </div>
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
            <div className="space-y-2">
              {pageNumbers.length > 0 ? (
                <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
                  {pageNumbers.map((pageNo) => {
                    const picked = draftPages.some((page) => page.documentId === active.id && page.pageNo === pageNo);
                    return (
                      <button
                        key={pageNo}
                        type="button"
                        onClick={() => toggleWholePage(active, pageNo)}
                        className={`h-8 min-w-8 rounded border px-2 text-xs ${
                          picked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : focusPageNo === pageNo
                              ? 'border-primary'
                              : 'border-border'
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
                  <Button type="button" variant="outline" size="sm" onClick={addManualPage}>加入整頁</Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void showPage(pageFromCatalog(active, focusPageNo, null))}>
                  預覽第 {focusPageNo} 頁
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addAttachment(focusPageNo, CATALOG_TOP_HALF)}>上半頁</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addAttachment(focusPageNo, CATALOG_BOTTOM_HALF)}>下半頁</Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!parseCatalogCrop(cropDraft)}
                  onClick={() => {
                    const crop = parseCatalogCrop(cropDraft);
                    if (!crop) return;
                    const source = preview?.page;
                    if (!source) {
                      addAttachment(focusPageNo, crop);
                      return;
                    }
                    setDraftPages((current) => {
                      if (current.length >= QUOTE_CATALOG_PAGE_LIMIT) {
                        setError(`一次最多 ${QUOTE_CATALOG_PAGE_LIMIT} 頁`);
                        return current;
                      }
                      return [...current, { ...source, id: newCatalogPageId(), crop }];
                    });
                  }}
                >
                  加入框選
                </Button>
              </div>
              {active.page_count != null && active.page_count > pageNumbers.length ? (
                <p className="text-xs text-muted-foreground">頁數較多，這裡先列出前 {pageNumbers.length} 頁。</p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {previewing ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 正在預覽</p>
          ) : preview ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">在預覽上拖出範圍，再按「加入框選」。不拖則這一頁維持整頁。</p>
              <div
                className="relative w-full max-w-md touch-none"
                style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
                onPointerDown={(event) => {
                  const point = pointInPreview(event);
                  setDragStart(point);
                  setCropDraft({ x: point.x, y: point.y, width: 0, height: 0 });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!dragStart) return;
                  const point = pointInPreview(event);
                  const x = Math.min(dragStart.x, point.x);
                  const y = Math.min(dragStart.y, point.y);
                  setCropDraft({
                    x,
                    y,
                    width: Math.abs(point.x - dragStart.x),
                    height: Math.abs(point.y - dragStart.y),
                  });
                }}
                onPointerUp={() => setDragStart(null)}
              >
                <div className="absolute inset-0">
                  <LoadingImage
                    src={preview.url}
                    alt="圖冊頁預覽"
                    className="h-full w-full"
                    imgClassName="object-fill"
                  />
                </div>
                {cropDraft && cropDraft.width > 0 && cropDraft.height > 0 ? (
                  <div className="pointer-events-none absolute border-2 border-primary bg-primary/20" style={cropStyle(cropDraft)} />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">已選 {draftPages.length} / {QUOTE_CATALOG_PAGE_LIMIT} 項，順序即報價 PDF 附件順序。</p>
          {draftPages.length === 0 ? (
            <p className="text-xs text-muted-foreground">還未加入任何頁面。選好頁碼後按該頁，或用「上半頁／下半頁／加入框選」。</p>
          ) : null}
          <ul className="max-h-72 space-y-1 overflow-auto">
            {draftPages.map((page, index) => (
              <li key={catalogPageKey(page)} className="flex items-center gap-1 rounded border border-border px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-xs">{catalogPageLabel(page)}</span>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => { setFocusPageNo(page.pageNo); void showPage(page); }}>預覽</button>
                <button type="button" onClick={() => movePage(index, -1)} aria-label="上移"><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => movePage(index, 1)} aria-label="下移"><ChevronDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => setDraftPages((current) => current.filter((item) => item.id !== page.id))} aria-label="移除">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
