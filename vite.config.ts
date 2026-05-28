import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const gitInfo = () => {
  try {
    const count = execSync("git rev-list --count HEAD").toString().trim();
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    return { count, hash };
  } catch {
    return { count: "0", hash: "dev" };
  }
};

const { count, hash } = gitInfo();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`v${count}`),
    __APP_COMMIT__: JSON.stringify(hash)
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 7171,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8000"
    }
  }
});
