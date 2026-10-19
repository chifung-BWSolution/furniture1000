import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Confident arrival — fast enough for repeated navigation. */
export const inkEase = [0.16, 1, 0.3, 1] as const;

/**
 * Shared active marker. `layoutId` lets the same ink travel between tabs
 * instead of each control fading its own background in place.
 */
export function NavInk({
  layoutId,
  className,
}: {
  layoutId: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId={reduce ? undefined : layoutId}
      aria-hidden
      initial={false}
      className={className}
      transition={
        reduce
          ? { duration: 0 }
          : { layout: { duration: 0.34, ease: inkEase } }
      }
      style={{ pointerEvents: 'none' }}
    />
  );
}

/** Page arrival: a short rise plus a hairline of the same ink across the top edge. */
export function ViewEnter({
  viewKey,
  children,
}: {
  viewKey: string;
  children: ReactNode;
}) {
  return (
    <div className="relative h-full min-h-0">
      <span key={`${viewKey}-ink`} aria-hidden className="view-ink-sweep" />
      <div key={viewKey} className="view-enter h-full min-h-0">
        {children}
      </div>
    </div>
  );
}
