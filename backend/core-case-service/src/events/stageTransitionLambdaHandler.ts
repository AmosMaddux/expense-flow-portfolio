import { z } from "zod";

import { verifyLambdaDatabaseUrlEnvironment } from "../config/lambdaDatabaseConfig.js";

const sqsLambdaRecordSchema = z.object({
    body: z.string().trim().min(1),
    messageId: z.string().trim().min(1),
});

const sqsLambdaEventSchema = z.object({
    Records: z.array(sqsLambdaRecordSchema),
});

export type StageTransitionLambdaEvent = z.infer<typeof sqsLambdaEventSchema>;

export type StageTransitionLambdaBatchResponse = {
    batchItemFailures: Array<{
        itemIdentifier: string;
    }>;
};

export type StageTransitionLambdaLogger = {
    recordFailed(): void;
};

export type StageTransitionLambdaHandlerDependencies = {
    verifyDatabaseUrl?: () => Promise<void> | void;
    logger?: StageTransitionLambdaLogger;
    processEventBody?: (body: string) => Promise<unknown>;
};

const defaultLogger: StageTransitionLambdaLogger = {
    recordFailed() {
        // Event payloads and identifiers are intentionally excluded from logs.
        console.error(
            "A stage-transition Lambda SQS record failed and remains available for retry.",
        );
    },
};

/**
 * Creates an SQS-triggered Lambda handler for stage-transition projection events.
 */
export function createStageTransitionLambdaHandler(
    dependencies: StageTransitionLambdaHandlerDependencies = {},
): (event: unknown) => Promise<StageTransitionLambdaBatchResponse> {
    return async (
        event: unknown,
    ): Promise<StageTransitionLambdaBatchResponse> => {
        const parsedEvent = sqsLambdaEventSchema.parse(event);
        const logger = dependencies.logger ?? defaultLogger;
        const batchItemFailures: StageTransitionLambdaBatchResponse["batchItemFailures"] =
            [];

        for (const record of parsedEvent.Records) {
            try {
                await processStageTransitionRecord(record.body, dependencies);
            } catch {
                logger.recordFailed();
                batchItemFailures.push({ itemIdentifier: record.messageId });
            }
        }

        return { batchItemFailures };
    };
}

/**
 * Handles an SQS-triggered Lambda batch of stage-transition projection events.
 */
export const handler = createStageTransitionLambdaHandler();

async function processStageTransitionRecord(
    body: string,
    dependencies: StageTransitionLambdaHandlerDependencies,
): Promise<void> {
    if (dependencies.processEventBody !== undefined) {
        await dependencies.processEventBody(body);
        return;
    }

    const verificationResult = (
        dependencies.verifyDatabaseUrl ?? verifyLambdaDatabaseUrlEnvironment
    )();
    if (verificationResult instanceof Promise) {
        await verificationResult;
    }
    const { processStageTransitionEventBody } =
        await import("./stageTransitionEventProcessor.js");
    await processStageTransitionEventBody(body);
}
