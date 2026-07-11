import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    // Tauri ships a modern webview (WebView2 / WKWebView / WebKitGTK), so we
    // can target modern engines and skip legacy transpilation.
    target: ["es2022", "chrome110", "safari15"],
    minify: "esbuild",
    // Split the monolithic bundle into cacheable vendor chunks so the initial
    // (Join) screen doesn't have to parse the whole livekit stack up front.
    // A function (not an object map) is used so react-dom/scheduler and every
    // @livekit/* sub-package are reliably grouped by their resolved path —
    // the object form silently left react-dom in the entry chunk.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // livekit-client + @livekit/* — heavy, and only reachable from the
          // (lazily loaded) RoomPage, so this whole chunk stays off the
          // startup path.
          if (id.includes("livekit")) return "livekit";
          // React runtime — needed at startup but rarely changes, so keep it
          // in its own long-lived cacheable chunk.
          if (
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    // Gzip-size reporting scans every chunk; skip it — Tauri loads from local
    // disk, so compressed transfer size is irrelevant and this speeds builds.
    reportCompressedSize: false,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
