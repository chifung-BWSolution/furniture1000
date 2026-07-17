import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";

const appBuildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.VITE_APP_BUILD_ID ||
  `dev-${Date.now()}`;

/** Emit public/version.json so clients can detect redeploys without forced reload. */
function versionJsonPlugin(buildId: string): Plugin {
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
      write(path.resolve(__dirname, "public"));
    },
    closeBundle() {
      write(path.resolve(__dirname, "dist"));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base:
    process.env.NODE_ENV === "development"
      ? "/"
      : process.env.VITE_BASE_PATH || "/",
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
  plugins: [react(), versionJsonPlugin(appBuildId)],
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // @ts-ignore
    allowedHosts: process.env.TEMPO === "true" ? true : undefined,
    host: process.env.TEMPO === "true" ? "0.0.0.0" : undefined,
  },
});
