import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, "../..", "");
    const apiBaseUrl = env.VITE_API_BASE_URL ?? "http://127.0.0.1:3301";

    return {
        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (!id.includes("node_modules")) {
                            return undefined;
                        }

                        if (
                            id.includes("/react/") ||
                            id.includes("/react-dom/")
                        ) {
                            return "vendor-react";
                        }

                        if (id.includes("/@tanstack/")) {
                            return "vendor-tanstack";
                        }

                        if (id.includes("/chart.js/")) {
                            return "vendor-charts";
                        }

                        return undefined;
                    },
                },
            },
        },
        define:
            command === "serve"
                ? { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") }
                : undefined,
        envDir: "../..",
        plugins: [react()],
        server: {
            proxy: {
                "/v1": {
                    changeOrigin: true,
                    target: apiBaseUrl,
                },
            },
        },
    };
});
