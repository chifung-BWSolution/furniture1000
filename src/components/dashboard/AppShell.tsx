import { useState, useCallback, useMemo, lazy, Suspense } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { SidebarNav } from "./SidebarNav";
import { TopBar } from "./TopBar";
import { DashboardView } from "./DashboardView";
import { ProductTableView } from "./ProductTableView";
import { SettingsView } from "./SettingsView";
import { PublishModal } from "./PublishModal";
import { Construction } from "lucide-react";

// Lazy-loaded heavy views (contain large dependencies like pdfjs-dist, @react-pdf/renderer, etc.)
const AIProcessorView = lazy(() =>
  import("./AIProcessorView").then((mod) => ({ default: mod.AIProcessorView }))
);
const ListedProductsView = lazy(() =>
  import("./ListedProductsView").then((mod) => ({ default: mod.ListedProductsView }))
);
const ManufacturerDirectoryView = lazy(() =>
  import("./ManufacturerDirectoryView").then((mod) => ({ default: mod.ManufacturerDirectoryView }))
);
const QuickQuoteView = lazy(() =>
  import("./QuickQuoteView").then((mod) => ({ default: mod.QuickQuoteView }))
);
const QuotationListView = lazy(() =>
  import("./QuotationListView").then((mod) => ({ default: mod.QuotationListView }))
);
const CategoryManagementView = lazy(() =>
  import("./CategoryManagementView").then((mod) => ({ default: mod.CategoryManagementView }))
);

function PlaceholderView({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Construction className="h-8 w-8 text-primary" />
        </div>
        <h2 className="font-display text-xl font-bold tracking-tight">
          {title}
        </h2>
        <p className="font-body text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
        <span className="font-mono-data text-[11px] tracking-wider text-muted-foreground/60 uppercase">
          即將推出 · Coming Soon
        </span>
      </div>
    </div>
  );
}

export function AppShell() {
  const store = useAppStore();
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const selectedProducts = useMemo(() =>
    store.products.filter((p) => store.selectedProductIds.has(p.id)),
    [store.products, store.selectedProductIds]
  );

  const handleBulkPublish = useCallback(() => {
    if (store.selectedProductIds.size > 0) {
      setShowPublishModal(true);
    }
  }, [store.selectedProductIds]);

  const handleClearFilter = useCallback(() => {
    store.setFilterProductId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirmPublish = useCallback(() => {
    store.publishSelected();
  }, [store]);

  const handleClearEditingQuote = useCallback(() => {
    setEditingQuoteId(null);
    store.setCurrentView("quotation-list");
  }, [store]);

  const renderView = () => {
    switch (store.currentView) {
      case "dashboard":
        return (
          <DashboardView
            products={store.products}
            stats={store.stats}
            onProductClick={store.navigateToProduct}
            onNavigateToAI={() => store.setCurrentView("ai-processor")}
          />
        );
      case "ai-processor":
        return (
          <AIProcessorView
            onAddProduct={store.addProduct}
            onNavigateToPublish={() => store.setCurrentView("ready-to-publish")}
            selectedModel={store.settings.aiModel}
            geminiProxyUrl={store.settings.geminiProxyUrl}
          />
        );
      case "ready-to-publish":
        return (
          <ProductTableView
            products={store.products}
            selectedIds={store.selectedProductIds}
            filterProductId={store.filterProductId}
            onToggleSelect={store.toggleProductSelection}
            onSelectAll={store.selectAllProducts}
            onSelectRange={store.selectRangeProducts}
            onUpdateProduct={store.updateProduct}
            onRetryPublish={store.retryPublish}
            onDeleteProduct={store.deleteProduct}
            onClearFilter={handleClearFilter}
            onSyncFromShopify={store.syncFromShopify}
            onUploadUnsyncedToMaster={store.uploadUnsyncedToMaster}
            isSyncing={store.isSyncing}
            isPublishing={store.isPublishing}
            lastSyncTime={store.lastSyncTime}
          />
        );
      case "listed-products":
        return (
          <ListedProductsView
            onSyncFromShopify={store.syncFromShopify}
            isSyncing={store.isSyncing}
            lastSyncTime={store.lastSyncTime}
            onSendToPublishQueue={(products) => {
              store.addProducts(products);
              store.setCurrentView("ready-to-publish");
            }}
          />
        );
      case "settings":
        return (
          <SettingsView
            settings={store.settings}
            onUpdateSettings={store.updateSettings}
          />
        );
      case "manufacturer-catalog":
        return <ManufacturerDirectoryView />;
      case "design-projects":
        return (
          <PlaceholderView
            title="設計專案"
            description="管理您的室內設計項目，追蹤進度並協調團隊合作。"
          />
        );
      case "product-search":
        return (
          <PlaceholderView
            title="產品搜尋"
            description="搜尋產品數據庫，快速找到符合設計需求的傢俬產品。"
          />
        );
      case "invite-clients":
        return (
          <PlaceholderView
            title="邀請客戶"
            description="向客戶發送邀請，讓他們查看和確認設計方案。"
          />
        );
      case "confirmed-projects":
        return (
          <PlaceholderView
            title="已確定方案"
            description="查看所有已被客戶確認的設計方案和訂單狀態。"
          />
        );
      case "factory-catalog-quote":
        return (
          <PlaceholderView
            title="廠家目錄"
            description="瀏覽廠家產品目錄，取得最新報價資訊。"
          />
        );
      case "quick-quote":
        return (
          <QuickQuoteView
            editingQuoteId={editingQuoteId}
            onClearEditingQuote={() => {
              setEditingQuoteId(null);
              store.setCurrentView("quotation-list");
            }}
          />
        );
      case "product-report":
        return (
          <PlaceholderView
            title="產品報告"
            description="查看產品銷售數據和績效分析報告。"
          />
        );
      case "quotation-list":
        return (
          <QuotationListView
            onOpenQuote={(quoteId) => {
              // Set the quote ID to edit and navigate to the editor
              setEditingQuoteId(quoteId);
              store.setCurrentView("quick-quote");
            }}
          />
        );
      case "category-management":
        return <CategoryManagementView />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <SidebarNav
        currentView={store.currentView}
        onViewChange={(view) => {
          // Reload products from DB when leaving category management
          // to ensure category assignments are reflected
          if (store.currentView === 'category-management' && view !== 'category-management') {
            store.reloadProducts();
          }
          store.setCurrentView(view);
          store.setFilterProductId(null);
          // Clear editing quote when navigating away
          if (view !== "quick-quote") {
            setEditingQuoteId(null);
          }
        }}
        isDarkMode={store.isDarkMode}
        onToggleDarkMode={store.toggleDarkMode}
        isConnected={store.settings.isConnected}
        isCollapsed={sidebarCollapsed}
        onCollapseChange={setSidebarCollapsed}
      />

      {/* Main Content */}
      <main
        className="flex flex-1 flex-col overflow-hidden transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? 8 : 20 }}
      >
        <TopBar
          currentView={store.currentView}
          selectedCount={store.selectedProductIds.size}
          totalProducts={store.products.length}
          onBulkPublish={handleBulkPublish}
          onSave={store.saveProducts}
          isSaving={store.isSaving}
          isPublishing={store.isPublishing}
          hasUnsavedChanges={store.hasUnsavedChanges}
          stats={store.stats}
        />

        <div className="flex-1 overflow-hidden">
          {store.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="font-mono-data text-xs text-muted-foreground">
                  Loading products...
                </span>
              </div>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="font-mono-data text-xs text-muted-foreground">
                      Loading view...
                    </span>
                  </div>
                </div>
              }
            >
              {renderView()}
            </Suspense>
          )}
        </div>
      </main>

      {/* Publish Confirmation Modal */}
      <PublishModal
        open={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        onConfirm={handleConfirmPublish}
        products={selectedProducts}
      />
    </div>
  );
}
