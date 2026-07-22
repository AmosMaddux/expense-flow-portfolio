import { describe, expect, test, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ execute: vi.fn() }));
const readCaseQueueStageRollupsMock = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", () => ({
    db: dbMock,
}));

vi.mock("../../db/queries/caseQueueRollups.js", () => ({
    readCaseQueueStageRollups: readCaseQueueStageRollupsMock,
}));

vi.mock("../../cache/redisClient.js", () => ({
    getRedisClient: vi.fn().mockResolvedValue(undefined),
}));

import { readCachedCaseQueueStageRollups } from "./caseQueueService.js";

void describe("default Case Queue service dependencies", () => {
    void test("reads rollups from the existing Postgres query", async () => {
        const rollups = [
            {
                currentStage: "Drafted",
                reportCount: 1,
                overdueCount: 0,
            },
        ];
        const params = {
            tenantId: "10000000-0000-4000-8000-000000000100",
            asOfDate: "2026-07-20",
        };
        readCaseQueueStageRollupsMock.mockResolvedValue(rollups);

        await expect(readCachedCaseQueueStageRollups(params)).resolves.toBe(
            rollups,
        );
        expect(readCaseQueueStageRollupsMock).toHaveBeenCalledWith(
            dbMock,
            params,
        );
    });
});
