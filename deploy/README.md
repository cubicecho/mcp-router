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

Whichever you use, the router ends up on port 3000 with its state in one data folder. Open
`http://<host>:3000`, sign in with your token, and install servers from the **Browse** page. If you
left the token empty, one is generated on first start and printed once to the container log.

## Docker Compose

```bash
mkdir mcp-router && cd mcp-router
curl -O https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/docker-compose.yml
echo "MCP_ROUTER_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up -d
```

The file reads these from the environment or a `.env` beside it:

| Variable | Default | |
| --- | --- | --- |
| `MCP_ROUTER_TOKEN` | generated | The bearer token for the UI, the API and the MCP endpoints |
| `MCP_ROUTER_PORT` | `3000` | Host port |
| `MCP_ROUTER_DATA` | `./data` | Host folder mounted at `/data` |
| `MCP_ROUTER_VERSION` | `latest` | Image tag, e.g. `1.4.0` to pin a release |
| `SECURE_LOCAL_NET` | `false` | `true` turns auth off. Only on a network you trust |

## Portainer

1. **Settings → App Templates**, set the URL to
   `https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/templates.json` and save.
   Portainer takes one catalog URL, so this replaces its built-in list while it is set.
2. **App Templates**, pick **MCP Router** (a stack built from `deploy/docker-compose.yml`) or
   **MCP Router (single container)**, fill in the token and deploy.

To keep Portainer's own catalog, skip the template and add it as a stack instead: **Stacks → Add stack →
Repository**, URL `https://github.com/cubicecho/mcp-router`, compose path `deploy/docker-compose.yml`, and
add `MCP_ROUTER_TOKEN` under environment variables.

## Dockhand

1. **Templates → Sources**, add a source named `MCP Router` with the URL
   `https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/templates.json`.
2. On the **Templates** tab, pick **MCP Router** and deploy.
   - The stack opens `deploy/docker-compose.yml` in the editor. Set `MCP_ROUTER_TOKEN` in the stack's
     environment before you deploy.
   - **MCP Router (single container)** asks for the token in the deploy dialog instead.

## QNAP Container Station 3

Either way, first create the folder `Container/mcp-router/data` in File Station. That is where config and
installed servers are kept.

**As an Application** (Docker Compose):

1. **Applications → Create**, name it `mcp-router`.
2. Paste in [`qnap/docker-compose.yml`](qnap/docker-compose.yml) and replace `change-me` with a long random
   token. Container Station doesn't read `.env` files, so the value goes in the YAML. The router refuses
   to start while it is still `change-me`.
3. **Validate YAML**, then **Create**.

**As an App Template:**

1. **Preferences → App Templates**, turn on **Enable custom template** and enter
   `https://raw.githubusercontent.com/cubicecho/mcp-router/main/deploy/qnap/app-template.json`.
2. **App Templates → Custom Templates → MCP Router → Deploy**. In the wizard, set `MCP_ROUTER_TOKEN`
   and check the `/data` folder mapping before you create it.

Both run on x86 and ARM (`arm64`) NAS models. 32-bit ARM models aren't supported.

## LAN discovery

Finding MCP servers on the network, and announcing the router, uses mDNS multicast. Docker's default bridge
network drops that. To use it, run the container with host networking (`network_mode: host` in compose,
or **Host** as the network mode in Portainer or Container Station) instead of publishing port 3000.
