FROM node:20-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json ./server/package.json

RUN pnpm install --frozen-lockfile --filter ./server... --prod

COPY server ./server

WORKDIR /app/server

EXPOSE 3001

CMD ["pnpm", "start"]
