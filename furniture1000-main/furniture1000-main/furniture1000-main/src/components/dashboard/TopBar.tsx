import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Database, ChevronRight, Save, Loader2, Check } from 'lucide-react';
import { ViewType } from '@/types/product';
import { getViewMeta } from './navConfig';

interface TopBarProps {
  currentView: ViewType;
  selectedCount: number;
  totalProducts: number;
  onBulkPublish: () => void;
  onSave?: () => void;
  isSaving?: boolean;
  isPublishing?: boolean;
  hasUnsavedChanges?: boolean;
  stats: {
    drafts: number;
    publishing: number;
    success: number;
    errors: number;
  };
}


export function TopBar({
  currentView,
  selectedCount,
  totalProducts,
  onBulkPublish,
  onSave,
  isSaving,
  isPublishing,
  hasUnsavedChanges,
  stats,
}: TopBarProps) {
  const meta = getViewMeta(currentView);
  const viewInfo = { label: meta.viewLabel, parent: meta.sectionLabel };

  // Only show product-related buttons on product catalog views
  const showProductButtons = currentView === 'listed-products' || currentView === 'ready-to-publish';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-xl">
      {/* Left — Breadcrumb */}
      <div className="flex items-center gap-2">
        {viewInfo.parent && (
          <>
            <span className="font-body text-xs text-muted-foreground">{viewInfo.parent}</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          </>
        )}
        <h2 className="font-display text-lg font-bold tracking-tight">{viewInfo.label}</h2>
      </div>

      {/* Right — Stats & CTA (only on product catalog views) */}
      {showProductButtons && (
        <div className="flex items-center gap-4">
          {/* Product stats pills */}
          <div className="hidden items-center gap-2 md:flex">
            <span className="font-mono-data text-[11px] text-muted-foreground tracking-wider">
              {totalProducts} 個產品
            </span>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground font-mono-data">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                {stats.drafts}
              </span>
              {stats.publishing > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500 font-mono-data">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-status-pulse" />
                  {stats.publishing}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 font-mono-data">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {stats.success}
              </span>
              {stats.errors > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-500 font-mono-data">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  {stats.errors}
                </span>
              )}
            </div>
          </div>

          {/* Save Button */}
          {onSave && (
            <Button
              onClick={onSave}
              disabled={isSaving || !hasUnsavedChanges}
              variant={hasUnsavedChanges ? 'default' : 'outline'}
              className={cn(
                'gap-2 font-display font-bold transition-all duration-300',
                hasUnsavedChanges && !isSaving && 'bg-emerald-600 hover:bg-emerald-700 text-white',
                !hasUnsavedChanges && 'opacity-60'
              )}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : hasUnsavedChanges ? (
                <Save className="h-4 w-4" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isSaving ? '儲存中...' : hasUnsavedChanges ? '儲存變更' : '已儲存'}
            </Button>
          )}

          {/* Upload to Database Button */}
          <Button
            onClick={onBulkPublish}
            disabled={selectedCount === 0 || isPublishing}
            className={cn(
              'relative gap-2 bg-primary font-display font-bold text-primary-foreground transition-all duration-300',
              selectedCount > 0 && !isPublishing && 'animate-pulse-glow hover:scale-[0.98] active:scale-[0.96]',
              (selectedCount === 0 || isPublishing) && 'opacity-60'
            )}
          >
            {isPublishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Database className="h-4 w-4" />
            )}
            {isPublishing ? '上傳中...' : '上傳到資料庫'}
            {selectedCount > 0 && !isPublishing && (
              <Badge className="ml-1 h-5 min-w-5 bg-white/20 text-[10px] text-white hover:bg-white/20">
                {selectedCount}
              </Badge>
            )}
          </Button>
        </div>
      )}
    </header>
  );
}
