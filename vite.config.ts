import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // the release this bundle was built from (Render sets RENDER_GIT_COMMIT during the build), so an open copy of the app
  // can tell it's out of date even if it never saw the old version on the server (lib/update.tsx)
  define: { __BUILD_ID__: JSON.stringify(String(process.env.RENDER_GIT_COMMIT || "").slice(0, 12)) },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
