import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { inkEase, ViewEnter } from "@/components/motion/NavInk";
import { useLocation, useNavigate } from "react-router-dom";
import { AppStoreProvider, useAppStore } from "@/hooks/use-app-store";
import { unsavedGuard } from "@/lib/unsavedGuard";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
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
import { PlatformRoleProvider, usePlatformRole } from "@/hooks/use-platform-role";
import {
  buildQuoteEditorPath,
  parseQuotePathname,
  QUOTE_LARGE_AMOUNT_PATH,
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
  clearQuoteShareToken,
  customerViewFromPath,
  isCustomerPortalPath,
  isCustomerPortalView,
  pathFromCustomerView,
  readStoredPortalToken,
  quoteShareSessionApplies,
  readStoredQuoteShareToken,
  storePortalToken,
  storeQuoteShareToken,
  withCustomerPortalQuery,
} from "@/lib/customerPortalRoutes";
import {
  appViewFromPath,
  buildFactoryDetailPath,
  canonicalizeDirectoryView,
  designerProductIdFromPath,
  FACTORIES_PATH,
  factoryCodeFromPath,
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
import { findSection, isAdminOnlyView, getFirstVisibleView, getViewMeta, isSitemapPlaceholderView, implementedPage, isImplementedLegacyView, isSolutionPageInQuote, isPmBlockedQuoteView } from "./navConfig";
import { PlannedPage } from "./PlannedPage";
import { type PrimarySection, type ViewType } from "@/types/product";
import { addToCatalog } from "@/lib/catalogStore";
import { toast } from "sonner";
import { checkSupabaseHealth, waitForSupabaseRecovery } from "@/lib/supabase";
import { supabase as sb } from "@/lib/supabase";
import { syncRtsWorkflowToProduct } from "@/lib/rtsProductSync";
import { resolveSelectedPublishProducts } from "@/lib/readyToPublishRow";
import type { Product } from "@/types/product";
import { hasPmsQuotePrefillParams } from "@/lib/pmsQuotePrefill";
import { canManageSupplierDocuments } from "@/lib/supplierDocuments";

// Lazy-loaded heavy views (contain large dependencies like pdfjs-dist, @react-pdf/renderer, etc.)
const ListedProductsView = lazy(() =>
  import("./ListedProductsView").then((mod) => ({ default: mod.ListedProductsView }))
);
const ManufacturerDirectoryView = lazy(() =>
  import("./ManufacturerDirectoryView").then((mod) => ({ default: mod.ManufacturerDirectoryView }))
);
const AIProcessorView = lazy(() =>
  import("./AIProcessorView").then((mod) => ({ default: mod.AIProcessorView }))
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
const SimilarProductsView = lazy(() =>
  import("./publish/SimilarProductsView").then((mod) => ({ default: mod.SimilarProductsView }))
);
// 分析報表 (Analytics Reports)
const FactoryReportView = lazy(() =>
  import("./reports/FactoryReportView").then((mod) => ({ default: mod.FactoryReportView }))
);
const ProductReportView = lazy(() =>
  import("./reports/ProductReportView").then((mod) => ({ default: mod.ProductReportView }))
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
const PrdDescriptionsView = lazy(() =>
  import("./admin/PrdDescriptionsView").then((mod) => ({ default: mod.PrdDescriptionsView }))
);
const DailyCommandLogsView = lazy(() =>
  import("./admin/DailyCommandLogsView").then((mod) => ({ default: mod.DailyCommandLogsView }))
);
const DevelopmentCostView = lazy(() =>
  import("./admin/DevelopmentCostView").then((mod) => ({ default: mod.DevelopmentCostView }))
);
const ExtractionReviewView = lazy(() =>
  import("./ExtractionReviewView").then((mod) => ({ default: mod.ExtractionReviewView }))
);
const FurnitureSearchView = lazy(() =>
  import("./FurnitureSearchView").then((mod) => ({ default: mod.FurnitureSearchView }))
);
const DesignerPdfView = lazy(() =>
  import("./DesignerPdfView").then((mod) => ({ default: mod.DesignerPdfView }))
);
const PresentationView = lazy(() =>
  import("./PresentationView").then((mod) => ({ default: mod.PresentationView }))
);
// 傢俬方案 (Furniture Scheme)
const DesignSchemeWorkspace = lazy(() =>
  import("./solutions/DesignSchemeWorkspace").then((mod) => ({ default: mod.DesignSchemeWorkspace }))
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
const QuoteTrashView = lazy(() =>
  import("./QuoteTrashView").then((mod) => ({ default: mod.QuoteTrashView }))
);
const PmBudgetView = lazy(() =>
  import("./PmBudgetView").then((mod) => ({ default: mod.PmBudgetView }))
);
const PmQuickView = lazy(() =>
  import("./PmQuickView").then((mod) => ({ default: mod.PmQuickView }))
);
const ProPdfView = lazy(() =>
  import("./ProPdfView").then((mod) => ({ default: mod.ProPdfView }))
);
const QuoteFormatView = lazy(() =>
  import("./QuoteFormatView").then((mod) => ({ default: mod.QuoteFormatView }))
);
const QuotePhotoLibraryView = lazy(() =>
  import("./QuotePhotoLibraryView").then((mod) => ({ default: mod.QuotePhotoLibraryView }))
);
const EmailNotificationsView = lazy(() =>
  import("./EmailNotificationsView").then((mod) => ({ default: mod.EmailNotificationsView }))
);
const CaseOrdersView = lazy(() =>
  import("./CaseOrdersView").then((mod) => ({ default: mod.CaseOrdersView }))
);
const CasePhotosView = lazy(() =>
  import("./CasePhotosView").then((mod) => ({ default: mod.CasePhotosView }))
);
const CaseClientsView = lazy(() =>
  import("./CaseClientsView").then((mod) => ({ default: mod.CaseClientsView }))
);
const FactoryZonesView = lazy(() =>
  import("./FactoryZonesView").then((mod) => ({ default: mod.FactoryZonesView }))
);
const FactoryLoginView = lazy(() =>
  import("./FactoryLoginView").then((mod) => ({ default: mod.FactoryLoginView }))
);
const UsageStatsView = lazy(() =>
  import("./admin/UsageStatsView").then((mod) => ({ default: mod.UsageStatsView }))
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
  "quotation-large-amount",
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
  "abnormal-price-products",
  "fds2-publish-similar",
  "fds2-products-ai-review",
  "fds2-pm-presentation",
  "fds2-quote-trash",
  "fds2-pm-budget",
  "fds2-pm-quick",
  "fds2-pm-pro-pdf",
  "fds2-factory-sales",
  "fds2-quote-format",
  "fds2-quote-photos",
  "fds2-admin-email",
  "fds2-admin-usage",
  "fds2-cases-orders",
  "fds2-cases-photos",
  "fds2-cases-clients",
  "fds2-factory-zones",
  "fds2-quote-report",
  "fds2-factory-login",
  "report-factory",
  "report-product",
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
  return (
    <AppStoreProvider>
      <PlatformRoleProvider>
        <AppShellContent />
      </PlatformRoleProvider>
    </AppStoreProvider>
  );
}

function AppShellContent() {
  const store = useAppStore();
  const { user } = useAuth();
  const { role: platformRole, profileRole, loading: roleLoading } = usePlatformRole();
  const location = useLocation();
  const navigate = useNavigate();
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalProducts, setPublishModalProducts] = useState<Product[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Mobile (< lg): section sidebar is an overlay drawer, closed by default. */
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const reduceMotion = useReducedMotion();
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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => {
      const mobile = mq.matches;
      setIsMobileLayout(mobile);
      if (mobile) {
        setSidebarCollapsed(true);
        setMobileNavOpen(false);
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const searchParams = new URLSearchParams(location.search);
  const portalToken = searchParams.get('portal_token');
  const quoteShareToken = searchParams.get('quote_share');
  const storedPortalToken = readStoredPortalToken();
  const storedQuoteShareToken = readStoredQuoteShareToken();
  const invitePortalActive = Boolean(portalToken || storedPortalToken);
  const quoteShareActive = quoteShareSessionApplies(
    location.pathname,
    location.search,
    storedQuoteShareToken,
  );
  // Logged-in staff/admin are not quote-share guests. The token is a no-login
  // link; attaching it to their session locks the whole account into 客戶專區.
  const isStaffAccount =
    !roleLoading &&
    (platformRole === 'staff' || platformRole === 'admin' || platformRole === 'supplier');
  const quoteShareGuestActive = quoteShareActive && !isStaffAccount;
  const portalTokenActive = invitePortalActive || quoteShareGuestActive;
  // Anonymous quote-share visitors stay in 客戶專區.
  // Project invite tokens lock unknown/client roles; staff/admin can leave those.
  const clientOnly =
    platformRole === 'client' ||
    quoteShareGuestActive ||
    (invitePortalActive &&
      (roleLoading ||
        (platformRole !== 'staff' && platformRole !== 'admin' && platformRole !== 'supplier')));
  const isAdmin = platformRole === 'admin';
  const isSupplier = platformRole === 'supplier';

  useEffect(() => {
    if (portalToken) {
      storePortalToken(portalToken);
    }
  }, [portalToken]);

  useEffect(() => {
    if (roleLoading || !isSupplier) return;
    if (store.currentView !== 'fds2-factory-login') {
      store.setCurrentView('fds2-factory-login');
    }
    if (location.pathname !== '/fds/factories/login') {
      navigate('/fds/factories/login', { replace: true });
    }
  }, [roleLoading, isSupplier, store, location.pathname, navigate]);

  useEffect(() => {
    if (!quoteShareToken || isStaffAccount) return;
    storeQuoteShareToken(quoteShareToken);
  }, [quoteShareToken, isStaffAccount]);

  // Drop a quote-share token that was stored before the staff role resolved
  // (this browser, or a previous visit to ?quote_share=).
  useEffect(() => {
    if (!isStaffAccount) return;
    const hasQuery = Boolean(quoteShareToken);
    const hasStored = Boolean(readStoredQuoteShareToken());
    if (!hasQuery && !hasStored) return;
    clearQuoteShareToken();
    if (!hasQuery) return;
    const params = new URLSearchParams(location.search);
    params.delete('quote_share');
    const qs = params.toString();
    const next = `${location.pathname}${qs ? `?${qs}` : ''}`;
    if (`${location.pathname}${location.search}` === next) return;
    quoteUrlSyncRef.current = next;
    navigate(next, { replace: true });
  }, [isStaffAccount, quoteShareToken, location.pathname, location.search, navigate]);

  // Legacy invite / quote-share links landed on `/?…` — send them to /customer.
  // Staff/admin keep their own session; the share query is stripped separately.
  useEffect(() => {
    if (isStaffAccount && quoteShareToken && !portalToken) return;
    if (!portalToken && !quoteShareToken) return;
    if (isCustomerPortalPath(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    const target = `${CUSTOMER_PORTAL_BASE}?${params.toString()}`;
    quoteUrlSyncRef.current = target;
    navigate(target, { replace: true });
  }, [
    isStaffAccount,
    portalToken,
    quoteShareToken,
    location.pathname,
    location.search,
    navigate,
  ]);

  // Quote-share guests stay in 客戶專區 (except 機構採購帳號), defaulting to 報價方案.
  useEffect(() => {
    if (!quoteShareGuestActive) return;
    if (
      !isCustomerPortalView(store.currentView) ||
      store.currentView === 'customer-org-account'
    ) {
      store.setCurrentView('customer-quote-schemes');
    }
    if (
      !isCustomerPortalPath(location.pathname) ||
      location.pathname.includes('/org-account')
    ) {
      const qShare = quoteShareToken || storedQuoteShareToken;
      const token = portalToken || storedPortalToken;
      const view =
        isCustomerPortalView(store.currentView) &&
        store.currentView !== 'customer-org-account'
          ? store.currentView
          : 'customer-quote-schemes';
      const target = withCustomerPortalQuery(pathFromCustomerView(view), {
        portalToken: token,
        quoteShareToken: qShare,
      });
      quoteUrlSyncRef.current = target;
      navigate(target, { replace: true });
    }
  }, [
    quoteShareGuestActive,
    quoteShareToken,
    storedQuoteShareToken,
    portalToken,
    storedPortalToken,
    store,
    location.pathname,
    navigate,
  ]);

  // /customer and /customer/:slug → switch the active client-portal view.
  useEffect(() => {
    if (!isCustomerPortalPath(location.pathname)) return;
    const view = customerViewFromPath(location.pathname);
    if (!view) return;
    // Quote-share guests cannot open 機構採購帳號 (redirect handled above).
    if (quoteShareGuestActive && view === 'customer-org-account') return;
    if (store.currentView !== view) {
      store.setCurrentView(view);
    }
  }, [location.pathname, quoteShareGuestActive, store]);

  useEffect(() => {
    if (clientOnly && findSection(store.currentView) !== 'customers') {
      const customerHome = 'fds2-customer-quotes' as const;
      store.setCurrentView(customerHome);
      if (!location.pathname.startsWith('/fds/customer')) {
        const target = withCustomerPortalQuery(pathFromAppView(customerHome) || '/fds/customer/quote-schemes', {
          portalToken: portalToken || storedPortalToken,
          quoteShareToken: quoteShareToken || storedQuoteShareToken,
        });
        quoteUrlSyncRef.current = target;
        navigate(target, { replace: true });
      }
    } else if (
      store.currentView !== 'dashboard' &&
      store.currentView !== 'factory-detail' &&
      store.currentView !== 'ai-processor' &&
      !isSitemapPlaceholderView(store.currentView) &&
      !isImplementedLegacyView(store.currentView) &&
      !implementedPage(store.currentView) &&
      !isSolutionPageInQuote(store.currentView)
    ) {
      store.setCurrentView('dashboard');
    }
    if (
      store.currentView === 'customer-design-projects' ||
      store.currentView === 'customer-confirmed-products' ||
      store.currentView === 'confirmed-projects'
    ) {
      store.setCurrentView('fds2-customer-quotes');
    }
    if (store.currentView === 'report-sales') {
      store.setCurrentView('fds2-report-factory');
    }
    if (!roleLoading && !clientOnly && !isAdmin && isAdminOnlyView(store.currentView)) {
      store.setCurrentView('fds2-admin-shopify');
    }
    if (!roleLoading && profileRole === 'pm' && isPmBlockedQuoteView(store.currentView)) {
      store.setCurrentView('fds2-pm-budget');
    }
  }, [
    clientOnly,
    portalToken,
    storedPortalToken,
    quoteShareToken,
    storedQuoteShareToken,
    roleLoading,
    profileRole,
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
    async (quoteId: string, opts?: { quoteUuid?: string; version?: string }) => {
      if (!(await unsavedGuard.confirmLeave())) return;
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

  // Deep links: /quote, /quote/large-amount, /quote/quick, /quote/:quoteId(Vn)
  useEffect(() => {
    const parsed = parseQuotePathname(location.pathname);
    if (parsed.kind === 'list' && location.pathname.replace(/\/+$/, '') !== QUOTE_LIST_PATH) {
      return;
    }
    if (
      parsed.kind !== 'list' &&
      parsed.kind !== 'large-amount' &&
      !location.pathname.startsWith('/quote/')
    ) {
      return;
    }

    if (!roleLoading && profileRole === 'pm') {
      if (store.currentView !== 'fds2-pm-budget') store.setCurrentView('fds2-pm-budget');
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

    if (parsed.kind === 'large-amount') {
      setEditingQuoteId(null);
      store.setCurrentView('quotation-large-amount');
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
      // re-fetch and briefly unmount editor step / 提交審核 (black flash + lost wizard state).
      if (parsed.version) {
        setEditingQuoteVersionRaw(parsed.version);
      } else {
        setEditingQuoteVersionRaw(null);
      }
      store.setCurrentView('quick-quote');
    }
  }, [location.pathname, location.search, navigate, store, user?.email, setEditingQuoteId, roleLoading, profileRole]);

  // After deploy reload: restore editing quote id/uuid from resume marker or session.
  // Never steal quote_share / portal invite deep links back into the quote editor.
  useEffect(() => {
    if (location.pathname.startsWith("/quote/")) return;
    if (quoteShareGuestActive || invitePortalActive) return;
    if (isCustomerPortalPath(location.pathname)) return;

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
  }, [
    user?.email,
    store.currentView,
    location.pathname,
    navigate,
    store,
    quoteShareGuestActive,
    invitePortalActive,
  ]);

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
    if (!roleLoading && profileRole === 'pm' && isPmBlockedQuoteView(view)) {
      if (store.currentView !== 'fds2-pm-budget') store.setCurrentView('fds2-pm-budget');
      return;
    }
    // The role guard further down decides which pages this account may open.
    // When the URL names a page it may not open, leave that decision to the
    // guard — otherwise both effects overwrite each other on every render and
    // React aborts with「Maximum update depth exceeded」.
    if (!roleLoading && !isAdmin && isAdminOnlyView(view)) return;
    if (view !== store.currentView) {
      store.setCurrentView(view);
    }
  }, [location.pathname, store, roleLoading, profileRole, isAdmin]);

  // Leaving /customer without ?quote_share= ends the guest preview. A stored
  // token must not be glued back on when the user opens the staff site.
  useEffect(() => {
    if (quoteShareToken) return;
    if (isCustomerPortalPath(location.pathname)) return;
    if (readStoredQuoteShareToken()) clearQuoteShareToken();
  }, [quoteShareToken, location.pathname]);

  // Keep browser URL aligned with quote / design-project / customer / section views.
  useEffect(() => {
    let target: string | null = null;
    const token =
      new URLSearchParams(location.search).get('portal_token') ||
      readStoredPortalToken();
    const qShare = isStaffAccount
      ? null
      : new URLSearchParams(location.search).get('quote_share') ||
        readStoredQuoteShareToken();
    const withToken = (path: string) =>
      withCustomerPortalQuery(path, {
        portalToken: token,
        quoteShareToken: qShare,
      });

    // Quote-share / invite sessions must stay on 客戶專區 URLs with tokens intact.
    // Do not let a stale sessionStorage view (dashboard / quick-quote) wipe
    // `/customer?quote_share=…` down to `/` or `/quote/…`.
    if (quoteShareGuestActive || (invitePortalActive && isCustomerPortalPath(location.pathname))) {
      target = withToken(
        isCustomerPortalView(store.currentView)
          ? pathFromCustomerView(store.currentView)
          : CUSTOMER_PORTAL_BASE,
      );
    } else if (store.currentView === 'quotation-list') {
      target = QUOTE_LIST_PATH;
    } else if (store.currentView === 'quotation-large-amount') {
      target = QUOTE_LARGE_AMOUNT_PATH;
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
      if (!isCustomerPortalPath(location.pathname) && !quoteShareToken) {
        // Address bar is the staff app. Do not follow a leftover 客戶專區 view.
        const staffView = appViewFromPath(location.pathname);
        target = (staffView && pathFromAppView(staffView)) || '/';
      } else {
        target = withToken(pathFromCustomerView(store.currentView));
      }
    } else if (
      store.currentView === 'fds2-designer-types' &&
      designerProductIdFromPath(location.pathname)
    ) {
      // FurnitureSearchView owns /fds/designer/types/:productId
    } else if (
      canonicalizeDirectoryView(store.currentView) === 'fds2-products-factories' &&
      factoryCodeFromPath(location.pathname)
    ) {
      // Factory detail owns /fds/factories/:code inside the shell.
    } else {
      const sectionPath = pathFromAppView(store.currentView);
      if (sectionPath) {
        const params = new URLSearchParams(location.search);
        // Canva redirects back with ?code=&state=. Replacing the path alone
        // drops that query before PresentationView can exchange the code.
        const keepCanvaOauth =
          sectionPath === '/fds/pm/presentation' &&
          (params.has('code') || params.has('error'));
        target = keepCanvaOauth ? `${sectionPath}?${params.toString()}` : sectionPath;
      } else if (
        location.pathname.startsWith('/quote') ||
        isDesignProjectPath(location.pathname) ||
        isCustomerPortalPath(location.pathname) ||
        isAppSectionPath(location.pathname)
      ) {
        // Preserve share/invite query if present (path bounce must not drop tokens).
        target = qShare || token ? withToken(CUSTOMER_PORTAL_BASE) : '/';
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
    quoteShareGuestActive,
    isStaffAccount,
    invitePortalActive,
  ]);
  // 方案 D: Supabase health monitoring (warning only — never treat the site as down)
  const [dbUnhealthy, setDbUnhealthy] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const cancelRecoveryRef = useRef<(() => void) | null>(null);
  const dbUnhealthyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const POLL_INTERVAL = 60_000; // check every 60s — avoid adding load while DB is stressed

    async function poll() {
      if (cancelled || dbUnhealthyRef.current) return;
      // Require TWO consecutive failed probes before showing the warning.
      // A single slow/aborted request during a heavy bulk op (e.g. 全部退回)
      // must NOT flip the banner — the DB is fine, the query was just big.
      const first = await checkSupabaseHealth();
      if (cancelled || first) return;
      const second = await checkSupabaseHealth();
      if (cancelled || second) return;

      dbUnhealthyRef.current = true;
      setDbUnhealthy(true);
      cancelRecoveryRef.current?.();
      cancelRecoveryRef.current = waitForSupabaseRecovery(() => {
        if (!cancelled) {
          dbUnhealthyRef.current = false;
          setDbUnhealthy(false);
          setIsRetrying(false);
          toast.success('連線已恢復', { description: '可繼續操作；正在同步產品列表' });
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
      cancelRecoveryRef.current?.();
      cancelRecoveryRef.current = null;
      dbUnhealthyRef.current = false;
      setDbUnhealthy(false);
      setIsRetrying(false);
      toast.success('連線正常', { description: '可繼續操作；正在同步產品列表' });
      store.reloadProducts();
    } else {
      setIsRetrying(false);
      toast.error('這次仍偏慢', { description: '請再按「立即重試」。其他頁面仍可繼續使用。' });
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
    if ((implementedPage(store.currentView) ?? store.currentView) === 'listed-products') {
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
      const inMemory = (implementedPage(store.currentView) ?? store.currentView) === 'ready-to-publish'
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

  const contentView = implementedPage(store.currentView) ?? store.currentView;

  const renderView = () => {
    if (!roleLoading && profileRole === 'pm' && isPmBlockedQuoteView(store.currentView)) {
      return <PmBudgetView />;
    }
    if (store.currentView === 'fds2-admin-prd') return <PrdDescriptionsView />;
    if (store.currentView === 'fds2-admin-command-logs') return <DailyCommandLogsView />;
    if (store.currentView === 'fds2-admin-usage') return <UsageStatsView />;
    if (store.currentView === 'fds2-admin-dev-cost') return <DevelopmentCostView />;
    if (store.currentView === 'fds2-products-ai-review') {
      return (
        <ExtractionReviewView
          onOpenUpload={() => store.setCurrentView('fds2-products-factories')}
        />
      );
    }
    if (store.currentView === 'fds2-designer-types') return <FurnitureSearchView key="browse" />;
    if (store.currentView === 'fds2-designer-pdf') return <DesignerPdfView />;
    if (store.currentView === 'fds2-designer-common' || store.currentView === 'fds2-quote-common') {
      return <FurnitureSearchView key="common" mode="common" />;
    }
    if (store.currentView === 'fds2-designer-latest') return <FurnitureSearchView key="latest" mode="latest" />;
    if (store.currentView === 'fds2-pm-presentation') return <PresentationView />;
    if (store.currentView === 'fds2-publish-similar') return <SimilarProductsView />;
    if (store.currentView === 'fds2-quote-trash') return <QuoteTrashView />;
    if (store.currentView === 'fds2-pm-budget') return <PmBudgetView />;
    if (store.currentView === 'fds2-pm-quick') return <PmQuickView />;
    if (store.currentView === 'fds2-pm-pro-pdf') return <ProPdfView />;
    if (store.currentView === 'fds2-factory-sales') return <FactoryReportView />;
    if (store.currentView === 'fds2-quote-format') return <QuoteFormatView />;
    if (store.currentView === 'fds2-quote-photos') return <QuotePhotoLibraryView />;
    if (store.currentView === 'fds2-admin-email') return <EmailNotificationsView />;
    if (store.currentView === 'fds2-cases-orders') return <CaseOrdersView />;
    if (store.currentView === 'fds2-cases-photos') return <CasePhotosView />;
    if (store.currentView === 'fds2-cases-clients') return <CaseClientsView />;
    if (store.currentView === 'fds2-factory-zones') return <FactoryZonesView />;
    if (store.currentView === 'fds2-quote-report') return <ProductReportView />;
    if (store.currentView === 'fds2-factory-login') return <FactoryLoginView />;
    if (isSitemapPlaceholderView(store.currentView)) {
      const meta = getViewMeta(store.currentView);
      return <PlannedPage sectionLabel={meta.sectionLabel} title={meta.viewLabel} />;
    }
    switch (contentView) {
      case "dashboard":
        return (
          <DashboardView onNavigate={handleViewChange} />
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
      case "ai-processor":
        return (
          <AIProcessorView
            onAddProduct={store.addProduct}
            onNavigateToPublish={() => store.setCurrentView("ready-to-publish")}
            selectedModel={store.settings.aiModel}
            geminiProxyUrl={store.settings.geminiProxyUrl}
          />
        );
      case "manufacturer-catalog": {
        const openFactoryCode = factoryCodeFromPath(location.pathname);
        if (openFactoryCode) {
          return (
            <FactoryDetailView
              factoryCode={openFactoryCode}
              onBack={() => {
                quoteUrlSyncRef.current = FACTORIES_PATH;
                navigate(FACTORIES_PATH);
              }}
            />
          );
        }
        return (
          <ManufacturerDirectoryView
            onOpenFactory={(code) => {
              const target = buildFactoryDetailPath(code);
              quoteUrlSyncRef.current = target;
              navigate(target);
            }}
            onOpenUpload={(factory) => {
              void canManageSupplierDocuments().then((ok) => {
                if (!ok) {
                  toast.error('只有管理員或上載員可以上傳圖冊／報價單');
                  return;
                }
                sessionStorage.setItem('fds-upload-factory', JSON.stringify({
                  id: factory.id,
                  name: factory.display_name,
                }));
                store.setCurrentView('ai-processor');
              });
            }}
          />
        );
      }
      case "factory-detail":
        return store.factoryDetailCode ? (
          <FactoryDetailView
            factoryCode={store.factoryDetailCode}
            onBack={() => store.setCurrentView("fds2-products-factories")}
          />
        ) : null;
      case "solution-project-list":
      case "solution-client-activity":
      case "solution-portal-content":
        return <DesignSchemeWorkspace panel="setup" />;
      case "design-projects":
      case "product-search":
        // 產品搜尋已併入配置傢俬右上角「選擇產品」
        return <DesignSchemeWorkspace panel="design" />;
      case "invite-clients":
        return <DesignSchemeWorkspace panel="invite" />;
      case "confirmed-projects":
        return <CustomerQuoteSchemesView />;

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
      case "abnormal-price-products":
        return <PublishedProductsView mode="price-audit" />;
      case "report-factory":
        return <FactoryReportView />;
      case "report-product":
        return <ProductReportView />;
      case "report-sales":
        return <FactoryReportView />;
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
      case "quotation-large-amount":
        return (
          <QuotationListView
            mode={
              contentView === 'quotation-large-amount'
                ? 'large-amount'
                : 'all'
            }
            onOpenQuote={openQuoteForEdit}
            onCopyQuote={async (quoteUuid) => {
              if (!(await unsavedGuard.confirmLeave())) return;
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

  const handleViewChange = async (view: typeof store.currentView) => {
    const linked = implementedPage(view);
    if (!roleLoading && !isAdmin && (isAdminOnlyView(view) || (linked != null && isAdminOnlyView(linked)))) {
      return;
    }
    if (!roleLoading && profileRole === 'pm' && isPmBlockedQuoteView(view)) {
      return;
    }

    if (linked === "quick-quote" || view === "quick-quote") {
      if (unsavedGuard.isDirty && !(await unsavedGuard.confirmLeave())) return;
      writeQuickQuoteCopyFrom(user?.email, null);
      resetQuickQuoteSessionStorage(user?.email);
      void deleteDraft(makeDraftKey(user?.email, "NEW"));
      setEditingQuoteId(null);
      setEditingQuoteUuidRaw(null);
      setEditingQuoteVersionRaw(null);
      setQuickQuoteFreshKey((k) => k + 1);
      const stayOnSitemap = linked === "quick-quote";
      const targetPath = stayOnSitemap ? pathFromAppView(view) : QUOTE_QUICK_PATH;
      quoteUrlSyncRef.current = targetPath || QUOTE_QUICK_PATH;
      navigate(quoteUrlSyncRef.current, { replace: true });
      store.setCurrentView(stayOnSitemap ? view : "quick-quote");
      store.setFilterProductId(null);
      return;
    }

    if (
      view === "quotation-list" ||
      view === "quotation-large-amount" ||
      linked === "quotation-list" ||
      linked === "quotation-large-amount"
    ) {
      if (view !== store.currentView && unsavedGuard.isDirty && !(await unsavedGuard.confirmLeave())) {
        return;
      }
      const targetPath = linked
        ? (pathFromAppView(view) || QUOTE_LIST_PATH)
        : view === "quotation-large-amount"
          ? QUOTE_LARGE_AMOUNT_PATH
          : QUOTE_LIST_PATH;
      quoteUrlSyncRef.current = targetPath;
      navigate(targetPath, { replace: true });
      store.setCurrentView(view);
      store.setFilterProductId(null);
      setEditingQuoteId(null);
      return;
    }

    if (view === "design-projects" || view === "product-search") {
      if (view !== store.currentView && unsavedGuard.isDirty && !(await unsavedGuard.confirmLeave())) {
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

    if (view !== store.currentView && unsavedGuard.isDirty && !(await unsavedGuard.confirmLeave())) {
      return;
    }
    const leavingView = implementedPage(store.currentView) ?? store.currentView;
    const enteringView = linked ?? view;
    if (leavingView === 'category-management' && enteringView !== 'category-management') {
      store.reloadProducts();
    }
    if (isCustomerPortalView(view)) {
      // Quote-share guests may browse portal pages except 機構採購帳號.
      if (quoteShareGuestActive && view === 'customer-org-account') {
        return;
      }
      const token =
        new URLSearchParams(location.search).get('portal_token') ||
        readStoredPortalToken();
      const qShare = isStaffAccount
        ? null
        : new URLSearchParams(location.search).get('quote_share') ||
          readStoredQuoteShareToken();
      const path = pathFromCustomerView(view);
      const target = withCustomerPortalQuery(path, {
        portalToken: token,
        quoteShareToken: qShare,
      });
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
    if (section !== 'customers' && quoteShareGuestActive) {
      return;
    }
    if (
      section !== 'customers' &&
      (platformRole === 'staff' || platformRole === 'admin') &&
      invitePortalActive
    ) {
      clearPortalToken();
    }
    const target = getFirstVisibleView(section, isAdmin, {
      quoteShareGuest: quoteShareGuestActive,
      pm: profileRole === 'pm',
    });
    if (target) handleViewChange(target);
  };

  return (
    <ConfirmProvider>
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      data-typography-zone={
        activeSection === 'designer' ||
        activeSection === 'cases' ||
        activeSection === 'solutions' ||
        activeSection === 'customers'
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
        {/* Desktop sidebar */}
        {activeSection !== 'home' && !isMobileLayout ? (
          <SidebarNav
            activeSection={activeSection}
            currentView={store.currentView}
            onViewChange={handleViewChange}
            isDarkMode={store.isDarkMode}
            onToggleDarkMode={store.toggleDarkMode}
            isCollapsed={sidebarCollapsed}
            onCollapseChange={setSidebarCollapsed}
            isAdmin={isAdmin}
            quoteShareGuest={quoteShareGuestActive}
            pm={profileRole === 'pm'}
          />
        ) : null}

        {/* Mobile section nav — overlay drawer, closed by default */}
        <AnimatePresence>
          {activeSection !== 'home' && isMobileLayout && mobileNavOpen ? (
            <motion.div
              key="mobile-section-nav"
              className="fixed inset-0 z-[60] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: inkEase }}
            >
              <button
                type="button"
                aria-label="關閉選單"
                className="absolute inset-0 bg-black/45"
                onClick={() => setMobileNavOpen(false)}
              />
              <motion.div
                className="absolute inset-y-0 left-0 flex w-[min(280px,86vw)] max-w-full shadow-2xl"
                initial={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
                animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
                transition={{ duration: reduceMotion ? 0.12 : 0.32, ease: inkEase }}
              >
                <SidebarNav
                  activeSection={activeSection}
                  currentView={store.currentView}
                  onViewChange={(view) => {
                    handleViewChange(view);
                    setMobileNavOpen(false);
                  }}
                  isDarkMode={store.isDarkMode}
                  onToggleDarkMode={store.toggleDarkMode}
                  isCollapsed={false}
                  onCollapseChange={() => setMobileNavOpen(false)}
                  isAdmin={isAdmin}
                  quoteShareGuest={quoteShareGuestActive}
                  pm={profileRole === 'pm'}
                />
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 方案 D: Unhealthy DB banner */}
        {dbUnhealthy && (
          <div className="flex items-center gap-2 bg-destructive/10 border-b border-destructive/20 px-4 py-2 text-sm text-destructive">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="flex-1">連線偏慢或暫時不穩 — 請按「立即重試」，不必空等。其他頁面仍可繼續操作。</span>
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
          pageView={contentView}
          selectedCount={contentView === 'listed-products' ? listedStats.selected : store.selectedProductIds.size}
          totalProducts={contentView === 'listed-products' ? listedStats.total : contentView === 'ready-to-publish' ? rtpTotalCount : store.products.length}
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
          showMobileNavButton={
            activeSection !== 'home' && isMobileLayout
          }
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <ViewEnter
            viewKey={
              store.isLoading &&
              !isSitemapPlaceholderView(store.currentView) &&
              !SELF_LOADING_VIEWS.has(contentView)
                ? 'loading'
                : contentView
            }
          >
            {store.isLoading && !isSitemapPlaceholderView(store.currentView) && !SELF_LOADING_VIEWS.has(contentView) ? (
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
          </ViewEnter>
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
    </ConfirmProvider>
  );
}
