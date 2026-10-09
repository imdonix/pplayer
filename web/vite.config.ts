import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "pplayer",
        short_name: "pplayer",
        description: "Personal podcast player and YouTube downloader",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell: scripts, styles and icons are precached, but *not* the
        // HTML. Navigations are network-first, so a plain refresh always picks
        // up a newly deployed index.html; the last loaded copy is what keeps
        // the app working offline. (Navigations must not be bound to a
        // precached index.html: that serves old HTML before the network on
        // every load, so refreshes kept showing the previous version.)
        navigateFallback: undefined,
        globPatterns: ["**/*.{js,css,svg,png,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "pplayer-pages",
              networkTimeoutSeconds: 4,
            },
          },
          {
            // Cache thumbnails so the library looks right offline.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/thumbnails/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "pplayer-thumbnails",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
})
