import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const tempoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const { tempoVitePlugin } = await import("tempo-sdk");

  return {
    root: tempoRoot,
    plugins: [
      tailwindcss(),
      tempoVitePlugin(),
      react(),
      tsconfigPaths({
        projectDiscovery: "lazy",
      }),
    ],
  server: {
    fs: {
      allow: [".."],
    },
  },
  };
});
