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
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabasePublic.url),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabasePublic.anonKey),
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
    ],
    exclude: ["framer-motion"],
  },
  plugins: [react(), versionJsonPlugin(appBuildId, { writePublic: command !== "serve" })],
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
    host: process.env.TEMPO === "true" ? "0.0.0.0" : undefined,
  },
};
});
