# MCP Router

One endpoint for every MCP server. MCP Router installs
[Model Context Protocol](https://modelcontextprotocol.io) servers from registries (by default the
[official registry](https://registry.modelcontextprotocol.io)), from npm or from PyPI. It runs them for you,
or proxies remote ones, and serves every one of them over streamable HTTP:

- **Per-server routes:** each installed server at `http://host:3000/mcp/<name>`
- **One aggregate endpoint:** `http://host:3000/mcp` merges all enabled servers, with tool names namespaced as
  `<server>__<tool>` (resources, resource templates and prompts likewise)
- **Workspaces:** a chosen subset of servers at its own `http://host:3000/mcp/w/<slug>`, with optional
  per-workspace `env`/`args`/`headers` overrides, so each client gets exactly the tools it needs

Point your MCP clients at the router instead of configuring every server in every client. Manage it all from
the built-in web UI.

![The Servers page](site/src/assets/screenshots/servers.png)

## Quickstart

The router keeps its config in Postgres, so it runs beside one. Make the data folder, owned by uid 1000
(the container's `node` user), and save this as `docker-compose.yml` beside it:

```bash
mkdir data && sudo chown 1000:1000 data
```

```yaml
services:
  mcp-router:
    image: vantreeseba/mcp-router:latest
    depends_on:
      postgres: { condition: service_healthy }
    ports:
      - '3000:3000'
    volumes:
      - ./data:/data
    environment:
      DATABASE_URL: postgres://mcp_router:pg-change-me@postgres:5432/mcp_router
      MCP_ROUTER_TOKEN: change-me # replace with a long random value: openssl rand -hex 32
    restart: unless-stopped
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: mcp_router
      POSTGRES_PASSWORD: pg-change-me # and in DATABASE_URL above
      POSTGRES_DB: mcp_router
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U mcp_router -d mcp_router']
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped
volumes:
  pgdata:
```

```bash
docker compose up -d
```

Open http://localhost:3000, sign in with your token, and install a server from the **Browse** page. Then
[connect your client](#connecting-mcp-clients).

The config (settings, servers, workspaces, secrets) lives in Postgres. Installed server packages and caches
live in `./data`, which must stay writable by uid 1000: a folder an older image wrote to (they ran as root)
needs `sudo chown -R 1000:1000 data`. The router refuses to start without a `postgres://` `DATABASE_URL`, and
while the token is still `change-me`. Leave `MCP_ROUTER_TOKEN` out entirely and it generates one into its
database, printing it once to the log (`docker compose logs`).

Or without compose, against a Postgres you already run:

```bash
docker run -d -p 3000:3000 -v ./data:/data \
  -e DATABASE_URL=postgres://mcp_router:secret@192.168.1.20:5432/mcp_router \
  -e MCP_ROUTER_TOKEN=your-secret-token \
  vantreeseba/mcp-router:latest
```

The image is on [Docker Hub](https://hub.docker.com/r/vantreeseba/mcp-router) and as
`ghcr.io/cubicecho/mcp-router`, for `linux/amd64` and `linux/arm64`. It is tagged `latest` and with each
release's version.

### Other ways to install

Ready-made files are in [`deploy/`](deploy/README.md):

- **Portainer** and **Dockhand:** an app-template catalog with the router as a stack or a single container
- **QNAP Container Station:** a compose file to paste in as an Application, and a custom App Template
- **A fuller compose file**, with the port, data folder, database password and image tag set from `.env`

### Upgrading from 2.x

- **The router now needs a Postgres.** Add one beside it (the `postgres` service in the
  [quickstart](#quickstart) or [`deploy/docker-compose.yml`](deploy/docker-compose.yml)) or use one you
  already run, and set `DATABASE_URL` to it. Without a `postgres://` `DATABASE_URL` the router refuses to
  start.
- **Config moves into that database.** On its first boot against an empty database the new router imports
  the old config files under `DATA_DIR/config` automatically and renames them `*.imported`. Nothing else
  needs doing by hand: keep the same `/data` mount so it finds them.
- **Config is no longer hand-editable.** Manage it from the web UI or `/graphql`; there is no file
  watcher. See [docs/configuration.md](docs/configuration.md#upgrading-from-the-config-files).
- **The data folder must be writable by uid 1000.** The image no longer runs as root, so give a folder an older
  image wrote to to its `node` user: `sudo chown -R 1000:1000 data`.

## Connecting MCP clients

All MCP endpoints speak streamable HTTP and require the bearer token (unless auth is off).

**Claude Code**, the aggregate endpoint (every enabled server, tools named `<server>__<tool>`):

```bash
claude mcp add --transport http router http://localhost:3000/mcp \
  --header "Authorization: Bearer <token>"
```

Or a single server, without the prefix:

```bash
claude mcp add --transport http github http://localhost:3000/mcp/github \
  --header "Authorization: Bearer <token>"
```

Or a workspace, which holds just the servers that client should see:

```bash
claude mcp add --transport http coding http://localhost:3000/mcp/w/coding-assistant \
  --header "Authorization: Bearer <token>"
```

**Other clients:** any client that supports streamable HTTP works. The usual JSON config shape:

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

Swap the URL for `http://localhost:3000/mcp/<name>` to expose just one server, or
`http://localhost:3000/mcp/w/<slug>` for a workspace.

**Instructions come through.** A server that ships `instructions` in its initialize result has them handed to
your client verbatim on `/mcp/<name>`. The aggregates combine what their members have said into one document,
each under a `## <server>` heading, with a note up front that every name is `<server>__`-prefixed. An
aggregate never starts a server just to read its instructions. A member that hasn't run yet in this router
process contributes nothing until it does, so reconnect after it wakes to pick them up.

## What it does

- stdio servers start on the first request, stay warm, and shut down after an idle timeout (default 5
  minutes, per-server override)
- Full MCP passthrough: tools, resources, resource templates, prompts, completions, logging and resource
  subscriptions. Downstream `list_changed`, resource-update and log notifications are relayed over a stateful
  session, and a dropped SSE stream resumes without a gap via `Last-Event-ID`. A server's elicitation is put
  to the session whose call asked for it. Sampling and roots are not proxied yet
- One bearer token guards the management API and all MCP endpoints
- Config lives in Postgres (`DATABASE_URL`), migrated on every boot. A router upgraded from the file-based
  config imports `DATA_DIR/config` on its first boot and renames the files `*.imported`

### Workspaces

A workspace is a custom aggregate: pick servers on the **Workspaces** page and the workspace serves just
those at `/mcp/w/<slug>`. Each member can override the server's `env`, `args` or `headers` for that workspace
only. Members run as separate instances, so a workspace can run a server that is turned off globally, and its
overrides never touch the base server.

### Remote servers that need a login

Some remote MCP servers (Home Assistant's, and most hosted ones) don't take an API key. They ask the client to
sign in with OAuth instead, the way `codex mcp add homeassistant --url …` opens a browser login. MCP Router
does the same:

1. **Add server → HTTP (streamable)**, with the server's URL, e.g. `http://homeassistant.local:8123/api/mcp`.
   No headers needed.
2. If the server asks for a login, the dialog moves on to **Sign in**. Click it and log in in the window that
   opens. The window closes itself and the server shows as running. You can also sign in later from the
   server's page or its row in the list (it shows **needs sign-in**).

MCP Router keeps the tokens in its database (like other secrets, plaintext, never sent to
the web UI) and refreshes them on its own. **Sign out** on the server's page forgets them.

The login sends your browser back to `<router>/oauth/callback`. Servers that identify clients by URL (Home
Assistant does) fetch `<router>/oauth/client-metadata.json`. Both are served without the bearer token. The
server must be able to reach that address, so set `publicUrl` on the Settings page when
the router is reached by a different name than the one in your browser. Home Assistant's login also checks
that the URL you use for it matches its configured Internal or External URL.

For a server whose login only accepts a client registered in advance, open **OAuth client (optional)** in the
add or edit dialog and enter its client ID and secret.

### Network discovery

The router describes its endpoints so other tools can find them without being given each URL:
`GET /.well-known/ai-catalog.json` lists the aggregate, every enabled server and every enabled workspace, each
with an [MCP Server Card](https://modelcontextprotocol.io/seps/2127-mcp-server-cards) at
`<endpoint>/server-card`. Both are public. A card says when the bearer token is needed but never carries it.

With **Look for servers on the network** on (the default), the router watches for MCP servers other machines
announce over mDNS, such as [mcp-skills-manager](https://github.com/cubicecho/mcp-skills-manager) with its
advertising on. Each one shows on the Servers page under **Found on your network**:

- **Add** opens a dialog for its local name and any token it needs, and adds it as a remote server.
- **Dismiss** hides it until you offer it again from Settings.

Nothing is added without you. Other routers' endpoints are never offered, so two routers can't add each other
in a loop. A server added this way remembers where it came from, and when it shows up at a new address the
router points the config there.

**Announce this router** (off by default) makes the router itself findable as `MCP Router on <instanceId>`.
mDNS needs multicast, which Docker's default bridge network drops. In a container, use `network_mode: host`
for discovery to work in either direction. All of this comes from
[`@cubicecho/mcp-discovery`](https://github.com/cubicecho/mcp-discovery).

## Configuration

The main environment variables:

| Variable | |
| --- | --- |
| `MCP_ROUTER_TOKEN` | The bearer token. Generated into the database when unset |
| `SECURE_LOCAL_NET` | `true` turns auth off. Only on a network you trust |
| `PORT` / `HOST` | Where to listen (default `3000` on all interfaces) |
| `DATABASE_URL` | Required. The `postgres://` (or `postgresql://`) URL of the router's Postgres |
| `DATA_DIR` | Where installed server packages and caches live (`/data` in the image) |

Everything else (`DB_CONNECT_TIMEOUT_MS`, the keep-alive timeouts, what the settings, registries, servers and
workspaces hold, upgrading and backups) is in [docs/configuration.md](docs/configuration.md). The GraphQL management API and the MCP
endpoints are in [docs/api.md](docs/api.md).

## Security notes

- **Secrets are stored in plaintext** in the database: `env` values, remote-transport headers, OAuth
  tokens and client secrets, and the auth token. Anyone who can read the Postgres database, its volume or
  a dump of it can read them. Protect it accordingly and keep backups equally private.
- **One bearer token guards everything** (`/graphql`, `/admin/mcp` and `/mcp*`). Treat it like a password. Setting
  `authEnabled: false` in the settings, or `SECURE_LOCAL_NET=true` in the environment, turns auth off
  entirely. Only do that on a trusted network. The `/mcp` Origin guard still applies with auth off, so a
  malicious web page can't reach the endpoints through DNS rebinding.
- **Do not expose the router directly to the internet.** It speaks plain HTTP, so the bearer token would
  travel in cleartext. Put it behind a TLS-terminating reverse proxy (Caddy, nginx, Traefik) if it must be
  reachable remotely, and otherwise bind it to localhost or a private network.
- Installed servers run as child processes of the router with the env vars you configure. Installing a
  server means running its code with access to those secrets. Install packages you trust.
- **The Activity tab keeps recent request and response bodies in memory.** For debugging, the router keeps
  the newest 200 proxied calls per server, including tool arguments and results, which may contain sensitive
  data. They are bounded, never written to disk, cleared when the server is removed or the process exits, and
  clearable from the UI. Anyone with the bearer token can read them through GraphQL's `serverActivity`.

## Limitations

- **The image runs npm and PyPI servers.** It ships Node (npm, npx) and `uv`/`uvx`. `uv` fetches its own
  Python on first use and keeps it under `/data/uv`. Servers that need anything else (a Go or Rust binary,
  Deno, Docker) need an image extended with that runtime, e.g.:

  ```dockerfile
  FROM vantreeseba/mcp-router:latest
  RUN apt-get update && apt-get install -y --no-install-recommends <your-runtime> \
      && rm -rf /var/lib/apt/lists/*
  ```

  then set the server's `transport.command` accordingly.
- Installing at runtime needs outbound network access from the container to the npm registry and PyPI.

---

## Development

npm-workspaces monorepo: `shared/` (zod schemas, the contract), `server/` (Express 5 + MCP TS SDK), `app/`
(React 19 + Vite + shadcn/ui). See [AGENTS.md](AGENTS.md) for conventions and [SPECS.md](SPECS.md) for the
full design and work list.

### Run from source

Requires Node >= 26 (the server runs its TypeScript sources directly).

```bash
npm install
npm run db:up    # a Postgres for development, on localhost:5433 (docker-compose.dev.yml)
npm run build
DATABASE_URL=postgres://mcp_router:mcp_router@localhost:5433/mcp_router \
  MCP_ROUTER_TOKEN=your-secret-token npm start
```

The server listens on port 3000 and serves the built web UI, with its config in that Postgres and installed
packages in `./data`. `npm start` and `npm run dev` also read a `.env` from the repo root
(`cp .env.example .env`), which is the easier place for `DATABASE_URL`. Tests need no Postgres: they run on
an in-memory PGlite.

To build and run the image from your checkout instead, `docker compose up -d --build` uses the root
[`docker-compose.yml`](docker-compose.yml).

### Commands

```bash
npm run dev      # server (watch, :3001) + Vite dev server (:3000)
npm run check    # biome + tsc for all packages
npm test         # vitest: server, app, then the stories in Chromium
npm run build    # the web UI (the server has no build step)
```
