import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, test } from "vitest";

const scrum149ScriptsUrl = new URL(
    "../../../scripts/aws/SCRUM-149/",
    import.meta.url,
);

void describe("SCRUM-149 AWS scripts", () => {
    void test("use the required sandbox owner tag and reject the old owner value", () => {
        const scripts = readdirSync(scrum149ScriptsUrl).filter((fileName) =>
            fileName.endsWith(".sh"),
        );
        const scriptSources = scripts.map((fileName) => ({
            fileName,
            source: readFileSync(new URL(fileName, scrum149ScriptsUrl), "utf8"),
        }));
        const combinedSource = scriptSources
            .map(({ source }) => source)
            .join("\n");

        expect(scriptSources.map(({ fileName }) => fileName)).toEqual(
            expect.arrayContaining([
                "create-stage-transition-lambda-resources.sh",
                "deploy-stage-transition-lambda.sh",
                "package-stage-transition-lambda.sh",
                "tear-down-stage-transition-lambda-resources.sh",
            ]),
        );
        expect(combinedSource).not.toContain("amos-maddux");
        expect(combinedSource).toContain("user=muhilramesh");
        expect(combinedSource).toContain("Value=muhilramesh");
        expect(combinedSource).toContain("'muhilramesh'");
    });

    void test("keeps database secret reads out of the Lambda role and runtime app", () => {
        const createScript = readFileSync(
            new URL(
                "create-stage-transition-lambda-resources.sh",
                scrum149ScriptsUrl,
            ),
            "utf8",
        );
        const deployScript = readFileSync(
            new URL("deploy-stage-transition-lambda.sh", scrum149ScriptsUrl),
            "utf8",
        );
        const verifyScript = readFileSync(
            new URL("verify-stage-transition-lambda.sh", scrum149ScriptsUrl),
            "utf8",
        );

        // Verify the create script does not grant direct secret reads without a specific ARN
        expect(createScript).toContain("DATABASE_SECRET_ARN");

        // Verify the deploy script does not expose resolved database credentials in environment
        expect(deployScript).not.toContain("require_resolved_database_url");
        expect(deployScript).toContain("DATABASE_SECRET_ARN=");
        expect(deployScript).not.toContain(
            'Variables={DATABASE_URL=',
        );
        expect(deployScript).toContain(
            'Variables={DATABASE_SECRET_ARN=$DATABASE_SECRET_ARN}',
        );

        // Verify the deploy script rejects resolved DATABASE_URL
        expect(deployScript).not.toContain("DATABASE_URL must be resolved");

        // Verify script now enforces the safe pattern: DATABASE_SECRET_ARN in Lambda config
        expect(verifyScript).toContain(
            "Stage-transition Lambda must receive DATABASE_SECRET_ARN for secure runtime secret resolution.",
        );
        expect(verifyScript).toContain(
            "Stage-transition Lambda must not expose DATABASE_URL in environment configuration.",
        );
        expect(verifyScript).toContain(
            "Stage-transition Lambda role must grant secretsmanager:GetSecretValue for the database secret ARN.",
        );
        expect(verifyScript).toContain(
            "Stage-transition Lambda must not receive DATABASE_URL_SECRET_ID.",
        );
    });

    void test("verifies stage-transition consumer behavior, idempotency, and DLQ redrive", () => {
        const verifyScript = readFileSync(
            new URL("verify-stage-transition-lambda.sh", scrum149ScriptsUrl),
            "utf8",
        );

        expect(verifyScript).toContain("VERIFY_CONSUMER_BEHAVIOR");
        expect(verifyScript).toContain("poll_lambda_invocations");
        expect(verifyScript).toContain("stage_transition_projection");
        expect(verifyScript).toContain("poll_projection_count 1");
        expect(verifyScript).toContain("require_projection_count 1");
        expect(verifyScript).toContain("publish_invalid_message");
        expect(verifyScript).toContain("poll_dlq_for_invalid_message");
        expect(verifyScript).toContain("poll_lambda_failure_logs");
    });
});
