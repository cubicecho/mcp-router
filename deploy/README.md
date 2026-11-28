# Deploying MCP Router

Ready-made files for running the published image
([`vantreeseba/mcp-router`](https://hub.docker.com/r/vantreeseba/mcp-router), also on
`ghcr.io/cubicecho/mcp-router`, for `linux/amd64` and `linux/arm64`).

| File | For |
| --- | --- |
| [`docker-compose.yml`](docker-compose.yml) | Docker Compose, and the stack Portainer and Dockhand deploy |
| [`templates.json`](templates.json) | A Portainer / Dockhand app-template catalog |
| [`qnap/docker-compose.yml`](qnap/docker-compose.yml) | QNAP Container Station: paste in as an Application |
| [`qnap/app-template.json`](qnap/app-template.json) | QNAP Container Station: a custom App Template |

The router keeps its config in Postgres, which it needs to start: the compose files run one beside it
(`postgres:17`, its data in a named volume or a NAS folder), and the single-container templates take a
`DATABASE_URL` pointing at one you already run. Installed server packages and caches go in a data folder
mounted at `/data`. Either way the router ends up on port 3000. Open
`http://<host>:3000` and sign in: as the local admin with `SECURE_LOCAL_NET=true`, or through your OIDC provider
(see [Authentication](../README.md#authentication)). Install servers from the **Browse** page, and make an API key
for each MCP client under **Settings → API keys**. Every file needs `BETTER_AUTH_SECRET`, which signs sessions:
the image runs in production, where the router refuses to start without a strong one.

## Docker Compose

```bash
mkdir -p mcp-router/data && cd mcp-router
# The container runs as uid 1000 (node), and Docker would create a missing folder as root.
sudo chown 1000:1000 data
curl -O https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/docker-compose.yml
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" > .env
echo "SECURE_LOCAL_NET=true" >> .env   # on a private network; or set OIDC_ISSUER and OIDC_CLIENT_ID
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up -d
```

The file reads these from the environment or a `.env` beside it:

| Variable | Default | |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | required | Signs web UI sessions. `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | `mcp_router` | Password of the bundled Postgres. Set it before the first start: Postgres keeps the one it was created with |
| `DATABASE_URL` | the bundled Postgres | Point the router at your own Postgres instead (then the `postgres` service can go) |
| `MCP_ROUTER_PORT` | `3000` | Host port |
| `MCP_ROUTER_DATA` | `./data` | Host folder mounted at `/data` for installed server packages and caches, writable by uid 1000 |
| `MCP_ROUTER_VERSION` | `latest` | Image tag, e.g. `1.4.0` to pin a release |
| `SECURE_LOCAL_NET` | `false` | `true` signs whoever opens the UI in as the local admin. Only on a network you trust. MCP clients still need an API key |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | unset | Sign in through an OIDC provider. Or leave them unset and paste the provider's setup URL on the login page |
| `MCP_ROUTER_TOKEN` | unset | Upgrading: the old router token, imported as an API key with the same value |

## Portainer

1. **Settings → App Templates**, set the URL to
   `https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/templates.json` and save.
   Portainer takes one catalog URL, so this replaces its built-in list while it is set.
2. **App Templates**, pick **MCP Router** (a stack built from `deploy/docker-compose.yml`) or
   **MCP Router (single container)**, which needs `DATABASE_URL` to a Postgres you already run. Fill in
   `BETTER_AUTH_SECRET` and deploy.

To keep Portainer's own catalog, skip the template and add it as a stack instead: **Stacks → Add stack →
Repository**, URL `https://github.com/cubicecho/mcp-router`, compose path `deploy/docker-compose.yml`, and
add `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD` under environment variables.

## Dockhand

1. **Templates → Sources**, add a source named `MCP Router` with the URL
   `https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/templates.json`.
2. On the **Templates** tab, pick **MCP Router** and deploy.
   - The stack opens `deploy/docker-compose.yml` in the editor. Set `BETTER_AUTH_SECRET` and
     `POSTGRES_PASSWORD` in the stack's environment before you deploy.
   - **MCP Router (single container)** asks for `BETTER_AUTH_SECRET` and a `DATABASE_URL` in the deploy dialog
     instead.

## QNAP Container Station 3

Either way, first create the folder `Container/mcp-router/data` in File Station. That is where installed
servers are kept; the config is in Postgres. The container runs as uid 1000, so give that uid write access: over SSH,
`sudo chown 1000:1000 /share/Container/mcp-router/data`.

**As an Application** (Docker Compose):

1. **Applications → Create**, name it `mcp-router`.
2. Create `Container/mcp-router/postgres` too, for the bundled Postgres. Paste in
   [`qnap/docker-compose.yml`](qnap/docker-compose.yml), replace `change-me` with a long random secret and
   `pg-change-me` (twice) with a database password. Container Station doesn't read `.env` files, so the value goes in the YAML. The router refuses
   to start while it is still `change-me`.
3. **Validate YAML**, then **Create**.

**As an App Template:**

1. **Preferences → App Templates**, turn on **Enable custom template** and enter
   `https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/qnap/app-template.json`.
2. **App Templates → Custom Templates → MCP Router → Deploy**. In the wizard, set `BETTER_AUTH_SECRET`
   and `DATABASE_URL` (a Postgres you already run, on the NAS or elsewhere) and check the `/data` folder
   mapping before you create it.

Both run on x86 and ARM (`arm64`) NAS models. 32-bit ARM models aren't supported.

## LAN discovery

Finding MCP servers on the network, and announcing the router, uses mDNS multicast. Docker's default bridge
network drops that. To use it, run the container with host networking (`network_mode: host` in compose,
or **Host** as the network mode in Portainer or Container Station) instead of publishing port 3000.
