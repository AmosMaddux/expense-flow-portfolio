FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY backend/core-case-service/package.json backend/core-case-service/package.json

RUN npm ci --workspace @expense-flow/core-case-service --include-workspace-root

FROM deps AS build

COPY backend/core-case-service/tsconfig.json backend/core-case-service/tsconfig.json
COPY backend/core-case-service/src backend/core-case-service/src

RUN npm --workspace @expense-flow/core-case-service run build

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS production-deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY backend/core-case-service/package.json backend/core-case-service/package.json

RUN npm ci --omit=dev --workspace @expense-flow/core-case-service && npm cache clean --force

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime

WORKDIR /workspace

ENV NODE_ENV=production
ENV PORT=3000
ENV AUTO_APPLY_MIGRATIONS=false

COPY --from=production-deps --chown=node:node /workspace/package.json /workspace/package-lock.json ./
COPY --from=production-deps --chown=node:node /workspace/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /workspace/backend/core-case-service/package.json backend/core-case-service/package.json
COPY --from=production-deps --chown=node:node /workspace/backend/core-case-service/node_modules backend/core-case-service/node_modules
COPY --from=build --chown=node:node /workspace/backend/core-case-service/dist backend/core-case-service/dist
COPY --chown=node:node backend/core-case-service/drizzle backend/core-case-service/drizzle
# Synthetic demo-seed fixtures for scripts/aws/bastion-run.sh demo-seed
# (backend/core-case-service/src/dev/localDemoSeed.ts). Not used by the
# running service itself.
COPY --chown=node:node scripts/fixtures/receipts scripts/fixtures/receipts
COPY --chown=node:node scripts/seed-demo-transactions.sql scripts/seed-demo-transactions.sql

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "backend/core-case-service/dist/index.js"]
