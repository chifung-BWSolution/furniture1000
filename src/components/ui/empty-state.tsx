import type { ReactNode } from 'react';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './empty';

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
