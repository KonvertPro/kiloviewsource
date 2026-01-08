import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/health": {
        target: "http://10.0.30.55:9980",
        changeOrigin: true,
        secure: false,
      },
      "/kiloview": {
        target: "http://10.0.30.55:9980",
        changeOrigin: true,
        secure: false,
      },
      "/api": {
        target: "http://10.0.30.55:9980",
        changeOrigin: true,
        secure: false,
      },
      "/td": {
        target: "http://10.0.30.55:9980",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
