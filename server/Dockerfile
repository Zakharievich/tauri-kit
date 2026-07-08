FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS build
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server ./server

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter ./server... deploy --prod /app

FROM node:20-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

RUN corepack enable

WORKDIR /app
COPY --from=build /app /app

EXPOSE 3001

CMD ["pnpm", "start"]
