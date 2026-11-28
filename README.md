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
      BETTER_AUTH_SECRET: change-me # replace with a long random value: openssl rand -hex 32
      SECURE_LOCAL_NET: 'true' # on a private network: opening the UI signs you in. See Authentication
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

Open http://localhost:3000. With `SECURE_LOCAL_NET=true` you are signed in as the local admin; otherwise
sign in through your OIDC provider (see [Authentication](#authentication)). Install a server from the
**Browse** page, make an API key under **Settings → API keys**, and
[connect your client](#connecting-mcp-clients) with it.

The config (settings, servers, workspaces, secrets) lives in Postgres. Installed server packages and caches
live in `./data`, which must stay writable by uid 1000: a folder an older image wrote to (they ran as root)
needs `sudo chown -R 1000:1000 data`. The router refuses to start without a `postgres://` `DATABASE_URL`, and
without a strong `BETTER_AUTH_SECRET` (at least 32 characters, not a published placeholder).

Or without compose, against a Postgres you already run:

```bash
docker run -d -p 3000:3000 -v ./data:/data \
  -e DATABASE_URL=postgres://mcp_router:secret@192.168.1.20:5432/mcp_router \
  -e BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  -e SECURE_LOCAL_NET=true \
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

### Upgrading from the router token

The single bearer token is replaced by a sign-in for the UI and API keys for MCP clients and agents.

- **Your token keeps working.** On boot the router imports the token it kept in its settings as an API key
  with the same value, named "Imported router token", and clears the stored copy. `MCP_ROUTER_TOKEN`, when set,
  is imported the same way (named "MCP_ROUTER_TOKEN"). MCP clients configured with either need no change.
  Revoke them from **Settings → API keys** once your clients use keys of their own. A revoked
  `MCP_ROUTER_TOKEN` key comes back on the next boot while the variable is still set, so unset it first.
- **Set `BETTER_AUTH_SECRET`.** The image runs with `NODE_ENV=production`, where the router refuses to start
  without a strong secret: `openssl rand -hex 32`.
- **Sign in to the UI** through an OIDC provider, or set `SECURE_LOCAL_NET=true` on a private network. The UI
  no longer asks for the token. For OIDC, set `publicUrl` in Settings (or before, from the API) to the
  address your browser uses.
- **`SECURE_LOCAL_NET` still opens `/mcp` without a key**, and now also signs whoever opens the UI in as the
  local admin. `/graphql` and `/admin/mcp` take a session or an API key.
- **`authEnabled: false` is ignored**, with a warning at boot. Use `SECURE_LOCAL_NET=true` for a router on a
  trusted network.

## Authentication

**People sign in to the UI**, and their sessions live in Postgres, so a restart signs nobody out. There are
two ways:

- **An OIDC provider** (heautou, Keycloak, Authentik, ...). Either set `OIDC_ISSUER` and `OIDC_CLIENT_ID` (plus
  `OIDC_CLIENT_SECRET` for a confidential client, `OIDC_CLIENT_AUTH` and `OIDC_NAME` for the button), or leave
  them unset and paste a setup URL from your provider on the login page (on a new router) or in Settings (as
  the admin): the router registers itself with the provider by Dynamic Client Registration. The environment
  wins and can't be changed from the UI. The redirect URI is `<publicUrl>/api/auth/callback/oidc`, so set
  `publicUrl` in Settings to the address your browser uses. The first person to sign in becomes the admin,
  the only one who may pair or disconnect the provider afterwards.
- **`SECURE_LOCAL_NET=true`**: whoever opens the UI is signed in as the local admin, with no provider. Only on
  a network nothing hostile can reach. The router refuses to start with it when `publicUrl` is not a private
  address, unless `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true`.

Sessions are signed with `BETTER_AUTH_SECRET`, which production requires (at least 32 characters:
`openssl rand -hex 32`). Sign-in attempts are throttled per client address; behind a reverse proxy set
`TRUST_PROXY` (for example `1`) so the router sees the real address.

**Machines use API keys.** Make one under **Settings → API keys**; it is shown once, and only its hash is kept.
Send it as `Authorization: Bearer <api-key>` or `x-api-key: <api-key>`. The proxied MCP endpoints (`/mcp`,
`/mcp/<name>`, `/mcp/w/<slug>`) take a key and nothing else (a UI session never opens them), except under `SECURE_LOCAL_NET`, which opens
them without one. On `/graphql` and
`/admin/mcp` a key is an agent, which may do everything the router is for (servers, workspaces, registries,
tool calls) except manage API keys, read or end sessions, change how people sign in, and edit the settings.
Those are for a signed-in person, so a leaked key can't mint its successor.

## Connecting MCP clients

All MCP endpoints speak streamable HTTP and require an API key (see [Authentication](#authentication)).

**Claude Code**, the aggregate endpoint (every enabled server, tools named `<server>__<tool>`):

```bash
claude mcp add --transport http router http://localhost:3000/mcp \
  --header "Authorization: Bearer <api-key>"
```

Or a single server, without the prefix:

```bash
claude mcp add --transport http github http://localhost:3000/mcp/github \
  --header "Authorization: Bearer <api-key>"
```

Or a workspace, which holds just the servers that client should see:

```bash
claude mcp add --transport http coding http://localhost:3000/mcp/w/coding-assistant \
  --header "Authorization: Bearer <api-key>"
```

**Other clients:** any client that supports streamable HTTP works. The usual JSON config shape:

```json
{
  "mcpServers": {
    "router": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <api-key>"
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
- A sign-in (OIDC, or the local admin on a trusted network) for the UI, and API keys for MCP clients and agents
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
Assistant does) fetch `<router>/oauth/client-metadata.json`. Both are served without a credential. The
server must be able to reach that address, so set `publicUrl` on the Settings page when
the router is reached by a different name than the one in your browser. Home Assistant's login also checks
that the URL you use for it matches its configured Internal or External URL.

For a server whose login only accepts a client registered in advance, open **OAuth client (optional)** in the
add or edit dialog and enter its client ID and secret.

### Network discovery

The router describes its endpoints so other tools can find them without being given each URL:
`GET /.well-known/ai-catalog.json` lists the aggregate, every enabled server and every enabled workspace, each
with an [MCP Server Card](https://modelcontextprotocol.io/seps/2127-mcp-server-cards) at
`<endpoint>/server-card`. Both are public. A card says an API key is needed but never carries one.

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
| `BETTER_AUTH_SECRET` | Signs sessions. Required in production: `openssl rand -hex 32` |
| `SECURE_LOCAL_NET` | `true` signs whoever opens the UI in as the local admin. Only on a network you trust |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` | Sign in through this OIDC provider (or pair one from the login page) |
| `TRUST_PROXY` | How many proxies to believe `X-Forwarded-For` from, for the sign-in throttle |
| `MCP_ROUTER_TOKEN` | Optional. Imported on boot as an API key with this value |
| `PORT` / `HOST` | Where to listen (default `3000` on all interfaces) |
| `DATABASE_URL` | Required. The `postgres://` (or `postgresql://`) URL of the router's Postgres |
| `DATA_DIR` | Where installed server packages and caches live (`/data` in the image) |

Everything else (`DB_CONNECT_TIMEOUT_MS`, the keep-alive timeouts, what the settings, registries, servers and
workspaces hold, upgrading and backups) is in [docs/configuration.md](docs/configuration.md). The GraphQL management API and the MCP
endpoints are in [docs/api.md](docs/api.md).

## Security notes

- **Secrets are stored in plaintext** in the database: `env` values, remote-transport headers, OAuth
  tokens and client secrets, and the OIDC pairing's client secret. API keys and sessions are stored as hashes or
  random tokens. Anyone who can read the Postgres database, its volume or
  a dump of it can read them. Protect it accordingly and keep backups equally private.
- **An API key is a password.** It opens every MCP endpoint, and the management API short of keys, sessions,
  sign-in setup and settings. Give each client its own and revoke one that leaks. `SECURE_LOCAL_NET=true`
  makes the network the credential for the UI: only on a trusted network. The `/mcp` Origin guard applies
  either way, so a malicious web page can't reach the endpoints through DNS rebinding.
- **Do not expose the router directly to the internet.** It speaks plain HTTP, so keys and sessions would
  travel in cleartext. Put it behind a TLS-terminating reverse proxy (Caddy, nginx, Traefik) if it must be
  reachable remotely, and otherwise bind it to localhost or a private network.
- Installed servers run as child processes of the router with the env vars you configure. Installing a
  server means running its code with access to those secrets. Install packages you trust.
- **The Activity tab keeps recent request and response bodies in memory.** For debugging, the router keeps
  the newest 200 proxied calls per server, including tool arguments and results, which may contain sensitive
  data. They are bounded, never written to disk, cleared when the server is removed or the process exits, and
  clearable from the UI. Anyone with an API key or a session can read them through GraphQL's `serverActivity`.

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
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" SECURE_LOCAL_NET=true npm start
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
