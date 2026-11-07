import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { LoadingImage } from '@/components/ui/loading-image';
import { SelectionBox, type SelectionHandle } from '@/components/ui/selection-box';
import { cn } from '@/lib/utils';
import {
  CATALOG_BOTTOM_HALF,
  CATALOG_SPLIT_LEFT,
  CATALOG_SPLIT_RIGHT,
  CATALOG_TOP_HALF,
  QUOTE_CATALOG_PAGE_LIMIT,
  buildQuoteCatalogPiecePdf,
  catalogPageBadge,
  catalogPageKey,
  catalogPageLabel,
  fetchQuoteCatalogPdf,
  isSpreadSize,
  listQuoteCatalogs,
  newCatalogPageId,
  parseCatalogCrop,
  type QuoteCatalogCrop,
  type QuoteCatalogOption,
  type QuoteCatalogPage,
  type QuoteCatalogSplit,
} from '@/lib/quoteCatalogPages';
import {
  clearCatalogThumbFailure,
  catalogThumbFailure,
  loadCatalogPagePreview,
  loadCatalogPageThumb,
  peekCatalogPagePreview,
  peekCatalogPageThumb,
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
  /** 這一項在附錄會出幾張（跨頁整頁＝左、右各一張）。 */
  sheetCount: number;
}

/** 一屏 12 張：圖冊一頁 0.3–1.3 MB，一屏越多第一排縮圖越遲出現。 */
const PAGES_PER_VIEW = 12;

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

/** 框選框的最小可用尺寸（相對整頁）；太細會令 PDF 切成幾乎空白。 */
const CROP_MIN_SIZE = 0.02;
/** 邊／角多遠以內當成拖框調整（像素）。 */
const CROP_HANDLE_HIT_PX = 14;

interface CropEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

type CropHit =
  | { kind: 'new' }
  | { kind: 'move' }
  | { kind: 'resize'; edges: CropEdges };

/**
 * 指標落在框選框的哪裡：邊／角＝調整大小、框內＝移動、框外＝重新框選。
 * 用像素判斷而不是百分比，縮放後手感才一致。
 */
function cropHitTest(rect: DOMRect, clientX: number, clientY: number, crop: QuoteCatalogCrop | null): CropHit {
  const box = parseCatalogCrop(crop);
  if (!box) return { kind: 'new' };
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const left = box.x * rect.width;
  const right = (box.x + box.width) * rect.width;
  const top = box.y * rect.height;
  const bottom = (box.y + box.height) * rect.height;
  const h = CROP_HANDLE_HIT_PX;
  let nearLeft = Math.abs(px - left) <= h && py >= top - h && py <= bottom + h;
  let nearRight = Math.abs(px - right) <= h && py >= top - h && py <= bottom + h;
  let nearTop = Math.abs(py - top) <= h && px >= left - h && px <= right + h;
  let nearBottom = Math.abs(py - bottom) <= h && px >= left - h && px <= right + h;
  // 框很窄時兩條邊都可能命中：只認比較近的那一條，否則一拖就會兩邊一起動。
  if (nearLeft && nearRight) {
    if (Math.abs(px - left) <= Math.abs(px - right)) nearRight = false;
    else nearLeft = false;
  }
  if (nearTop && nearBottom) {
    if (Math.abs(py - top) <= Math.abs(py - bottom)) nearBottom = false;
    else nearTop = false;
  }
  if (nearLeft || nearRight || nearTop || nearBottom) {
    return { kind: 'resize', edges: { left: nearLeft, right: nearRight, top: nearTop, bottom: nearBottom } };
  }
  if (px > left && px < right && py > top && py < bottom) return { kind: 'move' };
  return { kind: 'new' };
}

function cropCursor(hit: CropHit): string {
  if (hit.kind === 'move') return 'move';
  if (hit.kind === 'new') return 'crosshair';
  const { left, right, top, bottom } = hit.edges;
  if ((left && top) || (right && bottom)) return 'nwse-resize';
  if ((right && top) || (left && bottom)) return 'nesw-resize';
  if (left || right) return 'ew-resize';
  return 'ns-resize';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 把手 ↔ 邊的對應：把手拖曳時只動它控制的那幾條邊。 */
function handleEdges(handle: SelectionHandle): CropEdges {
  return {
    left: handle.includes('w'),
    right: handle.includes('e'),
    top: handle.includes('n'),
    bottom: handle.includes('s'),
  };
}

function edgesHandle(edges: CropEdges): SelectionHandle {
  const vertical = edges.top ? 'n' : edges.bottom ? 's' : '';
  const horizontal = edges.left ? 'w' : edges.right ? 'e' : '';
  if (vertical && horizontal) return `${vertical}${horizontal}` as SelectionHandle;
  return (vertical || horizontal || 'se') as SelectionHandle;
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
  onFail,
}: {
  documentId: string;
  pageNo: number;
  className?: string;
  imgClassName?: string;
  onSize?: (thumb: CatalogThumb) => void;
  onFail?: () => void;
}) {
  const { thumb, failed } = useCatalogThumb(documentId, pageNo);
  const sizeHandler = useRef(onSize);
  sizeHandler.current = onSize;
  const failHandler = useRef(onFail);
  failHandler.current = onFail;
  const reported = useRef<string>('');
  const reportedFail = useRef(false);

  // 浮卡打開後才去取高清頁；延遲一點，滑過（sweep）時不會每一頁都下載。
  const [hoverOpen, setHoverOpen] = useState(false);
  const [sharp, setSharp] = useState<CatalogThumb | null>(null);

  useEffect(() => {
    setSharp(null);
  }, [documentId, pageNo]);

  useEffect(() => {
    if (!hoverOpen) return;
    const cached = peekCatalogPagePreview(documentId, pageNo);
    if (cached) {
      setSharp(cached);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void loadCatalogPagePreview(documentId, pageNo).then((big) => {
        if (alive && big) setSharp(big);
      });
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [hoverOpen, documentId, pageNo]);

  useEffect(() => {
    if (!thumb) return;
    const key = `${documentId}#${pageNo}`;
    if (reported.current === key) return;
    reported.current = key;
    sizeHandler.current?.(thumb);
  }, [thumb, documentId, pageNo]);

  useEffect(() => {
    if (!failed || reportedFail.current) return;
    reportedFail.current = true;
    failHandler.current?.();
  }, [failed]);

  if (failed) {
    return (
      <span className={cn('flex items-center justify-center bg-muted/60', className)} aria-hidden>
        <ImageOff className="h-4 w-4 text-muted-foreground/50" />
      </span>
    );
  }
  if (!thumb) {
    // 骨架要看得到（白底頁面卡上白底骨架等於空白），用 muted 底加脈衝。
    return (
      <span className={cn('flex items-center justify-center overflow-hidden bg-muted', className)} aria-hidden>
        <span className="block h-full w-full animate-pulse bg-primary/10" />
      </span>
    );
  }
  const shown = sharp ?? thumb;
  return (
    <HoverCard openDelay={160} closeDelay={80} onOpenChange={setHoverOpen}>
      <HoverCardTrigger asChild>
        <span className={cn('block cursor-zoom-in', className)}>
          <LoadingImage
            src={thumb.url ?? thumb.dataUrl}
            alt=""
            className="h-full w-full bg-white"
            imgClassName={imgClassName}
          />
        </span>
      </HoverCardTrigger>
      {/* 先出 360px 縮圖，高清版畫好就換上（同一頁會記憶體快取）。 */}
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={16}
        className={cn(
          'z-[60] max-w-[calc(100vw_-_3rem)] border-border/80 p-1.5 shadow-xl',
          thumb.width > thumb.height ? 'w-[560px]' : 'w-[440px]',
        )}
      >
        <div className="relative">
          <img
            src={shown.url ?? shown.dataUrl}
            alt=""
            className="block h-auto max-h-[70vh] w-full rounded-sm object-contain"
          />
          {sharp ? null : (
            <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-medium text-white">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              高清載入中
            </span>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
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
  /** 彈窗內容：框選時是整頁原圖，看清單項目時是成品那一張。 */
  const [sheet, setSheet] = useState<PagePreview | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'crop' | 'piece'>('crop');
  const [sheetLoading, setSheetLoading] = useState(false);
  const [cropDraft, setCropDraft] = useState<QuoteCatalogCrop | null>(null);
  /** 拖曳狀態用 ref：pointermove 不會拿到上一個 render 的過期 state。 */
  const cropDragRef = useRef<
    | { mode: 'new'; start: { x: number; y: number } }
    | { mode: 'move'; start: { x: number; y: number }; initial: QuoteCatalogCrop }
    | { mode: 'resize'; start: { x: number; y: number }; initial: QuoteCatalogCrop; edges: CropEdges; handle: SelectionHandle }
    | null
  >(null);
  /** 正在拖的把手（給尺寸膠囊與箭頭動畫用）。 */
  const [cropHandle, setCropHandle] = useState<SelectionHandle | null>(null);
  /** 框選原圖的可用區域；把手要在它上面捕獲指針。 */
  const cropSurfaceRef = useRef<HTMLDivElement>(null);
  /** 框選舞台量到的可用區域，用來把原圖放到最大又不變形。 */
  const cropStageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  /** 舊的原圖請求回來時不要蓋掉剛開的另一張。 */
  const sheetRequest = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [shapeByDocument, setShapeByDocument] = useState<Record<string, 'spread' | 'page'>>({});
  /** 縮圖失敗時顯示原因與重試，不要只出一個壞掉的圖片圖示。 */
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [thumbRetry, setThumbRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDraftPages(pages);
    setSheet(null);
    setSheetOpen(false);
    setSheetMode('crop');
    setCropDraft(null);
    cropDragRef.current = null;
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

  // 已選附件所屬的圖冊也要判斷：清單要標成「跨頁」，左／右半按鈕也才知道何時出現。
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

  // 框選彈窗的可用區域：原圖要放到最大，框選才不會一拖就超出畫面。
  useEffect(() => {
    if (!sheetOpen) return;
    const element = cropStageRef.current;
    if (!element) return;
    const measure = () => {
      const styles = window.getComputedStyle(element);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      setStageSize({
        width: Math.max(0, element.clientWidth - (Number.isFinite(paddingX) ? paddingX : 0)),
        height: Math.max(0, element.clientHeight - (Number.isFinite(paddingY) ? paddingY : 0)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sheetOpen, sheet]);

  /** 原圖在舞台裡的最大尺寸：守住版面比例，不拉伸。 */
  const sheetBox = useMemo(() => {
    if (!sheet || stageSize.width < 40 || stageSize.height < 40) return null;
    const ratio = sheet.width / sheet.height;
    const width = Math.max(80, Math.min(stageSize.width, stageSize.height * ratio));
    return { width: Math.round(width), height: Math.round(width / ratio) };
  }, [sheet, stageSize]);

  const totalPages = active?.page_count && active.page_count > 0 ? active.page_count : null;  const pageViewCount = totalPages ? Math.max(1, Math.ceil(totalPages / PAGES_PER_VIEW)) : 1;
  const currentPageView = Math.min(pageView, pageViewCount);
  const pageNumbers = totalPages
    ? Array.from(
        { length: Math.max(0, Math.min(PAGES_PER_VIEW, totalPages - (currentPageView - 1) * PAGES_PER_VIEW)) },
        (_, index) => (currentPageView - 1) * PAGES_PER_VIEW + index + 1,
      )
    : [];

  // 不預取下一屏：一頁 0.3–1.3 MB，背景預取會多下載十幾 MB，反而拖慢目前這一屏。

  const addPages = (additions: QuoteCatalogPage[]) => {
    setError(null);
    if (additions.length === 0) return;
    if (draftPages.length + additions.length > QUOTE_CATALOG_PAGE_LIMIT) {
      setError(`一次最多 ${QUOTE_CATALOG_PAGE_LIMIT} 頁`);
      return;
    }
    setDraftPages((current) => [...current, ...additions]);
  };

  // 點縮圖只是「選取這一頁」，不會自動加入清單；加入要靠下方的按鈕
  // （加入整頁／左半頁／右半頁／框選），要甚麼由用戶自己決定。
  const selectPage = (pageNo: number) => {
    setFocusPageNo(pageNo);
    setError(null);
  };

  const addWholePage = (catalog: QuoteCatalogOption | null = active, pageNo: number = focusPageNo) => {
    if (!catalog) return;
    addPages([pageFromCatalog(catalog, pageNo)]);
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
    addWholePage(active, pageNo);
    setFocusPageNo(pageNo);
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

  const closeSheet = () => {
    sheetRequest.current += 1;
    setSheetOpen(false);
    setSheet(null);
    setCropDraft(null);
    cropDragRef.current = null;
  };

  const beginSheetRequest = () => {
    sheetRequest.current += 1;
    return sheetRequest.current;
  };

  /** 清單上的「預覽」：看它在報價 PDF 裡實際的那一張（已裁切、已轉正）。 */
  const openPieceSheet = async (page: QuoteCatalogPage) => {
    const token = beginSheetRequest();
    setSheetMode('piece');
    setSheetOpen(true);
    setSheetLoading(true);
    setSheet(null);
    setCropDraft(null);
    setError(null);
    try {
      const bytes = await buildQuoteCatalogPiecePdf(page);
      const rendered = await renderQuotePdfPages(bytes);
      if (sheetRequest.current !== token) return;
      const first = rendered[0];
      if (!first) {
        setError('這一頁未能預覽');
        closeSheet();
        return;
      }
      setSheet({ page, url: first.dataUrl, width: first.width, height: first.height, sheetCount: rendered.length });
    } catch (err) {
      if (sheetRequest.current !== token) return;
      setError(err instanceof Error ? err.message : '這一頁未能預覽');
      closeSheet();
    } finally {
      if (sheetRequest.current === token) setSheetLoading(false);
    }
  };

  /** 框選彈窗：整張 PDF 原圖放到最大，拖出範圍後按「加入框選」才加入並關閉。 */
  const openCropSheet = async (pageNo: number = focusPageNo) => {
    if (!active) return;
    setFocusPageNo(pageNo);
    const page = pageFromCatalog(active, pageNo);
    const token = beginSheetRequest();
    setSheetMode('crop');
    setSheetOpen(true);
    setSheetLoading(true);
    setSheet(null);
    setCropDraft(null);
    cropDragRef.current = null;
    setError(null);
    try {
      const bytes = await fetchQuoteCatalogPdf([page]);
      const rendered = await renderQuotePdfPages(bytes);
      if (sheetRequest.current !== token) return;
      const first = rendered[0];
      if (!first) {
        setError('這一頁未能預覽');
        closeSheet();
        return;
      }
      setSheet({ page, url: first.dataUrl, width: first.width, height: first.height, sheetCount: rendered.length });
    } catch (err) {
      if (sheetRequest.current !== token) return;
      setError(err instanceof Error ? err.message : '這一頁未能預覽');
      closeSheet();
    } finally {
      if (sheetRequest.current === token) setSheetLoading(false);
    }
  };

  /** 確認框選：有框就只取框內，沒有框就維持整頁；加入後關閉彈窗。 */
  const confirmCropSheet = () => {
    if (!sheet) return;
    const crop = parseCatalogCrop(cropDraft);
    addPages([{ ...sheet.page, id: newCatalogPageId(), crop, split: null }]);
    closeSheet();
  };

  const previewPoint = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const beginCrop = (event: PointerEvent<HTMLDivElement>) => {
    // 只認主鍵；右鍵／中鍵拖動不應該重設框選。
    if (event.button !== 0) return;
    event.preventDefault();
    const point = previewPoint(event);
    const hit = cropHitTest(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY, cropDraft);
    if (hit.kind === 'move' && cropSelection) {
      cropDragRef.current = { mode: 'move', start: point, initial: cropSelection };
      setCropHandle(null);
    } else if (hit.kind === 'resize' && cropSelection) {
      cropDragRef.current = { mode: 'resize', start: point, initial: cropSelection, edges: hit.edges, handle: edgesHandle(hit.edges) };
      setCropHandle(edgesHandle(hit.edges));
    } else {
      // 框外：重新拉一個新框。
      cropDragRef.current = { mode: 'new', start: point };
      setCropHandle(null);
      setCropDraft({ x: point.x, y: point.y, width: 0, height: 0 });
    }
    // 捕獲指針，拖出原圖邊界也繼續更新框選。
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** 抓住八個把手其中之一：直接以把手對應的邊開始調整大小。 */
  const beginHandleResize = (handle: SelectionHandle, event: PointerEvent<HTMLButtonElement>) => {
    if (!cropSelection) return;
    const surface = cropSurfaceRef.current;
    if (!surface) return;
    event.preventDefault();
    const box = surface.getBoundingClientRect();
    const start = {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
    cropDragRef.current = {
      mode: 'resize',
      start,
      initial: cropSelection,
      edges: handleEdges(handle),
      handle,
    };
    setCropHandle(handle);
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released; the surface keeps receiving moves while it is
      // over the image, which is enough for a normal drag.
    }
  };

  /** 方向鍵在把手上微調：0.5%（Shift 2%）。 */
  const nudgeCrop = (handle: SelectionHandle, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const current = parseCatalogCrop(cropDraft);
    if (!current) return;
    const step = (event.shiftKey ? 2 : 0.5) / 100;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    const edges = handleEdges(handle);
    let left = current.x;
    let right = current.x + current.width;
    let top = current.y;
    let bottom = current.y + current.height;
    if (edges.left) left = Math.max(0, Math.min(left + move[0], right - CROP_MIN_SIZE));
    if (edges.right) right = Math.min(1, Math.max(right + move[0], left + CROP_MIN_SIZE));
    if (edges.top) top = Math.max(0, Math.min(top + move[1], bottom - CROP_MIN_SIZE));
    if (edges.bottom) bottom = Math.min(1, Math.max(bottom + move[1], top + CROP_MIN_SIZE));
    setCropDraft({ x: left, y: top, width: right - left, height: bottom - top });
  };

  /** 未拖曳時依位置換游標：邊＝雙箭頭、框內＝移動、框外＝十字。 */
  const hoverCrop = (event: PointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current) return;
    event.currentTarget.style.cursor = cropCursor(
      cropHitTest(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY, cropDraft),
    );
  };

  const extendCrop = (event: PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    if (!drag) return;
    const point = previewPoint(event);
    if (drag.mode === 'new') {
      setCropDraft({
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y),
      });
      return;
    }
    const initial = drag.initial;
    if (drag.mode === 'move') {
      setCropDraft({
        ...initial,
        x: clamp01(Math.min(initial.x + (point.x - drag.start.x), 1 - initial.width)),
        y: clamp01(Math.min(initial.y + (point.y - drag.start.y), 1 - initial.height)),
      });
      return;
    }
    // 拖邊／角：只動被抓住的那幾條邊，並保留最小尺寸。
    let left = initial.x;
    let right = initial.x + initial.width;
    let top = initial.y;
    let bottom = initial.y + initial.height;
    if (drag.edges.left) left = Math.max(0, Math.min(point.x, right - CROP_MIN_SIZE));
    if (drag.edges.right) right = Math.min(1, Math.max(point.x, left + CROP_MIN_SIZE));
    if (drag.edges.top) top = Math.max(0, Math.min(point.y, bottom - CROP_MIN_SIZE));
    if (drag.edges.bottom) bottom = Math.min(1, Math.max(point.y, top + CROP_MIN_SIZE));
    setCropDraft({ x: left, y: top, width: right - left, height: bottom - top });
  };

  /** 放手：新拉的框太小（誤觸）就還原成「整頁」；移動／調整大小保持原樣。 */
  const endCrop = () => {
    const drag = cropDragRef.current;
    if (!drag) return;
    cropDragRef.current = null;
    setCropHandle(null);
    if (drag.mode === 'new') {
      setCropDraft((current) => (current && parseCatalogCrop(current) ? current : null));
    }
  };

  /** 一個 pointermove 同時處理拖曳與游標提示。 */
  const moveCrop = (event: PointerEvent<HTMLDivElement>) => {
    if (cropDragRef.current) {
      extendCrop(event);
      return;
    }
    hoverCrop(event);
  };

  const draftPageSet = useMemo(
    () => new Set(draftPages.map((page) => `${page.documentId}#${page.pageNo}`)),
    [draftPages],
  );

  const reportThumbFailure = (documentId: string) => {
    setThumbError(catalogThumbFailure(documentId) ?? '縮圖未能讀取');
  };

  const retryThumbs = () => {
    if (!activeIdResolved) return;
    clearCatalogThumbFailure(activeIdResolved);
    setThumbError(null);
    setThumbRetry((token) => token + 1);
  };

  const step = !active ? 1 : draftPages.length === 0 ? 2 : 3;
  const pagerItems = pagerWindow(currentPageView, pageViewCount);
  const cropSelection = parseCatalogCrop(cropDraft);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="5xl"
      title="圖冊附件"
      description="選擇圖冊與頁面：點縮圖選取後，再按加入整頁、上半／下半頁、跨頁左半／右半，或按「框選」在彈窗原圖上拖出範圍。清單順序即報價 PDF 附件順序。"
      footer={
        <>
          <ModalButton variant="secondary" onClick={() => onOpenChange(false)}>取消</ModalButton>
          <ModalButton onClick={() => onConfirm(draftPages)}>完成加入</ModalButton>
        </>
      }
    >
      <StepHeader current={step} />

      <div className="grid gap-3 lg:max-h-[62vh] lg:min-h-[420px] lg:grid-cols-[232px_minmax(0,1fr)_300px]">
        {/* ── 1. 圖冊 ─────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card lg:max-h-[62vh]">
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
                      setSheet(null);
                      setSheetOpen(false);
                      setFocusPageNo(1);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border p-1.5 text-left transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60',
                    )}
                  >
                    <CatalogPageThumb
                      key={`${catalog.id}-${thumbRetry}`}
                      documentId={catalog.id}
                      pageNo={1}
                      className="h-14 w-11 shrink-0 overflow-hidden rounded border border-border/60 bg-white"
                      onSize={(thumb) => rememberShape(catalog.id, thumb)}
                      onFail={() => reportThumbFailure(catalog.id)}
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
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card lg:max-h-[62vh]">
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
                  ? '跨頁：加入整頁會出左、右兩張'
                  : activeShape === null
                    ? '正在判斷版面…'
                    : '單頁：按「加入整頁」加入這一頁'}
              </span>
            ) : null}
          </header>

          {thumbError ? (
            <p className="flex items-center gap-2 border-b border-border/70 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive">
              縮圖載入失敗：{thumbError}
              <button
                type="button"
                onClick={retryThumbs}
                className="rounded border border-destructive/40 px-1.5 py-0.5 font-medium hover:bg-destructive/10"
              >
                重試
              </button>
            </p>
          ) : null}

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
                      key={`${pageNo}-${thumbRetry}`}
                      type="button"
                      onClick={() => selectPage(pageNo)}
                      onDoubleClick={() => void openCropSheet(pageNo)}
                      className={cn(
                        'group rounded-lg border p-1 text-left transition-colors',
                        picked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                        focusPageNo === pageNo ? 'ring-2 ring-primary/70' : '',
                      )}
                    >
                      <CatalogPageThumb
                        documentId={active.id}
                        pageNo={pageNo}
                        className={cn(
                          'w-full overflow-hidden rounded bg-white',
                          activeIsSpread ? 'aspect-[4/3]' : 'aspect-[3/4]',
                        )}
                        onFail={() => reportThumbFailure(active.id)}
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
              <div className="mt-3 space-y-1.5 border-t border-border/70 pt-2">
                <p className="text-[11px] text-muted-foreground">
                  點縮圖只會選取，不會自動加入；要加入哪一種自己按下面。
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                    已選第 {focusPageNo} 頁
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => addWholePage()}
                  >
                    加入整頁
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
                    onClick={() => void openCropSheet()}
                  >
                    框選
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
          </div>
        </section>

        {/* ── 3. 已選 ─────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card lg:max-h-[62vh]">
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
                還未加入任何頁面。點中間的頁面縮圖選取，再按「加入整頁」「左半頁／右半頁」「上半頁／下半頁」或「框選」。
              </p>
            ) : (
              draftPages.map((page, index) => (
                <div key={catalogPageKey(page)} className="flex items-start gap-1.5 rounded-lg border border-border p-1">
                  <button
                    type="button"
                    onClick={() => void openPieceSheet(page)}
                    title="預覽這一張"
                    className="shrink-0"
                  >
                    <CatalogPageThumb
                      documentId={page.documentId}
                      pageNo={page.pageNo}
                      className="h-11 w-8 overflow-hidden rounded border border-border/60 bg-white"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-foreground">
                      第 {page.pageNo} 頁
                      <span className="ml-1 rounded bg-muted px-1 py-px text-[10px] font-normal text-muted-foreground">
                        {catalogPageBadge(page) === '整頁' && shapeByDocument[page.documentId] === 'spread'
                          ? '跨頁'
                          : catalogPageBadge(page)}
                      </span>
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground/80" title={catalogPageLabel(page)}>
                      {[page.factoryName, page.series, page.title].filter(Boolean).join(' · ') || page.factoryName}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center">
                      <button type="button" onClick={() => movePage(index, -1)} aria-label="上移" className="text-muted-foreground hover:text-foreground">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => movePage(index, 1)} aria-label="下移" className="text-muted-foreground hover:text-foreground">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
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

      {/* ── 框選／預覽彈窗（顯示原圖，框選確定後才加入並關閉） ────── */}
      <Modal
        open={sheetOpen}
        onOpenChange={(next) => {
          if (!next) closeSheet();
        }}
        size="full"
        title={sheetMode === 'crop' ? `框選第 ${sheet?.page.pageNo ?? focusPageNo} 頁` : '附件預覽'}
        description={
          sheetMode === 'crop'
            ? '在原圖上拖出要放進報價單的範圍；拉好後可拖框內移動、拖邊或角調整大小，再按「加入框選」。'
            : '這一張就是會加在封底之前的樣子。'
        }
        bodyClassName="p-0 sm:p-0"
        footer={
          sheetMode === 'crop' ? (
            <>
              <ModalButton variant="secondary" onClick={closeSheet}>取消</ModalButton>
              <ModalButton onClick={confirmCropSheet} disabled={sheetLoading || !sheet}>加入框選</ModalButton>
            </>
          ) : (
            <ModalButton variant="secondary" onClick={closeSheet}>關閉</ModalButton>
          )
        }
      >
        {sheetLoading ? (
          <p className="flex items-center justify-center gap-2 py-24 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在載入預覽
          </p>
        ) : sheet ? (
          <div className="flex flex-col">
            {sheetMode === 'crop' ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                <span className="text-[11px] font-medium text-foreground">框選範圍</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {cropSelection
                    ? `${Math.round(cropSelection.width * 100)}% × ${Math.round(cropSelection.height * 100)}%`
                    : '未框選（按加入框選＝整頁）'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  disabled={!cropSelection}
                  onClick={() => setCropDraft(null)}
                >
                  清除框選
                </Button>
                {sheet.sheetCount > 1 ? (
                  <span className="text-[11px] text-muted-foreground">跨頁：這是左右兩版的原圖</span>
                ) : null}
                <span className="text-[11px] text-muted-foreground">拖框內移動、拖邊／角調整大小</span>
              </div>
            ) : null}

            <div
              ref={cropStageRef}
              className="flex h-[62vh] w-full items-center justify-center overflow-hidden bg-muted/40 p-3"
            >
              <div
                ref={cropSurfaceRef}
                className={cn(
                  'relative shrink-0 rounded bg-white shadow-lg',
                  sheetMode === 'crop' ? 'touch-none select-none' : '',
                )}
                style={{
                  ...(sheetBox ? { width: sheetBox.width, height: sheetBox.height } : { width: '100%', height: '100%' }),
                  cursor: sheetMode === 'crop' ? 'crosshair' : 'default',
                }}
                onPointerDown={sheetMode === 'crop' ? beginCrop : undefined}
                onPointerMove={sheetMode === 'crop' ? moveCrop : undefined}
                onPointerUp={sheetMode === 'crop' ? endCrop : undefined}
                onPointerCancel={sheetMode === 'crop' ? endCrop : undefined}
                onPointerLeave={sheetMode === 'crop' ? (event) => { event.currentTarget.style.cursor = 'crosshair'; } : undefined}
                onLostPointerCapture={sheetMode === 'crop' ? endCrop : undefined}
                onDragStart={(event) => event.preventDefault()}
              >
                {/* 圖片本身不吃指針事件：否則瀏覽器的圖片拖放會搶走 drag，框選會拖不動。 */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded">
                  <LoadingImage
                    src={sheet.url}
                    alt="圖冊頁原圖"
                    className="h-full w-full"
                    imgClassName="object-contain"
                    draggable={false}
                  />
                </div>
                {sheetMode === 'crop' && cropSelection ? (
                  <SelectionBox
                    x={cropSelection.x * 100}
                    y={cropSelection.y * 100}
                    w={cropSelection.width * 100}
                    h={cropSelection.height * 100}
                    color="hsl(var(--primary))"
                    active
                    draggingHandle={cropHandle}
                    sizeText={{
                      width: `${Math.round(cropSelection.width * 100)}%`,
                      height: `${Math.round(cropSelection.height * 100)}%`,
                    }}
                    ariaLabel="框選範圍"
                    onHandlePointerDown={beginHandleResize}
                    onHandleKeyDown={nudgeCrop}
                  />
                ) : null}
                {sheetMode === 'crop' && cropDraft && !cropSelection ? (
                  <div
                    className="pointer-events-none absolute border border-dashed border-primary/70"
                    style={cropStyle(cropDraft)}
                  />
                ) : null}
              </div>
            </div>

            {sheetMode === 'piece' && sheet.sheetCount > 1 ? (
              <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                跨頁：PDF 會出左、右兩張，這裡顯示的是左半（第 {sheet.page.pageNo} 頁）。
              </p>
            ) : null}
          </div>
        ) : (
          <p className="py-24 text-center text-xs text-muted-foreground">這一頁未能預覽。</p>
        )}
      </Modal>
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
