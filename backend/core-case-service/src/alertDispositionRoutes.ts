import { Router, type RequestHandler } from "express";

import { buildAuthJwks, loadAuthJwtConfig } from "./config/authJwtConfig.js";
import {
    createAccessTokenMiddleware,
    createAccessTokenVerifierConfig,
} from "./auth/shared/accessTokenMiddleware.js";
import {
    AlertDispositionQuerySchema,
    CreateAlertDispositionInboundRequestSchema,
} from "./schemas/alertDisposition.schema.js";
import {
    createAlertDisposition,
    readAlertDispositions,
    requireDispositionAccess,
} from "./alertDisposition.js";
import { UnauthorizedError } from "./errors/problem-json.js";

const authJwtConfig = loadAuthJwtConfig();
const authJwks = buildAuthJwks(authJwtConfig);
const accessTokenVerifierConfig = createAccessTokenVerifierConfig(
    authJwtConfig.issuer,
    authJwtConfig.audience,
    authJwks,
);

export const alertDispositionRouter = Router();

const requireAlertDispositionAccess: RequestHandler = (req, _res, next) => {
    requireDispositionAccess(req);
    next();
};

alertDispositionRouter.post(
    "/alert-dispositions",
    createAccessTokenMiddleware(accessTokenVerifierConfig),
    requireAlertDispositionAccess,
    async (req, res, next) => {
        try {
            const parsedRequest =
                CreateAlertDispositionInboundRequestSchema.parse(req.body);
            const auth = req.auth;
            if (auth === undefined) {
                throw new UnauthorizedError();
            }

            const traceId = req.tracing?.span.spanContext().traceId;
            const correlationId =
                parsedRequest.correlationId ?? req.tracing?.correlationId;
            const disposition = await createAlertDisposition({
                ...parsedRequest,
                ...(correlationId === undefined ? {} : { correlationId }),
                ...(traceId === undefined ? {} : { traceId }),
                tenantId: auth.tenantId,
                investigatedBy: auth.userId,
            });

            if (req.tracing !== undefined) {
                if (correlationId !== undefined) {
                    req.tracing.correlationId = correlationId;
                    req.tracing.span.setAttribute(
                        "expenseflow.correlation_id",
                        correlationId,
                    );
                }
                if (traceId !== undefined) {
                    req.tracing.span.setAttribute(
                        "expenseflow.trace_id",
                        traceId,
                    );
                }
                req.tracing.span.setAttribute(
                    "expenseflow.event_type",
                    "alert_disposition",
                );
            }

            res.status(201).json(disposition);
        } catch (error: unknown) {
            next(error);
        }
    },
);

alertDispositionRouter.get(
    "/alert-dispositions",
    createAccessTokenMiddleware(accessTokenVerifierConfig),
    requireAlertDispositionAccess,
    async (req, res, next) => {
        try {
            const auth = req.auth;
            if (auth === undefined) {
                throw new UnauthorizedError();
            }

            const parsedQuery = AlertDispositionQuerySchema.parse({
                limit: req.query.limit,
            });
            const dispositions = await readAlertDispositions({
                ...parsedQuery,
                tenantId: auth.tenantId,
            });

            res.status(200).json(dispositions);
        } catch (error: unknown) {
            next(error);
        }
    },
);
