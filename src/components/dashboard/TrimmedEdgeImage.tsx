import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { trimImageSolidEdgeBorders } from '@/lib/trimImageEdges';

type TrimmedEdgeImageProps = {
  src: string;
  alt?: string;
  className?: string;
  title?: string;
};

/**
 * Renders an image after trimming solid 1px black/white edge hairlines.
 * Falls back to the original `src` if trim is unnecessary or fails (e.g. CORS).
 */
export function TrimmedEdgeImage({
  src,
  alt = '',
  className,
  title,
}: TrimmedEdgeImageProps) {
  const [displaySrc, setDisplaySrc] = useState(src);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setDisplaySrc(src);

    const run = async () => {
      const value = (src || '').trim();
      if (!value || value.startsWith('data:image/svg')) return;
      try {
        const response = await fetch(value, { mode: 'cors' });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return;
        const file = new File(
          [blob],
          'preview.jpg',
          { type: blob.type || 'image/jpeg' },
        );
        const trimmed = await trimImageSolidEdgeBorders(file);
        if (cancelled) return;
        if (trimmed === file) return;
        objectUrl = URL.createObjectURL(trimmed);
        setDisplaySrc(objectUrl);
      } catch {
        // Keep original src (CORS / offline / decode failure).
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return (
    <img src={displaySrc} alt={alt} title={title} className={cn(className)} />
  );
}
