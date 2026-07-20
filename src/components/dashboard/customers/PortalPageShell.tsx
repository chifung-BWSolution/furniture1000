import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared chrome for Client Portal secondary pages (staff preview of client experience). */
export function PortalPageShell({
  title,
  subtitle,
  badge,
  actions,
  children,
  className,
  maxWidthClass = 'max-w-5xl',
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  maxWidthClass?: string;
}) {
  return (
    <div className={cn('h-full overflow-y-auto bg-background p-6 md:p-8', className)}>
      <div className={cn('mx-auto space-y-6', maxWidthClass)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
              {badge ? (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-body text-[11px] font-medium text-primary">
                  {badge}
                </span>
              ) : null}
            </div>
            {subtitle ? (
              <p className="mt-1 max-w-2xl font-body text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
