import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "postgresql",
    schema: "./backend/core-case-service/src/db/schema/index.ts",
    out: "./backend/core-case-service/drizzle",
});
