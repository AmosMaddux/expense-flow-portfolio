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

const serviceName = requiredEnvironmentValue("EVIDENCE_PACKET_SERVICE_NAME");
const dockerfile = requiredEnvironmentValue("EVIDENCE_PACKET_DOCKERFILE");
const inputRoot = path.resolve(
    process.env.EVIDENCE_PACKET_INPUT_ROOT ??
        `.evidence-packet-input/${serviceName}`,
);
const outputRoot = path.resolve(
    process.env.EVIDENCE_PACKET_OUTPUT_ROOT ??
        `.evidence-packet/${serviceName}`,
);
const requiredArtifacts = parseJsonEnvironment(
    "EVIDENCE_PACKET_REQUIRED_ARTIFACTS_JSON",
);
const reproductionCommands = parseJsonEnvironment(
    "EVIDENCE_PACKET_REPRODUCTION_COMMANDS_JSON",
);

if (!Array.isArray(requiredArtifacts) || requiredArtifacts.length === 0) {
    console.error(
        "EVIDENCE_PACKET_REQUIRED_ARTIFACTS_JSON must be a non-empty array.",
    );
    process.exit(1);
}

if (!Array.isArray(reproductionCommands) || reproductionCommands.length === 0) {
    console.error(
        "EVIDENCE_PACKET_REPRODUCTION_COMMANDS_JSON must be a non-empty array.",
    );
    process.exit(1);
}

for (const artifact of requiredArtifacts) {
    if (
        typeof artifact?.path !== "string" ||
        typeof artifact?.gate !== "string" ||
        typeof artifact?.description !== "string"
    ) {
        console.error(
            "Each required artifact must include path, gate, and description strings.",
        );
        process.exit(1);
    }
}

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

writeFileSync(
    path.join(outputRoot, "reproduce-tagged-build.md"),
    renderReproductionProcedure(),
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
        dockerfile,
    },
    reproduction: {
        procedure: "reproduce-tagged-build.md",
        sourceRef: process.env.GITHUB_REF ?? "<tag>",
        commands: reproductionCommands,
    },
    artifacts: artifactEntries,
};

writeFileSync(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Evidence packet assembled at ${outputRoot}`);

function requiredEnvironmentValue(name) {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") {
        console.error(`${name} is required.`);
        process.exit(1);
    }
    return value;
}

function parseJsonEnvironment(name) {
    const value = requiredEnvironmentValue(name);
    try {
        return JSON.parse(value);
    } catch (error) {
        console.error(`${name} must contain valid JSON.`);
        if (error instanceof Error) {
            console.error(error.message);
        }
        process.exit(1);
    }
}

function renderReproductionProcedure() {
    const commands = reproductionCommands
        .map((command, index) => `${index + 3}. ${command}`)
        .join("\n");

    return `# Reproduce ${serviceName} Tagged Build

1. Fetch the repository and tags: \`git fetch --tags origin\`.
2. Check out the release tag: \`git checkout <tag>\`.
${commands}
`;
}
