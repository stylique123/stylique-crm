import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const manualChunkMap: Record<string, string[]> = {
  react: ["react", "react-dom", "react-router-dom"],
  query: ["@tanstack/react-query"],
  ui: [
    "@radix-ui/react-dialog",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-select",
    "@radix-ui/react-tabs",
    "@radix-ui/react-tooltip",
  ],
  charts: ["recharts"],
};

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: "./",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [chunkName, packages] of Object.entries(manualChunkMap)) {
            if (packages.some(pkg => id.includes(`/node_modules/${pkg}/`))) return chunkName;
          }
        },
      },
    },
  },
}));
