# syntax=docker/dockerfile:1

# Builds the web UI. The server isn't compiled: its sources are the build output.
# Runs on the build machine's own platform even for a multi-arch build, since
# app/dist is the same static files on every one.
FROM --platform=$BUILDPLATFORM node:26-slim AS builder
WORKDIR /app

# Workspace manifests first, so the dependency layer caches apart from the source.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/
RUN npm ci

COPY . .
RUN npm run build

# Optional: docker build --target test
FROM builder AS test
CMD ["npm", "test"]

# Deliberately a full node image, not distroless: the router installs MCP
# server packages at runtime (`npm install --prefix /data/servers/<name>`) and
# spawns them with node/npx, so npm and node must be on PATH.
FROM node:26-slim AS runtime
WORKDIR /app

# uv and uvx, for servers from PyPI: the router spawns them as `uvx <package>`.
# uv fetches its own Python on demand, so no system Python is needed.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/
# Also links node_modules/@mcp-router/shared to ../../shared, which the server imports.
RUN npm ci --omit=dev && npm cache clean --force

# @mcp-router/shared's exports point at its .ts sources. Node resolves the
# workspace link to /app/shared/src, outside node_modules, so it strips the
# types there as it does for the server's own files.
COPY shared/src ./shared/src
COPY server/src ./server/src
# The committed migrations, applied on boot.
COPY server/drizzle ./server/drizzle
COPY --from=builder /app/app/dist ./app/dist

ENV NODE_ENV=production
ENV PORT=3000
# The installed servers' packages, caches and logs live under /data. The config is in the
# Postgres that DATABASE_URL names, which must be set at run time.
ENV DATA_DIR=/data
# uv's cache and the Pythons it downloads persist on the volume, so a cold
# spawn doesn't fetch them again. agent-mcp-pool passes both to uvx children.
ENV UV_CACHE_DIR=/data/uv/cache
ENV UV_PYTHON_INSTALL_DIR=/data/uv/python
# Created and owned by node before VOLUME: a new named volume is seeded from
# it, ownership included, so the first boot as node can write there.
# npm's cache and npx's go to /home/node/.npm, which the base image gives node.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node

# /healthz needs no token and answers 200 once the server is listening.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No --preserve-symlinks: it would resolve @mcp-router/shared to its path
# inside node_modules, and Node refuses to strip types from anything under there.
# Exec form, so node is PID 1 and gets SIGTERM itself.
CMD ["node", "server/src/index.ts"]
