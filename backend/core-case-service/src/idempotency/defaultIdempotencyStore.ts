import { createRequire } from "node:module";
import type { createClient as createRedisClient } from "redis";

import { loadIdempotencyConfig } from "../config/idempotencyConfig.js";
import {
    createInMemoryIdempotencyStore,
    createRedisIdempotencyStore,
    type IdempotencyStore,
} from "./idempotencyStore.js";

const memoryStore = createInMemoryIdempotencyStore();
const require = createRequire(import.meta.url);
let store: IdempotencyStore | undefined;

/**
 * Builds the shared Redis-backed idempotency store.
 */
export function getDefaultIdempotencyStore(): IdempotencyStore {
    if (store !== undefined) {
        return store;
    }

    const config = loadIdempotencyConfig();
    if (config.storeBackend === "memory") {
        store = memoryStore;
        return store;
    }

    const { createClient } = require("redis") as {
        createClient: typeof createRedisClient;
    };
    store = createRedisIdempotencyStore(createClient({ url: config.redisUrl }));
    return store;
}

/**
 * Clears local idempotency state between tests.
 */
export function resetDefaultIdempotencyStoreForTests(): void {
    store = undefined;
    memoryStore.clear();
}
