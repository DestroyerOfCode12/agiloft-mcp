# syntax=docker/dockerfile:1.7
# ---- build ---------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/worker/package.json apps/worker/
COPY packages/agiloft-client/package.json packages/agiloft-client/
COPY packages/capabilities/package.json packages/capabilities/
COPY packages/change-planner/package.json packages/change-planner/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY packages/test-fixtures/package.json packages/test-fixtures/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- runtime -------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Bundles include everything except PGlite (loads WASM assets from its own package).
RUN npm install --omit=dev --no-audit --no-fund @electric-sql/pglite@0.5.10 && npm cache clean --force
COPY --from=build /src/apps/api/dist apps/api/dist
COPY --from=build /src/apps/worker/dist apps/worker/dist
COPY --from=build /src/apps/mcp-server/dist apps/mcp-server/dist
COPY --from=build /src/apps/console/dist apps/console/dist
ENV CONSOLE_DIST=/app/apps/console/dist HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
