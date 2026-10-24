import fs from "fs";
import path from "path";
import { execSync } from "node:child_process";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";

const appBuildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.VITE_APP_BUILD_ID ||
  `dev-${Date.now()}`;

function currentGitBranch(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  if (fromCi) return fromCi;
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Browser Supabase connection. Unprefixed names win so Vercel Preview can set
 * SUPABASE_URL / SUPABASE_ANON_KEY without a VITE_ prefix. Existing
 * VITE_SUPABASE_* values remain the fallback for production.
 */
export function resolveSupabasePublicEnv(input: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  viteSupabaseUrl?: string;
  viteSupabaseAnonKey?: string;
}) {
  return {
    url: String(input.supabaseUrl || input.viteSupabaseUrl || "").trim(),
    anonKey: String(input.supabaseAnonKey || input.viteSupabaseAnonKey || "").trim(),
  };
}

/** One-click login is baked in only for the develop branch. main always gets empty values. */
export function resolveQuickLoginConfig(input: {
  gitBranch: string;
  enabled: string | undefined;
  email: string | undefined;
  password: string | undefined;
}) {
  const email = String(input.email || "").trim();
  const password = String(input.password || "");
  const enabledFlag = String(input.enabled || "").trim().toLowerCase();
  const enabledOn = enabledFlag === "true" || enabledFlag === "1" || enabledFlag === "yes";
  const active = input.gitBranch === "develop" && enabledOn && Boolean(email) && Boolean(password);
  return {
    enabled: active ? "true" : "false",
    email: active ? email : "",
    password: active ? password : "",
  };
}

/**
 * PRD 功能描述頁面需要每份 Markdown 的最後修改日期。
 * import.meta.glob(?raw) 拿不到 mtime，所以在 build/dev 時掃描檔案系統，
 * 產生 { 相對路徑: "YYYY-MM-DD" } 的 virtual module 給 src/lib/prd-docs.ts 使用。
 */
function prdMtimePlugin(): Plugin {
  const VIRTUAL_ID = "virtual:prd-mtimes";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
  const rootDir = path.resolve(__dirname);

  function collectMtimes(): Record<string, string> {
    const map: Record<string, string> = {};
    const pad = (n: number) => String(n).padStart(2, "0");

    const visit = (fullPath: string, relPath: string) => {
      try {
        const stat = fs.statSync(fullPath);
        const date = `${stat.mtime.getFullYear()}-${pad(stat.mtime.getMonth() + 1)}-${pad(
          stat.mtime.getDate(),
        )}`;
        map[relPath] = date;
      } catch {
        // stat 失敗（例如權限被攔）就不產生日期，讓 prd-docs.ts 退回解析文檔內容。
      }
    };

    const walkDocs = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walkDocs(full, rel);
        else if (entry.name.toLowerCase().endsWith(".md")) visit(full, rel);
      }
    };

    const docsDir = path.join(rootDir, "docs");
    if (fs.existsSync(docsDir)) walkDocs(docsDir, "docs");
    for (const name of ["CLAUDE.md", "README.md"]) {
      const full = path.join(rootDir, name);
      if (fs.existsSync(full)) visit(full, name);
    }
    return map;
  }

  const isPrdFile = (file: string) => {
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    return (
      rel === "CLAUDE.md" ||
      rel === "README.md" ||
      (rel.startsWith("docs/") && rel.toLowerCase().endsWith(".md"))
    );
  };

  return {
    name: "bwf-prd-mtimes",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      const map = collectMtimes();
      return `export default ${JSON.stringify(map)};`;
    },
    configureServer(server) {
      // dev 期間修改 md 時，讓 virtual module 重新計算並整頁刷新。
      server.watcher.on("change", (file) => {
        if (!isPrdFile(file)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidate(mod);
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

/** Emit public/version.json so clients can detect redeploys without forced reload. */
function versionJsonPlugin(buildId: string, opts?: { writePublic?: boolean }): Plugin {
  const write = (outDir: string) => {
    const payload = JSON.stringify(
      { buildId, builtAt: new Date().toISOString() },
      null,
      2,
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "version.json"), payload);
  };

  return {
    name: "bwf-version-json",
    config() {
      return {
        define: {
          "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(buildId),
        },
      };
    },
    buildStart() {
      if (opts?.writePublic === false) return;
      write(path.resolve(__dirname, "public"));
    },
    closeBundle() {
      write(path.resolve(__dirname, "dist"));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabasePublic = resolveSupabasePublicEnv({
    supabaseUrl: process.env.SUPABASE_URL ?? env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY,
    viteSupabaseUrl: process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL,
    viteSupabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY,
  });
  // Vite only ships VITE_* to the browser. Copy the unprefixed Preview values
  // across before the client bundle is sealed. Never stamp an empty string:
  // that freezes "supabaseUrl is required" into the deployment.
  if (supabasePublic.url) process.env.VITE_SUPABASE_URL = supabasePublic.url;
  if (supabasePublic.anonKey) process.env.VITE_SUPABASE_ANON_KEY = supabasePublic.anonKey;
  if (process.env.VERCEL && !supabasePublic.url) {
    throw new Error(
      "Missing SUPABASE_URL (or VITE_SUPABASE_URL) for this Vercel build. Preview builds cannot read Production-only or Sensitive variables.",
    );
  }
  const loginMethod = currentGitBranch() === "develop" ? "quick" : "sso";
  const quickLogin = resolveQuickLoginConfig({
    gitBranch: currentGitBranch(),
    enabled: process.env.VITE_ENABLE_QUICK_LOGIN ?? env.VITE_ENABLE_QUICK_LOGIN,
    email: process.env.VITE_QUICK_LOGIN_EMAIL ?? env.VITE_QUICK_LOGIN_EMAIL,
    password: process.env.VITE_QUICK_LOGIN_PASSWORD ?? env.VITE_QUICK_LOGIN_PASSWORD,
  });

  return {
  base:
    process.env.NODE_ENV === "development"
      ? "/"
      : process.env.VITE_BASE_PATH || "/",
  define: {
    "import.meta.env.VITE_LOGIN_METHOD": JSON.stringify(loginMethod),
    ...(supabasePublic.url
      ? { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabasePublic.url) }
      : {}),
    ...(supabasePublic.anonKey
      ? { "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabasePublic.anonKey) }
      : {}),
    "import.meta.env.VITE_ENABLE_QUICK_LOGIN": JSON.stringify(quickLogin.enabled),
    "import.meta.env.VITE_QUICK_LOGIN_EMAIL": JSON.stringify(quickLogin.email),
    "import.meta.env.VITE_QUICK_LOGIN_PASSWORD": JSON.stringify(quickLogin.password),
  },
  optimizeDeps: {
    entries: ["./src/main.tsx", "./src/App.tsx"],
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-router-dom",
      "base64-js", // 強制轉換這個報錯的模組
      "pdfjs-dist", // 加回來，因為它需要 CommonJS 轉 ESM
      "@react-pdf/renderer", // 確保它被 Vite 處理，解決兼容性問題
      // Lazy views (AppShell 用 lazy() 動態 import) 不在 entries 的掃描範圍內，
      // 裡面的新依賴會在第一次開啟時才被發現 → Vite 重新最佳化 → 舊頁面拿到
      // 504 (Outdated Optimize Dep) → dynamic import 失敗 → ErrorBoundary 白畫面。
      // 這裡把 Radix UI 全部手動列入，讓依賴在啟動時就完成最佳化。
      "@radix-ui/react-accordion",
      "@radix-ui/react-aspect-ratio",
      "@radix-ui/react-avatar",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-hover-card",
      "@radix-ui/react-menubar",
      "@radix-ui/react-navigation-menu",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-slider",
      "@radix-ui/react-toggle",
      "@radix-ui/react-toggle-group",
    ],
    exclude: ["framer-motion"],
  },
  plugins: [
    react(),
    prdMtimePlugin(),
    versionJsonPlugin(appBuildId, { writePublic: command !== "serve" }),
  ],
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8080,
    // @ts-ignore
    allowedHosts: process.env.TEMPO === "true" ? true : undefined,
    host: process.env.TEMPO === "true" ? "0.0.0.0" : "127.0.0.1",
  },
};
});
