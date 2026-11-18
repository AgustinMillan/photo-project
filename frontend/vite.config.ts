import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API is proxied so the browser sees a single origin. The Host
// header is preserved (changeOrigin: false) because storefronts are resolved from
// the hostname, e.g. http://mi-estudio.localhost:5173.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:3000",
        changeOrigin: false,
      },
    },
  },
});
