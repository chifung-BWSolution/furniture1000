import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/** Shared chrome for Client Portal secondary pages (staff preview of client experience). */
export function PortalPageShell({
  title,
  subtitle,
  badge,
  titleExtra,
  actions,
  children,
  className,
  maxWidthClass = 'max-w-none',
  scrollRef,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  /** Rendered to the right of title + badge (e.g. 全部 / BWA / BWF filters). */
  titleExtra?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  maxWidthClass?: string;
  /** Ref to the scrollable shell — used for sticky partition observers. */
  scrollRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn('h-full overflow-y-auto bg-background p-3 sm:p-4 md:p-6', className)}
    >
      <div className={cn('mx-auto w-full space-y-5 md:space-y-7', maxWidthClass)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                {title}
              </h1>
              {badge ? (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-body text-xs font-medium text-primary">
                  {badge}
                </span>
              ) : null}
              {titleExtra}
            </div>
            {subtitle ? (
              <p className="mt-1 max-w-2xl font-body text-sm text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
