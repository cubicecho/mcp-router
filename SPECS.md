# SPECS.md — MCP Router

An MCP gateway/router: install MCP servers from registries or npm, run them
locally (stdio) or point at remote ones (streamable HTTP), and re-expose every
one of them over streamable HTTP — per-server routes plus one aggregate
endpoint. Managed through a React web UI and hand-editable flat config files.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Exposure | Per-server routes `/mcp/<name>` **and** aggregate `/mcp` with namespaced tools (`<server>__<tool>`) |
| Auth | Single bearer token (env `MCP_ROUTER_TOKEN` or generated into `settings.json` on first run); protects `/api/*` and `/mcp*`; can be disabled via `authEnabled: false` |
| stdio lifecycle | Lazy spawn on first request, kept warm, killed after idle timeout (default 5 min, per-server override) |
| Secrets | Plaintext values in the JSON config files, written with mode 0600 |
| Config | Flat files under `DATA_DIR/config`; watched for changes (chokidar) + explicit `POST /api/reload` |
| First registry | `https://registry.modelcontextprotocol.io` (API `GET /v0/servers`, server.json schema 2025-12-11), seeded as `official` |
| Stack | TypeScript everywhere, npm workspaces (`shared`, `server`, `app`), Express 5, MCP TS SDK, React 19 + Vite + Tailwind + shadcn/ui + TanStack Router/Query, Biome, Vitest |
| Server runtime | Node ≥22.18 type stripping in dev (`node --watch src/index.ts`), `tsc` build (`rewriteRelativeImportExtensions`) for prod/Docker |
| Deploy | Single Docker image: build app + server, Express serves `app/dist` statically; `docker-compose.yml` with a `data/` volume |

## Layout & contracts

```
mcp-router/
├── shared/          # zod schemas + types (DONE — the contract, see shared/src/)
│   ├── config.ts    #   settings.json / registries.json / servers/<name>.json schemas
│   ├── registry.ts  #   MCP registry API response schemas
│   └── api.ts       #   REST DTOs (/api/*)
├── server/          # Express + MCP SDK backend        [Track A]
├── app/             # Vite + React + shadcn web UI     [Track B]
├── Dockerfile, docker-compose.yml, README.md           [Track C]
└── data/            # runtime, gitignored: config/, servers/<name>/ (npm prefixes), logs
```

### Flat config files (`DATA_DIR/config`, default `./data/config`)

- `settings.json` — port, authToken, authEnabled, default idleTimeoutMs
- `registries.json` — `{ registries: [{ name, url }] }`, seeded with `official`
- `servers/<name>.json` — one file per installed server (`serverConfigSchema`):
  name, enabled, source (registry | npm | pypi | remote), transport (stdio
  command/args | streamable-http url/headers), env (plaintext), envMeta (UI hints
  from the registry), idleTimeoutMs. npm packages install into
  `servers/<name>/` and run as `node <bin>`; pypi packages run as `uvx <pkg>`
  (uv resolves/caches on spawn, no install dir)

### Management REST API (`/api`, bearer auth)

| Method & path | Purpose |
| --- | --- |
| `GET /api/status` | RouterStatus |
| `GET /api/registries` / `POST` / `DELETE /api/registries/:name` | manage registries |
| `GET /api/registries/:name/servers?search=&cursor=&limit=` | proxy search of the registry (`RegistryListResponse`) |
| `GET /api/registries/:name/servers/:serverName` | registry entry detail (latest version) |
| `GET /api/servers` | `ServerStatus[]` (config + runtime state) |
| `POST /api/servers` | install (`InstallRequest`: from registry entry, raw npm package, or remote URL) |
| `GET /api/servers/:name` | single `ServerStatus` |
| `PATCH /api/servers/:name` | `UpdateServerRequest` (env, enabled, transport, …) → persists to its JSON file |
| `DELETE /api/servers/:name` | stop, delete config file, remove `data/servers/<name>` install dir |
| `POST /api/servers/:name/restart` | kill + respawn (used after env edits) |
| `GET /api/servers/:name/tools` | connect (spawning if needed) and list downstream tools |
| `POST /api/reload` | re-read all config from disk, reconcile running processes |

Errors: non-2xx with `{ error, detail? }`. Validation via the shared zod schemas.

### MCP endpoints (streamable HTTP, bearer auth)

- `POST/GET/DELETE /mcp/<name>` — proxy to that server: tools, resources,
  prompts, and calls forwarded 1:1
- `POST/GET/DELETE /mcp` — aggregate: merges all *enabled* servers; tool names
  prefixed `<server>__`; resources/prompts likewise namespaced; `tools/call`
  strips the prefix and routes to the owning downstream client
- Disabled servers 404. Auth failures 401 before any MCP handling.

---

## Work items

`[ ]` open · `[x]` done · Tracks A/B/C are parallel; items within a track are ordered.

### Phase 0 — Foundation (done inline)

- [x] 0.1 npm workspace root: `package.json`, `tsconfig.base.json`, `biome.json`, `.gitignore`
- [x] 0.2 `shared/` package: config-file schemas, registry API schemas, REST DTOs
- [x] 0.3 SPECS.md, AGENTS.md, initial commit

### Track A — Server (`server/`)

- [x] A1 Package scaffold: `server/package.json` (deps: express@5, @modelcontextprotocol/sdk, zod, chokidar), `tsconfig.json` (emits to `dist/`, `rewriteRelativeImportExtensions`), `src/index.ts` entry
- [x] A2 Config store (`src/config/`): load/validate/write `settings.json`, `registries.json`, `servers/*.json` via shared schemas; atomic writes (tmp+rename, mode 0600); seed defaults on first run (official registry, generated auth token → log it once); chokidar watcher (debounced) emitting typed change events; `reload()` for the API
- [x] A3 Auth middleware: bearer check for `/api` and `/mcp`; constant-time compare; skipped when `authEnabled: false`; `GET /api/status` reports authEnabled
- [x] A4 Registry client (`src/registry/`): fetch + zod-parse `GET {url}/v0/servers` (search, cursor, version=latest) and single-server detail; per-registry base URL; friendly errors for unreachable/invalid registries
- [x] A5 Installer (`src/installer/`): `npm install --prefix data/servers/<name> <pkg>@<ver>` via execFile (no shell); derive stdio transport: resolve installed package `bin` → `node <binPath>` (+ registry runtimeArguments/packageArguments where value is fixed); map registry `environmentVariables` → `envMeta`; build `ServerConfig` from an `InstallRequest` for all three source types; uninstall = rm install dir
- [x] A6 Process/connection manager (`src/gateway/manager.ts`): per-server downstream MCP `Client` — stdio: lazy spawn (`StdioClientTransport`, env = process env allowlist + config env), idle timer, restart-on-crash backoff, capture stderr tail for `lastError`; remote: `StreamableHTTPClientTransport` with headers; expose `getClient(name)`, `status(name)`, `stop(name)`, `reconcile(configs)` for reload
- [x] A7 Per-server MCP endpoint (`src/gateway/route.ts`): `StreamableHTTPServerTransport` per session at `/mcp/:name`; proxy tools/resources/prompts list + call/read/get to the downstream client; propagate downstream errors as MCP errors
- [x] A8 Aggregate MCP endpoint (`/mcp`): merged capability lists with `<server>__` prefix; route calls by prefix; skip (and log) servers that fail to connect rather than failing the whole list
- [x] A9 Management REST API (`src/api/`): all routes from the table above, zod-validated, wired to config store + installer + manager; JSON error envelope
- [x] A10 Static serving: in production serve `app/dist` with SPA fallback (exclude `/api`, `/mcp`); dev uses Vite proxy
- [x] A11 Server tests (Vitest): config store round-trip + validation, auth middleware, installer transport derivation (mock execFile), registry client parsing (fixture from the real API), aggregate namespacing/routing logic

### Track B — Web UI (`app/`)

- [x] B1 Package scaffold: Vite + React 19 + TS, Tailwind, shadcn/ui (`components.json`, `src/components/ui/`), TanStack Router (file-based, `src/routes/`) + TanStack Query; `@/` alias; dev proxy `/api` + `/mcp` → `localhost:3001`
- [x] B2 API client (`src/lib/api.ts`): typed fetch wrapper using `@mcp-router/shared` DTOs; bearer token from localStorage; 401 → token prompt screen (token entry stored locally)
- [x] B3 Layout: sidebar nav (Servers, Browse, Registries, Settings), header with router status (running/total from `GET /api/status`), toast feedback (sonner)
- [x] B4 Servers page (`/`): list installed servers — state badge (stopped/starting/running/error), transport type, tool count; enable/disable toggle; restart + delete (confirm dialog) actions
- [x] B5 Server detail (`/servers/$name`): config overview incl. endpoint URL with copy button; **env var editor** — table of vars from `envMeta` ∪ `env`, secret values masked with reveal, add/remove arbitrary vars; save → PATCH then offer restart; show `lastError` when state is error; tools list (from `GET /api/servers/:name/tools`)
- [x] B6 Browse/install page (`/browse`): registry picker, search box (debounced), cursor-paginated results; install dialog: local name (prefilled, validated against `serverNameSchema`), package/remote selector when multiple, required env vars (from `environmentVariables`, secrets masked) → `POST /api/servers`
- [x] B7 Direct npm install (on `/browse`): "Install from npm" form — package name, version (default latest), local name, env vars → `InstallRequest` with `source.type: 'npm'`
- [x] B8 Registries page (`/registries`): list/add/remove registries (`createRegistryRequestSchema` validation); official registry undeletable-by-default hint
- [x] B9 Settings page (`/settings`): show auth status + port; **Reload config** button (`POST /api/reload`) with result toast; link to config dir docs
- [x] B10 UI tests: api-client 401 handling, env editor add/edit/mask behavior, install dialog validation (Vitest + Testing Library)

### Track C — Deploy & docs

- [x] C1 `Dockerfile`: multi-stage — `npm ci` + build shared/server/app → slim `node:22` runtime with `server/dist`, `app/dist`, production node_modules; `ENV DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 3000`; needs npm available at runtime (installer shells out to it)
- [x] C2 `docker-compose.yml`: single service, `./data:/data` bind mount, `MCP_ROUTER_TOKEN` via env/`.env`, restart policy, healthcheck on `/api/status`
- [x] C3 `README.md`: what it is, quickstart (docker compose + bare node), config file reference with examples, API + MCP endpoint reference, how to point Claude/other clients at `/mcp` and `/mcp/<name>`, security notes (plaintext secrets, bearer token)

### Phase 2 — Integration (after tracks merge)

- [x] I1 `npm run check` (biome + tsc all packages) and `npm test` green
- [x] I2 End-to-end smoke: install a real server from the official registry (e.g. `@modelcontextprotocol/server-everything`), set an env var in the UI, connect an MCP client to `/mcp/<name>` and `/mcp`, call a tool through both
- [x] I3 Config reload smoke: hand-edit a server JSON, `POST /api/reload`, verify reconcile
- [x] I4 Docker smoke: `docker compose up`, repeat I2 against the container
