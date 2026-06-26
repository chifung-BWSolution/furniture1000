import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

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
    ],
    exclude: ["framer-motion", "pdfjs-dist", "@react-pdf/renderer", "xlsx"],
  },
  plugins: [react()],
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@react-pdf/renderer")) {
            return "vendor-react-pdf-renderer";
          }
          if (id.includes("@react-pdf/")) {
            const parts = id.split("node_modules/")[1]?.split(/[\\/]/).filter(Boolean) ?? [];
            return `vendor-${(parts[0] ?? "react-pdf").slice(1)}-${parts[1] ?? "core"}`;
          }
          if (id.includes("pdfkit")) {
            return "vendor-pdfkit";
          }
          if (id.includes("fontkit") || id.includes("restructure") || id.includes("brotli")) {
            return "vendor-fontkit";
          }
          if (id.includes("pdfjs-dist")) {
            return "vendor-pdfjs";
          }
          if (id.includes("xlsx") || id.includes("jszip")) {
            return "vendor-xlsx";
          }
          if (id.includes("recharts") || id.includes("d3-")) {
            return "vendor-charts";
          }
          if (id.includes("@supabase")) {
            return "vendor-supabase";
          }
          if (id.includes("@tiptap") || id.includes("prosemirror")) {
            return "vendor-editor";
          }
          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }
          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }
          if (
            id.includes("react") ||
            id.includes("react-dom") ||
            id.includes("react-router")
          ) {
            return "vendor-react";
          }
          const parts = id.split("node_modules/")[1]?.split(/[\\/]/).filter(Boolean) ?? [];
          const packageName = parts[0]?.startsWith("@")
            ? `${parts[0].slice(1)}-${parts[1] ?? "pkg"}`
            : parts[0] ?? "misc";
          if (
            ["babel-runtime", "detect-node-es", "dom-helpers", "is-url"].includes(packageName)
          ) {
            return undefined;
          }
          return `vendor-${packageName.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        },
      },
    },
  },
});
