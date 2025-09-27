# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps

ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY packages ./packages
COPY tsconfig.base.json ./

RUN npm ci --include-workspace-root

FROM deps AS build

RUN npm run build --workspaces

RUN npm prune --omit=dev

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "packages/api/dist/server.js"]
