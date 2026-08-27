#!/usr/bin/env node
import {
    cpSync,
    existsSync,
    mkdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

const serviceName = "core-case-service";
const inputRoot = path.resolve(
    process.env.EVIDENCE_PACKET_INPUT_ROOT ??
        ".evidence-packet-input/core-case-service",
);
const outputRoot = path.resolve(
    process.env.EVIDENCE_PACKET_OUTPUT_ROOT ??
        ".evidence-packet/core-case-service",
);

const requiredArtifacts = [
    {
        path: "test-output/typescript-vitest.txt",
        gate: "typescript-vitest-tests",
        description: "Vitest test and coverage command output",
    },
    {
        path: "test-output/python-pytest.txt",
        gate: "python-pytest-tests",
        description: "Pytest test and coverage command output",
    },
    {
        path: "coverage/typescript",
        gate: "typescript-vitest-tests",
        description: "V8 coverage report for Core Case TypeScript sources",
    },
    {
        path: "coverage/python",
        gate: "python-pytest-tests",
        description: "Coverage report for Python tests run with pytest-cov",
    },
    {
        path: "security/semgrep-report.json",
        gate: "semgrep-source-sast",
        description: "Semgrep high-severity TypeScript SAST report",
    },
    {
        path: "security/bandit-report.json",
        gate: "bandit-python-sast",
        description: "Bandit high-severity Python SAST report",
    },
    {
        path: "security/trivy-report.json",
        gate: "trivy-image-vulnerability-scan",
        description: "Trivy critical vulnerability report for the built image",
    },
    {
        path: "security/sbom.cdx.json",
        gate: "syft-sbom",
        description: "Syft CycloneDX SBOM for the built image",
    },
    {
        path: "signing/cosign-sign-image.txt",
        gate: "cosign-image-signature",
        description: "Cosign image signing command output",
    },
    {
        path: "signing/cosign-attest-sbom.txt",
        gate: "cosign-sbom-attestation",
        description: "Cosign SBOM attestation command output",
    },
    {
        path: "signing/cosign-verify-image.txt",
        gate: "cosign-image-verification",
        description: "Cosign image signature verification output",
    },
    {
        path: "signing/cosign-verify-attestation.txt",
        gate: "cosign-attestation-verification",
        description: "Cosign SBOM attestation verification output",
    },
];

const missingArtifacts = requiredArtifacts.filter(
    (artifact) => !existsSync(path.join(inputRoot, artifact.path)),
);

if (missingArtifacts.length > 0) {
    for (const artifact of missingArtifacts) {
        console.error(`Missing required evidence artifact: ${artifact.path}`);
    }
    process.exit(1);
}

rmSync(outputRoot, { force: true, recursive: true });
mkdirSync(outputRoot, { recursive: true });

for (const artifact of requiredArtifacts) {
    const source = path.join(inputRoot, artifact.path);
    const destination = path.join(outputRoot, artifact.path);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: statSync(source).isDirectory() });
}

const reproduceProcedure = `# Reproduce Core Case Service Tagged Build

1. Fetch the repository and tags: \`git fetch --tags origin\`.
2. Check out the release tag: \`git checkout <tag>\`.
3. Install Node dependencies from the lockfile: \`npm ci\`.
4. Install Python dependencies from the lockfile: \`uv sync --frozen\`.
5. Run TypeScript tests and coverage: \`npm run build && npx vitest run --coverage --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.lines=0 --coverage.thresholds.statements=0 --project unit --project integration --project production --exclude backend/core-case-service/src/glCoding/glCodingClient.pact.test.ts --passWithNoTests\`.
6. Run Python tests and coverage: \`UV_CACHE_DIR=/tmp/expense-flow-uv-cache uv run pytest --cov=backend --cov=evaluation --cov-report=term --cov-report=xml:coverage/python/coverage.xml --cov-report=html:coverage/python/html\`.
7. Build the Core Case Service image: \`docker build --file backend/core-case-service/Dockerfile --tag core-case-service:<tag> .\`.
8. Scan the image with Trivy, generate the Syft SBOM, sign the pushed image with Cosign, attest the SBOM, and verify both using the same commands recorded in this packet's manifest.
`;

writeFileSync(
    path.join(outputRoot, "reproduce-tagged-build.md"),
    reproduceProcedure,
);

const artifactEntries = requiredArtifacts.map((artifact) => ({
    path: artifact.path,
    gate: artifact.gate,
    description: artifact.description,
}));

artifactEntries.push({
    path: "reproduce-tagged-build.md",
    gate: "evidence-packet-assembler",
    description:
        "Documented procedure for reproducing a tagged build from source",
});

const manifest = {
    schemaVersion: 1,
    service: serviceName,
    generatedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY ?? null,
    commitSha: process.env.GITHUB_SHA ?? null,
    ref: process.env.GITHUB_REF ?? null,
    refName: process.env.GITHUB_REF_NAME ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    image: {
        reference: process.env.IMAGE_REF ?? null,
        digest: process.env.IMAGE_DIGEST ?? null,
    },
    reproduction: {
        procedure: "reproduce-tagged-build.md",
        sourceRef: process.env.GITHUB_REF ?? "<tag>",
        commands: [
            "npm ci",
            "uv sync --frozen",
            "npm run build && npx vitest run --coverage --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.lines=0 --coverage.thresholds.statements=0 --project unit --project integration --project production --exclude backend/core-case-service/src/glCoding/glCodingClient.pact.test.ts --passWithNoTests",
            "UV_CACHE_DIR=/tmp/expense-flow-uv-cache uv run pytest --cov=backend --cov=evaluation --cov-report=term --cov-report=xml:coverage/python/coverage.xml --cov-report=html:coverage/python/html",
            "docker build --file backend/core-case-service/Dockerfile --tag core-case-service:<tag> .",
            "scripts/ci/run-trivy-gate.sh --input <image.tar> --severity CRITICAL --exit-code 1 --ignorefile .trivyignore --format json --output security/trivy-report.json",
            "scripts/ci/run-syft-sbom.sh docker-archive:/repo/<image.tar> -o cyclonedx-json=/repo/security/sbom.cdx.json",
            "scripts/ci/run-cosign-sign-image.sh <image-ref>",
            "scripts/ci/run-cosign-attest-sbom.sh <image-ref> security/sbom.cdx.json cyclonedx",
            "cosign verify <identity-args> <image-ref>",
            "cosign verify-attestation --type cyclonedx <identity-args> <image-ref>",
        ],
    },
    artifacts: artifactEntries,
};

writeFileSync(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Evidence packet assembled at ${outputRoot}`);
