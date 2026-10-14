interface PlannedPageProps {
  sectionLabel: string;
  title: string;
}

/** FDS 2.0 sitemap shell. The page exists in navigation and is not built yet. */
export function PlannedPage({ sectionLabel, title }: PlannedPageProps) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card px-8 py-10 text-center shadow-sm">
        <p className="font-mono-data text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {sectionLabel}
        </p>
        <h1 className="mt-3 font-display text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-4 font-body text-sm text-muted-foreground">此頁面待開發</p>
      </div>
    </div>
  );
}
