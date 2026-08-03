import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Reserved row under a product main image.
 * - Design project default: up to 4 non-interactive thumbs
 * - Quote schemes: up to 3 clickable thumbs; overflow shows +N on the last slot
 */
export function ProductExtraImageThumbs({
  urls,
  className,
  maxVisible = 4,
  interactive = false,
  onSelect,
}: {
  urls: string[];
  className?: string;
  /** How many thumbnail slots to show (default 4). */
  maxVisible?: number;
  /** When true, thumbs open the gallery at that image. */
  interactive?: boolean;
  /** Called with the index within `urls` (extras list). */
  onSelect?: (extraIndex: number) => void;
}) {
  const slots = Math.max(1, Math.floor(maxVisible));
  const overflow = Math.max(0, urls.length - slots);
  const visible = urls.slice(0, slots);

  return (
    <div
      className={cn(
        'grid h-11 w-full gap-1',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      aria-hidden={visible.length === 0 && !interactive}
    >
      {Array.from({ length: slots }, (_, index) => {
        const src = visible[index];
        const showOverflow = overflow > 0 && index === slots - 1 && Boolean(src);
        if (!src) {
          return (
            <div
              key={index}
              className="overflow-hidden rounded-md bg-muted/40"
            />
          );
        }

        const content = (
          <>
            <img
              src={src}
              alt=""
              draggable={false}
              className="h-full w-full select-none object-cover"
            />
            {showOverflow ? (
              <span className="pointer-events-none absolute inset-y-0 right-0 flex w-[42%] items-center justify-center bg-black/65 text-[11px] font-bold text-white">
                +{overflow}
              </span>
            ) : null}
          </>
        );

        if (interactive && onSelect) {
          return (
            <button
              key={index}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(index);
              }}
              className="relative overflow-hidden rounded-md bg-muted/40 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title="點擊放大此圖片"
              aria-label={`放大第 ${index + 1} 張附加圖片`}
            >
              {content}
            </button>
          );
        }

        return (
          <div
            key={index}
            className="pointer-events-none relative overflow-hidden rounded-md bg-muted/40"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** Window-mode gallery: click main image to open; left/right browse extras. */
export function ProductImageGalleryLightbox({
  urls,
  title,
  startIndex = 0,
  onClose,
}: {
  urls: string[];
  title?: string;
  startIndex?: number;
  onClose: () => void;
}) {
  const safeUrls = urls.filter(Boolean);
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, safeUrls.length - 1)),
  );

  useEffect(() => {
    setIndex(Math.min(Math.max(0, startIndex), Math.max(0, safeUrls.length - 1)));
  }, [startIndex, safeUrls.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (safeUrls.length <= 1) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((current) => (current - 1 + safeUrls.length) % safeUrls.length);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setIndex((current) => (current + 1) % safeUrls.length);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, safeUrls.length]);

  if (safeUrls.length === 0) return null;

  const current = safeUrls[index] || safeUrls[0];
  const canNavigate = safeUrls.length > 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title}圖片預覽` : '產品圖片預覽'}
    >
      {canNavigate ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIndex((currentIndex) =>
              (currentIndex - 1 + safeUrls.length) % safeUrls.length,
            );
          }}
          className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2.5 text-white hover:bg-black/80 sm:left-6"
          aria-label="上一張圖片"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      ) : null}

      <img
        src={current}
        alt={title || '產品圖片'}
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />

      {canNavigate ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIndex((currentIndex) => (currentIndex + 1) % safeUrls.length);
          }}
          className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2.5 text-white hover:bg-black/80 sm:right-6"
          aria-label="下一張圖片"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        aria-label="關閉預覽"
      >
        <X className="h-5 w-5" />
      </button>

      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-[13px] text-white/80">
        {canNavigate
          ? `${index + 1} / ${safeUrls.length} · 點擊空白處或按 Esc 關閉`
          : '點擊空白處或按 Esc 關閉'}
      </p>
    </div>
  );
}
