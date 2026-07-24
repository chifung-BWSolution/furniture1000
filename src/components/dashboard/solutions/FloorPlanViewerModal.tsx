import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from 'lucide-react';
import { renderPdfPagesToObjectUrls } from '@/lib/floorPlanPdf';
import { toast } from 'sonner';

function isPdfSource(url: string | null | undefined, type: string | null | undefined) {
  const value = (url || '').toLowerCase();
  const mime = (type || '').toLowerCase();
  return (
    mime.includes('pdf') ||
    value.startsWith('data:application/pdf') ||
    /\.pdf(\?|#|$)/i.test(value)
  );
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

  useEffect(() => {
    if (!open || !url) {
      setPageUrls((current) => {
        current.forEach((item) => URL.revokeObjectURL(item));
        return [];
      });
      setPageIndex(0);
      return;
    }

    let cancelled = false;
    const pdf = isPdfSource(url, type);

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

  if (!open || !url) return null;

  const current = pageUrls[pageIndex] || previewUrl || '';
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pageUrls.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-base font-bold">{title}</p>
            <p className="text-xs text-muted-foreground">
              平面圖預覽
              {pageUrls.length > 1
                ? ` · 第 ${pageIndex + 1} / ${pageUrls.length} 頁`
                : ''}
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
              onClick={onClose}
              className="rounded-lg border border-border p-2 hover:bg-muted"
              aria-label="關閉平面圖預覽"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
          {loading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm">正在轉成可檢視圖片…</span>
            </div>
          ) : current ? (
            <img
              src={current}
              alt={`${title} 平面圖`}
              className="max-h-[72vh] w-auto max-w-full rounded-lg border border-border bg-white object-contain shadow-sm"
            />
          ) : (
            <p className="text-sm text-muted-foreground">暫無可顯示的平面圖</p>
          )}
        </div>

        {pageUrls.length > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button
              type="button"
              disabled={!canPrev || loading}
              onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
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
              onClick={() =>
                setPageIndex((value) =>
                  Math.min(pageUrls.length - 1, value + 1),
                )
              }
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
