import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { useAppStore } from "@/hooks/use-app-store";
import { unsavedGuard } from "@/lib/unsavedGuard";
import { resetQuickQuoteSessionStorage, readQuickQuoteEditingId, writeQuickQuoteEditingId, writeQuickQuoteCopyFrom, quickQuoteStepKey, quickQuoteFormKey, quickQuoteEditingIdKey } from "@/lib/quickQuoteSession";
import { deleteDraft, makeDraftKey } from "@/lib/draftStore";
import { useAuth } from "@/contexts/AuthProvider";
import { SidebarNav } from "./SidebarNav";
import { PrimaryTopNav } from "./PrimaryTopNav";
import { TopBar } from "./TopBar";
import { DashboardView } from "./DashboardView";
import { ProductTableView } from "./ProductTableView";
import { SettingsView } from "./SettingsView";
import { PublishModal } from "./PublishModal";
import { FurnitureGroupCheckView } from "./publish/FurnitureGroupCheckView";
import { ReadyToPublishView } from "./publish/ReadyToPublishView";
import { Construction, WifiOff, RefreshCw } from "lucide-react";
import { findSection, getSection } from "./navConfig";
import { type PrimarySection, type ViewType } from "@/types/product";
import { addToCatalog } from "@/lib/catalogStore";
import { toast } from "sonner";
import { checkSupabaseHealth, waitForSupabaseRecovery } from "@/lib/supabase";
import { supabase as sb } from "@/lib/supabase";
import { syncRtsWorkflowToProduct } from "@/lib/rtsProductSync";
import { resolveSelectedPublishProducts } from "@/lib/readyToPublishRow";
import type { Product } from "@/types/product";
import { hasPmsQuotePrefillParams } from "@/lib/pmsQuotePrefill";

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
const UploadProductLogView = lazy(() =>
  import("./admin/UploadProductLogView").then((mod) => ({ default: mod.UploadProductLogView }))
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
  "dashboard",
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
  "furniture-group-check",
  "published-products",
  "report-factory",
  "report-product",
  "report-sales",
  "user-management",
  "login-history",
  "upload-product-log",
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
  const { user } = useAuth();
  const location = useLocation();
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalProducts, setPublishModalProducts] = useState<Product[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingQuoteId, setEditingQuoteIdRaw] = useState<string | null>(null);
  const [editingQuoteUuid, setEditingQuoteUuidRaw] = useState<string | null>(null);
  const [quickQuoteFreshKey, setQuickQuoteFreshKey] = useState(0);
  const deepLinkHandledRef = useRef<string | null>(null);

  const setEditingQuoteId = useCallback(
    (id: string | null) => {
      setEditingQuoteIdRaw(id);
      writeQuickQuoteEditingId(user?.email, id);
      if (!id) setEditingQuoteUuidRaw(null);
    },
    [user?.email],
  );

  const openQuoteForEdit = useCallback(
    (quoteId: string, opts?: { quoteUuid?: string }) => {
      if (!unsavedGuard.confirmLeave()) return;
      writeQuickQuoteCopyFrom(user?.email, null);
      setEditingQuoteId(quoteId);
      setEditingQuoteUuidRaw(opts?.quoteUuid ?? null);
      store.setCurrentView("quick-quote");
    },
    [user?.email, store, setEditingQuoteId],
  );

  const clearEditingQuote = useCallback(() => {
    setEditingQuoteId(null);
    setEditingQuoteUuidRaw(null);
    store.setCurrentView("quotation-list");
  }, [setEditingQuoteId, store]);

  /** After 版本審核, pin AppShell to the new version row so reload effects cannot stale-fetch. */
  const handleEditingQuotePersisted = useCallback(
    (quoteId: string, quoteUuid: string) => {
      setEditingQuoteId(quoteId);
      setEditingQuoteUuidRaw(quoteUuid);
    },
    [setEditingQuoteId],
  );

  // Deep links: /quote/quick?... (PMS new quote) and /quote/:quoteId (open existing)
  useEffect(() => {
    const path = location.pathname;
    const key = `${path}${location.search}`;
    if (deepLinkHandledRef.current === key) return;

    const quoteMatch = path.match(/^\/quote\/([^/]+)\/?$/);
    if (!quoteMatch) return;

    deepLinkHandledRef.current = key;
    const segment = decodeURIComponent(quoteMatch[1]);

    if (segment === "quick") {
      resetQuickQuoteSessionStorage(user?.email);
      void deleteDraft(makeDraftKey(user?.email, "NEW"));
      setEditingQuoteId(null);
      if (hasPmsQuotePrefillParams(new URLSearchParams(location.search))) {
        setQuickQuoteFreshKey((k) => k + 1);
      }
      store.setCurrentView("quick-quote");
      return;
    }

    // Stable open-existing URL: /quote/<pitching_code> e.g. /quote/BWF-FD26-001
    setEditingQuoteId(segment);
    store.setCurrentView("quick-quote");
  }, [location.pathname, location.search, store, user?.email, setEditingQuoteId]);

  useEffect(() => {
    if (store.currentView !== "quick-quote") return;
    // Prefer deep-link quote id over stale session editing id
    if (location.pathname.startsWith("/quote/")) return;
    const saved = readQuickQuoteEditingId(user?.email);
    if (saved) setEditingQuoteIdRaw(saved);
  }, [user?.email, store.currentView, location.pathname]);
  // 方案 D: Supabase health monitoring
  const [dbUnhealthy, setDbUnhealthy] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const cancelRecoveryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let alreadyUnhealthy = false; // avoid stacking recovery pollers
    const POLL_INTERVAL = 60_000; // check every 60s — avoid adding load while DB is stressed

    async function poll() {
      if (cancelled || alreadyUnhealthy) return;
      // Require TWO consecutive failed probes before declaring unhealthy.
      // A single slow/aborted request during a heavy bulk op (e.g. 全部退回)
      // must NOT flip the banner — the DB is fine, the query was just big.
      const first = await checkSupabaseHealth();
      if (cancelled || first) return;
      const second = await checkSupabaseHealth();
      if (cancelled || second) return;

      alreadyUnhealthy = true;
      setDbUnhealthy(true);
      cancelRecoveryRef.current = waitForSupabaseRecovery(() => {
        if (!cancelled) {
          alreadyUnhealthy = false;
          setDbUnhealthy(false);
          setIsRetrying(false);
          toast.success('資料庫連接已恢復', { description: '正在重新載入產品...' });
          store.reloadProducts();
        }
      });
    }

    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
      cancelRecoveryRef.current?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualRetry = useCallback(async () => {
    setIsRetrying(true);
    const healthy = await checkSupabaseHealth();
    if (healthy) {
      setDbUnhealthy(false);
      setIsRetrying(false);
      toast.success('連接恢復', { description: '正在重新載入產品...' });
      store.reloadProducts();
    } else {
      setIsRetrying(false);
      toast.error('仍然無法連接', { description: 'Supabase 尚未恢復，請稍後再試' });
    }
  }, [store]);
  // Product to scroll-into-view when navigating from 發佈前檢查
  const [focusProductId, setFocusProductId] = useState<string | null>(null);
  const [customerFocusProjectId, setCustomerFocusProjectId] = useState<string | null>(null);
  const rtpReloadRef = useRef<(() => void) | null>(null);
  const [rtpTotalCount, setRtpTotalCount] = useState(0);
  // Real total/selected counts reported up from ListedProductsView (所有產品)
  const [listedStats, setListedStats] = useState<{ total: number; selected: number; selectedIds: string[] }>({ total: 0, selected: 0, selectedIds: [] });
  const rtpPageProductsRef = useRef<Product[]>([]);

  const handleRtpReload = useCallback(() => {
    rtpReloadRef.current?.();
  }, []);

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
      const ids = Array.from(store.selectedProductIds);
      const inMemory = store.currentView === 'ready-to-publish'
        ? rtpPageProductsRef.current
        : [...store.products, ...store.readyToPublishList];
      const resolved = await resolveSelectedPublishProducts(ids, inMemory);
      if (resolved.length === 0) {
        toast.message('請先勾選產品');
        return;
      }
      setPublishModalProducts(resolved);
      setShowPublishModal(true);
    }
  }, [store.selectedProductIds, store.currentView, store.products, store.readyToPublishList, listedStats.selectedIds]);

  // "加入到 準備上載" for 傢俬組檢查 — identical to the Shopify publish flow
  // (selectedProducts drives PublishModal which calls store.publishSelected)

  const handleClearFilter = useCallback(() => {
    store.setFilterProductId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirmPublish = useCallback(async () => {
    await store.publishSelected();
    handleRtpReload();
  }, [store, handleRtpReload]);

  const handleClearEditingQuote = useCallback(() => {
    setEditingQuoteId(null);
    store.setCurrentView("quotation-list");
  }, [store]);

  const renderView = () => {
    switch (store.currentView) {
      case "dashboard":
        return (
          <DashboardView onNavigate={handleViewChange} />
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
      case "furniture-group-check":
        return (
          <FurnitureGroupCheckView
            onEnterReadyToPublish={() => {
              store.setCurrentView('ready-to-publish');
            }}
          />
        );
      case "ready-to-publish":
        return (
          <ReadyToPublishView
            onRegisterReload={(fn) => { rtpReloadRef.current = fn; }}
            onTotalCountChange={setRtpTotalCount}
            onProductsChange={(products) => { rtpPageProductsRef.current = products; }}
            selectedIds={store.selectedProductIds}
            filterProductId={store.filterProductId}
            onToggleSelect={store.toggleProductSelection}
            onSelectAll={store.selectAllProducts}
            onSelectRange={store.selectRangeProducts}
            onUpdateProduct={store.updateProduct}
            onUpdateRtsTags={async (rtsId, tags) => {
              await store.updateReadyToPublishTags(rtsId, tags);
              handleRtpReload();
            }}
            onRetryPublish={store.retryPublish}
            onDeleteProduct={store.deleteProduct}
            onClearFilter={handleClearFilter}
            onSyncFromShopify={store.syncFromShopify}
            onUploadUnsyncedToMaster={store.publishSelected}
            onRevertToInfo={async (ids, reasons) => {
              // ids = ready_to_shopify.id (RTS row IDs — that is what ProductTableView stores)
              const revertReason = (reasons.labels.length > 0 || reasons.other)
                ? { labels: reasons.labels, other: reasons.other || null }
                : null;

              // Step 1: resolve the real products.id values from the RTS rows
              const { data: rtsRows, error: fetchErr } = await sb
                .from('ready_to_shopify')
                .select('id, product_id')
                .in('id', ids);
              if (fetchErr || !rtsRows || rtsRows.length === 0) {
                toast.error('退回失敗', { description: fetchErr?.message ?? '找不到對應的 ready_to_shopify 記錄' });
                return;
              }
              const productIds = rtsRows.map((r: any) => r.product_id).filter(Boolean) as string[];
              if (productIds.length === 0) {
                toast.error('退回失敗', { description: '找不到對應的產品記錄' });
                return;
              }

              // Step 2: reset RTS workflow flags so products reappear in 產品文案
              const { error: updateErr } = await sb.from('ready_to_shopify').update({
                copy_done: false,
                info_done: false,
                revert_reason: revertReason,
                furniture_group_checked: null,
              }).in('id', ids);
              if (updateErr) {
                toast.error('退回失敗', { description: updateErr.message });
                return;
              }
              await Promise.all(productIds.map((id) => syncRtsWorkflowToProduct(sb, id, {
                ready_to_publish: false,
                info_done: false,
                copy_done: false,
                revert_reason: revertReason,
              })));

              handleRtpReload();
              toast.success(`已退回 ${ids.length} 件產品至「產品文案」`, {
                description: revertReason?.labels.length ? `原因：${revertReason.labels.join('、')}` : undefined,
              });
            }}
            onBatchDeleteProducts={async (ids) => {
              // ids are ready_to_shopify.id values — delete directly
              const { error } = await sb.from('ready_to_shopify').delete().in('id', ids);
              if (error) {
                toast.error('批量刪除失敗', { description: error.message });
                return;
              }
              handleRtpReload();
              toast.success(`已刪除 ${ids.length} 件產品`);
            }}
            onVariantsSaved={handleRtpReload}
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

      case "customer-design-projects":
        return (
          <CustomerDesignProjectsView initialProjectId={customerFocusProjectId} />
        );
      case "customer-product-search":
        return <CustomerProductSearchView />;
      case "customer-confirmed-products":
        return <CustomerConfirmedProductsView />;
      case "customer-company-info":
        return (
          <CustomerCompanyInfoView
            onOpenProject={(projectId) => {
              setCustomerFocusProjectId(projectId);
              store.setCurrentView('customer-design-projects');
            }}
          />
        );
      case "publish-copywriting":
        return <PublishCopywritingView focusProductId={focusProductId} onFocusHandled={() => setFocusProductId(null)} />;
      case "publish-product-info":
        return (
          <PublishProductInfoView
            focusProductId={focusProductId}
            onFocusHandled={() => setFocusProductId(null)}
            onComplete={() => store.setCurrentView('furniture-group-check')}
          />
        );
      case "publish-precheck":
        return (
          <PublishPrecheckView
            onNavigate={({ view, productId }) => {
              setFocusProductId(productId);
              store.setCurrentView(view);
            }}
            onProductsReadyToPublish={async () => {
              await store.reloadReadyToPublish();
              store.setCurrentView('ready-to-publish');
            }}
          />
        );
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
      case "upload-product-log":
        return <UploadProductLogView />;
      case "quick-quote":
        return (
          <QuickQuoteView
            key={`quick-quote-${quickQuoteFreshKey}`}
            editingQuoteId={editingQuoteId}
            editingQuoteUuid={editingQuoteUuid}
            freshSessionKey={quickQuoteFreshKey}
            onClearEditingQuote={clearEditingQuote}
            onEditingQuotePersisted={handleEditingQuotePersisted}
          />
        );
      case "quotation-list":
        return (
          <QuotationListView
            onOpenQuote={openQuoteForEdit}
            onCopyQuote={(quoteUuid) => {
              if (!unsavedGuard.confirmLeave()) return;
              writeQuickQuoteCopyFrom(user?.email, quoteUuid);
              if (typeof window !== "undefined") {
                sessionStorage.removeItem(quickQuoteStepKey(user?.email));
                sessionStorage.removeItem(quickQuoteFormKey(user?.email));
                sessionStorage.removeItem(quickQuoteEditingIdKey(user?.email));
              }
              void deleteDraft(makeDraftKey(user?.email, "NEW"));
              setEditingQuoteId(null);
              setQuickQuoteFreshKey((k) => k + 1);
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
    if (view === "quick-quote") {
      if (unsavedGuard.isDirty && !unsavedGuard.confirmLeave()) return;
      writeQuickQuoteCopyFrom(user?.email, null);
      resetQuickQuoteSessionStorage(user?.email);
      void deleteDraft(makeDraftKey(user?.email, "NEW"));
      setEditingQuoteId(null);
      setEditingQuoteUuidRaw(null);
      setQuickQuoteFreshKey((k) => k + 1);
      store.setCurrentView("quick-quote");
      store.setFilterProductId(null);
      return;
    }

    if (view !== store.currentView && unsavedGuard.isDirty && !unsavedGuard.confirmLeave()) {
      return;
    }
    if (store.currentView === 'category-management' && view !== 'category-management') {
      store.reloadProducts();
    }
    store.setCurrentView(view);
    store.setFilterProductId(null);
    setEditingQuoteId(null);
    if (view !== 'customer-design-projects') {
      setCustomerFocusProjectId(null);
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
        {activeSection !== 'home' && (
          <SidebarNav
            activeSection={activeSection}
            currentView={store.currentView}
            onViewChange={handleViewChange}
            isDarkMode={store.isDarkMode}
            onToggleDarkMode={store.toggleDarkMode}
            isCollapsed={sidebarCollapsed}
            onCollapseChange={setSidebarCollapsed}
          />
        )}

        <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* 方案 D: Unhealthy DB banner */}
        {dbUnhealthy && (
          <div className="flex items-center gap-2 bg-destructive/10 border-b border-destructive/20 px-4 py-2 text-sm text-destructive">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="flex-1">資料庫連接異常 — Supabase 暫時無法讀取，正在等待恢復...</span>
            <button
              onClick={handleManualRetry}
              disabled={isRetrying}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-destructive/20 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${isRetrying ? 'animate-spin' : ''}`} />
              {isRetrying ? '檢查中...' : '立即重試'}
            </button>
          </div>
        )}
        <TopBar
          currentView={store.currentView}
          selectedCount={store.currentView === 'listed-products' ? listedStats.selected : store.selectedProductIds.size}
          totalProducts={store.currentView === 'listed-products' ? listedStats.total : store.currentView === 'ready-to-publish' ? rtpTotalCount : store.products.length}
          onBulkPublish={handleBulkPublish}
          onSave={store.saveProducts}
          isSaving={store.isSaving}
          isPublishing={store.isPublishing}
          publishProgress={store.publishProgress}
          hasUnsavedChanges={store.hasUnsavedChanges}
          stats={store.stats}
          hideBreadcrumbParent={activeSection === 'home'}
          showDarkModeToggle={activeSection === 'home'}
          isDarkMode={store.isDarkMode}
          onToggleDarkMode={store.toggleDarkMode}
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
        onClose={() => {
          setShowPublishModal(false);
          setPublishModalProducts([]);
        }}
        onConfirm={handleConfirmPublish}
        products={publishModalProducts}
      />
    </div>
  );
}
