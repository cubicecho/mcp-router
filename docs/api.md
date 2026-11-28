# API reference

## REST API

The management API lives under `/api`, takes the bearer token, and speaks JSON in and out. Errors are
non-2xx with `{ "error": "...", "detail": "..." }`.

| Method & path | Purpose |
| --- | --- |
| `GET /healthz` | Liveness, **no auth** (not under `/api`): `{ "ok": true, "version": "…" }`. What the container healthcheck calls |
| `GET /api/status` | Router status (version, auth mode, running/total servers) |
| `GET /api/registries` | List configured registries |
| `POST /api/registries` | Add a registry `{ name, url }` |
| `DELETE /api/registries/:name` | Remove a registry |
| `GET /api/registries/:name/servers?search=&cursor=&limit=` | Search that registry |
| `GET /api/registries/:name/servers/:serverName` | Registry entry detail (latest version) |
| `GET /api/servers` | All installed servers with runtime state |
| `POST /api/servers` | Install (from a registry entry, a raw npm package, or a remote URL) |
| `GET /api/servers/:name` | Single server status |
| `PATCH /api/servers/:name` | Update env / enabled / transport; saved to its database row |
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
| `POST /api/reload` | Re-read all config from the database and reconcile running processes |

## MCP endpoints

All three speak streamable HTTP and take the bearer token.

| Endpoint | Purpose |
| --- | --- |
| `POST/GET/DELETE /mcp/<name>` | Proxy 1:1 to that server (tools, resources, prompts) |
| `POST/GET/DELETE /mcp` | Aggregate of all enabled servers, `<server>__` name prefix |
| `POST/GET/DELETE /mcp/w/<slug>` | A workspace's custom aggregate — same `<server>__` prefix, over its members only |

All three forward downstream `instructions`. See
[Connecting MCP clients](../README.md#connecting-mcp-clients) in the README.

## Discovery

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/ai-catalog.json` | Lists the aggregate, every enabled server and every enabled workspace. Public |
| `GET <endpoint>/server-card` | That endpoint's [MCP Server Card](https://modelcontextprotocol.io/seps/2127-mcp-server-cards). Public; says when the token is needed but never carries it |
