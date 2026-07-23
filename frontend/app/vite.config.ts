import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
    define:
        command === "serve"
            ? { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") }
            : undefined,
    envDir: "../..",
    plugins: [react()],
    server: {
        proxy: {
            "/v1": "http://127.0.0.1:3301",
        },
    },
}));
