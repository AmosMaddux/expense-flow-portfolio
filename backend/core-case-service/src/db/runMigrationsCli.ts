import { fileURLToPath } from "node:url";

import { applyPendingCoreCaseMigrations } from "./migrations.js";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void applyPendingCoreCaseMigrations()
        .then(() => {
            process.stdout.write("Migrations applied.\n");
        })
        .catch((error: unknown) => {
            process.stderr.write(
                `Failed to apply migrations: ${String(error)}\n`,
            );
            process.exitCode = 1;
        });
}
