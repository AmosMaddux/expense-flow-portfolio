import { z } from "zod";

import { PolicyEmbeddingServiceError } from "./policyEmbeddingErrors.js";

export const CreatePolicyEmbeddingsRequestSchema = z
    .object({
        input: z.array(z.string().trim().min(1)).min(1).max(256),
        model: z.string().min(1),
        dimensions: z.number().int().positive(),
    })
    .strict();

export type CreatePolicyEmbeddingsRequest = z.infer<
    typeof CreatePolicyEmbeddingsRequestSchema
>;

const embeddingsResponseSchema = z.object({
    data: z
        .array(
            z.object({
                index: z.number().int().nonnegative(),
                embedding: z.array(z.number()).min(1),
            }),
        )
        .min(1),
    model: z.string().min(1),
});

export type PolicyEmbeddingResult = {
    embeddings: number[][];
    model: string;
};

export type PolicyEmbeddingClientOptions = {
    apiKey: string;
    baseUrl: string;
    baseBackoffMs?: number;
    delayImplementation?: (milliseconds: number) => Promise<void>;
    fetchImplementation?: typeof fetch;
    maxBackoffMs?: number;
    maxRetries?: number;
    random?: () => number;
    signal?: AbortSignal;
    timeoutMs?: number;
};

/**
 * Creates OpenAI embeddings for policy text, one vector per input in order.
 */
export async function createPolicyEmbeddings(
    request: CreatePolicyEmbeddingsRequest,
    options: PolicyEmbeddingClientOptions,
): Promise<PolicyEmbeddingResult> {
    const parsedRequest = CreatePolicyEmbeddingsRequestSchema.parse(request);
    const endpoint = `${options.baseUrl.replace(/\/$/, "")}/embeddings`;
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const maxRetries = options.maxRetries ?? 0;
    const delay = options.delayImplementation ?? defaultDelay;
    const random = options.random ?? Math.random;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
        const signal = options.signal
            ? AbortSignal.any([options.signal, timeoutSignal])
            : timeoutSignal;

        let response: Response;
        try {
            response = await fetchImplementation(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${options.apiKey}`,
                },
                body: JSON.stringify(parsedRequest),
                signal,
            });
        } catch (error: unknown) {
            if (attempt < maxRetries && options.signal?.aborted !== true) {
                await delay(calculateRetryDelay(attempt, options, random));
                continue;
            }

            if (timeoutSignal.aborted) {
                throw new PolicyEmbeddingServiceError(
                    "The policy embedding request timed out.",
                    undefined,
                    { cause: error },
                );
            }

            throw new PolicyEmbeddingServiceError(
                signal.aborted
                    ? "The policy embedding request was cancelled."
                    : "The policy embedding provider could not be reached.",
                undefined,
                { cause: error },
            );
        }

        if (!response.ok) {
            if (attempt < maxRetries && isRetryableStatus(response.status)) {
                await delay(calculateRetryDelay(attempt, options, random));
                continue;
            }

            // The provider echoes request text in error bodies, so only the
            // status code is surfaced to avoid leaking tenant policy content.
            throw new PolicyEmbeddingServiceError(
                "The policy embedding provider rejected the request.",
                response.status,
            );
        }

        let parsedResponse: z.infer<typeof embeddingsResponseSchema>;
        try {
            const responseBody: unknown = await response.json();
            parsedResponse = embeddingsResponseSchema.parse(responseBody);
        } catch (error: unknown) {
            throw new PolicyEmbeddingServiceError(
                timeoutSignal.aborted
                    ? "The policy embedding request timed out."
                    : "The policy embedding provider returned an invalid response.",
                response.status,
                { cause: error },
            );
        }

        return {
            embeddings: orderEmbeddings(parsedRequest, parsedResponse),
            model: parsedResponse.model,
        };
    }

    throw new PolicyEmbeddingServiceError(
        "The policy embedding request failed.",
    );
}

function orderEmbeddings(
    request: CreatePolicyEmbeddingsRequest,
    response: z.infer<typeof embeddingsResponseSchema>,
): number[][] {
    if (response.data.length !== request.input.length) {
        throw new PolicyEmbeddingServiceError(
            "The policy embedding provider returned a different number of vectors than requested.",
        );
    }

    const embeddings: number[][] = [];
    // The provider documents results as index-addressed rather than ordered,
    // so vectors are realigned with their source chunk before persistence.
    for (let index = 0; index < request.input.length; index += 1) {
        const entry = response.data.find((item) => item.index === index);
        if (entry === undefined) {
            throw new PolicyEmbeddingServiceError(
                "The policy embedding provider omitted a requested vector.",
            );
        }
        if (entry.embedding.length !== request.dimensions) {
            throw new PolicyEmbeddingServiceError(
                `The policy embedding provider returned ${String(entry.embedding.length)} dimensions instead of ${String(request.dimensions)}.`,
            );
        }
        embeddings.push(entry.embedding);
    }

    return embeddings;
}

function isRetryableStatus(statusCode: number): boolean {
    return statusCode === 429 || statusCode >= 500;
}

function calculateRetryDelay(
    attempt: number,
    options: PolicyEmbeddingClientOptions,
    random: () => number,
): number {
    const baseBackoffMs = options.baseBackoffMs ?? 200;
    const maxBackoffMs = options.maxBackoffMs ?? 2_000;
    const exponentialDelay = Math.min(
        maxBackoffMs,
        baseBackoffMs * 2 ** attempt,
    );

    return Math.floor(exponentialDelay / 2 + random() * (exponentialDelay / 2));
}

async function defaultDelay(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
