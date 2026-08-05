FROM node:24-bookworm-slim AS deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY backend/core-case-service/package.json backend/core-case-service/package.json
COPY frontend/app/package.json frontend/app/package.json

RUN npm ci

FROM deps AS build

COPY backend/core-case-service/tsconfig.json backend/core-case-service/tsconfig.json
COPY backend/core-case-service/src backend/core-case-service/src

RUN npm --workspace @expense-flow/core-case-service run build

FROM node:24-bookworm-slim AS production-deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY backend/core-case-service/package.json backend/core-case-service/package.json
COPY frontend/app/package.json frontend/app/package.json

RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime

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

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "backend/core-case-service/dist/index.js"]
