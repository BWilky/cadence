import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works under HA ingress (/api/hassio_ingress/<token>/) and on the
// external port (/). The backend injects <base href> at request time.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8199", ws: true } },
  },
});
