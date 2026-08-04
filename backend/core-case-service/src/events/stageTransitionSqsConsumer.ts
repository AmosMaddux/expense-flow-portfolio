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

export type StageTransitionPollFailureCategory =
    "receive_failed" | "request_validation_failed";

export type StageTransitionConsumerLogger = {
    messageFailed(): void;
    pollFailed(category: StageTransitionPollFailureCategory): void;
};

export type StageTransitionSqsConsumerDependencies = {
    logger?: StageTransitionConsumerLogger;
    waitForRetry?: (
        delayMilliseconds: number,
        signal: AbortSignal,
    ) => Promise<void>;
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
    pollFailed(category) {
        console.error(
            `Stage-transition SQS poll failed (${category}); the consumer will retry.`,
        );
    },
};

const initialRetryDelayMilliseconds = 1_000;
const maximumRetryDelayMilliseconds = 30_000;

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
    const logger = dependencies.logger ?? defaultLogger;
    const waitForRetry = dependencies.waitForRetry ?? waitForRetryDelay;
    let consecutiveFailureCount = 0;

    while (!signal.aborted) {
        try {
            await pollStageTransitionQueueOnce(client, config, dependencies);
            consecutiveFailureCount = 0;
        } catch (error: unknown) {
            if (signal.aborted) {
                return;
            }

            consecutiveFailureCount += 1;
            logger.pollFailed(categorizePollFailure(error));
            await waitForRetry(
                calculateRetryDelayMilliseconds(consecutiveFailureCount),
                signal,
            );
        }
    }
}

function categorizePollFailure(
    error: unknown,
): StageTransitionPollFailureCategory {
    return error instanceof z.ZodError
        ? "request_validation_failed"
        : "receive_failed";
}

function calculateRetryDelayMilliseconds(
    consecutiveFailureCount: number,
): number {
    return Math.min(
        initialRetryDelayMilliseconds *
            2 ** Math.max(0, consecutiveFailureCount - 1),
        maximumRetryDelayMilliseconds,
    );
}

async function waitForRetryDelay(
    delayMilliseconds: number,
    signal: AbortSignal,
): Promise<void> {
    if (signal.aborted) {
        return;
    }

    await new Promise<void>((resolve) => {
        const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        };
        const timer = setTimeout(finish, delayMilliseconds);
        signal.addEventListener("abort", finish, { once: true });
    });
}
