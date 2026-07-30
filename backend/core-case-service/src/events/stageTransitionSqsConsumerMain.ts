import { SQSClient } from "@aws-sdk/client-sqs";

import { loadStageTransitionConsumerConfig } from "../config/stageTransitionConsumerConfig.js";
import { applyPendingCoreCaseMigrations } from "../db/migrations.js";
import { runStageTransitionSqsConsumer } from "./stageTransitionSqsConsumer.js";

/**
 * Starts the standalone stage-transition SQS projection consumer.
 */
export async function startStageTransitionSqsConsumer(): Promise<void> {
    if (process.env.AUTO_APPLY_MIGRATIONS === "true") {
        await applyPendingCoreCaseMigrations();
    }

    const config = loadStageTransitionConsumerConfig();
    const client = new SQSClient({
        ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
        region: config.region,
    });
    const shutdownController = new AbortController();
    const requestShutdown = () => {
        shutdownController.abort();
    };

    process.once("SIGINT", requestShutdown);
    process.once("SIGTERM", requestShutdown);

    try {
        await runStageTransitionSqsConsumer(
            client,
            config,
            shutdownController.signal,
        );
    } finally {
        process.off("SIGINT", requestShutdown);
        process.off("SIGTERM", requestShutdown);
        client.destroy();
    }
}

startStageTransitionSqsConsumer().catch(() => {
    console.error("Stage-transition SQS consumer stopped unexpectedly.");
    process.exit(1);
});
