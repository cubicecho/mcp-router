# syntax=docker/dockerfile:1

# ── Stage 1: build ────────────────────────────────────────────────────────────
# Full node image (matches engines >=22.18); builds shared/server/app workspaces.
FROM node:26-slim AS builder

WORKDIR /app

# Copy workspace manifests first so the dependency layer caches independently
# of source changes.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/

RUN npm ci

# Copy the rest of the source (.dockerignore excludes node_modules, data, dist, .git)
COPY . .

# shared typecheck → server tsc (server/dist) → app vite build (app/dist)
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Deliberately a full node image, NOT distroless/alpine-minimal: the router
# installs MCP server packages at runtime via `npm install --prefix
# /data/servers/<name>` and spawns them with node/npx, so npm + node must be on
# PATH and the container needs network access to registry.npmjs.org.
FROM node:26-slim

WORKDIR /app

# uv/uvx for PyPI-based MCP servers: the router spawns Python servers as
# `uvx <package>`, so the uv binary must be on PATH. uv fetches its own managed
# Python on demand — no system Python needed. Copy the static binaries straight
# from the official image (no curl/network at build time).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
# Persist uv's package cache and downloaded interpreters on the /data volume so
# they survive container restarts instead of re-downloading on every cold spawn.
# manager.ts allowlists these vars so they reach the spawned uvx children.
ENV UV_CACHE_DIR=/data/uv/cache
ENV UV_PYTHON_INSTALL_DIR=/data/uv/python

# Workspace manifests + production dependencies. `npm ci --omit=dev` also
# creates the node_modules/@mcp-router/shared → ../../shared workspace symlink
# that the server needs at runtime (see below).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/

RUN npm ci --omit=dev && npm cache clean --force

# NOTE: @mcp-router/shared is a source-only TS package — its package.json
# exports point at ./src/index.ts, and server's tsc build compiles only
# server/src, leaving `import ... from '@mcp-router/shared'` in server/dist as
# a bare specifier. At runtime Node resolves it through the workspace symlink
# to /app/shared/src/index.ts (outside node_modules after realpath), which
# Node >=23.6 (and thus 26) type-strips natively — so `node server/dist/index.js`
# works with no flags as long as shared/ source is present. If the server build
# ever changes to bundle shared, this COPY becomes harmless dead weight; if
# type stripping ever fails here, switch CMD to a tsx-based start script.
COPY shared ./shared

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/app/dist ./app/dist

ENV NODE_ENV=production
# Config, per-server npm install prefixes, and logs all live under /data —
# mount a volume here to persist them.
ENV DATA_DIR=/data

RUN mkdir -p /data

VOLUME /data

EXPOSE 3000

# /api/status answers 200 when auth is off and 401 when auth is on — both mean
# the server is up, so treat anything below 500 as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e 'fetch("http://localhost:" + (process.env.PORT || 3000) + "/api/status").then((r) => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))'

CMD ["node", "server/dist/index.js"]
