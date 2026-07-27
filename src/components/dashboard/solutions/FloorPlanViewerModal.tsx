import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Map as MapIcon,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import { renderPdfPagesToObjectUrls } from '@/lib/floorPlanPdf';
import { toast } from 'sonner';
import type { DesignProject } from '@/types/solutions';

/** Fit (100%) → staged enlargements requested for the floor-plan viewer. */
const ZOOM_LEVELS = [1, 1.5, 2, 2.5, 3, 5] as const;

function isPdfSource(url: string | null | undefined, type: string | null | undefined) {
  const value = (url || '').toLowerCase();
  const mime = (type || '').toLowerCase();
  return (
    mime.includes('pdf') ||
    value.startsWith('data:application/pdf') ||
    /\.pdf(\?|#|$)/i.test(value)
  );
}

function isDisplayableFloorImage(
  url: string | null | undefined,
  type: string | null | undefined,
) {
  if (!url) return false;
  const mime = (type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return (
    url.startsWith('data:image/') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  );
}

export function floorPlanPreviewOf(project: DesignProject): string | null {
  const preview = project.meta?.floorPlanPreviewUrl;
  return typeof preview === 'string' && preview.trim() ? preview.trim() : null;
}

export function FloorPlanThumb({
  url,
  type,
  previewUrl,
  fileName,
}: {
  url: string | null;
  type: string | null;
  previewUrl?: string | null;
  fileName?: string;
}) {
  if (previewUrl) {
    return (
      <div className="relative h-full w-full">
        <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        {url && isPdfSource(url, type) ? (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 py-0.5 text-[9px] font-semibold text-white">
            PDF
          </span>
        ) : null}
      </div>
    );
  }
  if (url && isPdfSource(url, type)) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-rose-500/5 px-1 text-rose-700">
        <FileText className="h-5 w-5" />
        <span className="truncate text-[10px] font-semibold">PDF</span>
        {fileName ? (
          <span className="max-w-full truncate text-[9px] text-muted-foreground">
            {fileName}
          </span>
        ) : null}
      </div>
    );
  }
  if (url && isDisplayableFloorImage(url, type)) {
    return <img src={url} alt="" className="h-full w-full object-cover" />;
  }
  return <MapIcon className="h-6 w-6 text-muted-foreground/50" />;
}

export function FloorPlanViewerModal({
  open,
  title,
  url,
  type,
  previewUrl,
  onClose,
}: {
  open: boolean;
  title: string;
  url: string | null;
  type: string | null;
  previewUrl?: string | null;
  onClose: () => void;
}) {
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoom = ZOOM_LEVELS[zoomIndex] ?? 1;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;
  const canZoomOut = zoomIndex > 0;

  const zoomIn = () => {
    setZoomIndex((current) => Math.min(ZOOM_LEVELS.length - 1, current + 1));
  };
  const zoomOut = () => {
    setZoomIndex((current) => Math.max(0, current - 1));
  };

  useEffect(() => {
    if (!open || !url) {
      setPageUrls((current) => {
        current.forEach((item) => {
          if (item.startsWith('blob:')) URL.revokeObjectURL(item);
        });
        return [];
      });
      setPageIndex(0);
      setZoomIndex(0);
      setNaturalSize({ w: 0, h: 0 });
      return;
    }

    let cancelled = false;
    const pdf = isPdfSource(url, type);
    setZoomIndex(0);
    setNaturalSize({ w: 0, h: 0 });

    if (!pdf) {
      setPageUrls([url]);
      setPageIndex(0);
      return;
    }

    setLoading(true);
    renderPdfPagesToObjectUrls(url, { scale: 1.45, maxPages: 8 })
      .then((urls) => {
        if (cancelled) {
          urls.forEach((item) => URL.revokeObjectURL(item));
          return;
        }
        setPageUrls(urls);
        setPageIndex(0);
      })
      .catch((error) => {
        if (cancelled) return;
        if (previewUrl) {
          setPageUrls([previewUrl]);
          setPageIndex(0);
          return;
        }
        toast.error('無法預覽 PDF 平面圖', {
          description:
            error instanceof Error ? error.message : '請稍後再試',
        });
        setPageUrls([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, previewUrl, type, url]);

  useEffect(() => {
    return () => {
      pageUrls.forEach((item) => {
        if (item.startsWith('blob:')) URL.revokeObjectURL(item);
      });
    };
  }, [pageUrls]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => {
      setViewportSize({
        w: node.clientWidth,
        h: node.clientHeight,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, loading, pageIndex]);

  const current = pageUrls[pageIndex] || previewUrl || '';
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pageUrls.length - 1;

  useEffect(() => {
    setNaturalSize({ w: 0, h: 0 });
  }, [current]);

  const displaySize = useMemo(() => {
    const pad = 32;
    const availW = Math.max(120, viewportSize.w - pad);
    const availH = Math.max(120, viewportSize.h - pad);
    if (!naturalSize.w || !naturalSize.h || !availW || !availH) {
      return { w: 0, h: 0 };
    }
    const fit = Math.min(availW / naturalSize.w, availH / naturalSize.h, 1);
    return {
      w: Math.max(1, Math.round(naturalSize.w * fit * zoom)),
      h: Math.max(1, Math.round(naturalSize.h * fit * zoom)),
    };
  }, [naturalSize.h, naturalSize.w, viewportSize.h, viewportSize.w, zoom]);

  useEffect(() => {
    // After zoom changes, keep scroll range valid (especially top/left).
    const node = scrollRef.current;
    if (!node) return;
    if (zoom <= 1) {
      node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
      node.scrollTop = Math.max(0, (node.scrollHeight - node.clientHeight) / 2);
      return;
    }
    // Clamp so users can always reach left/top edges.
    node.scrollLeft = Math.min(node.scrollLeft, node.scrollWidth - node.clientWidth);
    node.scrollTop = Math.min(node.scrollTop, node.scrollHeight - node.clientHeight);
  }, [displaySize.h, displaySize.w, zoom]);

  if (!open || !url) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[84vh] w-[84vw] max-h-[84vh] max-w-[84vw] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 平面圖預覽`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold">{title}</p>
            <p className="text-xs text-muted-foreground">
              平面圖預覽
              {pageUrls.length > 1
                ? ` · 第 ${pageIndex + 1} / ${pageUrls.length} 頁`
                : ''}
              {` · 目前 ${Math.round(zoom * 100)}%`}
              {' · 點擊圖片或按＋可放大（150% / 200% / 250% / 300% / 500%）'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {url.startsWith('http') ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                開啟原檔
              </a>
            ) : null}
            <button
              type="button"
              onClick={zoomOut}
              disabled={!canZoomOut}
              className="rounded-lg border border-border p-2 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="縮小"
              title="縮小"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={!canZoomIn}
              className="rounded-lg border border-border p-2 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="放大"
              title="放大"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border p-2 hover:bg-muted"
              aria-label="關閉平面圖預覽"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-auto bg-muted/30"
        >
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm">正在轉成可檢視圖片…</span>
            </div>
          ) : current ? (
            <div
              className="grid place-items-center"
              style={{
                width: Math.max(viewportSize.w || 0, (displaySize.w || 0) + 32),
                height: Math.max(viewportSize.h || 0, (displaySize.h || 0) + 32),
                minWidth: '100%',
                minHeight: '100%',
              }}
            >
              <img
                src={current}
                alt={`${title} 平面圖`}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  setNaturalSize({
                    w: img.naturalWidth || img.width,
                    h: img.naturalHeight || img.height,
                  });
                }}
                onClick={zoomIn}
                className="rounded-lg border border-border bg-white object-contain shadow-sm"
                style={{
                  cursor: canZoomIn ? 'zoom-in' : 'default',
                  width: displaySize.w || undefined,
                  height: displaySize.h || undefined,
                  maxWidth: displaySize.w ? undefined : '100%',
                  maxHeight: displaySize.h ? undefined : '100%',
                }}
                title={
                  canZoomIn
                    ? `點擊放大至 ${Math.round((ZOOM_LEVELS[zoomIndex + 1] || zoom) * 100)}%`
                    : '已達最大放大 500%'
                }
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">暫無可顯示的平面圖</p>
            </div>
          )}
        </div>

        {pageUrls.length > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button
              type="button"
              disabled={!canPrev || loading}
              onClick={() => {
                setPageIndex((value) => Math.max(0, value - 1));
                setZoomIndex(0);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              上一頁
            </button>
            <span className="font-mono-data text-xs text-muted-foreground">
              {pageIndex + 1} / {pageUrls.length}
            </span>
            <button
              type="button"
              disabled={!canNext || loading}
              onClick={() => {
                setPageIndex((value) =>
                  Math.min(pageUrls.length - 1, value + 1),
                );
                setZoomIndex(0);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              下一頁
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
