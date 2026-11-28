# API reference

## Management API: GraphQL

The router is managed through GraphQL at `POST /graphql`, with the bearer token (`Authorization: Bearer <token>`).
The same schema is offered to agents as MCP tools at `/admin/mcp`. There is no REST API: the routes that were under
`/api` were removed, and each has a GraphQL operation in their place (the table in
[SPECS.md](../SPECS.md#no-rest-api) maps them one to one).

**The schema documents itself.** Every field has a description. Outside production, open `/graphql` in a browser for
GraphiQL, which browses the schema and runs operations. `npm run codegen` prints the served schema to
`server/__generated__/schema.graphql`.

```sh
curl -s http://localhost:3000/graphql \
  -H "Authorization: Bearer $MCP_ROUTER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"{ routerStatus { version serverCount runningCount } }"}'
```

### What is there

| To | Use |
| --- | --- |
| Read the router's status | `routerStatus` |
| List, add, remove registries | `registries`, `createRegistry`, `deleteRegistry` |
| Search a registry | `registryServers(registry, search, cursor, limit)`, `registryServer(registry, name)` |
| List servers, and their live state | `servers`, `server(where)`, `serverRuntimes`, `serverRuntime(name)` |
| Install, edit, remove a server | `installServer(input)`, `updateServer(name, input)`, `deleteServer(name)` |
| Restart a server (after env edits) | `restartServer(name)` |
| Sign a remote server in or out | `checkServerOAuth(name)`, `startServerOAuth(name, origin)`, `signOutServerOAuth(name)` |
| List what a server offers | `serverTools(name)`, `serverResources(name)`, `serverPrompts(name)` |
| Try a server's tool, resource or prompt | `callServerTool(name, tool, arguments)`, `readServerResource(name, uri)`, `getServerPrompt(name, prompt, arguments)` |
| Read or clear a server's activity | `serverActivity(name)`, `clearServerActivity(name)` |
| List, save, delete workspaces | `workspaces`, `workspace(where)`, `saveWorkspace(input)`, `deleteWorkspace(where)` |
| The same for a workspace | `workspaceTools(slug)`, `workspaceResources`, `workspacePrompts`, `workspaceActivity`, `clearWorkspaceActivity`, `callWorkspaceTool(slug, tool, arguments)`, `readWorkspaceResource(slug, uri)`, `getWorkspacePrompt(slug, prompt, arguments)` |
| Change settings | `updateSetting(set, where: { id: { eq: 1 } })` |
| Servers found on the network | `lanServers`, `setLanServerDismissed(key, dismissed)` |
| Re-read config from the database (was `POST /api/reload`) | `reloadConfig` |

A workspace's try-it calls take the name its aggregate shows (`<server>__<tool>`) and run on that member's own
instance, with the workspace's overrides. Every try-it call is recorded in the activity log.

A tool call answers `{ content, structuredContent, isError }`: `isError: true` is a tool that reported its own
failure, which is still an answer. A server that fails is an error.

### Errors

A refused operation answers `200` with `errors`, each with `extensions.code` (`BAD_USER_INPUT`, `NOT_FOUND`,
`CONFLICT`, `FORBIDDEN`, `UPSTREAM_FAILED`, `UNAVAILABLE`, `UPSTREAM_TIMEOUT`, `QUERY_TOO_COMPLEX`, …) and, where there
is more to say, `extensions.detail` (a child's stderr, the field a value broke). Branch on the code, never on the
message. A missing or wrong token is a `401` before any operation runs.

Every list takes `limit`. Operations are bounded in depth, aliases and cost, and refused as `QUERY_TOO_COMPLEX` past
them.

## Health

`GET /healthz` takes **no auth**: `{ "ok": true, "version": "…" }`. It is what the container healthcheck calls.

## MCP endpoints

All three speak streamable HTTP and take the bearer token.

| Endpoint | Purpose |
| --- | --- |
| `POST/GET/DELETE /mcp/<name>` | Proxy 1:1 to that server (tools, resources, prompts) |
| `POST/GET/DELETE /mcp` | Aggregate of all enabled servers, `<server>__` name prefix |
| `POST/GET/DELETE /mcp/w/<slug>` | A workspace's custom aggregate — same `<server>__` prefix, over its members only |

All three forward downstream `instructions`. See
[Connecting MCP clients](../README.md#connecting-mcp-clients) in the README.

`/admin/mcp` is a different thing: the router's own management API as MCP tools (`install_server`, `servers`,
`restart_server`, …), for an agent that manages the router rather than one that uses its servers.

Refused requests on these endpoints answer with a JSON body `{ "error": "...", "code": "...", "detail": "..." }` and
the status the code maps to (`NOT_FOUND` 404, `UNAUTHENTICATED` 401, …).

## Discovery

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/ai-catalog.json` | Lists the aggregate, every enabled server and every enabled workspace. Public |
| `GET <endpoint>/server-card` | That endpoint's [MCP Server Card](https://modelcontextprotocol.io/seps/2127-mcp-server-cards). Public; says when the token is needed but never carries it |
