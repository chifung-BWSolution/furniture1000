import { type ReactNode, type Ref } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ListPageShellProps {
  title: string;
  subtitle: string;
  hideHeader?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchInputRef?: Ref<HTMLInputElement>;
  /** Extra controls to the left of the search field (e.g. filters). */
  searchLeading?: ReactNode;
  /** Extra controls next to the search field (e.g. refresh). */
  searchActions?: ReactNode;
  scrollContainerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  className?: string;
}

/** Shared chrome for 建立新報價單 / 報價單一覽 full-page tables. */
export function ListPageShell({
  title,
  subtitle,
  hideHeader = false,
  search,
  onSearchChange,
  searchPlaceholder,
  searchInputRef,
  searchLeading,
  searchActions,
  scrollContainerRef,
  children,
  className,
}: ListPageShellProps) {
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}>
      <div className="bg-background fds-page-padding pb-0">
        <div className="mx-auto flex w-full max-w-none flex-col gap-4">
          {!hideHeader && <div className="fds-page-header">
            <h1 className="fds-page-title">
              {title}
            </h1>
            <p className="fds-page-description">{subtitle}</p>
          </div>}
          <div
            className={cn(
              'flex w-full items-center gap-2',
              searchLeading ? 'max-w-none' : 'max-w-lg',
            )}
          >
            {searchLeading}
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 font-body text-sm text-foreground shadow-sm placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                autoComplete="off"
              />
            </div>
            {searchActions}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 md:px-6">
        <div ref={scrollContainerRef} className="h-full min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-none">{children}</div>
        </div>
      </div>
    </div>
  );
}

interface ListTableCardProps {
  children: ReactNode;
  footer?: ReactNode;
  minWidthClassName?: string;
}

export function ListTableCard({
  children,
  footer,
  minWidthClassName = 'min-w-[1100px]',
}: ListTableCardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className={cn('w-full border-collapse', minWidthClassName)}>
          {children}
        </table>
      </div>
      {footer ? (
        <div className="border-t border-border px-4 py-2 font-body text-[11px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export const LIST_TABLE_TH_CLASS =
  'whitespace-nowrap px-3 py-2.5 text-left font-body text-[11px] font-semibold tracking-wide text-muted-foreground';

export function ListTableLoadingRow({
  colSpan,
  label,
}: {
  colSpan: number;
  label: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16 text-center">
        <div className="inline-flex items-center gap-2 font-body text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {label}
        </div>
      </td>
    </tr>
  );
}

export function ListTableEmptyRow({
  colSpan,
  message,
}: {
  colSpan: number;
  message: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-16 text-center font-body text-sm text-muted-foreground"
      >
        {message}
      </td>
    </tr>
  );
}

export function ListRefreshButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title="重新載入"
    >
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
    </button>
  );
}
