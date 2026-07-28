import { Suspense, lazy, Component, type ReactNode } from "react";
import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthProvider";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppUpdateBanner } from "@/components/system/AppUpdateBanner";
import { isStaleAssetErrorMessage, notifyAppUpdate } from "@/lib/appUpdateGuard";
import Home from "./components/home";

const ShopifyCallback = lazy(() =>
  import("./components/auth/ShopifyCallback").then((m) => ({
    default: m.ShopifyCallback,
  })),
);

const PmsSsoCallback = lazy(() =>
  import("./components/auth/PmsSsoCallback").then((m) => ({
    default: m.PmsSsoCallback,
  })),
);

const FactoryDetailPage = lazy(() =>
  import("./components/dashboard/FactoryDetailPage").then((m) => ({
    default: m.FactoryDetailPage,
  })),
);

// Error boundary to catch rendering errors gracefully
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null; staleAssets: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, staleAssets: false };
  }

  static getDerivedStateFromError(error: Error) {
    const stale = isStaleAssetErrorMessage(error?.message || "");
    return { hasError: true, error, staleAssets: stale };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    if (isStaleAssetErrorMessage(error?.message || "")) {
      // Prompt instead of forced reload — preserves chance to flush drafts.
      void notifyAppUpdate("error-boundary");
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex h-screen w-screen items-center justify-center"
          style={{ background: "#f5f6fb", color: "#1a1a2e" }}
        >
          <div
            className="max-w-md space-y-4 rounded-xl border p-8 text-center"
            style={{ background: "#fff", borderColor: "#e5e7eb" }}
          >
            <h2 className="text-lg font-bold">
              {this.state.staleAssets ? "網站已更新" : "頁面載入失敗"}
            </h2>
            <p className="text-sm" style={{ color: "#5c5c7a" }}>
              {this.state.staleAssets
                ? "偵測到新版本資源。請重新整理頁面；若正在編輯報價，草稿應已暫存，重整後可恢復。"
                : this.state.error?.message || "發生未預期錯誤。請重新整理後再試。"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null, staleAssets: false });
                window.location.reload();
              }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: "#4f46e5" }}
            >
              重新整理頁面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppUpdateBanner />
        <Toaster position="top-right" richColors closeButton />
        <Suspense
          fallback={
            <div className="flex h-screen w-screen items-center justify-center">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          }
        >
          <Routes>
            <Route path="/auth/shopify/callback" element={<ShopifyCallback />} />
            <Route path="/auth/pms/callback" element={<PmsSsoCallback />} />
            <Route
              path="/manufacturers/:factoryCode"
              element={
                <RequireAuth>
                  <FactoryDetailPage />
                </RequireAuth>
              }
            />
            {/* Stable deep links for PMS Quote tab / SSO redirect_to */}
            <Route path="/quote/quick" element={<Home />} />
            <Route path="/quote/:quoteId" element={<Home />} />
            <Route path="/quote" element={<Home />} />
            {/* 傢俬方案 / 產品管理 / 網上發佈 / 分析報表 / 設定 */}
            <Route path="/project/*" element={<Home />} />
            <Route path="/products/*" element={<Home />} />
            <Route path="/publish/*" element={<Home />} />
            <Route path="/reports/*" element={<Home />} />
            <Route path="/settings/*" element={<Home />} />
            {/* Legacy 設計專案 deep links → redirected to /project/design-projects */}
            <Route path="/design-projects/:projectId" element={<Home />} />
            <Route path="/design-projects" element={<Home />} />
            {/* Stable deep links for 客戶專區 */}
            <Route path="/customer/*" element={<Home />} />
            <Route path="/customer" element={<Home />} />
            <Route path="/*" element={<Home />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
