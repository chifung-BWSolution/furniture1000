import { cn } from '@/lib/utils';
import { ProductStatus } from '@/types/product';

interface StatusBadgeProps {
  status: ProductStatus;
  className?: string;
}

const statusConfig: Record<ProductStatus, { label: string; className: string }> = {
  draft: {
    label: '草稿',
    className: 'bg-muted text-muted-foreground border-muted',
  },
  publishing: {
    label: '發佈中',
    className: 'bg-amber-500/15 text-amber-500 border-amber-500/30 animate-status-pulse',
  },
  success: {
    label: '已發佈',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  },
  error: {
    label: '錯誤',
    className: 'bg-rose-500/15 text-rose-500 border-rose-500/30',
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold font-mono-data tracking-wider uppercase',
        config.className,
        className
      )}
    >
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'draft' && 'bg-muted-foreground',
        status === 'publishing' && 'bg-amber-500 animate-status-pulse',
        status === 'success' && 'bg-emerald-500',
        status === 'error' && 'bg-rose-500',
      )} />
      {config.label}
    </span>
  );
}
