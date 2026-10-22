interface PlannedPageProps {
  sectionLabel: string;
  title: string;
}

/** FDS 2.0 sitemap shell. The page exists in navigation and is not built yet. */
export function PlannedPage({ sectionLabel, title }: PlannedPageProps) {
  return (
    <div className="h-full overflow-y-auto bg-background fds-page-padding">
      <header className="fds-page-header">
        <h1 className="fds-page-title">{title}</h1>
        <p className="fds-page-description">{sectionLabel}</p>
      </header>
      <p className="py-16 text-center text-sm text-muted-foreground">此頁面待開發</p>
    </div>
  );
}
