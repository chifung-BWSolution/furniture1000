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

  // Show stats (總共/已選) on product list views
  const showProductButtons = currentView === 'listed-products' || currentView === 'ready-to-publish' || currentView === 'furniture-group-check' || currentView === 'product-catalog';
  // The upload-to-catalog action only appears on the 所有產品 / 待發佈 views
  const showUploadButton = currentView === 'listed-products' || currentView === 'ready-to-publish' || currentView === 'furniture-group-check';
  const uploadLabel = currentView === 'listed-products' ? '上傳到產品目錄' : currentView === 'furniture-group-check' ? '加入到 準備上載' : '上傳到 Shopify';

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
          {/* Product count pills — 總共產品 / 已選產品 (隱藏待處理產品頁，數字已在工具列顯示) */}
          {currentView !== 'listed-products' && (
            <div className="hidden items-center gap-2 md:flex">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground font-mono-data">
                總共產品
                <span className="text-foreground">{totalProducts.toLocaleString()}</span>
              </span>
              <span className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold font-mono-data',
                selectedCount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              )}>
                已選產品
                <span className={selectedCount > 0 ? 'text-primary' : 'text-foreground'}>{selectedCount.toLocaleString()}</span>
              </span>
            </div>
          )}

          {/* Save Button — hidden on ready-to-publish page */}
          {showUploadButton && onSave && currentView !== 'ready-to-publish' && (
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

          {/* Upload Button (所有產品 → 上傳到產品目錄) */}
          {showUploadButton && (
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
              {isPublishing ? '上傳中...' : uploadLabel}
              {selectedCount > 0 && !isPublishing && (
                <Badge className="ml-1 h-5 min-w-5 bg-white/20 text-[10px] text-white hover:bg-white/20">
                  {selectedCount}
                </Badge>
              )}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
