import { createHmac, createHash } from "node:crypto";

import { loadStageTransitionEventsConfig } from "../config/stageTransitionEventsConfig.js";
import type { ExpenseReportStageTransitionedEvent } from "./expenseReportStageTransitioned.v1.js";

export type StageTransitionEventPublisher = {
    publish(event: ExpenseReportStageTransitionedEvent): Promise<void>;
};

/**
 * Creates a publisher that sends stage-transition events to an SNS-compatible endpoint.
 */
export function createSnsStageTransitionEventPublisher(
    fetchImplementation: typeof fetch = fetch,
): StageTransitionEventPublisher {
    return {
        async publish(event: ExpenseReportStageTransitionedEvent) {
            const config = loadStageTransitionEventsConfig();
            const endpoint =
                config.STAGE_TRANSITION_SNS_ENDPOINT ??
                buildSnsEndpointFromTopicArn(
                    config.STAGE_TRANSITION_SNS_TOPIC_ARN,
                );
            const body = JSON.stringify({
                TopicArn: config.STAGE_TRANSITION_SNS_TOPIC_ARN,
                Message: JSON.stringify(event),
                MessageAttributes: {
                    eventType: {
                        DataType: "String",
                        StringValue: event.type,
                    },
                    tenantId: {
                        DataType: "String",
                        StringValue: event.data.tenantId,
                    },
                    caseId: {
                        DataType: "String",
                        StringValue: event.data.caseId,
                    },
                    correlationId: {
                        DataType: "String",
                        StringValue: event.data.correlationId,
                    },
                },
            });

            const response = await fetchImplementation(endpoint, {
                method: "POST",
                headers: {
                    "content-type": "application/x-amz-json-1.0",
                    "x-amz-target": "SNS.Publish",
                    ...buildAwsSigV4Headers(body, endpoint),
                },
                body,
            });

            if (!response.ok) {
                throw new Error(
                    `SNS publish failed with status ${response.status}.`,
                );
            }
        },
    };
}

function buildSnsEndpointFromTopicArn(topicArn: string): string {
    const [, , service, region] = topicArn.split(":");

    if (service !== "sns" || region === undefined || region.length === 0) {
        throw new Error("Invalid SNS topic ARN for stage-transition events.");
    }

    return `https://sns.${region}.amazonaws.com/`;
}

function buildAwsSigV4Headers(
    body: string,
    endpoint: string,
): Record<string, string> {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;
    const region = new URL(endpoint).hostname.split(".")[1];

    if (
        accessKeyId === undefined ||
        secretAccessKey === undefined ||
        region === undefined
    ) {
        return {};
    }

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
    const dateStamp = amzDate.slice(0, 8);
    const signedHeaderValues = {
        "content-type": "application/x-amz-json-1.0",
        host: new URL(endpoint).host,
        "x-amz-date": amzDate,
        ...(sessionToken === undefined
            ? {}
            : { "x-amz-security-token": sessionToken }),
        "x-amz-target": "SNS.Publish",
    };
    const signedHeaderNames = Object.keys(signedHeaderValues).sort();
    const canonicalHeaders = signedHeaderNames
        .map(
            (headerName) =>
                `${headerName}:${signedHeaderValues[headerName as keyof typeof signedHeaderValues]}`,
        )
        .join("\n")
        .concat("\n");
    const signedHeaders = signedHeaderNames.join(";");
    const payloadHash = sha256Hex(body);
    const canonicalRequest = [
        "POST",
        "/",
        "",
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/sns/aws4_request`;
    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = getSignatureKey(secretAccessKey, dateStamp, region);
    const signature = hmacHex(signingKey, stringToSign);

    return {
        "x-amz-date": amzDate,
        ...(sessionToken === undefined
            ? {}
            : { "x-amz-security-token": sessionToken }),
        authorization: [
            `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
            `SignedHeaders=${signedHeaders}`,
            `Signature=${signature}`,
        ].join(", "),
    };
}

function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
    return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string): string {
    return createHmac("sha256", key).update(value).digest("hex");
}

function getSignatureKey(
    secretAccessKey: string,
    dateStamp: string,
    regionName: string,
): Buffer {
    const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = hmac(dateKey, regionName);
    const dateRegionServiceKey = hmac(dateRegionKey, "sns");

    return hmac(dateRegionServiceKey, "aws4_request");
}
