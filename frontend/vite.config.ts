import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700, // cytoscape is ~550kB on its own, isolated + on-demand
    rollupOptions: {
      output: {
        // Keep the Cytoscape stack in its own long-lived vendor chunk (heavy and
        // rarely changing) so app updates don't bust its cache.
        manualChunks: {
          cytoscape: ["cytoscape", "react-cytoscapejs", "cytoscape-dagre", "dagre"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
