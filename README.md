# MCP Router

An MCP gateway: install [Model Context Protocol](https://modelcontextprotocol.io)
servers from registries (default: the [official registry](https://registry.modelcontextprotocol.io))
or directly from npm, run them locally as lazily-spawned stdio child processes
(or proxy to remote streamable-HTTP servers), and re-expose every one of them
over streamable HTTP:

- **Per-server routes** — each installed server at `http://host:3000/mcp/<name>`
- **One aggregate endpoint** — `http://host:3000/mcp` merges all enabled
  servers, with tool names namespaced as `<server>__<tool>` (resources, resource
  templates, and prompts likewise); calls are routed back to the owning server
- **Workspaces (custom aggregates)** — group a chosen subset of servers at their
  own `http://host:3000/mcp/w/<slug>` endpoint, with optional per-workspace
  `env`/`args`/`headers` overrides; give each client exactly the tools it needs

Point one MCP client at the router instead of configuring N servers in every
client. Manage everything through the built-in React web UI, or hand-edit the
flat JSON config files and reload.

Highlights:

- stdio servers spawn lazily on first request, stay warm, and shut down after
  an idle timeout (default 5 minutes, per-server override)
- Full MCP passthrough — tools, resources, resource templates, prompts,
  completions, logging, and resource subscriptions, plus downstream
  `list_changed` / resource-update / log notifications relayed over a stateful
  session; a dropped SSE stream resumes gap-free via `Last-Event-ID`
  (reverse-direction sampling/elicitation/roots are not yet proxied)
- Single bearer token guards the management API and all MCP endpoints
- Config is plain JSON under `DATA_DIR/config` — watched for changes, plus an
  explicit `POST /api/reload`

## Quickstart A: Docker Compose (recommended)

```bash
git clone <this-repo> mcp-router && cd mcp-router
cp .env.example .env      # then edit .env and set a real MCP_ROUTER_TOKEN
docker compose up -d
```

Open http://localhost:3000, enter your token, and install servers from the
Browse page. All state (config, installed server packages, logs) lives in
`./data`, bind-mounted to `/data` in the container.

Prebuilt images are published on every release to
[Docker Hub (`vantreeseba/mcp-router`)](https://hub.docker.com/r/vantreeseba/mcp-router)
and GHCR, tagged `latest` and the semver version — swap `build: .` for
`image: vantreeseba/mcp-router:latest` in `docker-compose.yml` to skip building
locally. Or run the image directly, without cloning the repo:

```bash
docker run -d -p 3000:3000 -v ./data:/data \
  -e MCP_ROUTER_TOKEN=your-secret-token \
  vantreeseba/mcp-router:latest
```

## Quickstart B: bare Node

Requires Node >= 22.18.

```bash
npm install
npm run build
MCP_ROUTER_TOKEN=your-secret-token npm start
```

The server listens on port 3000 (override with `PORT`) and serves the built
web UI. State lives in `./data` (override with `DATA_DIR`). By default it binds
all interfaces; set `HOST=127.0.0.1` (or `settings.host`) to restrict it to
localhost.

Both `npm start` and `npm run dev` also load a `.env` file from the repo root
if one exists (`cp .env.example .env`), so you can keep `MCP_ROUTER_TOKEN`
there instead of passing it inline. Variables already set in your shell take
precedence over `.env`.

For development:

```bash
npm run dev   # server with watch on :3001 + Vite dev server on :3000
```

If you start without `MCP_ROUTER_TOKEN`, a token is generated into
`data/config/settings.json` on first run and logged once — check the startup
output.

On a trusted local network you can skip tokens entirely by setting
`SECURE_LOCAL_NET=true` — this disables bearer auth for both `/api` and `/mcp`
(no token is minted or required). Only do this when the router is not reachable
from untrusted networks. The `/mcp` Origin guard (below) still applies, so a
malicious web page cannot reach the endpoints via DNS rebinding even with auth
off.

## Configuration

All config lives as flat, hand-editable JSON under `DATA_DIR/config`
(`./data/config` locally, `/data/config` in Docker — i.e. `./data/config` on
the host via the compose bind mount). Files are written by the router with
mode `0600`. Unknown keys are preserved across round-trips.

After hand-editing, either wait for the file watcher to pick the change up or
apply it explicitly:

```bash
curl -X POST -H "Authorization: Bearer $MCP_ROUTER_TOKEN" \
  http://localhost:3000/api/reload
```

(or use the **Reload config** button on the Settings page).

### `settings.json`

```jsonc
{
  // HTTP port. The PORT env var wins over this.
  "port": 3000,
  // Bearer token for /api/* and /mcp*. The MCP_ROUTER_TOKEN env var wins.
  // Generated on first run when auth is enabled and no token exists.
  "authToken": "a-long-random-secret",
  // Set false to allow unauthenticated access (trusted networks only!).
  "authEnabled": true,
  // Interface to bind. The HOST env var wins. Omit to bind all interfaces
  // (needed for Docker/LAN); set "127.0.0.1" to restrict to localhost.
  "host": "127.0.0.1",
  // Extra browser Origins allowed to reach /mcp (DNS-rebinding protection).
  // Loopback origins are always allowed and native MCP clients send no Origin;
  // add browser-based clients (e.g. the MCP Inspector on a non-loopback host).
  "allowedOrigins": ["https://inspector.example.com"],
  // Default idle shutdown for stdio child processes, in milliseconds.
  // Per-server idleTimeoutMs overrides this.
  "idleTimeoutMs": 300000,
  // Idle lifetime of an MCP session before the router reclaims it (ms).
  // Sessions normally end on a client DELETE; this bounds abandoned ones.
  "sessionIdleTimeoutMs": 1800000,
  // Hard cap on concurrent live MCP sessions; least-recently-active evicted past it.
  "maxSessions": 1000
}
```

### `registries.json`

```jsonc
{
  "registries": [
    // Any MCP-registry-API-compatible service (GET {url}/v0/servers).
    // Seeded with the official registry on first run.
    { "name": "official", "url": "https://registry.modelcontextprotocol.io" }
  ]
}
```

### `servers/<name>.json` — one file per installed server

The file (and server) name doubles as the route segment (`/mcp/<name>`) and
the install directory (`data/servers/<name>`). Names must match
`^[a-z0-9][a-z0-9._-]*$` (max 64 chars).

A local stdio server installed from a registry:

```jsonc
{
  "name": "github",
  "displayName": "GitHub",                 // optional, UI only
  "description": "GitHub MCP server",      // optional
  "enabled": true,                          // disabled servers 404 and are
                                            // excluded from the aggregate
  "source": {
    "type": "registry",                     // "registry" | "npm" | "remote"
    "registry": "official",                 // name from registries.json
    "serverName": "io.github.github/github-mcp-server",
    "version": "1.2.3"                      // optional, defaults to latest
  },
  "transport": {
    "type": "stdio",
    "command": "node",                      // executable or absolute bin path
    "args": ["/data/servers/github/node_modules/.bin/github-mcp-server"],
    "cwd": "/data/servers/github"           // optional
  },
  // Env vars passed to the child process. Values are PLAINTEXT — see
  // Security notes below.
  "env": {
    "GITHUB_TOKEN": "ghp_..."
  },
  // UI hints for known env vars (sourced from the registry); keys are var names.
  "envMeta": {
    "GITHUB_TOKEN": {
      "description": "GitHub personal access token",
      "isRequired": true,
      "isSecret": true
      // also supported: "default", "placeholder", "choices"
    }
  },
  // Optional override of the global stdio idle shutdown (ms).
  "idleTimeoutMs": 600000
}
```

A server installed directly from npm uses
`"source": { "type": "npm", "package": "@scope/pkg", "version": "1.0.0" }`
(version optional) with the same stdio transport shape.

A remote server that is merely proxied (nothing installed):

```jsonc
{
  "name": "some-remote",
  "enabled": true,
  "source": { "type": "remote" },
  "transport": {
    "type": "streamable-http",
    "url": "https://mcp.example.com/mcp",
    // Extra headers sent to the remote server, e.g. its own auth:
    "headers": { "Authorization": "Bearer <remote-token>" }
  }
}
```

### `workspaces/<slug>.json` — one file per workspace (custom aggregate)

A **workspace** exposes a chosen subset of servers as its own aggregate at
`/mcp/w/<slug>`. The `slug` doubles as the filename and is derived from the
name; each member may override the base server's `env`, `args`, or `headers`
for that workspace only. Each member runs as an isolated downstream instance, so
a workspace can run a server that's globally disabled, and its overrides never
touch the base server.

```jsonc
{
  "name": "Coding assistant",
  "slug": "coding-assistant",               // matches the filename; auto-derived
  "enabled": true,                          // false → /mcp/w/<slug> returns 404
  "description": "GitHub + local files for a code client.",  // optional
  "members": {
    "github": { "enabled": true },
    "filesystem": {
      "enabled": true,
      "args": ["/data/servers/filesystem", "/srv/repo"],  // replaces base args
      "env": { "READ_ONLY": "1" }                          // merged over base env
    }
  }
}
```

A member's effective enabled state is `workspace.enabled && member.enabled` — the
base server's own `enabled` flag is ignored inside a workspace. Members that
reference a server which no longer exists are skipped. Manage workspaces from the
**Workspaces** page in the web UI, or hand-edit these files and reload.

## Connecting MCP clients

All MCP endpoints speak streamable HTTP and require the bearer token (unless
`authEnabled` is false).

**Claude Code** — the aggregate endpoint (every enabled server, tools named
`<server>__<tool>`):

```bash
claude mcp add --transport http router http://localhost:3000/mcp \
  --header "Authorization: Bearer <token>"
```

Or a single server, un-namespaced:

```bash
claude mcp add --transport http github http://localhost:3000/mcp/github \
  --header "Authorization: Bearer <token>"
```

Or a workspace — a custom aggregate of just the servers that client should see:

```bash
claude mcp add --transport http coding http://localhost:3000/mcp/w/coding-assistant \
  --header "Authorization: Bearer <token>"
```

**Other clients** — any client that supports streamable HTTP works; the usual
JSON config shape:

```json
{
  "mcpServers": {
    "router": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Swap the URL for `http://localhost:3000/mcp/<name>` to expose just one server,
or `http://localhost:3000/mcp/w/<slug>` for a workspace's custom aggregate.

## API reference

Management REST API under `/api`, bearer auth, JSON in/out. Errors are non-2xx
with `{ "error": "...", "detail": "..." }`.

| Method & path | Purpose |
| --- | --- |
| `GET /api/status` | Router status (version, auth mode, running/total servers) |
| `GET /api/registries` | List configured registries |
| `POST /api/registries` | Add a registry `{ name, url }` |
| `DELETE /api/registries/:name` | Remove a registry |
| `GET /api/registries/:name/servers?search=&cursor=&limit=` | Search that registry |
| `GET /api/registries/:name/servers/:serverName` | Registry entry detail (latest version) |
| `GET /api/servers` | All installed servers with runtime state |
| `POST /api/servers` | Install (from a registry entry, a raw npm package, or a remote URL) |
| `GET /api/servers/:name` | Single server status |
| `PATCH /api/servers/:name` | Update env / enabled / transport; persists to its JSON file |
| `DELETE /api/servers/:name` | Stop, delete config, remove its install dir |
| `POST /api/servers/:name/restart` | Kill and respawn (use after env edits) |
| `GET /api/servers/:name/tools` | Connect (spawning if needed) and list downstream tools |
| `GET /api/servers/:name/resources` | Connect and list downstream resources + resource templates (empty when unsupported) |
| `POST /api/servers/:name/resources/read` | Read one resource by URI (recorded to the activity log) |
| `GET /api/servers/:name/prompts` | Connect and list downstream prompts (empty when unsupported) |
| `POST /api/servers/:name/prompts/get` | Get one prompt with arguments (recorded to the activity log) |
| `GET /api/servers/:name/activity` | Recent proxied calls (in-memory, newest first); `DELETE` clears the log |
| `GET /api/workspaces` | All workspaces with their endpoint paths |
| `POST /api/workspaces` | Create a workspace (slug auto-derived from the name) |
| `GET /api/workspaces/:slug` | Single workspace |
| `PATCH /api/workspaces/:slug` | Update members / overrides / enabled (renaming re-slugs and moves the URL) |
| `DELETE /api/workspaces/:slug` | Remove a workspace (underlying servers untouched) |
| `POST /api/reload` | Re-read all config from disk and reconcile running processes |

MCP endpoints (streamable HTTP):

| Endpoint | Purpose |
| --- | --- |
| `POST/GET/DELETE /mcp/<name>` | Proxy 1:1 to that server (tools, resources, prompts) |
| `POST/GET/DELETE /mcp` | Aggregate of all enabled servers, `<server>__` name prefix |
| `POST/GET/DELETE /mcp/w/<slug>` | A workspace's custom aggregate — same `<server>__` prefix, over its members only |

## Security notes

- **Secrets are stored in plaintext** in the JSON config files (`env` values,
  remote-transport headers, the auth token). The router writes these files
  with mode `0600`, but anyone with read access to `DATA_DIR` — or to your
  Docker bind mount — can read them. Protect the directory accordingly and
  keep backups equally private.
- **One bearer token guards everything** (`/api/*` and `/mcp*`). Set it via
  `MCP_ROUTER_TOKEN`; treat it like a password. Setting `authEnabled: false` in
  settings.json, or `SECURE_LOCAL_NET=true` in the environment, disables auth
  entirely — only do that on a trusted network. The `SECURE_LOCAL_NET` env var
  overrides settings and is handy for containers where editing settings.json is
  awkward.
- **Do not expose the router directly to the internet.** It speaks plain HTTP;
  the bearer token would travel in cleartext. Put it behind a TLS-terminating
  reverse proxy (Caddy, nginx, Traefik) if it must be reachable remotely, and
  prefer binding to localhost or a private network otherwise.
- Installed servers run as child processes of the router with the env vars you
  configure — installing a server means running its code with access to those
  secrets. Install packages you trust.
- **The Activity tab keeps recent request/response bodies in memory.** For
  debugging, the router retains the newest 200 proxied calls per server —
  including tool arguments and results, which may contain sensitive data — in
  process memory (bounded, never written to disk, cleared when the server is
  removed or the process exits, and clearable from the UI). Anyone with the
  bearer token can read them via `GET /api/servers/:name/activity`.

## Limitations

- **The default Docker image supports npm-based servers only.** Runtime
  installs shell out to `npm install --prefix /data/servers/<name>`, and the
  image ships node/npm/npx — but not Python, `uv`/`uvx`, or other runtimes
  some MCP servers need. To run those, extend the image, e.g.:

  ```dockerfile
  FROM mcp-router
  RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 pipx && rm -rf /var/lib/apt/lists/* \
      && pipx install uv
  ```

  then configure the server's `transport.command` accordingly.
- Runtime installs need outbound network access to registry.npmjs.org from
  inside the container.

## Development

npm-workspaces monorepo: `shared/` (zod schemas — the contract), `server/`
(Express 5 + MCP TS SDK), `app/` (React 19 + Vite + shadcn/ui). See
[AGENTS.md](AGENTS.md) for conventions and [SPECS.md](SPECS.md) for the full
design and work list.

```bash
npm run dev      # server (watch, :3001) + Vite dev server (:3000)
npm run check    # biome + tsc for all packages
npm test         # vitest
npm run build    # shared typecheck → server tsc → app vite build
```
