import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './empty';
import type { EmptyStateProps } from './empty-state';

export type ErrorStateProps = EmptyStateProps;

/** A failed request: name the problem and point at the page-level recovery (重新整理). */
export function ErrorState({ title = '資料暫時無法載入', description = '請按「重新整理」再試一次。', className }: ErrorStateProps) {
  return <Empty role="alert" className={className}>
    <img src="/images/states/error.png" alt="" aria-hidden="true" width={640} height={480} className="h-auto w-44 object-contain sm:w-56" />
    <EmptyHeader>
      <EmptyTitle className="break-words">{title}</EmptyTitle>
      <EmptyDescription className="break-words">{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>;
}
