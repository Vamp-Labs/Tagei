# Build context is the repo root (monorepo): server/src/index.ts imports @bnbplay/shared by
# workspace protocol, and tsup bundles it in (noExternal), so only server's own npm deps need
# to survive into the runtime image. `pnpm deploy` produces exactly that: a plain, symlink-free
# node_modules for one workspace package, ready for a container.
#
# docker build -f server/Dockerfile . (from repo root)

FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

FROM base AS build
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY server server
RUN pnpm --filter @bnbplay/server build
RUN pnpm --filter @bnbplay/server deploy --prod --legacy /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
EXPOSE 8787
CMD ["node", "dist/index.js"]
