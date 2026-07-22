import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createClient } from "redis";

import { loadIdempotencyConfig } from "../config/idempotencyConfig.js";
import {
    createIdempotencyStore,
    type IdempotencyStore,
} from "./idempotencyStore.js";

let store: IdempotencyStore | undefined;

/**
 * Builds the shared Redis and DynamoDB-backed idempotency store.
 */
export function getDefaultIdempotencyStore(): IdempotencyStore {
    if (store !== undefined) {
        return store;
    }

    const config = loadIdempotencyConfig();
    const dynamoDb = DynamoDBDocumentClient.from(
        new DynamoDBClient({
            ...(config.dynamoDbEndpoint === undefined
                ? {}
                : { endpoint: config.dynamoDbEndpoint }),
            region: config.dynamoDbRegion,
        }),
    );
    const redis = createClient({ url: config.redisUrl });

    store = createIdempotencyStore(dynamoDb, redis, config.dynamoDbTableName);

    return store;
}
