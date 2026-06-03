import { useState, useCallback, useMemo, lazy, Suspense } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { SidebarNav } from "./SidebarNav";
import { PrimaryTopNav } from "./PrimaryTopNav";
import { TopBar } from "./TopBar";
import { DashboardView } from "./DashboardView";
import { ProductTableView } from "./ProductTableView";
import { SettingsView } from "./SettingsView";
import { PublishModal } from "./PublishModal";
import { Construction } from "lucide-react";
import { findSection, getSection } from "./navConfig";
import { type PrimarySection, type ViewType } from "@/types/product";

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
// 傢俬方案 (Furniture Scheme)
const DesignProjectsView = lazy(() =>
  import("./solutions/DesignProjectsView").then((mod) => ({ default: mod.DesignProjectsView }))
);
const ProductSearchView = lazy(() =>
  import("./solutions/ProductSearchView").then((mod) => ({ default: mod.ProductSearchView }))
);
const InviteClientsView = lazy(() =>
  import("./solutions/InviteClientsView").then((mod) => ({ default: mod.InviteClientsView }))
);
const ConfirmedProjectsView = lazy(() =>
  import("./solutions/ConfirmedProjectsView").then((mod) => ({ default: mod.ConfirmedProjectsView }))
);
// 客戶專區 (Client Zone)
const CustomerDesignProjectsView = lazy(() =>
  import("./customers/CustomerDesignProjectsView").then((mod) => ({ default: mod.CustomerDesignProjectsView }))
);
const CustomerProductSearchView = lazy(() =>
  import("./customers/CustomerProductSearchView").then((mod) => ({ default: mod.CustomerProductSearchView }))
);
const CustomerConfirmedProductsView = lazy(() =>
  import("./customers/CustomerConfirmedProductsView").then((mod) => ({ default: mod.CustomerConfirmedProductsView }))
);
const CustomerCompanyInfoView = lazy(() =>
  import("./customers/CustomerCompanyInfoView").then((mod) => ({ default: mod.CustomerCompanyInfoView }))
);

// Views that fetch their own data independently of the app store's product
// load — they must not be gated by store.isLoading, so they render immediately.
const SELF_LOADING_VIEWS = new Set<ViewType>([
  "listed-products",
  "manufacturer-catalog",
  "category-management",
  "quotation-list",
  "design-projects",
  "product-search",
  "invite-clients",
  "confirmed-projects",
  "customer-design-projects",
  "customer-product-search",
  "customer-confirmed-products",
  "customer-company-info",
]);

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
        return <DesignProjectsView />;
      case "product-search":
        return <ProductSearchView />;
      case "invite-clients":
        return <InviteClientsView />;
      case "confirmed-projects":
        return <ConfirmedProjectsView />;
      case "factory-catalog-quote":
        return (
          <PlaceholderView
            title="廠家目錄"
            description="瀏覽廠家產品目錄，取得最新報價資訊。"
          />
        );
      case "advanced-search":
        return (
          <PlaceholderView
            title="進階搜尋"
            description="跨產品、廠家、分類的深度搜尋功能。"
          />
        );
      case "customer-design-projects":
        return <CustomerDesignProjectsView />;
      case "customer-product-search":
        return <CustomerProductSearchView />;
      case "customer-confirmed-products":
        return <CustomerConfirmedProductsView />;
      case "customer-company-info":
        return <CustomerCompanyInfoView />;
      case "quotation-settings":
        return (
          <PlaceholderView
            title="報價設定"
            description="預設條款、稅率、付款方式與簽署設定。"
          />
        );
      case "publish-copywriting":
        return (
          <PlaceholderView
            title="產品文案"
            description="AI 撰寫產品標題、描述與賣點文案。"
          />
        );
      case "publish-precheck":
        return (
          <PlaceholderView
            title="發佈前檢查"
            description="檢查圖片、SEO、價格、庫存等上架前必填欄位。"
          />
        );
      case "published-products":
        return (
          <PlaceholderView
            title="已上載產品"
            description="所有已成功上架到 Shopify 的產品。"
          />
        );
      case "report-factory":
        return (
          <PlaceholderView
            title="廠家報告"
            description="按廠家匯總的產品數、銷售與交期分析。"
          />
        );
      case "report-product":
        return (
          <PlaceholderView
            title="產品報告"
            description="產品銷售、庫存與表現分析報告。"
          />
        );
      case "report-sales":
        return (
          <PlaceholderView
            title="銷售報告"
            description="期間銷售趨勢、客戶分佈與成交報告。"
          />
        );
      case "user-management":
        return (
          <PlaceholderView
            title="用戶管理"
            description="管理團隊成員的角色與存取權限。"
          />
        );
      case "login-history":
        return (
          <PlaceholderView
            title="登入紀錄"
            description="檢視用戶登入歷史與安全事件。"
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

  const activeSection: PrimarySection = findSection(store.currentView);

  const handleViewChange = (view: typeof store.currentView) => {
    if (store.currentView === 'category-management' && view !== 'category-management') {
      store.reloadProducts();
    }
    store.setCurrentView(view);
    store.setFilterProductId(null);
    if (view !== "quick-quote") {
      setEditingQuoteId(null);
    }
  };

  const handleSectionChange = (section: PrimarySection) => {
    if (section === activeSection) return;
    const target = getSection(section).children[0]?.view;
    if (target) handleViewChange(target);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <PrimaryTopNav
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        isConnected={store.settings.isConnected}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SidebarNav
          activeSection={activeSection}
          currentView={store.currentView}
          onViewChange={handleViewChange}
          isDarkMode={store.isDarkMode}
          onToggleDarkMode={store.toggleDarkMode}
          isCollapsed={sidebarCollapsed}
          onCollapseChange={setSidebarCollapsed}
        />

        <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
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
          {store.isLoading && !SELF_LOADING_VIEWS.has(store.currentView) ? (
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
      </div>

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
