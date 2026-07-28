import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "@/hooks/use-app-store";
import { unsavedGuard } from "@/lib/unsavedGuard";
import {
  resetQuickQuoteSessionStorage,
  readQuickQuoteEditingId,
  readQuickQuoteStep,
  writeQuickQuoteEditingId,
  writeQuickQuoteCopyFrom,
  quickQuoteStepKey,
  quickQuoteFormKey,
  quickQuoteEditingIdKey,
  readResumeQuote,
  clearResumeQuote,
  clearUseLocalQuoteDraft,
} from "@/lib/quickQuoteSession";

/** Survive React StrictMode double-mount so deploy-reload resume is only applied once. */
let resumeQuoteAppliedThisPageLoad = false;
import { deleteDraft, makeDraftKey } from "@/lib/draftStore";
import { useAuth } from "@/contexts/AuthProvider";
import { usePlatformRole } from "@/hooks/use-platform-role";
import {
  buildQuoteEditorPath,
  parseQuotePathname,
  QUOTE_LIST_PATH,
  QUOTE_QUICK_PATH,
} from "@/lib/quoteRoutes";
import {
  DESIGN_PROJECTS_PATH,
  canonicalDesignProjectPath,
  isDesignProjectPath,
  parseDesignProjectPathname,
} from "@/lib/designProjectRoutes";
import {
  CUSTOMER_PORTAL_BASE,
  clearPortalToken,
  customerViewFromPath,
  isCustomerPortalPath,
  isCustomerPortalView,
  pathFromCustomerView,
  readStoredPortalToken,
  storePortalToken,
} from "@/lib/customerPortalRoutes";
import {
  appViewFromPath,
  isAppSectionPath,
  pathFromAppView,
} from "@/lib/appSectionRoutes";
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
import { findSection, isAdminOnlyView, getFirstVisibleView } from "./navConfig";
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
const SolutionProjectListView = lazy(() =>
  import("./solutions/SolutionProjectListView").then((mod) => ({ default: mod.SolutionProjectListView }))
);
const DesignProjectsView = lazy(() =>
  import("./solutions/DesignProjectsView").then((mod) => ({ default: mod.DesignProjectsView }))
);
const InviteClientsView = lazy(() =>
  import("./solutions/InviteClientsView").then((mod) => ({ default: mod.InviteClientsView }))
);
const ConfirmedProjectsView = lazy(() =>
  import("./solutions/ConfirmedProjectsView").then((mod) => ({ default: mod.ConfirmedProjectsView }))
);
// 客戶專區 (Client Portal)
const CustomerQuoteSchemesView = lazy(() =>
  import("./customers/CustomerQuoteSchemesView").then((mod) => ({
    default: mod.CustomerQuoteSchemesView,
  }))
);
const CustomerProductSearchView = lazy(() =>
  import("./customers/CustomerProductSearchView").then((mod) => ({ default: mod.CustomerProductSearchView }))
);
const CustomerCompanyInfoView = lazy(() =>
  import("./customers/CustomerCompanyInfoView").then((mod) => ({ default: mod.CustomerCompanyInfoView }))
);
const CustomerCustomFurnitureView = lazy(() =>
  import("./customers/CustomerPortalExtraViews").then((mod) => ({
    default: mod.CustomerCustomFurnitureView,
  }))
);
const CustomerPaymentDeliveryView = lazy(() =>
  import("./customers/CustomerPaymentDeliveryView").then((mod) => ({
    default: mod.CustomerPaymentDeliveryView,
  }))
);
const CustomerOrderStatusView = lazy(() =>
  import("./customers/CustomerPortalExtraViews").then((mod) => ({
    default: mod.CustomerOrderStatusView,
  }))
);
const CustomerCaseStudiesView = lazy(() =>
  import("./customers/CustomerPortalExtraViews").then((mod) => ({
    default: mod.CustomerCaseStudiesView,
  }))
);
const CustomerServicesView = lazy(() =>
  import("./customers/CustomerPortalExtraViews").then((mod) => ({
    default: mod.CustomerServicesView,
  }))
);
const CustomerContactView = lazy(() =>
  import("./customers/CustomerPortalExtraViews").then((mod) => ({
    default: mod.CustomerContactView,
  }))
);
const CustomerOrgAccountView = lazy(() =>
  import("./customers/CustomerPortalExtraViews").then((mod) => ({
    default: mod.CustomerOrgAccountView,
  }))
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
  // Quote routes must render on refresh even while the product catalog is still loading.
  // Otherwise /quote/:id waits on store.isLoading and can look like a blank/black screen.
  "quick-quote",
  "quotation-list",
  "solution-project-list",
  "design-projects",
  "invite-clients",
  "confirmed-projects",
  "customer-quote-schemes",
  "customer-product-search",
  "customer-custom-furniture",
  "customer-payment-delivery",
  "customer-order-status",
  "customer-case-studies",
  "customer-services",
  "customer-company-info",
  "customer-contact",
  "customer-org-account",
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
  const { role: platformRole, loading: roleLoading } = usePlatformRole();
  const location = useLocation();
  const navigate = useNavigate();
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalProducts, setPublishModalProducts] = useState<Product[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingQuoteId, setEditingQuoteIdRaw] = useState<string | null>(() => {
    const parsed = parseQuotePathname(location.pathname);
    return parsed.kind === 'quote' ? parsed.quoteId : null;
  });
  const [editingQuoteUuid, setEditingQuoteUuidRaw] = useState<string | null>(null);
  const [editingQuoteVersion, setEditingQuoteVersionRaw] = useState<string | null>(() => {
    const parsed = parseQuotePathname(location.pathname);
    return parsed.kind === 'quote' ? parsed.version ?? null : null;
  });
  const [quickQuoteFreshKey, setQuickQuoteFreshKey] = useState(0);
  const deepLinkHandledRef = useRef<string | null>(null);
  const quoteUrlSyncRef = useRef<string | null>(
    (() => {
      const path = location.pathname.replace(/\/+$/, '') || '/';
      return path.startsWith('/quote') ? path : null;
    })(),
  );
  const portalToken = new URLSearchParams(location.search).get('portal_token');
  const storedPortalToken = readStoredPortalToken();
  const portalTokenActive = Boolean(portalToken || storedPortalToken);
  // Real clients stay inside 客戶專區. Invite tokens also lock unknown roles while
  // loading; staff/admin keep full top-nav so they can leave a preview session.
  const clientOnly =
    platformRole === 'client' ||
    (portalTokenActive &&
      (roleLoading || (platformRole !== 'staff' && platformRole !== 'admin')));
  const isAdmin = platformRole === 'admin';

  useEffect(() => {
    if (portalToken) {
      storePortalToken(portalToken);
    }
  }, [portalToken]);

  // Legacy invite links landed on `/?portal_token=…` — send them to /customer.
  useEffect(() => {
    if (!portalToken) return;
    if (isCustomerPortalPath(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    const target = `${CUSTOMER_PORTAL_BASE}?${params.toString()}`;
    quoteUrlSyncRef.current = target;
    navigate(target, { replace: true });
  }, [portalToken, location.pathname, location.search, navigate]);

  // /customer and /customer/:slug → switch the active client-portal view.
  useEffect(() => {
    if (!isCustomerPortalPath(location.pathname)) return;
    const view = customerViewFromPath(location.pathname);
    if (!view) return;
    if (store.currentView !== view) {
      store.setCurrentView(view);
    }
  }, [location.pathname, store]);

  useEffect(() => {
    if (clientOnly && findSection(store.currentView) !== 'customers') {
      store.setCurrentView('customer-quote-schemes');
      if (!isCustomerPortalPath(location.pathname)) {
        const token = portalToken || storedPortalToken;
        const target = token
          ? `${CUSTOMER_PORTAL_BASE}?portal_token=${encodeURIComponent(token)}`
          : CUSTOMER_PORTAL_BASE;
        quoteUrlSyncRef.current = target;
        navigate(target, { replace: true });
      }
    }
    if (
      store.currentView === 'customer-design-projects' ||
      store.currentView === 'customer-confirmed-products'
    ) {
      store.setCurrentView('customer-quote-schemes');
    }
    if (!roleLoading && !clientOnly && !isAdmin && isAdminOnlyView(store.currentView)) {
      store.setCurrentView('category-management');
    }
  }, [
    clientOnly,
    portalToken,
    storedPortalToken,
    roleLoading,
    isAdmin,
    store.currentView,
    store,
    location.pathname,
    navigate,
  ]);

  const setEditingQuoteId = useCallback(
    (id: string | null) => {
      setEditingQuoteIdRaw(id);
      writeQuickQuoteEditingId(user?.email, id);
      if (!id) {
        setEditingQuoteUuidRaw(null);
        setEditingQuoteVersionRaw(null);
      }
    },
    [user?.email],
  );

  const goToQuoteList = useCallback(() => {
    quoteUrlSyncRef.current = QUOTE_LIST_PATH;
    navigate(QUOTE_LIST_PATH, { replace: true });
    setEditingQuoteId(null);
    store.setCurrentView("quotation-list");
  }, [navigate, setEditingQuoteId, store]);

  const openQuoteForEdit = useCallback(
    (quoteId: string, opts?: { quoteUuid?: string; version?: string }) => {
      if (!unsavedGuard.confirmLeave()) return;
      writeQuickQuoteCopyFrom(user?.email, null);
      // Opening from 報價一覽: always prefer Supabase 版本審核 snapshot, not IndexedDB.
      clearUseLocalQuoteDraft(user?.email);
      clearResumeQuote(user?.email);
      void deleteDraft(makeDraftKey(user?.email, quoteId));
      setEditingQuoteId(quoteId);
      setEditingQuoteUuidRaw(opts?.quoteUuid ?? null);
      setEditingQuoteVersionRaw(opts?.version ?? null);
      const target = buildQuoteEditorPath(quoteId, opts?.version ?? null);
      quoteUrlSyncRef.current = target;
      navigate(target, { replace: true });
      store.setCurrentView("quick-quote");
    },
    [navigate, user?.email, store, setEditingQuoteId],
  );

  /** After 版本審核, pin AppShell to the new version row so reload effects cannot stale-fetch. */
  const handleEditingQuotePersisted = useCallback(
    (quoteId: string, quoteUuid: string, version?: string) => {
      setEditingQuoteId(quoteId);
      setEditingQuoteUuidRaw(quoteUuid);
      if (version) setEditingQuoteVersionRaw(version);
      const target = buildQuoteEditorPath(quoteId, version ?? null);
      quoteUrlSyncRef.current = target;
      navigate(target, { replace: true });
    },
    [navigate, setEditingQuoteId],
  );

  const assignEditingQuoteId = useCallback(
    (quoteId: string) => {
      setEditingQuoteId(quoteId);
      const target = buildQuoteEditorPath(quoteId);
      quoteUrlSyncRef.current = target;
      navigate(target, { replace: true });
    },
    [navigate, setEditingQuoteId],
  );

  // Deep links: /quote, /quote/quick, /quote/:quoteId(Vn)
  useEffect(() => {
    const parsed = parseQuotePathname(location.pathname);
    if (parsed.kind === 'list' && location.pathname.replace(/\/+$/, '') !== QUOTE_LIST_PATH) {
      return;
    }
    if (parsed.kind !== 'list' && !location.pathname.startsWith('/quote/')) {
      return;
    }

    const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
    const key = `${normalizedPath}${location.search}`;
    if (deepLinkHandledRef.current === key) return;

    const syncPath = quoteUrlSyncRef.current?.replace(/\/+$/, '') || '';
    // In-app navigation (list → editor / 複製報價單 → /quote/quick) already set
    // session state — do not wipe uuid or copyFromUuid here.
    if (
      syncPath === normalizedPath &&
      (parsed.kind === 'quote' || parsed.kind === 'quick')
    ) {
      deepLinkHandledRef.current = key;
      store.setCurrentView('quick-quote');
      return;
    }

    deepLinkHandledRef.current = key;
    quoteUrlSyncRef.current = normalizedPath;

    if (parsed.kind === 'list') {
      setEditingQuoteId(null);
      store.setCurrentView('quotation-list');
      return;
    }

    if (parsed.kind === 'quick') {
      const savedEditingId = readQuickQuoteEditingId(user?.email);
      const savedStep = readQuickQuoteStep(user?.email);
      const hasPrefill = hasPmsQuotePrefillParams(new URLSearchParams(location.search));

      if (savedEditingId && savedStep === 4) {
        setEditingQuoteId(savedEditingId);
        store.setCurrentView('quick-quote');
        const target = buildQuoteEditorPath(savedEditingId);
        quoteUrlSyncRef.current = target;
        navigate(target, { replace: true });
        return;
      }

      if (hasPrefill) {
        // PMS deep-link is a fresh handoff — do not keep a leftover 複製 source.
        resetQuickQuoteSessionStorage(user?.email);
        void deleteDraft(makeDraftKey(user?.email, 'NEW'));
        setEditingQuoteId(null);
        setQuickQuoteFreshKey((k) => k + 1);
      } else if (savedEditingId || savedStep > 1) {
        if (savedEditingId) setEditingQuoteIdRaw(savedEditingId);
      } else {
        // Preserve copyFromUuid so 複製報價單 still loads items after pitching pick.
        resetQuickQuoteSessionStorage(user?.email, { keepCopyFrom: true });
        void deleteDraft(makeDraftKey(user?.email, 'NEW'));
        setEditingQuoteId(null);
      }

      store.setCurrentView('quick-quote');
      return;
    }

    if (parsed.kind === 'quote' && parsed.quoteId) {
      setEditingQuoteId(parsed.quoteId);
      // Do not clear uuid on every deep-link pass — wiping it forces QuickQuote to
      // re-fetch and briefly unmount step 4 / 提交審核 (black flash + lost wizard state).
      if (parsed.version) {
        setEditingQuoteVersionRaw(parsed.version);
      } else {
        setEditingQuoteVersionRaw(null);
      }
      store.setCurrentView('quick-quote');
    }
  }, [location.pathname, location.search, navigate, store, user?.email, setEditingQuoteId]);

  // After deploy reload: restore editing quote id/uuid from resume marker or session.
  useEffect(() => {
    if (location.pathname.startsWith("/quote/")) return;

    if (!resumeQuoteAppliedThisPageLoad) {
      const resume = readResumeQuote(user?.email);
      if (resume?.quoteId && resume.quoteId !== "NEW") {
        resumeQuoteAppliedThisPageLoad = true;
        clearResumeQuote(user?.email);
        setEditingQuoteIdRaw(resume.quoteId);
        if (resume.quoteUuid) setEditingQuoteUuidRaw(resume.quoteUuid);
        store.setCurrentView("quick-quote");
        const target = buildQuoteEditorPath(resume.quoteId);
        quoteUrlSyncRef.current = target;
        navigate(target, { replace: true });
        return;
      }
    }

    if (store.currentView !== "quick-quote") return;
    const saved = readQuickQuoteEditingId(user?.email);
    if (saved) setEditingQuoteIdRaw(saved);
  }, [user?.email, store.currentView, location.pathname, navigate, store]);

  // Deep links: /project/design-projects[/:id] (+ legacy /design-projects…)
  useEffect(() => {
    const parsed = parseDesignProjectPathname(location.pathname);
    if (!parsed) return;
    const canonical = canonicalDesignProjectPath(parsed);
    const normalized = location.pathname.replace(/\/+$/, '') || '/';
    if (normalized !== canonical) {
      navigate(canonical, { replace: true });
      return;
    }
    if (
      store.currentView !== 'design-projects' &&
      store.currentView !== 'product-search'
    ) {
      store.setCurrentView('design-projects');
    }
  }, [location.pathname, navigate, store]);

  // /project|products|publish|reports|settings/… → active view
  useEffect(() => {
    if (isCustomerPortalPath(location.pathname)) return;
    if (location.pathname.startsWith('/quote')) return;
    if (isDesignProjectPath(location.pathname)) return;
    if (!isAppSectionPath(location.pathname) && location.pathname !== '/') return;
    const view = appViewFromPath(location.pathname);
    if (!view) return;
    if (view !== store.currentView) {
      store.setCurrentView(view);
    }
  }, [location.pathname, store]);

  // Keep browser URL aligned with quote / design-project / customer / section views.
  useEffect(() => {
    let target: string | null = null;
    const token =
      new URLSearchParams(location.search).get('portal_token') ||
      readStoredPortalToken();
    const withToken = (path: string) =>
      token ? `${path}?portal_token=${encodeURIComponent(token)}` : path;

    if (store.currentView === 'quotation-list') {
      target = QUOTE_LIST_PATH;
    } else if (store.currentView === 'quick-quote') {
      if (editingQuoteId) {
        target = buildQuoteEditorPath(editingQuoteId, editingQuoteVersion);
      } else {
        target = `${QUOTE_QUICK_PATH}${location.search || ''}`;
      }
    } else if (
      store.currentView === 'design-projects' ||
      store.currentView === 'product-search'
    ) {
      // DesignProjectsView owns `/project/design-projects/:id` once a project is selected.
      if (!isDesignProjectPath(location.pathname)) {
        target = DESIGN_PROJECTS_PATH;
      } else {
        const parsed = parseDesignProjectPathname(location.pathname);
        if (parsed) {
          const canonical = canonicalDesignProjectPath(parsed);
          const normalized = location.pathname.replace(/\/+$/, '') || '/';
          if (normalized !== canonical) target = canonical;
        }
      }
    } else if (isCustomerPortalView(store.currentView)) {
      target = withToken(pathFromCustomerView(store.currentView));
    } else {
      const sectionPath = pathFromAppView(store.currentView);
      if (sectionPath) {
        target = sectionPath;
      } else if (
        location.pathname.startsWith('/quote') ||
        isDesignProjectPath(location.pathname) ||
        isCustomerPortalPath(location.pathname) ||
        isAppSectionPath(location.pathname)
      ) {
        target = '/';
      }
    }

    if (!target) return;
    const current = `${location.pathname}${location.search}`;
    if (current === target || quoteUrlSyncRef.current === target) return;
    quoteUrlSyncRef.current = target;
    navigate(target, { replace: true });
  }, [
    store.currentView,
    editingQuoteId,
    editingQuoteVersion,
    location.pathname,
    location.search,
    navigate,
  ]);
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
      toast.error('仍然無法連接', { description: '資料庫尚未恢復，請稍後再試' });
    }
  }, [store]);
  // Product to scroll-into-view when navigating from 發佈前檢查
  const [focusProductId, setFocusProductId] = useState<string | null>(null);
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
      case "solution-project-list":
        return <SolutionProjectListView />;
      case "design-projects":
        return <DesignProjectsView />;
      case "product-search":
        // 產品搜尋已併入「設計專案」右上角「選擇產品」
        return <DesignProjectsView />;
      case "invite-clients":
        return <InviteClientsView />;
      case "confirmed-projects":
        return <ConfirmedProjectsView />;
      case "solution-client-activity":
      case "solution-portal-content":
        // 已自傢俬方案側欄移除 — 舊 deep-link 導向方案列表
        return <SolutionProjectListView />;

      case "customer-quote-schemes":
        return <CustomerQuoteSchemesView />;
      case "customer-product-search":
        return <CustomerProductSearchView />;
      case "customer-custom-furniture":
        return <CustomerCustomFurnitureView />;
      case "customer-payment-delivery":
        return <CustomerPaymentDeliveryView />;
      case "customer-order-status":
        return <CustomerOrderStatusView />;
      case "customer-case-studies":
        return <CustomerCaseStudiesView />;
      case "customer-services":
        return <CustomerServicesView />;
      case "customer-company-info":
        return <CustomerCompanyInfoView />;
      case "customer-contact":
        return <CustomerContactView />;
      case "customer-org-account":
        return <CustomerOrgAccountView />;
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
            editingQuoteVersion={editingQuoteVersion}
            freshSessionKey={quickQuoteFreshKey}
            onAssignEditingQuoteId={assignEditingQuoteId}
            onClearEditingQuote={goToQuoteList}
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
              setEditingQuoteUuidRaw(null);
              setEditingQuoteVersionRaw(null);
              setQuickQuoteFreshKey((k) => k + 1);
              quoteUrlSyncRef.current = QUOTE_QUICK_PATH;
              navigate(QUOTE_QUICK_PATH, { replace: true });
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
    if (!roleLoading && !isAdmin && isAdminOnlyView(view)) {
      return;
    }

    if (view === "quick-quote") {
      if (unsavedGuard.isDirty && !unsavedGuard.confirmLeave()) return;
      writeQuickQuoteCopyFrom(user?.email, null);
      resetQuickQuoteSessionStorage(user?.email);
      void deleteDraft(makeDraftKey(user?.email, "NEW"));
      setEditingQuoteId(null);
      setEditingQuoteUuidRaw(null);
      setEditingQuoteVersionRaw(null);
      setQuickQuoteFreshKey((k) => k + 1);
      quoteUrlSyncRef.current = QUOTE_QUICK_PATH;
      navigate(QUOTE_QUICK_PATH, { replace: true });
      store.setCurrentView("quick-quote");
      store.setFilterProductId(null);
      return;
    }

    if (view === "quotation-list") {
      if (view !== store.currentView && unsavedGuard.isDirty && !unsavedGuard.confirmLeave()) {
        return;
      }
      quoteUrlSyncRef.current = QUOTE_LIST_PATH;
      navigate(QUOTE_LIST_PATH, { replace: true });
      store.setCurrentView("quotation-list");
      store.setFilterProductId(null);
      setEditingQuoteId(null);
      return;
    }

    if (view === "design-projects" || view === "product-search") {
      if (view !== store.currentView && unsavedGuard.isDirty && !unsavedGuard.confirmLeave()) {
        return;
      }
      const parsed = parseDesignProjectPathname(location.pathname);
      const target =
        parsed?.kind === 'project'
          ? `${DESIGN_PROJECTS_PATH}/${parsed.projectId}`
          : DESIGN_PROJECTS_PATH;
      quoteUrlSyncRef.current = target;
      navigate(target, { replace: true });
      store.setCurrentView("design-projects");
      store.setFilterProductId(null);
      setEditingQuoteId(null);
      return;
    }

    if (view !== store.currentView && unsavedGuard.isDirty && !unsavedGuard.confirmLeave()) {
      return;
    }
    if (store.currentView === 'category-management' && view !== 'category-management') {
      store.reloadProducts();
    }
    if (isCustomerPortalView(view)) {
      const token =
        new URLSearchParams(location.search).get('portal_token') ||
        readStoredPortalToken();
      const path = pathFromCustomerView(view);
      const target = token
        ? `${path}?portal_token=${encodeURIComponent(token)}`
        : path;
      quoteUrlSyncRef.current = target;
      navigate(target, { replace: true });
      store.setCurrentView(view);
      store.setFilterProductId(null);
      setEditingQuoteId(null);
      return;
    }
    const sectionPath = pathFromAppView(view);
    if (sectionPath) {
      quoteUrlSyncRef.current = sectionPath;
      navigate(sectionPath, { replace: true });
      store.setCurrentView(view);
      store.setFilterProductId(null);
      setEditingQuoteId(null);
      return;
    }
    if (
      location.pathname.startsWith('/quote') ||
      isDesignProjectPath(location.pathname) ||
      isCustomerPortalPath(location.pathname) ||
      isAppSectionPath(location.pathname)
    ) {
      quoteUrlSyncRef.current = '/';
      navigate('/', { replace: true });
    }
    store.setCurrentView(view);
    store.setFilterProductId(null);
    setEditingQuoteId(null);
  };

  const handleSectionChange = (section: PrimarySection) => {
    if (section === activeSection) return;
    if (
      section !== 'customers' &&
      (platformRole === 'staff' || platformRole === 'admin') &&
      portalTokenActive
    ) {
      clearPortalToken();
    }
    const target = getFirstVisibleView(section, isAdmin);
    if (target) handleViewChange(target);
  };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      data-typography-zone={
        activeSection === 'solutions' || activeSection === 'customers'
          ? 'cjk-portal'
          : undefined
      }
    >
      <PrimaryTopNav
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        isConnected={store.settings.isConnected}
        clientOnly={clientOnly}
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
            isAdmin={isAdmin}
          />
        )}

        <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* 方案 D: Unhealthy DB banner */}
        {dbUnhealthy && (
          <div className="flex items-center gap-2 bg-destructive/10 border-b border-destructive/20 px-4 py-2 text-sm text-destructive">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="flex-1">資料庫連接異常 — 系統暫時無法讀取資料，正在等待恢復...</span>
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
