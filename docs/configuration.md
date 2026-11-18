# Configuration

MCP Router is configured through a few environment variables and a set of flat, hand-editable JSON files.

- [Environment variables](#environment-variables)
- [Config files](#config-files)
  - [`settings.json`](#settingsjson)
  - [`registries.json`](#registriesjson)
  - [`servers/<name>.json`](#serversnamejson--one-file-per-installed-server)
  - [`workspaces/<slug>.json`](#workspacesslugjson--one-file-per-workspace-custom-aggregate)

## Environment variables

| Variable | Default | |
| --- | --- | --- |
| `MCP_ROUTER_TOKEN` | generated | Bearer token for `/api/*` and `/mcp*`. Wins over `authToken` in settings.json. When neither is set, one is generated into settings.json on first run and logged once. The placeholder `change-me` is refused |
| `SECURE_LOCAL_NET` | off | `true` (or `1`, `yes`, `on`) turns bearer auth off for `/api` and `/mcp`, and no token is minted. Overrides `authEnabled`. Only on a network you trust |
| `PORT` | `3000` | HTTP port. Wins over `port` in settings.json |
| `HOST` | all interfaces | Interface to bind. Wins over `host` in settings.json. `127.0.0.1` restricts it to localhost |
| `DATA_DIR` | `./data` (`/data` in the image) | Where config, installed server packages and caches live |
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

## Config files

All config lives as flat, hand-editable JSON under `DATA_DIR/config`: `./data/config` locally, `/data/config`
in Docker, which is `./data/config` on the host with the usual bind mount. The router writes these files with
mode `0600`. Unknown keys are preserved across round-trips.

After hand-editing, either wait for the file watcher to pick the change up or apply it explicitly:

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

The file (and server) name doubles as the route segment (`/mcp/<name>`) and the install directory
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

### `workspaces/<slug>.json` — one file per workspace (custom aggregate)

A **workspace** exposes a chosen subset of servers as its own aggregate at `/mcp/w/<slug>`. The `slug`
doubles as the filename and is derived from the name. Each member may override the base server's `env`,
`args`, or `headers` for that workspace only. Each member runs as an isolated downstream instance, so a
workspace can run a server that's globally disabled, and its overrides never touch the base server.

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

A member's effective enabled state is `workspace.enabled && member.enabled`. The base server's own `enabled`
flag is ignored inside a workspace. Members that reference a server which no longer exists are skipped.
Manage workspaces from the **Workspaces** page in the web UI, or hand-edit these files and reload.
