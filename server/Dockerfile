FROM node:20-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server ./server

RUN pnpm install --no-frozen-lockfile

WORKDIR /repo/server
RUN pnpm build

EXPOSE 3001

CMD ["pnpm", "start"]
