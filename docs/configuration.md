# Configuration

MCP Router is configured through a few environment variables and a database that it manages itself. Settings,
registries, installed servers and workspaces are rows in that database, edited from the web UI, `/graphql`
(and the `/admin/mcp` MCP endpoint over it) or the REST API under `/api`. There are no config files to edit.

- [Environment variables](#environment-variables)
- [Where config is stored](#where-config-is-stored)
- [What the config holds](#what-the-config-holds)
  - [Settings](#settings)
  - [Registries](#registries)
  - [Servers](#servers--one-row-per-installed-server)
  - [Workspaces](#workspaces--one-row-per-workspace-custom-aggregate)
- [Upgrading from the config files](#upgrading-from-the-config-files)
- [Backups](#backups)

## Environment variables

| Variable | Default | |
| --- | --- | --- |
| `MCP_ROUTER_TOKEN` | generated | Bearer token for `/api/*` and `/mcp*`. Wins over the stored `authToken`. When neither is set, one is generated into the database on first run and logged once. The placeholder `change-me` is refused |
| `SECURE_LOCAL_NET` | off | `true` (or `1`, `yes`, `on`) turns bearer auth off for `/api` and `/mcp`, and no token is minted. Overrides `authEnabled`. Only on a network you trust |
| `PORT` | `3000` | HTTP port. Wins over the stored `port` |
| `HOST` | all interfaces | Interface to bind. Wins over the stored `host`. `127.0.0.1` restricts it to localhost |
| `DATABASE_URL` | required | The `postgres://` (or `postgresql://`) URL of the Postgres that holds the config. Boot refuses to start, with a `[db]` message, when it is unset or anything else |
| `DB_CONNECT_TIMEOUT_MS` | `60000` | How long boot waits for Postgres to answer before giving up, retrying while it is still starting |
| `DATA_DIR` | `./data` (`/data` in the image) | Where installed server packages, caches and the old config files (imported on upgrade) live |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | `75000` | How long an idle client connection stays open. `0` never closes one. See below |
| `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS` | `30000` | How long an idle connection to a remote MCP server stays open when that server sends no `Keep-Alive` timeout of its own |

Run from source, `npm start` and `npm run dev` also load a `.env` file from the repo root if there is one
(`cp .env.example .env`). Variables already set in your shell win over `.env`.

**Keep-alive.** Connections are kept open between tool calls, which usually arrive further apart than
Node's defaults allow for:

- `HTTP_KEEP_ALIVE_TIMEOUT_MS`: Node's own default is 5 s. Behind a reverse proxy, keep it above the proxy's
  idle timeout (60 s for nginx and ALB, 90 s for Traefik). Otherwise the proxy can reuse a connection the
  router is closing and answer 502.
- `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS`: without it, the default would be 4 s, and every proxied call after a
  pause would pay a new TLS handshake.

## Where config is stored

The config lives in the Postgres that `DATABASE_URL` names. The compose files in this repo and in
[`deploy/`](../deploy/README.md) run a `postgres:17` beside the router, with its data in its own volume, and
start the router once Postgres is healthy. Any other Postgres works too: point `DATABASE_URL` at it. For
`npm run dev`, `npm run db:up` starts one on `localhost:5433` (`docker-compose.dev.yml`).

Boot waits for Postgres to answer (up to `DB_CONNECT_TIMEOUT_MS`), retrying while it is still starting, and
fails at once on a wrong password or a missing database. In production (`NODE_ENV=production`, as in the
image) TLS is required for a host the internet could reach; a private or local host (a compose service name,
`localhost`, an RFC 1918 or link-local address, a `.lan`, `.local`, `.internal` or `.home.arpa` name) is
connected to without it. A `sslmode` in the URL always wins, e.g. `?sslmode=disable` or `?sslmode=require`.

Migrations run on every boot, so an upgraded router brings its tables up to date by itself. The
router caches the config in memory and applies its own writes at once. If something else changes the tables
(a SQL client, another tool against the same Postgres), tell the router to re-read the database:

```bash
curl -X POST -H "Authorization: Bearer $MCP_ROUTER_TOKEN" \
  http://localhost:3000/api/reload
```

(or use the **Reload config** button on the Settings page).

## What the config holds

The shapes below are the shared zod schemas (`shared/src/config.ts`) that every stored row is validated
against, written as JSON: the form the API and GraphQL take, and the form the old config files had.

### Settings

One row. The Settings page and GraphQL's `updateSetting` change the timeouts and session limits, `publicUrl`
and the network discovery options. The rest (the port, the address, the token, whether auth is on, the router's
network name, the origins `/mcp` trusts) guards the router itself or needs a restart, so it is set where the
router is deployed: through the environment variables above, or by editing the `settings` table directly and
restarting.

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
  "maxSessions": 1000,
  // How long a downstream connect (spawn + MCP initialize) may take before the
  // router gives up on it, in milliseconds. Bounds a server that starts and then
  // never speaks. Generous by default because a first `uvx`/`npx` spawn may
  // download the package before it says anything. Takes effect on the next
  // connect after a reload; a running child is not bounced for it.
  "connectTimeoutMs": 60000,
  // How long one proxied tools/call may run before the router gives up on it,
  // in milliseconds. Per-server callTimeoutMs overrides this. Long by default:
  // the client's own timeout and its cancellation both reach the server.
  "callTimeoutMs": 600000,
  // The router's address as your browser and a remote server's login reach it.
  // Used for OAuth sign-in (see "Remote servers that need a login" in the README).
  // Omit to use the address the web UI is open at; set it behind a proxy that
  // rewrites hosts.
  "publicUrl": "https://router.example.com",
  // This router's name on the network, in its Server Cards and mDNS announcement.
  // Written from the hostname on first run, then kept.
  "instanceId": "nas",
  // Announce the router on the local network over mDNS (_mcp._tcp). Off by default.
  "lanAdvertise": false,
  // Look for MCP servers on the local network and offer them on the Servers page.
  "lanDiscovery": true,
  // Found servers you dismissed, by discovery key; "Offer again" in Settings removes one.
  "lanDismissed": []
}
```

### Registries

Managed from the **Registries** page or `/api/registries`.

```jsonc
[
  // Any MCP-registry-API-compatible service (GET {url}/v0/servers).
  // Seeded with the official registry on first run.
  { "name": "official", "url": "https://registry.modelcontextprotocol.io" }
]
```

### Servers — one row per installed server

The server name doubles as the route segment (`/mcp/<name>`) and the install directory
(`data/servers/<name>`). Names must match `^[a-z0-9][a-z0-9._-]*$` (max 64 chars).

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
    "registry": "official",                 // name of a configured registry
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
  // Security notes in the README.
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
  "idleTimeoutMs": 600000,
  // Optional override of the global proxied tools/call timeout (ms).
  "callTimeoutMs": 1800000
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

### Workspaces — one row per workspace (custom aggregate)

A **workspace** exposes a chosen subset of servers as its own aggregate at `/mcp/w/<slug>`. The `slug` is
derived from the name. Each member may override the base server's `env`, `args`, or `headers` for that
workspace only. Each member runs as an isolated downstream instance, so a
workspace can run a server that's globally disabled, and its overrides never touch the base server.

```jsonc
{
  "name": "Coding assistant",
  "slug": "coding-assistant",               // auto-derived from the name
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

A member's effective enabled state is `workspace.enabled && member.enabled`. The base server's own `enabled`
flag is ignored inside a workspace. Members are stored as `workspace_members` rows, so a member must name an
installed server, and deleting a server removes it from every workspace. Manage workspaces from the
**Workspaces** page in the web UI, `/api/workspaces` or GraphQL.

## Upgrading from the config files

Routers before the database (2.x) kept their config as JSON files under `DATA_DIR/config`: `settings.json`,
`registries.json`, `servers/<name>.json` and `workspaces/<slug>.json`. A newer router needs a Postgres: add
the `postgres` service from [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) beside it, or use one
you already run, and set `DATABASE_URL`. Keep the same data folder mounted at `/data`. On the first boot of the
newer router, while the database is still empty, it imports them all in one transaction and renames each imported file
`*.imported`, so they are kept but never read again. After that the database is the only source of truth, and
the files are not read again.

- An invalid `settings.json` or `registries.json` stops the import and nothing is stored: fix the file and
  restart. An invalid server or workspace file is logged and left in place, not renamed, and the rest is
  imported; add that one again from the UI.
- Keys the tables have no column for are dropped, and the log names the files that had them.
- The image now runs as uid 1000 (the `node` user) rather than root. A data folder an older image wrote to is
  owned by root, so hand it over before starting the new one:

  ```bash
  sudo chown -R 1000:1000 data
  ```

## Backups

Back up the database with `pg_dump` (beside the compose stack:
`docker compose exec postgres pg_dump -U mcp_router mcp_router > backup.sql`). The data folder holds
installed packages and caches; copy `DATA_DIR/servers` too for the installed npm packages.
Secrets are stored in plaintext, so keep backups as private as the router itself.
