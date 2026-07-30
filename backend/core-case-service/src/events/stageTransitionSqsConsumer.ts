import {
    DeleteMessageCommand,
    ReceiveMessageCommand,
    SQSClient,
} from "@aws-sdk/client-sqs";
import { z } from "zod";

import type { StageTransitionConsumerConfig } from "../config/stageTransitionConsumerConfig.js";
import { processStageTransitionEventBody } from "./stageTransitionEventProcessor.js";
import {
    defaultStageTransitionProjectionStore,
    type StageTransitionProjectionStore,
} from "./stageTransitionProjectionRepository.js";

const sqsStageTransitionMessageSchema = z.object({
    Body: z.string().trim().min(1),
    ReceiptHandle: z.string().trim().min(1),
});

const receiveStageTransitionMessagesRequestSchema = z
    .object({
        MaxNumberOfMessages: z.literal(10),
        MessageAttributeNames: z.tuple([z.literal("All")]),
        MessageSystemAttributeNames: z.tuple([
            z.literal("ApproximateReceiveCount"),
        ]),
        QueueUrl: z.url(),
        WaitTimeSeconds: z.literal(20),
    })
    .strict();

const deleteStageTransitionMessageRequestSchema = z
    .object({
        QueueUrl: z.url(),
        ReceiptHandle: z.string().trim().min(1),
    })
    .strict();

type SqsCommandClient = Pick<SQSClient, "send">;

export type StageTransitionConsumerLogger = {
    messageFailed(): void;
};

export type StageTransitionSqsConsumerDependencies = {
    logger?: StageTransitionConsumerLogger;
    store?: StageTransitionProjectionStore;
};

export type StageTransitionSqsPollResult = {
    failed: number;
    processed: number;
};

const defaultLogger: StageTransitionConsumerLogger = {
    messageFailed() {
        // Event payloads and identifiers are intentionally excluded from logs.
        console.error(
            "A stage-transition SQS message failed and remains available for retry.",
        );
    },
};

/**
 * Receives and processes one long-poll batch from the stage-transition queue.
 */
export async function pollStageTransitionQueueOnce(
    client: SqsCommandClient,
    config: StageTransitionConsumerConfig,
    dependencies: StageTransitionSqsConsumerDependencies = {},
): Promise<StageTransitionSqsPollResult> {
    const response = await client.send(
        new ReceiveMessageCommand(
            receiveStageTransitionMessagesRequestSchema.parse({
                MaxNumberOfMessages: 10,
                MessageAttributeNames: ["All"],
                MessageSystemAttributeNames: ["ApproximateReceiveCount"],
                QueueUrl: config.queueUrl,
                WaitTimeSeconds: 20,
            }),
        ),
    );
    const logger = dependencies.logger ?? defaultLogger;
    const store = dependencies.store ?? defaultStageTransitionProjectionStore;
    let failed = 0;
    let processed = 0;

    for (const rawMessage of response.Messages ?? []) {
        try {
            const message = sqsStageTransitionMessageSchema.parse(rawMessage);
            await processStageTransitionEventBody(message.Body, store);
            await client.send(
                new DeleteMessageCommand(
                    deleteStageTransitionMessageRequestSchema.parse({
                        QueueUrl: config.queueUrl,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                ),
            );
            processed += 1;
        } catch {
            failed += 1;
            logger.messageFailed();
        }
    }

    return { failed, processed };
}

/**
 * Runs the plain long-poll SQS consumer until shutdown is requested.
 *
 * Sprint 5 replaces this polling shell with Lambda while retaining the event processor.
 */
export async function runStageTransitionSqsConsumer(
    client: SqsCommandClient,
    config: StageTransitionConsumerConfig,
    signal: AbortSignal,
    dependencies: StageTransitionSqsConsumerDependencies = {},
): Promise<void> {
    while (!signal.aborted) {
        await pollStageTransitionQueueOnce(client, config, dependencies);
    }
}
