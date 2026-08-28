import { type SyntheticEvent } from 'react';
import { cn } from '@/lib/utils';
import { safeAsanaHref } from '@/lib/pmsPitchings';

/** Official Asana three-dot mark. */
function AsanaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M18.78 12.653c-2.64 0-4.78 2.16-4.78 4.826 0 2.665 2.14 4.825 4.78 4.825s4.78-2.16 4.78-4.825c0-2.666-2.14-4.826-4.78-4.826zm-13.56 0c-2.64 0-4.78 2.16-4.78 4.826 0 2.665 2.14 4.825 4.78 4.825s4.78-2.16 4.78-4.825c0-2.666-2.14-4.826-4.78-4.826zM12 1.696c-2.64 0-4.78 2.16-4.78 4.825 0 2.666 2.14 4.826 4.78 4.826s4.78-2.16 4.78-4.826c0-2.665-2.14-4.825-4.78-4.825z"
      />
    </svg>
  );
}

function stopRowSelect(e: SyntheticEvent) {
  e.stopPropagation();
}

/**
 * Icon that opens a pitching Asana URL in a new tab.
 * Stops row click/keyboard select so list rows do not open a quote.
 */
export function AsanaLinkButton({
  asanaLink,
  label,
  compact,
}: {
  asanaLink?: string | null;
  label?: string;
  compact?: boolean;
}) {
  const href = safeAsanaHref(asanaLink);
  if (!href) {
    return <span className="font-body text-xs text-muted-foreground">—</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="在新分頁開啟 Asana"
      aria-label={label ? `開啟 ${label} 的 Asana` : '開啟 Asana'}
      onClick={stopRowSelect}
      onPointerDown={stopRowSelect}
      onKeyDown={stopRowSelect}
      className={cn(
        'inline-flex items-center justify-center rounded-md border border-border bg-card text-[#F06A6A] shadow-sm transition-colors hover:bg-[#F06A6A]/10 hover:text-[#E25555]',
        compact ? 'h-7 w-7' : 'h-8 w-8',
      )}
    >
      <AsanaMark className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </a>
  );
}
