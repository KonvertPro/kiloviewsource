import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/health": {
        target: "https://10.0.20.35:9980",
        changeOrigin: true,
        secure: false,
      },
      "/kiloview": {
        target: "https://10.0.20.35:9980",
        changeOrigin: true,
        secure: false,
      },
      "/api": {
        target: "https://10.0.20.35:9980",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
