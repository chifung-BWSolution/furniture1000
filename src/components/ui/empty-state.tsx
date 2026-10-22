import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './empty';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title?: string;
  description?: ReactNode;
  className?: string;
}

/** A successful query with no records. Never use this for a failed request. */
export function EmptyState({ title = '沒有符合條件的資料', description = '請調整搜尋或篩選，再試一次。', className }: EmptyStateProps) {
  return <Empty role="status" className={className}>
    <img src="/images/states/empty.png" alt="" aria-hidden="true" width={640} height={480} className="h-auto w-44 object-contain sm:w-56" />
    <EmptyHeader>
      <EmptyTitle className="break-words">{title}</EmptyTitle>
      <EmptyDescription className="break-words">{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>;
}

export interface CompactEmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}

/** An empty panel inside a page (card, side pane, tab). Illustration-free, no actions. */
export function CompactEmptyState({ icon: Icon, title, description, className }: CompactEmptyStateProps) {
  return <div role="status" className={cn('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
    {Icon && (
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60">
        <Icon aria-hidden="true" className="h-5 w-5 text-muted-foreground/70" />
      </span>
    )}
    <p className="font-body text-sm text-muted-foreground">{title}</p>
    {description && <p className="max-w-sm font-body text-xs leading-relaxed text-muted-foreground/70">{description}</p>}
  </div>;
}
