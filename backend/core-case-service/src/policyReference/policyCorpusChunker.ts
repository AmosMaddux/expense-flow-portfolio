import { createHash } from "node:crypto";

import { z } from "zod";

export const ChunkExpensePolicyCorpusRequestSchema = z
    .object({
        tenantId: z.uuid(),
        policyText: z.string().trim().min(1),
        updatedAt: z.date(),
    })
    .strict();

export type ChunkExpensePolicyCorpusRequest = z.infer<
    typeof ChunkExpensePolicyCorpusRequestSchema
>;

export type ExpensePolicyChunkMetadata = {
    tenantId: string;
    section: string;
    chunkIndex: number;
    policyHash: string;
    chunkHash: string;
    source: "tenant_expense_policy";
    updatedAt: string;
};

export type ExpensePolicyChunk = {
    tenantId: string;
    policyHash: string;
    chunkHash: string;
    section: string;
    chunkIndex: number;
    content: string;
    metadata: ExpensePolicyChunkMetadata;
};

const targetChunkLength = 1000;
const overlapLength = 150;

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function detectSection(line: string): string | null {
    const markdownHeading = line.match(/^#{1,3}\s+(.+?)\s*#*$/u);
    if (markdownHeading?.[1] !== undefined) {
        return markdownHeading[1].trim();
    }

    const numberedHeading = line.match(/^\d+[.)]\s+(.+?)\s*$/u);
    if (numberedHeading?.[1] !== undefined) {
        return numberedHeading[1].trim();
    }

    if (
        line.length > 1 &&
        line === line.toUpperCase() &&
        /[A-Z]/u.test(line) &&
        line.length <= 100
    ) {
        return line;
    }

    return null;
}

function splitParagraph(paragraph: string): string[] {
    const pieces: string[] = [];
    let start = 0;

    while (start < paragraph.length) {
        const end = Math.min(start + targetChunkLength, paragraph.length);
        pieces.push(paragraph.slice(start, end).trim());
        if (end === paragraph.length) {
            break;
        }
        start = end - overlapLength;
    }

    return pieces.filter((piece) => piece.length > 0);
}

function buildSectionChunks(section: string, text: string): string[] {
    const paragraphs = text
        .split(/\n\s*\n/u)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0);
    const chunks: string[] = [];
    let current = "";

    for (const paragraph of paragraphs) {
        const candidate =
            current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
        if (candidate.length <= targetChunkLength) {
            current = candidate;
            continue;
        }

        if (current.length > 0) {
            chunks.push(current);
        }
        if (paragraph.length > targetChunkLength) {
            chunks.push(...splitParagraph(paragraph));
            current = "";
        } else {
            current = paragraph;
        }
    }

    if (current.length > 0) {
        chunks.push(current);
    }

    return chunks.map((chunk, index) => {
        if (index === 0) {
            return chunk;
        }
        const previous = chunks[index - 1] ?? "";
        const overlap = previous.slice(-overlapLength);
        return `${overlap}\n\n${chunk}`.trim();
    });
}

/**
 * Splits tenant expense policy text into retrieval-ready chunks.
 */
export function chunkExpensePolicyCorpus(
    request: ChunkExpensePolicyCorpusRequest,
): ExpensePolicyChunk[] {
    const parsedRequest = ChunkExpensePolicyCorpusRequestSchema.parse(request);
    const normalizedPolicyText = parsedRequest.policyText
        .replaceAll("\r\n", "\n")
        .replaceAll("\r", "\n")
        .trim();
    const policyHash = sha256(normalizedPolicyText);
    const sections = new Map<string, string>();
    let currentSection = "General";
    let currentText = "";

    for (const line of normalizedPolicyText.split("\n")) {
        const section = detectSection(line.trim());
        if (section !== null) {
            if (currentText.trim().length > 0) {
                sections.set(
                    currentSection,
                    `${sections.get(currentSection) ?? ""}${sections.has(currentSection) ? "\n" : ""}${currentText.trim()}`,
                );
            }
            currentSection = section;
            currentText = "";
        } else {
            currentText += `${line}\n`;
        }
    }
    if (currentText.trim().length > 0) {
        sections.set(
            currentSection,
            `${sections.get(currentSection) ?? ""}${sections.has(currentSection) ? "\n" : ""}${currentText.trim()}`,
        );
    }

    const chunks: ExpensePolicyChunk[] = [];
    for (const [section, sectionText] of sections) {
        for (const content of buildSectionChunks(section, sectionText)) {
            const chunkIndex = chunks.length;
            const chunkHash = sha256(
                `${parsedRequest.tenantId}${policyHash}${section}${chunkIndex}${content}`,
            );
            chunks.push({
                tenantId: parsedRequest.tenantId,
                policyHash,
                chunkHash,
                section,
                chunkIndex,
                content,
                metadata: {
                    tenantId: parsedRequest.tenantId,
                    section,
                    chunkIndex,
                    policyHash,
                    chunkHash,
                    source: "tenant_expense_policy",
                    updatedAt: parsedRequest.updatedAt.toISOString(),
                },
            });
        }
    }

    return chunks;
}
