# syntax=docker/dockerfile:1
#
# ForeverTracker Server image. The build context is the repository root, because the server
# validates payloads against contract/schemas at runtime:
#   docker build -f server/Dockerfile -t forever-tracker-server .
#
# Both stages share the same base so the Prisma engines downloaded at `npm ci` match the runtime.
ARG NODE_IMAGE=node:24-bookworm-slim

# --- build: install everything, generate the Prisma client, compile, then drop dev dependencies
FROM ${NODE_IMAGE} AS build
WORKDIR /app/server
ENV CHECKPOINT_DISABLE=1

COPY server/package.json server/package-lock.json server/prisma.config.ts ./
COPY server/prisma ./prisma
# postinstall runs `prisma generate` into src/generated/prisma
RUN npm ci --no-audit --no-fund

COPY server/tsconfig.json server/tsconfig.build.json server/nest-cli.json ./
COPY server/src ./src
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# --- runtime: compiled server, production dependencies (Prisma CLI included for migrations)
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1
WORKDIR /app/server

COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json server/prisma.config.ts ./
COPY server/prisma ./prisma
# Found by walking up from dist/ (findContractDir).
COPY contract/schemas /app/contract/schemas

# Files stay owned by root and read-only for the process.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Pending migrations are applied before every start; the server never starts on a failed migration.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js"]
