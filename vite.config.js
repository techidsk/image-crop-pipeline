import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
var gitInfo = function () {
    try {
        var count_1 = execSync("git rev-list --count HEAD").toString().trim();
        var hash_1 = execSync("git rev-parse --short HEAD").toString().trim();
        return { count: count_1, hash: hash_1 };
    }
    catch (_a) {
        return { count: "0", hash: "dev" };
    }
};
var _a = gitInfo(), count = _a.count, hash = _a.hash;
export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify("v".concat(count)),
        __APP_COMMIT__: JSON.stringify(hash)
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src")
        }
    },
    server: {
        port: 5174,
        strictPort: true,
        proxy: {
            "/api": "http://127.0.0.1:8000"
        }
    }
});
