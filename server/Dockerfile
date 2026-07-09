# --- build: full workspace install (frozen lockfile) + compile TS ---
FROM node:20-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /repo

RUN npm install --global corepack@latest \
 && corepack enable \
 && corepack install --global pnpm@9.15.4

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server ./server

# --frozen-lockfile: fail the build rather than silently drift from the
# committed lockfile (the previous --no-frozen-lockfile made this image
# non-reproducible).
RUN pnpm install --frozen-lockfile

WORKDIR /repo/server
RUN pnpm build

# --- runtime: no compiler/toolchain, non-root user ---
FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /repo/server

RUN groupadd --system app && useradd --system --gid app --home /repo/server app

# pnpm's workspace install links server's dependencies via symlinks into the
# shared store at /repo/node_modules/.pnpm, so both trees must be copied
# together — a package's own transitive deps often live as *siblings*
# inside that store (e.g. livekit-server-sdk's own @livekit/protocol
# dependency), not nested under the package itself, so a partial/flattened
# copy of just server/node_modules silently breaks at runtime.
COPY --from=build --chown=app:app /repo/node_modules /repo/node_modules
COPY --from=build --chown=app:app /repo/server/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/server/dist ./dist
COPY --from=build --chown=app:app /repo/server/package.json ./package.json

USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
