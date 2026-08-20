import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { loadDatabaseConfig } from "../config/databaseConfig.js";

import * as schema from "./schema/index.js";

const pool = new Pool({
    connectionString: loadDatabaseConfig().connectionString,
});

export const db = drizzle(pool, { schema });
