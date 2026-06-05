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
import { addToCatalog } from "@/lib/catalogStore";
import { toast } from "sonner";

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
const FactoryDetailView = lazy(() =>
  import("./FactoryDetailPage").then((mod) => ({ default: mod.FactoryDetailView }))
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
const ProductCategoryView = lazy(() =>
  import("./ProductCategoryView").then((mod) => ({ default: mod.ProductCategoryView }))
);
// 網上發佈 (Online Publication)
const PublishCopywritingView = lazy(() =>
  import("./publish/PublishCopywritingView").then((mod) => ({ default: mod.PublishCopywritingView }))
);
const PublishProductInfoView = lazy(() =>
  import("./publish/PublishProductInfoView").then((mod) => ({ default: mod.PublishProductInfoView }))
);
const PublishPrecheckView = lazy(() =>
  import("./publish/PublishPrecheckView").then((mod) => ({ default: mod.PublishPrecheckView }))
);
const PublishedProductsView = lazy(() =>
  import("./publish/PublishedProductsView").then((mod) => ({ default: mod.PublishedProductsView }))
);
// 分析報表 (Analytics Reports)
const FactoryReportView = lazy(() =>
  import("./reports/FactoryReportView").then((mod) => ({ default: mod.FactoryReportView }))
);
const ProductReportView = lazy(() =>
  import("./reports/ProductReportView").then((mod) => ({ default: mod.ProductReportView }))
);
const SalesReportView = lazy(() =>
  import("./reports/SalesReportView").then((mod) => ({ default: mod.SalesReportView }))
);
// 設定 (Settings)
const UserManagementView = lazy(() =>
  import("./admin/UserManagementView").then((mod) => ({ default: mod.UserManagementView }))
);
const LoginHistoryView = lazy(() =>
  import("./admin/LoginHistoryView").then((mod) => ({ default: mod.LoginHistoryView }))
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
  "product-catalog",
  "manufacturer-catalog",
  "factory-detail",
  "category-management",
  "category-registry",
  "quotation-list",
  "design-projects",
  "product-search",
  "invite-clients",
  "confirmed-projects",
  "customer-design-projects",
  "customer-product-search",
  "customer-confirmed-products",
  "customer-company-info",
  "publish-copywriting",
  "publish-product-info",
  "publish-precheck",
  "published-products",
  "report-factory",
  "report-product",
  "report-sales",
  "user-management",
  "login-history",
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
  // Real total/selected counts reported up from ListedProductsView (所有產品)
  const [listedStats, setListedStats] = useState<{ total: number; selected: number; selectedIds: string[] }>({ total: 0, selected: 0, selectedIds: [] });
  const selectedProducts = useMemo(() =>
    store.products.filter((p) => store.selectedProductIds.has(p.id)),
    [store.products, store.selectedProductIds]
  );
  // 準備上載頁：只顯示發佈前檢查通過後標記 readyToPublish 的產品
  const readyToPublishProducts = useMemo(() =>
    store.products.filter((p) => p.readyToPublish),
    [store.products]
  );

  const handleBulkPublish = useCallback(async () => {
    // 所有產品頁：「上傳到產品目錄」— 把已選產品標記 in_catalog（寫入 Supabase，跨裝置共用）
    if (store.currentView === 'listed-products') {
      if (listedStats.selectedIds.length === 0) {
        toast.message('請先勾選產品');
        return;
      }
      const res = await addToCatalog(listedStats.selectedIds);
      if (res.ok) {
        toast.success('已加入產品目錄', { description: `${listedStats.selectedIds.length} 件已寫入，所有裝置可見` });
      } else {
        toast.error('加入失敗', { description: res.error });
      }
      return;
    }
    if (store.selectedProductIds.size > 0) {
      setShowPublishModal(true);
    }
  }, [store.selectedProductIds, store.currentView, listedStats.selectedIds]);

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
            onNavigateToAI={() => store.setCurrentView("ai-processor")}
            onNavigateToCopywriting={() => store.setCurrentView("publish-copywriting")}
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
            products={readyToPublishProducts}
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
            mode="all"
            onSyncFromShopify={store.syncFromShopify}
            isSyncing={store.isSyncing}
            lastSyncTime={store.lastSyncTime}
            onStatsChange={setListedStats}
            onSendToPublishQueue={(products) => {
              store.addProducts(products);
              store.setCurrentView("ready-to-publish");
            }}
          />
        );
      case "product-catalog":
        return (
          <ListedProductsView
            mode="catalog"
            onStatsChange={setListedStats}
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
      case "factory-detail":
        return store.factoryDetailCode ? (
          <FactoryDetailView
            factoryCode={store.factoryDetailCode}
            onBack={() => store.setCurrentView("manufacturer-catalog")}
          />
        ) : null;
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
        return <PublishCopywritingView />;
      case "publish-product-info":
        return <PublishProductInfoView />;
      case "publish-precheck":
        return <PublishPrecheckView />;
      case "published-products":
        return <PublishedProductsView />;
      case "report-factory":
        return <FactoryReportView />;
      case "report-product":
        return <ProductReportView />;
      case "report-sales":
        return <SalesReportView />;
      case "user-management":
        return <UserManagementView />;
      case "login-history":
        return <LoginHistoryView />;
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
      case "category-registry":
        return <ProductCategoryView />;
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
          selectedCount={store.currentView === 'listed-products' ? listedStats.selected : store.selectedProductIds.size}
          totalProducts={store.currentView === 'listed-products' ? listedStats.total : store.currentView === 'ready-to-publish' ? readyToPublishProducts.length : store.products.length}
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
