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

        expect(createScript).not.toContain("secretsmanager:GetSecretValue");
        expect(deployScript).not.toContain("{{resolve:secretsmanager:");
        expect(deployScript).toContain("DATABASE_URL=");
        expect(deployScript).toContain("require_resolved_database_url");
        expect(deployScript).toContain(
            "DATABASE_URL must be resolved before deployment",
        );
        expect(deployScript).not.toContain("DATABASE_URL_SECRET_ID");
        expect(deployScript).not.toContain("DATABASE_URL_SECRET_JSON_KEY");
        expect(deployScript).not.toContain(
            "Variables={AWS_REGION=$AWS_REGION,DATABASE_URL_SECRET_ID=",
        );
        expect(verifyScript).toContain(
            "Stage-transition Lambda role must not grant direct database secret reads.",
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
