import { cn } from '@/lib/utils';

const FDS_ICON_SRC = '/fds-icon.svg';

interface FdsLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showLabel?: boolean;
}

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
} as const;

export function FdsLogo({ size = 'md', className, showLabel = false }: FdsLogoProps) {
  return (
    <img
      src={FDS_ICON_SRC}
      alt={showLabel ? 'FDS Furniture Design Platform' : 'FDS'}
      className={cn('shrink-0 rounded-xl object-cover', sizeMap[size], className)}
      width={size === 'lg' ? 48 : size === 'md' ? 36 : 32}
      height={size === 'lg' ? 48 : size === 'md' ? 36 : 32}
      decoding="async"
    />
  );
}

export { FDS_ICON_SRC };
