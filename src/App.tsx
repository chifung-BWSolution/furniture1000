import { Suspense, lazy, Component, type ReactNode } from "react";
import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthProvider";
import { RequireAuth } from "@/components/auth/RequireAuth";
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
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    const msg = error?.message || "";
    if (
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Importing a module script failed") ||
      msg.includes("error loading dynamically imported module")
    ) {
      try {
        const KEY = "__stale_chunk_reload_ts";
        const last = Number(sessionStorage.getItem(KEY) || "0");
        if (Date.now() - last >= 10_000) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background">
          <div className="max-w-md space-y-4 rounded-xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-bold text-foreground">
              Something went wrong
            </h2>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Reload Page
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
            <Route path="/*" element={<Home />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
