FROM node:20-slim

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /repo

RUN npm install -g corepack@0.31.0 \
  && corepack enable \
  && corepack prepare pnpm@9.15.4 --activate \
  && pnpm --version

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server ./server

RUN pnpm install --no-frozen-lockfile

WORKDIR /repo/server

EXPOSE 3001

CMD ["pnpm", "start"]
