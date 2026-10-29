import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { LoadingImage } from '@/components/ui/loading-image';
import { cn } from '@/lib/utils';
import {
  CATALOG_BOTTOM_HALF,
  CATALOG_SPLIT_LEFT,
  CATALOG_SPLIT_RIGHT,
  CATALOG_TOP_HALF,
  QUOTE_CATALOG_PAGE_LIMIT,
  buildQuoteCatalogPiecePdf,
  catalogPageBadge,
  catalogPageCrop,
  catalogPageKey,
  catalogPageLabel,
  fetchQuoteCatalogPdf,
  isSpreadSize,
  listQuoteCatalogs,
  newCatalogPageId,
  parseCatalogCrop,
  splitSpreadAttachments,
  type QuoteCatalogCrop,
  type QuoteCatalogOption,
  type QuoteCatalogPage,
  type QuoteCatalogSplit,
} from '@/lib/quoteCatalogPages';
import {
  loadCatalogPageThumb,
  peekCatalogPageThumb,
  primeCatalogPageThumbs,
  type CatalogPageThumb as CatalogThumb,
} from '@/lib/catalogPageThumbs';
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

/** 一屏 16 張，跟原本的清單密度一致。 */
const PAGES_PER_VIEW = 16;

function pageFromCatalog(
  catalog: QuoteCatalogOption,
  pageNo: number,
  crop: QuoteCatalogCrop | null = null,
  split: QuoteCatalogSplit | null = null,
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
    split,
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

/** 縮圖：先看記憶體／IndexedDB，沒有才向 edge 取那一頁再畫成小 JPEG。 */
function useCatalogThumb(documentId: string | null, pageNo: number | null) {
  const [state, setState] = useState<{ thumb: CatalogThumb | null; failed: boolean }>(() => ({
    thumb: documentId && pageNo ? peekCatalogPageThumb(documentId, pageNo) : null,
    failed: false,
  }));

  useEffect(() => {
    if (!documentId || !pageNo) {
      setState({ thumb: null, failed: false });
      return;
    }
    const cached = peekCatalogPageThumb(documentId, pageNo);
    if (cached) {
      setState({ thumb: cached, failed: false });
      return;
    }
    let alive = true;
    setState({ thumb: null, failed: false });
    void loadCatalogPageThumb(documentId, pageNo)
      .then((thumb) => {
        if (alive) setState({ thumb, failed: !thumb });
      })
      .catch(() => {
        if (alive) setState({ thumb: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [documentId, pageNo]);

  return state;
}

function CatalogPageThumb({
  documentId,
  pageNo,
  className,
  imgClassName = 'object-contain',
  onSize,
}: {
  documentId: string;
  pageNo: number;
  className?: string;
  imgClassName?: string;
  onSize?: (thumb: CatalogThumb) => void;
}) {
  const { thumb, failed } = useCatalogThumb(documentId, pageNo);
  const sizeHandler = useRef(onSize);
  sizeHandler.current = onSize;
  const reported = useRef<string>('');

  useEffect(() => {
    if (!thumb) return;
    const key = `${documentId}#${pageNo}`;
    if (reported.current === key) return;
    reported.current = key;
    sizeHandler.current?.(thumb);
  }, [thumb, documentId, pageNo]);

  if (failed) {
    return (
      <span className={cn('flex items-center justify-center bg-muted/60', className)} aria-hidden>
        <ImageOff className="h-4 w-4 text-muted-foreground/50" />
      </span>
    );
  }
  if (!thumb) {
    return (
      <span className={cn('block animate-pulse bg-primary/10', className)} aria-hidden />
    );
  }
  return (
    <LoadingImage src={thumb.dataUrl} alt="" className={className} imgClassName={imgClassName} />
  );
}

function StepHeader({ current }: { current: number }) {
  const steps = [
    { no: 1, title: '選擇圖冊', hint: '選擇要使用的圖冊' },
    { no: 2, title: '選擇頁面', hint: '從圖冊中挑選並設定範圍' },
    { no: 3, title: '確認加入', hint: '檢查已選頁面並完成' },
  ];
  return (
    <ol className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
      {steps.map((step, index) => {
        const done = step.no < current;
        const active = step.no === current;
        return (
          <li key={step.no} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done
                  ? 'bg-primary text-primary-foreground'
                  : active
                    ? 'bg-primary/10 text-primary ring-2 ring-primary'
                    : 'bg-muted text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : step.no}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-xs font-semibold', active || done ? 'text-foreground' : 'text-muted-foreground')}>
                {step.title}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">{step.hint}</span>
            </span>
            {index < steps.length - 1 ? (
              <span className="mx-1 hidden h-px w-10 shrink-0 bg-border sm:block" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
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
  const [factoryNames, setFactoryNames] = useState<string[]>([]);
  const [factoryFilter, setFactoryFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pageView, setPageView] = useState(1);
  const [focusPageNo, setFocusPageNo] = useState(1);
  const [draftPages, setDraftPages] = useState<QuoteCatalogPage[]>([]);
  const [manualPage, setManualPage] = useState('');
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewEditable, setPreviewEditable] = useState(false);
  const [cropDraft, setCropDraft] = useState<QuoteCatalogCrop | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [shapeByDocument, setShapeByDocument] = useState<Record<string, 'spread' | 'page'>>({});

  useEffect(() => {
    if (!open) return;
    setDraftPages(pages);
    setPreview(null);
    setPreviewEditable(false);
    setCropDraft(null);
    setError(null);
    setManualPage('');
    setPageView(1);
    setFactoryFilter('all');
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
        setActiveId((current) => (current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null));
        setPageView(1);
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

  // 廠家篩選用的完整清單（搜尋結果會變，chips 不應該跟着縮）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listQuoteCatalogs('')
      .then((rows) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const row of rows) counts.set(row.factory_name, (counts.get(row.factory_name) ?? 0) + 1);
        setFactoryNames(
          [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([name]) => name),
        );
      })
      .catch(() => {
        // chips 只是方便，抓不到就只顯示「全部」。
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadToken]);

  const visibleCatalogs = useMemo(
    () => (factoryFilter === 'all' ? catalogs : catalogs.filter((row) => row.factory_name === factoryFilter)),
    [catalogs, factoryFilter],
  );

  const active = visibleCatalogs.find((catalog) => catalog.id === activeId)
    ?? catalogs.find((catalog) => catalog.id === activeId)
    ?? null;
  const activeIdResolved = active?.id ?? null;
  const activeShape = activeIdResolved ? shapeByDocument[activeIdResolved] ?? null : null;
  const activeIsSpread = activeShape === 'spread';

  const rememberShape = useCallback((documentId: string, thumb: CatalogThumb) => {
    setShapeByDocument((current) => {
      if (current[documentId]) return current;
      return {
        ...current,
        [documentId]: isSpreadSize(thumb.width, thumb.height) ? 'spread' : 'page',
      };
    });
  }, []);

  // 已選附件所屬的圖冊也要判斷，否則舊單的整頁附件在清單裡看不到左／右半。
  useEffect(() => {
    if (!open) return;
    const known = new Set(Object.keys(shapeByDocument));
    const wanted = new Set(draftPages.map((page) => page.documentId));
    for (const documentId of wanted) {
      if (known.has(documentId)) continue;
      void loadCatalogPageThumb(documentId, 1).then((thumb) => {
        if (thumb) rememberShape(documentId, thumb);
      });
    }
  }, [open, draftPages, shapeByDocument, rememberShape]);

  // 確定是跨頁後，把舊資料裡「整頁」的附件換成左、右兩列，清單與 PDF 才會一致。
  useEffect(() => {
    if (!open) return;
    const spreadIds = Object.keys(shapeByDocument).filter((id) => shapeByDocument[id] === 'spread');
    if (spreadIds.length === 0) return;
    setDraftPages((current) => {
      let next = current;
      for (const id of spreadIds) next = splitSpreadAttachments(next, id);
      return next;
    });
  }, [open, shapeByDocument]);

  const totalPages = active?.page_count && active.page_count > 0 ? active.page_count : null;
  const pageViewCount = totalPages ? Math.max(1, Math.ceil(totalPages / PAGES_PER_VIEW)) : 1;
  const currentPageView = Math.min(pageView, pageViewCount);
  const pageNumbers = totalPages
    ? Array.from(
        { length: Math.max(0, Math.min(PAGES_PER_VIEW, totalPages - (currentPageView - 1) * PAGES_PER_VIEW)) },
        (_, index) => (currentPageView - 1) * PAGES_PER_VIEW + index + 1,
      )
    : [];

  // 先把下一屏的縮圖排進隊列，按下一頁時不用等。
  useEffect(() => {
    if (!open || !activeIdResolved || pageNumbers.length === 0) return;
    const nextStart = currentPageView * PAGES_PER_VIEW + 1;
    if (!totalPages || nextStart > totalPages) return;
    const nextPages = Array.from(
      { length: Math.min(PAGES_PER_VIEW, totalPages - nextStart + 1) },
      (_, index) => nextStart + index,
    );
    const timer = window.setTimeout(() => primeCatalogPageThumbs(activeIdResolved, nextPages), 400);
    return () => window.clearTimeout(timer);
  }, [open, activeIdResolved, currentPageView, pageNumbers.length, totalPages]);

  const addPages = (additions: QuoteCatalogPage[]) => {
    setError(null);
    if (additions.length === 0) return;
    if (draftPages.length + additions.length > QUOTE_CATALOG_PAGE_LIMIT) {
      setError(`一次最多 ${QUOTE_CATALOG_PAGE_LIMIT} 頁`);
      return;
    }
    setDraftPages((current) => [...current, ...additions]);
  };

  const toggleWholePage = (catalog: QuoteCatalogOption, pageNo: number) => {
    setFocusPageNo(pageNo);
    setError(null);
    // 同一頁的整頁／左半／右半算同一組；框選是自己畫的，不會被這裡刪掉。
    const existing = draftPages.filter(
      (page) => page.documentId === catalog.id && page.pageNo === pageNo && !parseCatalogCrop(page.crop),
    );
    if (existing.length > 0) {
      const ids = new Set(existing.map((page) => page.id));
      setDraftPages((current) => current.filter((page) => !ids.has(page.id)));
      return;
    }
    addPages(
      shapeByDocument[catalog.id] === 'spread'
        ? [pageFromCatalog(catalog, pageNo, null, 'left'), pageFromCatalog(catalog, pageNo, null, 'right')]
        : [pageFromCatalog(catalog, pageNo)],
    );
  };

  const addSplit = (split: QuoteCatalogSplit) => {
    if (!active) return;
    addPages([pageFromCatalog(active, focusPageNo, null, split)]);
  };

  const addAttachment = (crop: QuoteCatalogCrop) => {
    if (!active) return;
    addPages([pageFromCatalog(active, focusPageNo, crop)]);
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

  /** 清單上的「預覽」：看它在報價 PDF 裡實際的那一張（已裁切、已轉正）。 */
  const showPiece = async (page: QuoteCatalogPage) => {
    setPreviewing(true);
    setError(null);
    setPreviewEditable(false);
    setPreview(null);
    try {
      const bytes = await buildQuoteCatalogPiecePdf(page);
      const rendered = await renderQuotePdfPages(bytes);
      const first = rendered[0];
      if (!first) {
        setError('這一頁未能預覽');
        return;
      }
      setCropDraft(null);
      setPreview({ page, url: first.dataUrl, width: first.width, height: first.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : '這一頁未能預覽');
    } finally {
      setPreviewing(false);
    }
  };

  /** 整頁預覽：讓用戶在整張 PDF 頁上拖框（跨頁就是左右兩版一起看）。 */
  const showWholePage = async (page: QuoteCatalogPage) => {
    setPreviewing(true);
    setError(null);
    setPreviewEditable(true);
    setPreview(null);
    try {
      const bytes = await fetchQuoteCatalogPdf([page]);
      const rendered = await renderQuotePdfPages(bytes);
      const first = rendered[0];
      if (!first) {
        setError('這一頁未能預覽');
        return;
      }
      setCropDraft(catalogPageCrop(page));
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

  const draftPageSet = useMemo(
    () => new Set(draftPages.map((page) => `${page.documentId}#${page.pageNo}`)),
    [draftPages],
  );
  const step = !active ? 1 : draftPages.length === 0 ? 2 : 3;
  const pagerItems = pagerWindow(currentPageView, pageViewCount);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="5xl"
      title="圖冊附件"
      description="選擇圖冊與頁面，可加入整頁、上半／下半頁、跨頁的左半／右半，或在預覽上拖出框選。清單順序即報價 PDF 附件順序。"
      footer={
        <>
          <ModalButton variant="secondary" onClick={() => onOpenChange(false)}>取消</ModalButton>
          <ModalButton onClick={() => onConfirm(draftPages)}>完成加入</ModalButton>
        </>
      }
    >
      <StepHeader current={step} />

      <div className="grid gap-3 lg:h-[62vh] lg:grid-cols-[236px_minmax(0,1fr)_264px]">
        {/* ── 1. 圖冊 ─────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="font-display text-sm font-semibold text-foreground">選擇圖冊</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-[11px]"
              disabled={loading}
              onClick={() => setReloadToken((token) => token + 1)}
            >
              <RefreshCw className={loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
              重新整理
            </Button>
          </header>
          <div className="space-y-2 px-2.5 py-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋廠家、系列、年份或標題"
                className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs"
              />
            </label>
            <div className="-mx-0.5 flex flex-wrap gap-1">
              {['all', ...factoryNames].map((name) => {
                const selected = factoryFilter === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setFactoryFilter(name)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {name === 'all' ? '全部' : name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-2">
            {loading && visibleCatalogs.length === 0 ? (
              <p className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在讀取圖冊
              </p>
            ) : visibleCatalogs.length === 0 ? (
              <div className="space-y-1 rounded-md border border-dashed border-border px-2 py-2">
                <p className="text-xs text-muted-foreground">
                  {query.trim() ? `找不到符合「${query.trim()}」的圖冊。` : '沒有可選的圖冊。'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  這裡只列文件類型為「圖冊」的上載文件；標成報價單的 PDF 不會出現，可到「廠家詳情 → 廠家文件」改類型。
                </p>
              </div>
            ) : (
              visibleCatalogs.map((catalog) => {
                const selected = catalog.id === activeId;
                return (
                  <button
                    key={catalog.id}
                    type="button"
                    onClick={() => {
                      setActiveId(catalog.id);
                      setPageView(1);
                      setPreview(null);
                      setFocusPageNo(1);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border p-1.5 text-left transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60',
                    )}
                  >
                    <CatalogPageThumb
                      documentId={catalog.id}
                      pageNo={1}
                      className="h-14 w-11 shrink-0 overflow-hidden rounded border border-border/60 bg-white"
                      onSize={(thumb) => rememberShape(catalog.id, thumb)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-1">
                        <span className="truncate text-xs font-semibold text-foreground">{catalog.factory_name}</span>
                        {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {catalog.title || '未命名圖冊'}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {[catalog.document_year, catalog.page_count ? `${catalog.page_count} 頁` : null, catalog.series]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* ── 2. 頁面 ─────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <h3 className="font-display text-sm font-semibold text-foreground">選擇頁面</h3>
              <p className="truncate text-[11px] text-muted-foreground">
                {active
                  ? `${active.factory_name}${active.title ? ` · ${active.title}` : ''}${totalPages ? `（共 ${totalPages} 頁）` : ''}`
                  : '先選左邊的圖冊'}
              </p>
            </div>
            {active ? (
              <span className="text-[11px] text-muted-foreground">
                {activeIsSpread
                  ? '跨頁：選一頁會加入左半＋右半'
                  : activeShape === null
                    ? '正在判斷版面…'
                    : '單頁：選一頁加入整頁'}
              </span>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-2.5 py-2">
            {!active ? (
              <p className="py-8 text-center text-xs text-muted-foreground">請先在左邊選擇一份圖冊。</p>
            ) : pageNumbers.length === 0 ? (
              <div className="flex items-center gap-2 py-6">
                <input
                  value={manualPage}
                  onChange={(event) => setManualPage(event.target.value)}
                  inputMode="numeric"
                  placeholder="頁碼"
                  className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
                />
                <Button type="button" variant="outline" size="sm" onClick={addManualPage}>加入整頁</Button>
                <span className="text-[11px] text-muted-foreground">這份圖冊未記錄頁數，請直接輸入頁碼。</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {pageNumbers.map((pageNo) => {
                  const picked = draftPageSet.has(`${active.id}#${pageNo}`);
                  return (
                    <button
                      key={pageNo}
                      type="button"
                      onClick={() => toggleWholePage(active, pageNo)}
                      onDoubleClick={() => void showWholePage(pageFromCatalog(active, pageNo))}
                      className={cn(
                        'group rounded-lg border p-1 text-left transition-colors',
                        picked ? 'border-primary bg-primary/5' : focusPageNo === pageNo ? 'border-primary/60' : 'border-border hover:border-primary/40',
                      )}
                    >
                      <CatalogPageThumb
                        documentId={active.id}
                        pageNo={pageNo}
                        className="aspect-[3/4] w-full overflow-hidden rounded bg-white"
                      />
                      <span className="mt-1 flex items-center justify-between px-0.5">
                        <span className={cn('text-[11px]', picked ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                          {String(pageNo).padStart(2, '0')}
                        </span>
                        {picked ? <Check className="h-3 w-3 text-primary" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {active && totalPages && pageViewCount > 1 ? (
              <nav className="mt-2 flex items-center justify-center gap-1" aria-label="頁面分頁">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground disabled:opacity-40"
                  onClick={() => setPageView((view) => Math.max(1, view - 1))}
                  disabled={currentPageView === 1}
                  aria-label="上一頁"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                {pagerItems.map((item, index) => (
                  item === 'gap' ? (
                    <span key={`gap-${index}`} className="px-1 text-xs text-muted-foreground">…</span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPageView(item)}
                      className={cn(
                        'h-7 min-w-7 rounded border px-1.5 text-[11px]',
                        item === currentPageView
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-foreground hover:bg-muted',
                      )}
                    >
                      {item}
                    </button>
                  )
                ))}
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground disabled:opacity-40"
                  onClick={() => setPageView((view) => Math.min(pageViewCount, view + 1))}
                  disabled={currentPageView === pageViewCount}
                  aria-label="下一頁"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </nav>
            ) : null}

            {active ? (
              <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-foreground">第 {focusPageNo} 頁</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void showWholePage(pageFromCatalog(active, focusPageNo))}
                  >
                    預覽／框選
                  </Button>
                  {activeIsSpread ? (
                    <>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => addSplit('left')}>左半頁</Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => addSplit('right')}>右半頁</Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => addAttachment(CATALOG_TOP_HALF)}>上半頁</Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => addAttachment(CATALOG_BOTTOM_HALF)}>下半頁</Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={!parseCatalogCrop(cropDraft)}
                    onClick={() => {
                      const crop = parseCatalogCrop(cropDraft);
                      if (!crop) return;
                      const source = previewEditable ? preview?.page : null;
                      if (!source) {
                        addAttachment(crop);
                        return;
                      }
                      addPages([{ ...source, id: newCatalogPageId(), crop, split: null }]);
                    }}
                  >
                    加入框選
                  </Button>
                </div>

                {previewing ? (
                  <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在預覽
                  </p>
                ) : preview ? (
                  <div className="flex gap-2">
                    <div
                      className={cn('relative shrink-0', previewEditable ? 'w-[150px] touch-none' : 'w-[110px]')}
                      style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
                      onPointerDown={previewEditable ? (event) => {
                        const point = pointInPreview(event);
                        setDragStart(point);
                        setCropDraft({ x: point.x, y: point.y, width: 0, height: 0 });
                        event.currentTarget.setPointerCapture(event.pointerId);
                      } : undefined}
                      onPointerMove={previewEditable ? (event) => {
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
                      } : undefined}
                      onPointerUp={previewEditable ? () => setDragStart(null) : undefined}
                    >
                      <div className="absolute inset-0">
                        <LoadingImage src={preview.url} alt="圖冊頁預覽" className="h-full w-full" imgClassName="object-fill" />
                      </div>
                      {previewEditable && cropDraft ? (
                        <div
                          className={cn(
                            'pointer-events-none absolute border-2 border-primary',
                            cropDraft.width > 0.005 && cropDraft.height > 0.005 ? 'bg-primary/20' : '',
                          )}
                          style={cropStyle(cropDraft)}
                        />
                      ) : null}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {previewEditable
                        ? '在預覽上拖出範圍，再按「加入框選」；不拖就維持整頁。'
                        : '這一張就是會加在報價 PDF 後面的樣子。'}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
          </div>
        </section>

        {/* ── 3. 已選 ─────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="font-display text-sm font-semibold text-foreground">
              已選頁面（{draftPages.length}）
            </h3>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40"
              onClick={() => setDraftPages([])}
              disabled={draftPages.length === 0}
            >
              <Trash2 className="h-3 w-3" /> 清空
            </button>
          </header>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 py-2">
            {draftPages.length === 0 ? (
              <p className="px-1 py-3 text-[11px] leading-relaxed text-muted-foreground">
                還未加入任何頁面。點中間的頁面縮圖即可加入；要只取局部就用「預覽／框選」。
              </p>
            ) : (
              draftPages.map((page, index) => (
                <div key={catalogPageKey(page)} className="flex items-start gap-1.5 rounded-lg border border-border p-1">
                  <CatalogPageThumb
                    documentId={page.documentId}
                    pageNo={page.pageNo}
                    className="h-11 w-8 shrink-0 overflow-hidden rounded border border-border/60 bg-white"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-foreground">第 {page.pageNo} 頁</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {catalogPageBadge(page)}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground/80" title={catalogPageLabel(page)}>
                      {[page.factoryName, page.series, page.title].filter(Boolean).join(' · ') || page.factoryName}
                    </p>
                  </div>
                  <div className="flex flex-col items-center">
                    <button type="button" onClick={() => movePage(index, -1)} aria-label="上移" className="text-muted-foreground hover:text-foreground">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => movePage(index, 1)} aria-label="下移" className="text-muted-foreground hover:text-foreground">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-col items-center">
                    <button type="button" onClick={() => void showPiece(page)} className="text-[10px] text-muted-foreground hover:text-foreground">
                      預覽
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftPages((current) => current.filter((item) => item.id !== page.id))}
                      aria-label="移除"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            最多 {QUOTE_CATALOG_PAGE_LIMIT} 項，順序即報價 PDF 附件順序。
          </p>
        </section>
      </div>
    </Modal>
  );
}

/** 分頁列：1 … 3 4 [5] 6 7 … 92 */
function pagerWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const first = 1;
  const last = total;
  const start = Math.max(2, Math.min(current - 2, total - 5));
  const end = Math.min(total - 1, Math.max(current + 2, 6));
  const items: (number | 'gap')[] = [first];
  if (start > 2) items.push('gap');
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < total - 1) items.push('gap');
  items.push(last);
  return items;
}
