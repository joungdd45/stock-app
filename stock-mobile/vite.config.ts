import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],

  server: {
    host: "0.0.0.0",
    port: 5174,
    allowedHosts: [
      "pseudoallegoristic-sina-nonremedial.ngrok-free.dev",
    ],

    // 🔹 여기 추가
    proxy: {
      "/api": {
        target: "http://192.168.45.139:8000", // 또는 http://localhost:8000
        changeOrigin: true,
      },
    },
  },
});
