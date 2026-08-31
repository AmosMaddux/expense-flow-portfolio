import { beforeEach, describe, expect, test, vi } from "vitest";

const dbReturningMock = vi.hoisted(() => vi.fn());
const dbValuesMock = vi.hoisted(() =>
    vi.fn((values: unknown) => {
        void values;
        return {
            returning: dbReturningMock,
        };
    }),
);
const dbInsertMock = vi.hoisted(() =>
    vi.fn(() => ({
        values: dbValuesMock,
    })),
);
const logCoreCaseInfoMock = vi.hoisted(() => vi.fn());

vi.mock("./db/client.js", () => ({
    db: {
        insert: dbInsertMock,
    },
}));

vi.mock("./logging/coreCaseLogger.js", () => ({
    logCoreCaseInfo: logCoreCaseInfoMock,
}));

import { createAlertDisposition } from "./alertDisposition.js";
import { ForbiddenError } from "./errors/problem-json.js";
import { requireDispositionAccess } from "./alertDisposition.js";

const syntheticTenantId = "10000000-0000-4000-8000-000000000101";
const syntheticInvestigatorId = "20000000-0000-4000-8000-000000000101";
const syntheticDispositionId = "30000000-0000-4000-8000-000000000101";
const syntheticCorrelationId = "40000000-0000-4000-8000-000000000101";
const syntheticTraceId = "50000000000040008000000000000101";

function buildAlertDispositionRow(overrides: {
    resolvedAt: Date | null;
    status: "investigated" | "resolved" | "monitoring" | "escalated";
}) {
    return {
        id: syntheticDispositionId,
        tenantId: syntheticTenantId,
        alertId: "synthetic-alert-101",
        alertName: "Synthetic alert",
        source: "synthetic-monitoring",
        severity: "high" as const,
        status: overrides.status,
        resolution: "Synthetic disposition text",
        correlationId: syntheticCorrelationId,
        traceId: syntheticTraceId,
        investigatedBy: syntheticInvestigatorId,
        notes: "Synthetic note that should never reach CloudWatch",
        resolvedAt: overrides.resolvedAt,
        createdAt: new Date("2026-08-27T12:00:00.000Z"),
    };
}

void describe("alertDisposition service", () => {
    beforeEach(() => {
        dbInsertMock.mockClear();
        dbValuesMock.mockClear();
        dbReturningMock.mockReset();
        logCoreCaseInfoMock.mockClear();
    });

    void test("omits free-form disposition text from logs and keeps non-resolved timestamps null", async () => {
        const row = buildAlertDispositionRow({
            resolvedAt: null,
            status: "monitoring",
        });
        dbReturningMock.mockResolvedValue([row]);

        const response = await createAlertDisposition({
            alertId: row.alertId,
            alertName: row.alertName,
            source: row.source,
            severity: row.severity,
            status: row.status,
            resolution: row.resolution,
            correlationId: row.correlationId,
            traceId: row.traceId,
            notes: row.notes ?? undefined,
            tenantId: syntheticTenantId,
            investigatedBy: syntheticInvestigatorId,
        });

        expect(dbInsertMock).toHaveBeenCalledTimes(1);
        expect(dbValuesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "monitoring",
                resolvedAt: null,
            }),
        );
        expect(response.resolvedAt).toBeNull();
        expect(logCoreCaseInfoMock).toHaveBeenCalledWith(
            expect.objectContaining({
                alertId: row.alertId,
                alertName: row.alertName,
                eventType: "alert_disposition",
                investigatedBy: syntheticInvestigatorId,
                resolvedAt: null,
                severity: "high",
                status: "monitoring",
                tenantId: syntheticTenantId,
            }),
        );

        const loggedEvent = logCoreCaseInfoMock.mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        expect(loggedEvent).not.toHaveProperty("resolution");
        expect(loggedEvent).not.toHaveProperty("notes");
        expect(JSON.stringify(loggedEvent)).not.toContain(
            "Synthetic disposition text",
        );
        expect(JSON.stringify(loggedEvent)).not.toContain(
            "Synthetic note that should never reach CloudWatch",
        );
    });

    void test("sets resolvedAt only for resolved dispositions", async () => {
        const resolvedAt = new Date("2026-08-27T13:14:15.000Z");
        const row = buildAlertDispositionRow({
            resolvedAt,
            status: "resolved",
        });
        dbReturningMock.mockResolvedValue([row]);

        const response = await createAlertDisposition({
            alertId: row.alertId,
            alertName: row.alertName,
            source: row.source,
            severity: row.severity,
            status: row.status,
            resolution: row.resolution,
            correlationId: row.correlationId,
            traceId: row.traceId,
            notes: row.notes ?? undefined,
            tenantId: syntheticTenantId,
            investigatedBy: syntheticInvestigatorId,
        });

        const insertedDisposition = dbValuesMock.mock.calls[0]?.[0] as
            { resolvedAt?: unknown } | undefined;
        expect(insertedDisposition?.resolvedAt).toBeInstanceOf(Date);
        expect(response.resolvedAt).toStrictEqual(resolvedAt);
        expect(logCoreCaseInfoMock).toHaveBeenCalledWith(
            expect.objectContaining({
                resolvedAt: resolvedAt.toISOString(),
                status: "resolved",
            }),
        );
    });

    void test.each(["Finance Admin", "Department Manager"] as const)(
        "allows %s to access alert dispositions",
        (role) => {
            expect(() =>
                requireDispositionAccess({
                    auth: {
                        roles: [role],
                    },
                } as never),
            ).not.toThrow();
        },
    );

    void test.each(["Employee", "Admin"] as const)(
        "rejects %s access to alert dispositions",
        (role) => {
            expect(() =>
                requireDispositionAccess({
                    auth: {
                        roles: [role],
                    },
                } as never),
            ).toThrow(ForbiddenError);
        },
    );

    void test("rejects empty role lists when accessing alert dispositions", () => {
        expect(() =>
            requireDispositionAccess({
                auth: {
                    roles: [],
                },
            } as never),
        ).toThrow(ForbiddenError);
    });

    void test("rejects missing auth when accessing alert dispositions", () => {
        expect(() => requireDispositionAccess({} as never)).toThrow(
            ForbiddenError,
        );
    });
});
