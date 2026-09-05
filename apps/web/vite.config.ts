/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt"],
      manifest: {
        name: "Thi Thử",
        short_name: "Thi Thử",
        description: "Ôn luyện & thi thử offline-first với tài khoản đồng bộ nhiều thiết bị",
        theme_color: "#111827",
        background_color: "#f3f4f6",
        display: "standalone",
        start_url: "/",
        id: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      workbox: {
        cacheId: "exam-platform-v8",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Only the app shell is precached. API routes are explicitly denied
        // from navigation fallback and no API runtime cache is configured.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,woff2,png}"]
      }
    })
  ],
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version) },
  server: { proxy: { "/api": "http://localhost:3000" } },
  // `vite preview` (used by Playwright e2e) needs the same proxy so the
  // production-like preview build can reach the API without CORS.
  preview: { proxy: { "/api": "http://localhost:3000" } },
  resolve: { alias: { "@": "/src" } },
  test: { environment: "node", setupFiles: ["./src/test/setup.ts"], globals: false, fileParallelism: false }
});
