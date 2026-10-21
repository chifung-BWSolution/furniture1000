import { cn } from '@/lib/utils';
import { productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import { ImageLightbox } from '@/components/ui/image-lightbox';

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
              className="overflow-hidden rounded-md border border-border/70 bg-muted/30"
            />
          );
        }

        const content = (
          <>
            <LoadingImage
              src={productThumbUrl(src)}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
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
              className="relative overflow-hidden rounded-md border border-border bg-muted/40 shadow-sm ring-offset-background transition-colors hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
            className="pointer-events-none relative overflow-hidden rounded-md border border-border bg-muted/40 shadow-sm"
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
  if (safeUrls.length === 0) return null;

  return (
    <ImageLightbox
      open
      onClose={onClose}
      images={safeUrls}
      startIndex={startIndex}
      title={title}
    />
  );
}
