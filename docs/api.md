# API reference

## Management API: GraphQL

The router is managed through GraphQL at `POST /graphql`. The UI sends its session (`Authorization: Bearer <session>`);
an agent or script sends an API key (`Authorization: Bearer <api-key>` or `x-api-key: <api-key>`).
The same schema is offered to agents as MCP tools at `/admin/mcp`. There is no REST API: the routes that were under
`/api` were removed, and each has a GraphQL operation in their place (the table in
[SPECS.md](../SPECS.md#no-rest-api) maps them one to one).

**The schema documents itself.** Every field has a description. Outside production, open `/graphql` in a browser for
GraphiQL, which browses the schema and runs operations. `npm run codegen` prints the served schema to
`server/__generated__/schema.graphql`.

```sh
curl -s http://localhost:3000/graphql \
  -H "x-api-key: $MCP_ROUTER_API_KEY" -H 'Content-Type: application/json' \
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

### Signing in and API keys

| To | Use | Who |
| --- | --- | --- |
| How people sign in (trusted network, the OIDC button) | `authConfig` | anyone but an API key, signed out too |
| How OIDC is set up, and whether the caller may pair | `ssoSetup` | anyone but an API key, signed out too |
| Sign the UI in as the local admin under `SECURE_LOCAL_NET` | `signInOnTrustedNetwork` | anyone but an API key |
| Swap the OIDC callback's one-time token for a session | `verifyOneTimeToken(token)` | anyone but an API key |
| Pair or disconnect an OIDC provider from a setup URL | `pairSso(setupUrl)`, `unpairSso` | the admin, or anyone on a router with no accounts |
| The signed-in person | `me` | a session |
| Sessions | `getSession`, `listSessions`, `signOut`, `revokeSession(token)`, `revokeSessions`, `revokeOtherSessions` | a session |
| API keys | `apiKeys`, `createApiKey(name, expiresInDays)`, `revokeApiKey(id)` | a session |

`createApiKey` answers `{ key, apiKey }`: `key` is the whole key, shown this once; only its hash is kept. A key
that is left out `expiresInDays` never expires.

**Who may call what.** The caller comes from the credential: a session is the operator, an API key an agent, neither
nobody. An agent may do everything above the sign-in table (read everything, install and manage servers and
workspaces, call their tools), but not manage keys, read or end sessions, change how people sign in, or edit the
settings: those are `FORBIDDEN` to it, so a leaked key can't mint its successor. Nobody may only sign in.
`RouterStatus.authEnabled` is gone: auth is always on.

A workspace's try-it calls take the name its aggregate shows (`<server>__<tool>`) and run on that member's own
instance, with the workspace's overrides. Every try-it call is recorded in the activity log.

A tool call answers `{ content, structuredContent, isError }`: `isError: true` is a tool that reported its own
failure, which is still an answer. A server that fails is an error.

### Errors

A refused operation answers `200` with `errors`, each with `extensions.code` (`BAD_USER_INPUT`, `NOT_FOUND`,
`CONFLICT`, `FORBIDDEN`, `UPSTREAM_FAILED`, `UNAVAILABLE`, `UPSTREAM_TIMEOUT`, `QUERY_TOO_COMPLEX`, …) and, where there
is more to say, `extensions.detail` (a child's stderr, the field a value broke). Branch on the code, never on the
message. A request with no credential, or a dead one, is still answered `200`, each field refused as
`UNAUTHENTICATED`, because `/graphql` is also where signing in happens. Two different keys in `Authorization` and
`x-api-key` are `BAD_USER_INPUT`. A sign-in step tried too often from one address is `TOO_MANY_REQUESTS`, with
`extensions.retryAfter` in seconds.

Every list takes `limit`. Operations are bounded in depth, aliases and cost, and refused as `QUERY_TOO_COMPLEX` past
them.

## Health

`GET /healthz` takes **no auth**: `{ "ok": true, "version": "…" }`. It is what the container healthcheck calls.

## MCP endpoints

All three speak streamable HTTP and take an API key, as `Authorization: Bearer <api-key>` or `x-api-key`, and nothing
else: a UI session never opens them. Under `SECURE_LOCAL_NET` they are open without a key, as before keys. Otherwise
no key or a dead one is a `401`, two different keys a `400`.

| Endpoint | Purpose |
| --- | --- |
| `POST/GET/DELETE /mcp/<name>` | Proxy 1:1 to that server (tools, resources, prompts) |
| `POST/GET/DELETE /mcp` | Aggregate of all enabled servers, `<server>__` name prefix |
| `POST/GET/DELETE /mcp/w/<slug>` | A workspace's custom aggregate — same `<server>__` prefix, over its members only |

All three forward downstream `instructions`. See
[Connecting MCP clients](../README.md#connecting-mcp-clients) in the README.

`/admin/mcp` is a different thing: the router's own management API as MCP tools (`install_server`, `servers`,
`restart_server`, …), for an agent that manages the router rather than one that uses its servers. It takes an API key
or a session, answers a request with neither with a `401`, and permissions decide which tools each may call.

Refused requests on these endpoints answer with a JSON body `{ "error": "...", "code": "...", "detail": "..." }` and
the status the code maps to (`NOT_FOUND` 404, `UNAUTHENTICATED` 401, …).

## Discovery

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/ai-catalog.json` | Lists the aggregate, every enabled server and every enabled workspace. Public |
| `GET <endpoint>/server-card` | That endpoint's [MCP Server Card](https://modelcontextprotocol.io/seps/2127-mcp-server-cards). Public; says an API key is needed but never carries one |
