import { env } from "node:process";

import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "postgresql",
    schema: "./src/db/schema/index.ts",
    out: "./drizzle",
    dbCredentials: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        url: env.DATABASE_URL ?? "",
    },
});
