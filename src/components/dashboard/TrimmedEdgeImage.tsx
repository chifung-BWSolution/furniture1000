import { LoadingImage } from '@/components/ui/loading-image';

type TrimmedEdgeImageProps = {
  src: string;
  alt?: string;
  className?: string;
  title?: string;
};

/** Edge trimming belongs to upload preparation. Render stable Storage images here;
 * LoadingImage uses the persisted thumbnail and falls back to the original.
 */
export function TrimmedEdgeImage({ src, alt = '', className, title }: TrimmedEdgeImageProps) {
  return <LoadingImage src={src} alt={alt} title={title} className={className} />;
}
