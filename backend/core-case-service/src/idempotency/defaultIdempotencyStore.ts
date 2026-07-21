import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createClient } from "redis";

import { loadIdempotencyConfig } from "../config/idempotencyConfig.js";
import {
    createIdempotencyStore,
    createInMemoryIdempotencyStore,
    type IdempotencyStore,
} from "./idempotencyStore.js";

const memoryStore = createInMemoryIdempotencyStore();
let defaultStore: IdempotencyStore | undefined;

/**
 * Returns the configured tenant-scoped idempotency store.
 */
export function getDefaultIdempotencyStore(): IdempotencyStore {
    defaultStore ??= createDefaultIdempotencyStore();
    return defaultStore;
}

/**
 * Clears local idempotency state between tests.
 */
export function resetDefaultIdempotencyStoreForTests(): void {
    defaultStore = undefined;
    memoryStore.clear();
}

function createDefaultIdempotencyStore(): IdempotencyStore {
    const config = loadIdempotencyConfig();

    if (config.storeBackend !== "dynamodb") {
        return memoryStore;
    }

    const dynamoDbClient = new DynamoDBClient({
        ...(config.dynamoDbEndpoint === undefined
            ? {}
            : { endpoint: config.dynamoDbEndpoint }),
        region: config.dynamoDbRegion,
    });
    const redis = createClient({ url: config.redisUrl });

    return createIdempotencyStore(
        DynamoDBDocumentClient.from(dynamoDbClient),
        redis,
        config.dynamoDbTableName,
    );
}
