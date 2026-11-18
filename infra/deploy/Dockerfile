# Production images for the API and the static web panel.
# Build from the repository root:
#   docker build -f infra/deploy/Dockerfile --target api -t photo-platform-api .
#   docker build -f infra/deploy/Dockerfile --target web --output type=local,dest=./web-dist .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

FROM deps AS build-api
COPY tsconfig.base.json biome.json ./
COPY backend backend
RUN pnpm --filter @photo-platform/api build \
 && pnpm --filter @photo-platform/api deploy --prod --legacy /out \
 && cp -r backend/dist backend/drizzle /out/

FROM deps AS build-web
ARG VITE_PLATFORM_DOMAIN
ARG VITE_SUPPORT_EMAIL
ENV VITE_PLATFORM_DOMAIN=$VITE_PLATFORM_DOMAIN VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL
COPY tsconfig.base.json biome.json ./
COPY frontend frontend
RUN pnpm --filter @photo-platform/web build

FROM scratch AS web
COPY --from=build-web /repo/frontend/dist /

FROM node:22-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build-api --chown=node:node /out /app
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
