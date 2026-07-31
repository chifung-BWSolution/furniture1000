import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  ChevronRight,
  Save,
  Loader2,
  Check,
  ZoomIn,
  Moon,
  Sun,
} from 'lucide-react';
import { ViewType } from '@/types/product';
import { getViewMeta } from './navConfig';
import { Switch } from '@/components/ui/switch';
import { useDesignProjectStickyChrome } from '@/lib/designProjectStickyChrome';

interface TopBarProps {
  currentView: ViewType;
  selectedCount: number;
  totalProducts: number;
  onBulkPublish: () => void;
  onSave?: () => void;
  isSaving?: boolean;
  isPublishing?: boolean;
  publishProgress?: { succeeded: number; total: number } | null;
  hasUnsavedChanges?: boolean;
  stats: {
    drafts: number;
    publishing: number;
    success: number;
    errors: number;
  };
  hideBreadcrumbParent?: boolean;
  showDarkModeToggle?: boolean;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
}


export function TopBar({
  currentView,
  selectedCount,
  totalProducts,
  onBulkPublish,
  onSave,
  isSaving,
  isPublishing,
  publishProgress,
  hasUnsavedChanges,
  stats,
  hideBreadcrumbParent = false,
  showDarkModeToggle = false,
  isDarkMode = false,
  onToggleDarkMode,
}: TopBarProps) {
  const meta = getViewMeta(currentView);
  const showParent = !hideBreadcrumbParent && meta.sectionLabel && meta.sectionLabel !== meta.viewLabel;
  const viewInfo = { label: meta.viewLabel, parent: showParent ? meta.sectionLabel : '' };
  const designSticky = useDesignProjectStickyChrome();
  const stickyMode = designSticky?.mode || 'design';
  const showPartitionSticky =
    Boolean(designSticky?.active) &&
    ((currentView === 'design-projects' && stickyMode === 'design') ||
      (currentView === 'customer-quote-schemes' && stickyMode === 'quote'));

  // Show stats (總共/已選) on product list views
  const showProductButtons = currentView === 'listed-products' || currentView === 'ready-to-publish' || currentView === 'product-catalog';
  // The upload-to-catalog action only appears on the 所有產品 / 待發佈 views
  const showUploadButton = currentView === 'listed-products' || currentView === 'ready-to-publish';
  const uploadLabel = currentView === 'listed-products' ? '上傳到產品目錄' : '上傳到 Shopify';

  if (showPartitionSticky && designSticky) {
    const isQuoteSticky = stickyMode === 'quote';
    const activeZoneLabel = designSticky.activeZoneLabel || '';
    return (
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-xl md:px-6">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-bold tracking-tight md:text-lg">
                間隔清單與傢俬配置
              </h2>
              <span className="text-[13px] font-medium text-muted-foreground">
                間隔數量
              </span>
            </div>
            {designSticky.zoneGroups.length > 0 ? (
              <div className="flex max-h-[4.5rem] flex-wrap items-center gap-1.5 overflow-y-auto">
                {designSticky.zoneGroups.map((group) => {
                  const isActive = group.label === activeZoneLabel;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => designSticky.onJump(group.label)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[13px] transition-colors md:text-[14px]',
                        isActive
                          ? 'border-primary/50 bg-primary/15 text-primary shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
                      )}
                      title={`跳至「${group.label}」`}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <span
                        className={cn(
                          'font-semibold',
                          isActive ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {group.label}
                      </span>
                      <span className={isActive ? 'text-primary/80' : 'text-muted-foreground'}>
                        ：{group.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">尚無間隔</p>
            )}
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            {!isQuoteSticky ? (
              <button
                type="button"
                onClick={() => designSticky.onViewFloorPlan()}
                disabled={!designSticky.hasFloorPlan}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-[15px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                title={
                  designSticky.hasFloorPlan ? '檢視平面圖' : '尚未上傳平面圖'
                }
              >
                <ZoomIn className="h-4 w-4" />
                檢視平面圖
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => designSticky.onSave()}
              disabled={designSticky.saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {designSticky.saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isQuoteSticky ? '儲存' : '儲存方案'}
            </button>
          </div>
        </div>
        {designSticky.activeContextLine ? (
          <p className="mt-2 w-full text-center font-body text-[15px] font-medium text-foreground md:text-[16px]">
            {designSticky.activeContextLine}
          </p>
        ) : null}
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-page-tint/90 px-6 backdrop-blur-xl">
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
            <div className="flex flex-col items-end gap-1.5">
              {isPublishing && publishProgress && publishProgress.total > 0 && (
                <div className="w-44">
                  <div className="mb-1 flex items-center justify-between font-mono-data text-[10px] text-muted-foreground">
                    <span>上傳進度</span>
                    <span className="font-semibold text-primary">
                      {publishProgress.succeeded}/{publishProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${(publishProgress.succeeded / publishProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
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
            </div>
          )}
        </div>
      )}

      {showDarkModeToggle && onToggleDarkMode && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isDarkMode ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{isDarkMode ? '深色模式' : '淺色模式'}</span>
          <Switch checked={isDarkMode} onCheckedChange={onToggleDarkMode} className="scale-90" />
        </div>
      )}
    </header>
  );
}
