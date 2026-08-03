import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const THUMB_SLOTS = 4;

/**
 * Reserved row under a product main image. Shows up to 4 non-interactive
 * thumbnails when extras exist; empty slots keep card heights aligned.
 */
export function ProductExtraImageThumbs({
  urls,
  className,
}: {
  urls: string[];
  className?: string;
}) {
  const extras = urls.slice(0, THUMB_SLOTS);
  return (
    <div
      className={cn('grid h-11 w-full grid-cols-4 gap-1', className)}
      aria-hidden={extras.length === 0}
    >
      {Array.from({ length: THUMB_SLOTS }, (_, index) => {
        const src = extras[index];
        return (
          <div
            key={index}
            className="pointer-events-none overflow-hidden rounded-md bg-muted/40"
          >
            {src ? (
              <img
                src={src}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-cover"
              />
            ) : null}
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
