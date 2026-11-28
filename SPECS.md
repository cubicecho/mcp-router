# SPECS.md — MCP Router

An MCP gateway/router: install MCP servers from registries or npm, run them
locally (stdio) or point at remote ones (streamable HTTP), and re-expose every
one of them over streamable HTTP — per-server routes, one merged aggregate, and
per-**workspace** custom aggregates. Managed through a React web UI; state lives
in Postgres (`DATABASE_URL`, required).

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Exposure | Per-server routes `/mcp/<name>` **and** aggregate `/mcp` with namespaced tools (`<server>__<tool>`) **and** per-workspace custom aggregates `/mcp/w/<slug>` |
| Workspaces | Custom aggregates: a named subset of servers at `/mcp/w/<slug>` (slug auto-derived from name); per-member `env`/`args`/`headers`/`url` overrides; each member runs as an isolated downstream instance (key `w:<slug>:<server>`), so a workspace scope is fully independent of a server's global enabled state; effective enabled = `workspace.enabled && member.enabled` |
| Auth | better-auth ^1.7 over the same Postgres (`server/src/auth/`), as ai-router does it. **People** sign in to the UI through an OIDC provider (better-auth `genericOAuth`: `OIDC_ISSUER`/`OIDC_CLIENT_ID` in the environment, which wins, or one paired from a setup URL by Dynamic Client Registration and kept in `oidc_settings`); the callback hands the UI a one-time token it swaps for a bearer session over GraphQL (`verifyOneTimeToken`); sessions live in Postgres. `SECURE_LOCAL_NET=true` signs whoever opens the UI in as the local admin (`signInOnTrustedNetwork`), and boot refuses it when `publicUrl` is not a private address unless `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true`. **Machines** (agents, MCP clients) send an `@better-auth/api-key` key as `Authorization: Bearer` or `x-api-key`. The caller role comes from the credential, read once in `createContextFactory`: a session is `operator`, a key `agent`, neither nobody. The proxied `/mcp*` take a key only, except under `SECURE_LOCAL_NET`, which opens them without one (as before keys). An agent may do everything but manage keys, read or end sessions, change sign-in and edit settings. Who may pair a provider: the admin (the first account), or anyone while there are no accounts. Sign-in steps are throttled per address (`ctx.limiter`). better-auth's REST routes are not mounted: its endpoints are GraphQL fields (`@cubicecho/graphql-better-auth`), and only the OIDC start and callback are Express routes. The old router token (`settings.authToken`, `MCP_ROUTER_TOKEN`) is imported on boot as an API key with the same value; `authEnabled` is ignored |
| stdio lifecycle | Lazy spawn on first request, kept warm, killed after idle timeout (default 5 min, per-server override) |
| Secrets | Plaintext values in the database (the servers' `env`, headers and `oauth` columns, the OIDC pairing's client secret). API keys are stored as hashes; sessions as better-auth's random tokens |
| Remote OAuth | A remote server that asks for an MCP OAuth login (401 + `WWW-Authenticate`) is signed in from the UI: the router is the OAuth client (PKCE, Client ID Metadata Document or dynamic registration, or a typed-in client), tokens live in the server's row, and the SDK refreshes them. See [Remote OAuth sign-in](#remote-oauth-sign-in) |
| Config | Drizzle tables (`server/src/db/tables/`), migrations committed in `server/drizzle/` and run on boot. Postgres only: boot refuses to start, with a `[db]` message, unless `DATABASE_URL` is a `postgres://` or `postgresql://` URL, always waits for it (`waitForDatabase`), and in production forces TLS for a host the internet could reach (`requiresSsl`: not for private/LAN hosts or an explicit `sslmode`). PGlite is for tests only (an in-memory database per test file). The compose files run `postgres:17` beside the router. `ConfigStore` caches it in memory and emits `change` after every write; anything else that writes the tables calls `store.reload()`, as the `reloadConfig` mutation does. On first boot with an empty database the old `DATA_DIR/config` files are imported once and renamed `*.imported` |
| First registry | `https://registry.modelcontextprotocol.io` (API `GET /v0/servers`, server.json schema 2025-12-11), seeded as `official` |
| Stack | TypeScript everywhere, npm workspaces (`shared`, `server`, `app`), Express 5, MCP TS SDK, React 19 + Vite + Tailwind + shadcn/ui + TanStack Router/Query, Biome, Vitest |
| Server runtime | Node 26 type stripping everywhere: `node --watch src/index.ts` in dev, `node server/src/index.ts` in prod/Docker. No server build; `tsc --noEmit` only checks |
| Deploy | Single `node:26-slim` image running as `USER node`: build the app, copy the server and shared sources, Express serves `app/dist` statically; `docker-compose.yml` with a named volume at `/data` |
| Shared agent packages | **`@cubicecho/agent-mcp-pool` adopted.** `gateway/manager.ts` is an adapter over its `McpPool`; `gateway/naming.ts` stays local. `@cubicecho/agent-core` is an OpenAI-compatible agent loop and this repo makes no LLM calls — still out, see below |

## Layout & contracts

```
mcp-router/
├── shared/          # zod schemas + types (DONE — the contract, see shared/src/)
│   ├── config.ts    #   settings / registry / server / workspace config schemas (validated on every row read)
│   ├── registry.ts  #   MCP registry API response schemas
│   └── api.ts       #   what /graphql checks inputs against, gateway status, the HTTP error envelope
├── server/          # Express + MCP SDK backend        [Track A]
├── app/             # Vite + React + shadcn web UI     [Track B]
├── Dockerfile, docker-compose.yml, README.md           [Track C]
└── data/            # runtime, gitignored: servers/<name>/ (npm prefixes), caches, logs
```

### Config tables (one row per entry; the shapes are the shared schemas)

- `settings` (one row) — port, default idleTimeoutMs, connectTimeoutMs, default callTimeoutMs, session TTL/cap,
  publicUrl (the router's address: the OIDC sign-in's base and a remote's OAuth callback; `http://localhost:<port>`
  for sign-in, and the UI's origin for a remote's callback, when unset). `authToken` and `authEnabled` are
  deprecated and not served: boot imports `authToken` as an API key and clears it, and ignores `authEnabled`
- better-auth's tables — `users` (with `role`: admin or user; the first account is the admin), `sessions`,
  `accounts`, `verifications` (OIDC state, one-time tokens), `apikeys` (the api-key plugin's; `reference_id` is the
  maker's user id, or `router` for an imported token), and `oidc_settings` (the paired provider, one row or none).
  None is in the generated GraphQL schema
- `registries` — `{ name, url }`, seeded with `official`
- `servers` — one row per installed server (`serverConfigSchema`):
  name, enabled, source (registry | npm | pypi | remote), transport (stdio
  command/args | streamable-http url/headers), env (plaintext), envMeta (UI hints
  from the registry), idleTimeoutMs, callTimeoutMs, oauth (a remote's sign-in: typed-in
  clientId/clientSecret/scope, and the router-written clientInformation,
  redirectUri, tokens, tokensSavedAt — plaintext, never sent to the UI). npm packages install into
  `servers/<name>/` and run as `node <bin>`; pypi packages run as `uvx <pkg>`
  (uv resolves/caches on spawn, no install dir)
- `workspaces` + `workspace_members` — one row per workspace (`workspaceConfigSchema`): name,
  slug, enabled, description; `members` — a map of server
  name → `{ enabled, env?, args?, headers?, url? }`, stored as `workspace_members` rows by server id
  (deleting a server deletes its memberships; a member naming no server is not stored). Overrides merge over the
  base server config (`env`/`headers` shallow-merged, `args`/`url` replaced) for
  that workspace's instance only; `url` re-points a remote member's
  streamable-http endpoint (e.g. to scope a shared upstream to a workspace path);
  members whose server no longer exists are skipped

### Health (`/healthz`, no auth)

`GET /healthz` answers `200 { ok: true, version }` (`Health`) once the server is listening. It sits in front of
every credential check so Docker's healthcheck, the CI boot job and a load balancer can call it without a key,
and it reports nothing else.

### Discovery documents (no auth)

`GET /.well-known/ai-catalog.json` (an AI Catalog) and `GET <endpoint>/server-card` (an MCP Server Card, SEP-2127)
for the aggregate `/mcp`, every enabled server `/mcp/<name>` and every enabled workspace `/mcp/w/<slug>`. Mounted
ahead of the origin and auth guards because they are public by design; they are built per request from the
origin the client used, so a LAN client is told LAN URLs. A card names
`io.github.cubicecho.mcp-router.<instanceId>/<endpoint>`, declares `Authorization` as a required secret header
when auth is on (never its value), and carries `_meta["io.github.cubicecho.mcp-router/role"]`
(`aggregate` | `server` | `workspace`), plus `…/upstream` with the registry name for a registry-installed server.
Served by `discoveryMiddleware` from `@cubicecho/mcp-discovery`; the cards are built in `server/src/discovery/endpoints.ts`.

### No REST API

The management REST API under `/api` is gone (issue #91): the UI and agents use `/graphql` and its MCP door
`/admin/mcp`. A GET under `/api` is now one of the UI's own paths, so the SPA fallback answers it with the page; any
other method is a 404. Each route's replacement:

| Was | Now |
| --- | --- |
| `GET /api/status` | `routerStatus` |
| `GET` / `POST /api/registries`, `DELETE /api/registries/:name` | `registries`, `createRegistry`, `deleteRegistry` |
| `GET /api/registries/:name/servers`, `…/servers/:serverName` | `registryServers(registry, search, cursor)`, `registryServer(registry, name)` |
| `GET /api/servers`, `GET /api/servers/:name` | `servers`, `server(where)`, with `serverRuntimes` / `serverRuntime(name)` for the live state |
| `POST /api/servers`, `PATCH` / `DELETE /api/servers/:name` | `installServer`, `updateServer(name)`, `deleteServer(name)` |
| `POST /api/servers/:name/restart` | `restartServer(name)` |
| `POST …/oauth/check`, `POST …/oauth/start`, `DELETE …/oauth` | `checkServerOAuth`, `startServerOAuth(name, origin)`, `signOutServerOAuth` |
| `GET /api/servers/:name/{tools,resources,prompts}` | `serverTools`, `serverResources`, `serverPrompts` |
| `POST /api/servers/:name/tools/call` | `callServerTool(name, tool, arguments)` |
| `POST /api/servers/:name/resources/read` | `readServerResource(name, uri)` |
| `POST /api/servers/:name/prompts/get` | `getServerPrompt(name, prompt, arguments)` |
| `GET` / `DELETE /api/servers/:name/activity` | `serverActivity`, `clearServerActivity` |
| `GET` / `POST /api/workspaces`, `GET` / `PATCH` / `DELETE /api/workspaces/:slug` | `workspaces`, `workspace(where)`, `saveWorkspace`, `deleteWorkspace` |
| `GET /api/workspaces/:slug/{tools,resources,prompts,activity}`, `DELETE …/activity` | `workspaceTools`, `workspaceResources`, `workspacePrompts`, `workspaceActivity`, `clearWorkspaceActivity` |
| `POST /api/workspaces/:slug/{tools/call,resources/read,prompts/get}` | `callWorkspaceTool`, `readWorkspaceResource`, `getWorkspacePrompt` |
| `PATCH /api/settings` | `updateSetting` |
| `GET /api/discovery`, `POST /api/discovery/dismissed` | `lanServers`, `setLanServerDismissed(key, dismissed)` |
| `POST /api/reload` | `reloadConfig` |

The HTTP doors that remain (`/mcp*`, the auth and origin guards, a malformed body) still refuse with the JSON
envelope `{ error, code, detail? }` (`ApiError`), with the status the code maps to: `BAD_USER_INPUT` 400,
`UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `INTERNAL` 500, `UPSTREAM_FAILED` 502,
`UNAVAILABLE` 503, `UPSTREAM_TIMEOUT` 504.

### Management GraphQL (`/graphql`) and its MCP door (`/admin/mcp`), session or API key

The router's whole management API, over the same database the `ConfigStore` reads: `createApp`
requires the Drizzle `db`, and index.ts passes the one it opened. Both sit behind the same
`express.json` cap (`HTTP_DEFAULTS.bodyLimit`); `/admin/mcp` also behind the Origin guard and a guard that answers a
request with neither a session nor a key with 401. `/graphql` takes anonymous requests, for signing in, and
permissions refuse every other field to them as UNAUTHENTICATED. GraphiQL is served at `/graphql` outside production.
They serve one permissioned schema (`server/src/graphql/build-schema.ts`) through one context factory
(`createContextFactory` in `core/context.ts`), which reads the caller from the credential (`auth/caller.ts`):
`x-api-key` is only ever a key; a bearer with the `mcpr_` prefix is a key; any other bearer is tried as a session,
then as a key (an imported token has no prefix). Two different keys in one request are BAD_USER_INPUT.

- **Schema:** drizzle-graphql `buildSchema` over `server/src/db/schema.ts` (create/update/delete
  prefixes, singular type names, `complexity: true`, page sizes from `OPERATION_LIMIT_DEFAULTS`),
  plus hand-written fields for what no table holds, and better-auth's endpoints (`auth/endpoints.ts`). `servers.oauth`,
  `settings.authToken` and `settings.authEnabled` are never readable, and better-auth's tables are not served. `features.nestedWrites` is off: a workspace's members can't be replaced through a nested
  update (the NOT NULL `workspace_id` leaves only `create`/`connect`), so `saveWorkspace` does it.
- **Generated writes** (single-row forms only; every bulk `createXs`/`updateXs`/`deleteXs`/`…Many`
  is FORBIDDEN): `createRegistry`/`updateRegistry`/`deleteRegistry`, `createWorkspace`/`updateWorkspace`/
  `deleteWorkspace`, `createWorkspaceMember`/`updateWorkspaceMember`/`deleteWorkspaceMember`,
  `updateSetting` (a person only; only the settings the UI edits; the port, host, `instanceId` and
  `allowedOrigins` are refused, and so is a public `publicUrl` under `SECURE_LOCAL_NET`). `createServer` exists but is FORBIDDEN: servers come from
  `installServer`. `onWrite` hooks check each written row against the shared zod schemas
  (BAD_USER_INPUT) and, once the write commits, call `store.reload()`, whose `change` reconciles the
  gateway (`reconcileOnChange` in `gateway/reconcile.ts`, wired at boot). Hand-written writes that answer with
  gateway state also await `applyConfig`, which queues behind that reconcile.
- **Hand-written queries:** `routerStatus`, `serverRuntimes`, `serverRuntime(name)`,
  `serverTools`/`serverResources`/`serverPrompts`/`serverActivity(name)`,
  `workspaceTools`/`workspaceResources`/`workspacePrompts`/`workspaceActivity(slug)`,
  `registryServers(registry, search, cursor)`, `registryServer(registry, name)`, `lanServers`.
  Every list takes `limit` (default `defaultPageSize`, capped at `maxPageSize`) and is priced as a page.
- **Hand-written mutations:** `installServer`, `updateServer(name)`, `deleteServer(name)`,
  `restartServer`, `clearServerActivity`, `startServerOAuth(name, origin)`, `checkServerOAuth`,
  `signOutServerOAuth`, `saveWorkspace` (a workspace and its whole member list, one transaction),
  `clearWorkspaceActivity`, `reloadConfig`, `setLanServerDismissed(key, dismissed)`.
- **Try-it calls:** `callServerTool(name, tool, arguments)`, `readServerResource(name, uri)`,
  `getServerPrompt(name, prompt, arguments)`, and `callWorkspaceTool` / `readWorkspaceResource` /
  `getWorkspacePrompt(slug, …)`, which take the `<server>__`-prefixed name and run on that member's
  workspace instance (a prefix naming no member is BAD_USER_INPUT). They answer `McpToolResult
  { content, structuredContent, isError }`, `McpResourceContents { contents }` and `McpPromptMessages
  { description, messages }`, the open-ended parts as JSON; a tool that reports its own failure answers
  `isError: true`, a server that fails is UPSTREAM_FAILED. Each is recorded to the activity log under
  via `ui` (`gateway/ui-calls.ts`). They are not in `ADMIN_TOOLS`: an agent calls a server's tools on `/mcp`.
- **Bounds:** depth, aliases and cost per operation (`OPERATION_LIMIT_DEFAULTS`, refused as
  `QUERY_TOO_COMPLEX`); a `limit` over `maxPageSize` is drizzle-graphql's `DRIZZLE_LIMIT_EXCEEDED`.
  `/admin/mcp` offers the tools in `ADMIN_TOOLS` (`graphql/admin-mcp.ts`), bounded by `MCP_DEFAULTS`.
- **Errors:** `GraphQLError` with `extensions.code` from the shared `ErrorCode` (the envelope's codes,
  plus `QUERY_TOO_COMPLEX`), and the diagnostics, such as a child's stderr, in `extensions.detail`; anything uncoded is masked by Yoga and logged with a `[graphql]` tag,
  never with the operation's variables.
- `npm run codegen` prints the served schema to `server/__generated__/schema.graphql` (gitignored).

### MCP endpoints (streamable HTTP, API key)

- `POST/GET/DELETE /mcp/<name>` — proxy to that server: tools, resources,
  resource templates, prompts, completions, logging, and resource subscriptions
  forwarded 1:1; downstream `list_changed` / `resources/updated` / log
  notifications relayed back
- `POST/GET/DELETE /mcp` — aggregate: merges all *enabled* servers; tools,
  resources, resource templates, and prompts namespaced `<server>__`, and so are
  the `resource_link` and embedded-resource URIs in a tool result, so a link
  reads back through the aggregate; calls, completions, and subscriptions strip
  the prefix and route to the owning downstream client; `logging/setLevel` fans
  out to every member; relayed notifications are re-namespaced
- `POST/GET/DELETE /mcp/w/<slug>` — a workspace's custom aggregate: same
  `<server>__` namespacing, but only over that workspace's enabled members, each
  served by its own isolated (override-applied) downstream instance
- **`instructions` forwarded.** A 1:1 endpoint serves the downstream's own
  `instructions` verbatim; an aggregate serves a merged document — a preamble
  naming the `<server>__` prefix, then one `## <server>` section per member that
  has any. `instructions` travels only in the initialize result, so a 1:1
  session connects before it constructs its proxy `Server` (a spawn that
  endpoint was going to pay anyway); an aggregate never does, and reads only
  what its members have already said in this process
- **`capabilities` forwarded too, on the 1:1 endpoint.** It rides the same
  initialize result and the same connect, so it costs nothing more: `/mcp/<name>`
  declares what the downstream declared, narrowed to the surfaces this proxy
  relays, and registers a request handler for exactly those. A tools-only server
  is a tools-only endpoint — asking it for resources is `MethodNotFound`, which
  is true, rather than an empty list, which reads as a server that has resources
  and happens to have none. `resources.subscribe` is the one that mattered most:
  it was claimed unconditionally, so a client was invited to send a subscribe
  that only its own failure would answer. `listChanged` is mirrored rather than
  asserted, since this endpoint relays such a notification and never originates
  one. A downstream that would not connect falls back to the full set — claiming
  too much costs a client one empty round trip, claiming too little costs it the
  surface. An aggregate keeps the union: its members are deliberately not
  connected while a client initializes, so what any of them might support is the
  only honest answer
- **Stateful sessions:** `initialize` mints an `Mcp-Session-Id` reused across the
  session's requests and its GET SSE stream (which carries relayed
  notifications); a non-initialize request with no session id → 400, an
  unknown/expired session id → 404
- **A proxied `tools/call` carries the caller's request options.** The upstream
  request's abort signal goes downstream, so a client that cancels stops the
  call there too; the timeout is the server's `callTimeoutMs`, else
  `settings.callTimeoutMs` (default 10 min) — the value written onto its pool row
  too — rather than the SDK's 60s, which cut long tools off only when called
  through the router. A caller that sent a `progressToken` gets the downstream's
  progress re-sent under its own token. It goes out on the session's GET stream,
  not tied to the request, because sessions answer in JSON and a JSON-mode
  transport drops a request-tied notification; the SDK client matches progress
  by token, so it arrives — when that stream is open, like every relayed
  notification
- **Subscriptions are counted per downstream URI.** Every session reaching an
  instance shares its one connection, and so its subscriptions: forwarded as-is,
  the second session to unsubscribe ended the first one's too.
  `SubscriptionLedger` (`gateway/subscriptions.ts`), held by the manager so the
  1:1 and aggregate endpoints count together, forwards an unsubscribe only when
  the last session holding the URI lets go, and a closing session lets go of
  everything it held (unsubscribing only an instance that is still connected). A
  subscribe is forwarded every time: the ledger cannot see a respawn, and a
  repeat subscribe is harmless where a skipped one is lost
- `logging/setLevel` is still per downstream connection (the last session to
  set it wins for all). A `notifications/message` goes to the session whose
  request caused it, where one can be named, and to every session on the
  endpoint where not — see the next point for how it is named
- **Elicitation is forwarded to the session whose call asked.** The downstream
  connection is shared, and SDK 1.30 tells a client nothing of which request a
  server→client message belongs to, so the router names it by elimination, as
  the pool does for its own `call()`: `InFlightLedger` (`gateway/in-flight.ts`)
  counts every request the router has running on each instance, and a question
  or a log line is a request's when it is the only one in flight there. The
  pool's per-call `onElicit`/`onLog` are not reachable from the router — they
  hang off `call()`, which needs the tool index `indexTools: false` turns off,
  and `use()` takes no options — so the router counts its own `use()`s and
  answers through the pool-wide `onElicit`. Every downstream connection
  declares form elicitation, since it is shared by sessions that differ and is
  fixed at a handshake before most of them; a question is put to the session's
  client with `elicitInput` on its GET stream when that client declared the
  mode, and answered `decline` when no one session can be named or its client
  cannot answer, and `cancel` when the call settles first. A question that
  arrives before the client holds its GET stream waits for it
  (`gateway/standalone-stream.ts`) rather than going out to be dropped: an SDK
  client opens the stream after `initialized` without waiting for it, so a
  first call that asks straight away can get there first. A person answering
  is on the call's own clock (`callTimeoutMs`, ten minutes by default)
- Sampling and roots are **not** offered downstream — see Phase 4 F7
- Disabled servers 404. Disabled or unknown workspaces 404. Auth failures 401
  before any MCP handling.

---

## Remote OAuth sign-in

The same second step Codex and Claude Code do for a login-gated MCP server (e.g.
Home Assistant's `/api/mcp`): the server is added by URL, then signed in from the
browser. The router is the OAuth client; the browser only carries the redirect.

1. **Add.** `installServer` as for any remote. The add dialog then calls
   `checkServerOAuth(name)`, which sends an unauthenticated
   `initialize` and reads only the status: a `401` marks the server `needs-auth`
   and the dialog stays open on a "Sign in" step.
2. **Start.** The UI opens a blank window on the click (so it is not a blocked
   popup), then `startServerOAuth(name, origin)`. The router reads the 401's
   `WWW-Authenticate` hints, runs the SDK's `auth()` with a provider bound to an
   in-memory flow (random `state`, PKCE verifier, 10-minute TTL), and returns the
   authorization URL; the UI points the window at it.
3. **Client identity.** In order: a typed-in `oauth.clientId`; a stored client
   registered for the same redirect URI; the router's Client ID Metadata
   Document URL `<base>/oauth/client-metadata.json` when the login advertises
   `client_id_metadata_document_supported` (used even over plain HTTP — the SDK
   would refuse — because the redirect URI shares its origin, which is what an
   IndieAuth-style login such as Home Assistant checks); otherwise RFC 7591
   dynamic registration. `<base>` is `settings.publicUrl`, else the UI's origin.
4. **Callback.** `GET /oauth/callback?code&state` — public, like `/healthz`; the single-use `state` is its credential. It exchanges
   the code, writes the tokens to the server's row, drops every connection of
   the server (base and workspace instances) so the next use dials with them, and
   answers a page that `postMessage`s `{ type: 'mcp-router-oauth', server, ok }`
   to the UI's origin and closes. `GET /oauth/client-metadata.json` is public too.
5. **Use.** Every remote row hands the pool an `authProvider` (pool ≥ 3.8.0)
   reading the store. The SDK attaches the token and refreshes it on a 401;
   with nothing to refresh with, the provider marks the server `needs-auth`
   instead of starting a login, and the API answers its listings `502` "needs you
   to sign in".

Rules: tokens never leave the router (`ServerStatus.config` has no `oauth`; the
`oauth` summary carries `signedIn`, `expiresAt`, `refreshable`, `clientId`,
`hasClientSecret`). A URL edit to another origin forgets the tokens; a workspace
member whose `url` override is on another origin gets no provider. A changed
typed-in client forgets the tokens and registered client.

## How the `@cubicecho/agent-*` packages are used

Reviewed 2026-09-06, re-reviewed 2026-09-08 against `agent-core@2.2.4` and
`agent-mcp-pool@2.5.0`; pool taken to `3.1.0` on 2026-09-13.

**`@cubicecho/agent-core` — wrong layer, still closed.** It is the
endpoint-agnostic half of an OpenAI-compatible agent loop: capability
negotiation, schema compatibility, on-demand tool loading, streamed turns, a
run-event bus, retry, and a pooled `OpenAI` client — with `openai` as a required
peer dependency. The 2.x API reshuffled that surface but did not change what it
is for. This repo is a gateway; it makes no model calls and has no run to
instrument, so there is nothing for any of it to attach to. The one module with
a plausible home — `schema-compat`'s `sanitizeTools`/`relaxTools`, to normalize
downstream tool schemas at the aggregate endpoint — is a *client* concern: a
gateway should forward a server's schema faithfully and let the consumer decide
what its inference endpoint will accept. Reopen only if the router grows an
agent of its own.

**`@cubicecho/agent-mcp-pool` — adopted, pool and all.** Every objection raised
in the first two reviews is now closed upstream: lazy connect with idle reap
([#8](https://github.com/cubicecho/agent-mcp-pool/issues/8)), a raw `Client` via
`client(id)` ([#9](https://github.com/cubicecho/agent-mcp-pool/issues/9)), stdio
`cwd` plus a notification relay
([#10](https://github.com/cubicecho/agent-mcp-pool/issues/10)), a discriminated
`McpPoolError` carrying `retryAt` and the child's stderr
([#50](https://github.com/cubicecho/agent-mcp-pool/issues/50)), `pid` and
`startedAt` on `state()` ([#49](https://github.com/cubicecho/agent-mcp-pool/issues/49)),
a paginated `tools/list` drain ([#47](https://github.com/cubicecho/agent-mcp-pool/issues/47)),
`openai` off the dependency tree ([#48](https://github.com/cubicecho/agent-mcp-pool/issues/48)),
and — the last one, shipped in `2.1.0` — `indexTools: false`
([#56](https://github.com/cubicecho/agent-mcp-pool/issues/56)), which skips the
tool-list drain on connect. That drain was the blocker: this repo proxies
`tools/list` straight through from the client that asked and never reads the
index, so indexing put a full paginated listing in front of every cold
user-facing request and held a second copy of every tool.

`gateway/manager.ts` is now a thin adapter, and owns only what the pool does not
model:

- **Instance keys.** The pool is keyed by a flat `id`, so a workspace member is
  registered under `w:<slug>:<server>` with its overrides already resolved. That
  is what makes a member an instance independent of the global server, and it is
  what `isWorkspaceKey` filters back out of the base-server views.
- **Config translation.** `toPoolConfig` flattens this repo's discriminated-union
  `ServerConfig` into the pool's row and resolves `idleTimeoutMs` per row —
  `config.idleTimeoutMs ?? settings.idleTimeoutMs` for a stdio child, and `0`
  ("never reap") for a remote connection, which costs nothing to hold open. It is
  resolved at reconcile rather than passed to the pool once, because the global
  default is a setting an operator can edit while the router is running.
- **Router-only bookkeeping.** Tool counts, call counts, last-called timestamps
  and the activity ring live in `meta` and `activity`; the pool tracks
  connections, not usage.
- **HTTP mapping.** `McpPoolError` codes become statuses: `unknown-server` and
  `disabled` → 404, `backoff` → 503, anything else → 502 with the child's stderr
  as `detail`. `gateway/ui-calls.ts` passes an `HttpError` through untouched so a
  try-it call cannot flatten the 503 back into a 502, and `handField` carries the code over to GraphQL.

Two behaviours changed with the adoption, both accepted:

- **`reconcile()` is async.** `pool.sync()` is queued, so every caller now awaits
  it — a route that writes config and then reads status has to, or it reads the
  state from before its own write.
- **Remote servers share the crash backoff.** It used to apply to stdio children
  only; the pool applies it to every entry. An unreachable remote server now
  answers 503 for `crashBackoffMs` after a failed connect instead of redialling
  on every request, which is the better behaviour anyway.

**`2.2.0` closed [#58](https://github.com/cubicecho/agent-mcp-pool/issues/58)**,
which asked for a `stop(id)` and for `reconnect` to be pinned down against a
lazy pool. Both landed, and `restart(name)` is now `stop` + `getClient` rather
than `reconnect`: `stop` leaves the row idle with its `error`/`failedAt`
cleared, so the `getClient` *is* the dial and a restart that fails answers 502
carrying the child's stderr. `reconnect` dials the child itself, which lands a
failed restart inside the backoff it started a millisecond earlier — the next
request would answer 503 "crashed recently", naming a crash the operator just
asked to be retried. Clearing that backoff is what pressing Restart on a
crash-looping server is *for*. Delete still needs neither: it reconciles (which
closes the child) before removing the install directory.

**`connectTimeoutMs` is a router setting now.** A child that spawns and then
never speaks used to hold its request open forever — the MCP SDK's own 60s
applies to the `initialize` *request*, which such a child never gets far enough
to answer. `settings.connectTimeoutMs` (default 60s, generous because a first
`uvx`/`npx` spawn may resolve and download a package before it says anything)
resolves per row in `toPoolConfig` beside `idleTimeoutMs`, and a wedged child
now fails the request that woke it. It was constructor-only when it landed,
which meant a restart to change it; `2.4.0` closed
[#62](https://github.com/cubicecho/agent-mcp-pool/issues/62)/[#64](https://github.com/cubicecho/agent-mcp-pool/issues/64)
and the pool re-reads it on every reconcile, applying it at the next connect —
an edited timeout is no reason to bounce a running child.

**`2.3.0` closed [#60](https://github.com/cubicecho/agent-mcp-pool/issues/60)**,
the hardcoded `clientInfo.version` of `0.1.0`. The pool now takes a
`clientVersion` beside its `clientName`, and the router passes `SERVER_VERSION`
— so `clientInfo`, which is the whole of what a dialled server learns about its
caller and the only thing it can log or gate on, is now true in both halves
rather than one. A manager test calls a fixture tool that reads
`getClientVersion()` back out of the child.

**Nothing is left open upstream from this adoption.** The last one,
[#63](https://github.com/cubicecho/agent-mcp-pool/issues/63) — `sync()` or
`reconnect()` with no `configs`, on a pool built without `load()`, silently
closing and forgetting every server — is fixed in `2.4.1` (a reconcile with
neither now throws). It never bit this repo, which always passes `configs`; it
was a trap for the next caller.

Four releases since, none of which changes an interface this repo holds.
`2.4.2` closed [#66](https://github.com/cubicecho/agent-mcp-pool/issues/66) —
the exported standalone `probe` dropped the row's `connectTimeoutMs` that
`2.4.0` widened `McpConnection` to carry — and `2.4.3` closed
[#67](https://github.com/cubicecho/agent-mcp-pool/issues/67), where the timeout
bounded each *request* rather than the connect, so a paginated `tools/list` on
a cold connect multiplied it by the page count. A `requestBudget` countdown is
now shared by `initialize` and every page, and the exported `listAllTools`
reads its `timeout` as the budget for the whole walk.

Neither reached the router, for the same two reasons. It calls no probe of
either kind — "Test connection" goes through `manager.getClient`, so it is
dialled by the pool on the row's own patience — and `indexTools: false` means
there was no `tools/list` drain on a connect to multiply. `connectTimeoutMs`
here bounds spawn plus `initialize` and nothing else, which is what the setting
claims, and after `2.4.3` that is what it would bound even with the drain on.
The paginated walk the router *does* do is on a proxied request rather than on a
connect, so the budget is not in that path either. It is the pool's own walk
since `3.16.0` (`listAllPrompts`/`listAllResources`/`listAllResourceTemplates`,
[#108](https://github.com/cubicecho/agent-mcp-pool/issues/108), beside
`listAllTools`), which replaced `gateway/pagination.ts`: a downstream that
repeats a cursor or sends more than 1000 pages fails the listing — skipped and
recorded on an aggregate, an error on a per-server listing — where the local
walk looped on a repeated cursor to a 100-page cap and returned the short list
with a console warning. A gateway that hands a client a truncated list has told
it something false that looks true; a failure lands in the server's activity
log, where it can be seen. `2.4.4`'s fix to `resultText` — embedded resources and resource
links reaching a model as `[resource content]` — is likewise out of reach: that
helper flattens a tool result into a string for an agent loop, and this repo
forwards `CallToolResult` untouched.

**`2.5.0` puts `instructions` and `capabilities` on `state()`**
([#70](https://github.com/cubicecho/agent-mcp-pool/issues/70)), so a consumer
can read either without `client()` dialling an idle server to hand back a whole
client for one field. The router keeps reading both off the client in
`getClient`, because it already holds one there and because it needs them to
outlive the connection: `state()` clears them when a child is reaped, by design,
while the aggregate's merged `instructions` is built from whatever its members
have *ever* said in this process. What the release is used for here is the
`ServerCapabilities` re-export, which lets `capability.ts` and `manager.ts` type the
field without reaching into the SDK's module layout.

The capability half of it is what prompted the endpoint change above. The pool's
`Client` is constructed without `enforceStrictCapabilities`, so the SDK sends a
request for a surface the server never declared and lets it come back
`MethodNotFound` — which `emptyOnMissing` then turns into an empty list. That is
the right behaviour for a *call*, and the wrong thing to build a *handshake* on:
the proxy was declaring five surfaces for every server regardless of what stood
behind it. Reading `getServerCapabilities()` at the one connect the 1:1 endpoint
already makes for `instructions` costs nothing and makes the declaration true.

`3.0.0` split `McpServerConfig` into a stdio arm and an http arm. The router's
`toConnection` now builds the one arm a server's transport needs instead of a
flat row padded with `command: ''` / `url: ''`, and `env` rides the stdio arm
only. The rest of 2.6–3.1 — session hooks, `contextBlocks`, a bounded tool call
through the pool's own `call()`, a page-count bound on the `tools/list` walk —
is agent-loop surface the router does not call; the fixes to lazy wake-up scope
and to a call racing the idle reaper do sit in its path.

**Nothing was open on `agent-mcp-pool` at the time of this review (since then:
[#98](https://github.com/cubicecho/agent-mcp-pool/pull/98), see H4), and nothing
this repo can reach is open on `agent-core`.** That package moved `2.2.2` → `2.2.4` over the same window:
token counting per content part, a produced latch read off what a chunk carried,
a refused temperature told from a refused value, model names in negotiation
notices. Its one open issue,
[#61](https://github.com/cubicecho/agent-core/issues/61), is a `side-task.ts`
latch that turns the no-thinking hints off after any unrecognised 400. All of it
is inside the run loop this repo does not have, so the "wrong layer" finding
above is unchanged by it.

**Namespacing stays here regardless.** The pool truncates `<slug>__<tool>` to 64
characters for OpenAI's function-name limit and resolves by whole-string lookup,
while `gateway/naming.ts` splits names a *foreign* MCP client invented,
longest-prefix-first, and applies the same scheme to resource URIs and prompt
names. Unifying on the truncation corrupts resource URIs. Full adoption of the
pool leaves `naming.ts` untouched, as predicted.

## Work items

`[ ]` open · `[x]` done · Tracks A/B/C are parallel; items within a track are ordered.

### Phase 0 — Foundation (done inline)

- [x] 0.1 npm workspace root: `package.json`, `tsconfig.base.json`, `biome.json`, `.gitignore`
- [x] 0.2 `shared/` package: config-file schemas, registry API schemas, REST DTOs
- [x] 0.3 SPECS.md, AGENTS.md, initial commit

### Track A — Server (`server/`)

- [x] A1 Package scaffold: `server/package.json` (deps: express@5, @modelcontextprotocol/sdk, zod, chokidar), `tsconfig.json` (`noEmit`: Node 26 runs the sources, no build), `src/index.ts` entry
- [x] A2 Config store (`src/config/`): load/validate/write `settings.json`, `registries.json`, `servers/*.json` via shared schemas; atomic writes (tmp+rename, mode 0600); seed defaults on first run (official registry, generated auth token → log it once); chokidar watcher (debounced) emitting typed change events; `reload()` for the API
- [x] A2b Database (#91, step 1): the config store reads and writes Drizzle tables (Postgres via `DATABASE_URL`, required; `waitForDatabase` at boot, migrations run on boot; PGlite in tests only), emits `change` after its writes and on `reload()`; the watcher and chokidar are gone; first boot on an empty database imports `DATA_DIR/config` in one transaction and renames the files `*.imported`
- [x] A3 Auth middleware: bearer check for `/api` and `/mcp`; constant-time compare; skipped when `authEnabled: false`; `GET /api/status` reports authEnabled
- [x] A4 Registry client (`src/registry/`): fetch + zod-parse `GET {url}/v0/servers` (search, cursor, version=latest) and single-server detail; per-registry base URL; friendly errors for unreachable/invalid registries
- [x] A5 Installer (`src/installer/`): `npm install --prefix data/servers/<name> <pkg>@<ver>` via execFile (no shell); derive stdio transport: resolve installed package `bin` → `node <binPath>` (+ registry runtimeArguments/packageArguments where value is fixed); map registry `environmentVariables` → `envMeta`; build `ServerConfig` from an `InstallRequest` for all three source types; uninstall = rm install dir
- [x] A6 Process/connection manager (`src/gateway/manager.ts`): per-server downstream MCP `Client` — stdio: lazy spawn (`StdioClientTransport`, env = process env allowlist + config env), idle timer, restart-on-crash backoff, capture stderr tail for `lastError`; remote: `StreamableHTTPClientTransport` with headers; expose `getClient(name)`, `status(name)`, `stop(name)`, `reconcile(configs)` for reload
- [x] A7 Per-server MCP endpoint (`src/gateway/route.ts`): `StreamableHTTPServerTransport` per session at `/mcp/:name`; proxy tools/resources/prompts list + call/read/get to the downstream client; propagate downstream errors as MCP errors
- [x] A8 Aggregate MCP endpoint (`/mcp`): merged capability lists with `<server>__` prefix; route calls by prefix; skip (and log) servers that fail to connect rather than failing the whole list
- [x] A9 Management REST API (`src/api/`, removed in G3: see "No REST API"): every route, zod-validated, wired to config store + installer + manager; JSON error envelope
- [x] A10 Static serving: in production serve `app/dist` with SPA fallback (exclude `/api`, `/mcp`); dev uses Vite proxy
- [x] A11 Server tests (Vitest): config store round-trip + validation, auth middleware, installer transport derivation (mock execFile), registry client parsing (fixture from the real API), aggregate namespacing/routing logic

### Track B — Web UI (`app/`)

- [x] B1 Package scaffold: Vite + React 19 + TS, Tailwind, shadcn/ui (`components.json`, `src/components/ui/`), TanStack Router (file-based, `src/routes/`) + TanStack Query; `@/` alias; dev proxy `/api` + `/mcp` → `localhost:3001`
- [x] B2 API client (`src/lib/api.ts`): typed fetch wrapper using `@mcp-router/shared` DTOs; bearer token from localStorage; 401 → token prompt screen (token entry stored locally)
- [x] B3 Layout: sidebar nav (Servers, Browse, Registries, Settings), header with router status (running/total from `GET /api/status`), toast feedback (sonner)
- [x] B4 Servers page (`/`): list installed servers — state badge (stopped/starting/running/error), transport type, tool count; enable/disable toggle; restart + delete (confirm dialog) actions
- [x] B5 Server detail (`/servers/$name`): config overview incl. endpoint URL with copy button; **env var editor** — table of vars from `envMeta` ∪ `env`, secret values masked with reveal, add/remove arbitrary vars; save → PATCH then offer restart; show `lastError` when state is error; tools list (from `GET /api/servers/:name/tools`)
- [x] B6 Browse/install page (`/browse`): registry picker, search box (debounced), cursor-paginated results; install dialog: local name (prefilled, validated against `serverNameSchema`), package/remote selector when multiple, required env vars (from `environmentVariables`, secrets masked) → `POST /api/servers`
- [x] B7 Direct npm install (on `/browse`): "Install from npm" form — package name, version (default latest), local name, env vars → `InstallRequest` with `source.type: 'npm'`
- [x] B8 Registries page (`/registries`): list/add/remove registries (`createRegistryRequestSchema` validation); official registry undeletable-by-default hint
- [x] B9 Settings page (`/settings`): show auth status + port; **Reload config** button (`POST /api/reload`) with result toast; link to config dir docs
- [x] B10 UI tests: api-client 401 handling, env editor add/edit/mask behavior, install dialog validation (Vitest + Testing Library)

### Track C — Deploy & docs

- [x] C1 `Dockerfile`: multi-stage — `npm ci` + app vite build → `node:26-slim` runtime with `server/src`, `shared/src`, `app/dist`, production node_modules; `ENV DATA_DIR=/data`, `/data` chowned to node before `VOLUME /data`, `USER node`, `EXPOSE 3000`, `CMD ["node", "server/src/index.ts"]`; needs npm and uv available at runtime (installer shells out to them)
- [x] C2 `docker-compose.yml`: single service, named volume at `/data`, `MCP_ROUTER_TOKEN` via env/`.env`, restart policy, healthcheck on `/healthz`
- [x] C3 `README.md`: what it is, quickstart (docker compose + bare node), config file reference with examples, API + MCP endpoint reference, how to point Claude/other clients at `/mcp` and `/mcp/<name>`, security notes (plaintext secrets, bearer token)

### Phase 3 — Workspaces (custom aggregates)

- [x] P1 Shared contract: `workspaceMemberSchema` / `workspaceConfigSchema` +
  `slugify()` in `shared/src/config.ts`; `workspaceStatusSchema` (adds `path`),
  `createWorkspaceRequestSchema`, `updateWorkspaceRequestSchema` in `shared/src/api.ts`
- [x] P2 Config store: load/validate/write `workspaces/<slug>.json` (keyed by
  slug, warn on slug/filename mismatch); `getWorkspaces`/`getWorkspace`/`saveWorkspace`/
  `deleteWorkspace`; workspaces included in the reload snapshot
- [x] P3 Gateway manager: instances keyed by explicit key (base = name,
  workspace = `w:<slug>:<server>`); `resolveMemberConfig` merges overrides;
  `reconcile(configs, workspaces)` builds workspace instances; `getClientForWorkspace`;
  base-only views (`statusAll`/`enabledNames`/`runningCount`) exclude workspace keys
- [x] P4 Workspace MCP endpoint `/mcp/w/:slug` (reuses `createAggregateServer` with
  workspace-scoped `getClient`/`serverNames`); 404 on disabled/unknown workspace
- [x] P5 REST API (removed in G3): `/api/workspaces` CRUD (auto-slug, collision + member-exists
  validation, rename-re-slugs); every `reconcile` call now passes workspaces
- [x] P6 Web UI: Workspaces nav item + `/workspaces` list route (URL + copy, server
  count, enabled badge, edit/delete); `WorkspaceDialog` (name→slug preview, member
  toggles, per-member override editors, ConnectCard in edit mode)
- [x] P7 Tests: manager workspace-instance behavior (overrides, isolation from
  global disable, drop-on-remove); API auto-slug/validation/rename/gating

### Phase 4 — Full MCP proxy (complete protocol passthrough)

The gateway now proxies the request/response core **and** the streaming half of
the protocol (F1–F6): completions, resource subscriptions, logging, and
downstream→client change/resource/log notifications ride a stateful session.
The one remaining gap (F7, reverse-direction sampling/elicitation/roots) is
blocked by the shared-downstream-client architecture and is documented below.

- [x] F1 Aggregate resource templates: `createAggregateServer` fans out
  `resources/templates/list` and namespaces `uriTemplate` + `name` (was
  hardcoded `[]`), matching the per-server endpoint; test in `proxy.test.ts`
- [x] F2 Completions (`completion/complete`): `CompleteRequestSchema` handlers on
  both proxy servers; per-server forwards 1:1 via `client.complete()`; aggregate
  strips the `<server>__` prefix off the `ref` (prompt name or resource `uri`) and
  routes to the owning client; degrades to an empty `completion.values` when the
  downstream lacks the capability. Recorded failures-only (fires per keystroke)
- [x] F3 **Stateful sessions (foundational).** `gateway/routes.ts` now runs the
  exposed `StreamableHTTPServerTransport` session-backed (`sessionIdGenerator` →
  `randomUUID`): the `initialize` request mints a session kept in a
  `Map<sessionId, transport>`, reused across the session's `POST`/`GET`(SSE)/
  `DELETE` and torn down on transport close. Non-initialize requests without a
  session `400`; unknown/expired session ids `404`. Downstream client lifecycle
  (lazy spawn, idle timeout) unchanged. Real-client end-to-end test in `api.test.ts`
- [x] F4 Change notifications: `PROXY_CAPABILITIES` advertises `listChanged: true`
  for tools / resources / prompts. `GatewayManager` exposes a notification bus
  (`onNotification`) fed by each downstream client's `fallbackNotificationHandler`
  (re-installed on every reconnect, so it survives respawns); each session
  subscribes and relays `notifications/{tools,resources,prompts}/list_changed` to
  its client (aggregate/workspace sessions relay for any member)
- [x] F5 Resource subscriptions: advertises `resources: { subscribe: true }`;
  `resources/subscribe` + `resources/unsubscribe` handlers forward to the downstream
  client (aggregate strips the `<server>__` URI prefix); downstream
  `notifications/resources/updated` is relayed to the subscribing session with the
  URI re-namespaced on the aggregate/workspace path (`namespaceNotification`)
- [x] F6 Logging passthrough: advertises the `logging` capability; `logging/setLevel`
  forwards to the downstream client (per-server) or fans out to every member
  (aggregate); downstream `notifications/message` is relayed over the same bus as F4
- [ ] F7 Reverse-direction (server→client) capabilities — elicitation is
  forwarded by elimination (see the MCP-endpoints section); sampling and roots
  are still **blocked by the shared-client model.** Sampling / elicitation / roots require forwarding a
  *downstream→router* request out to a specific *upstream* MCP client. But one
  downstream `Client` is shared across all sessions (lazy-spawned, idle-killed), and
  an incoming server→client request carries no correlation to whichever upstream
  session's tool call provoked it — so the router cannot attribute it to a session.
  Doing this soundly requires **per-session (or per-request) downstream instances**
  instead of the shared client, a larger architecture change. Until then the router
  advertises none of these to downstream servers (they degrade gracefully). Track as
  its own phase: (a) key downstream instances by session, (b) offer `sampling`/
  `elicitation`/`roots` on the downstream `Client`, (c) forward each request to the
  session's upstream client and its response back, (d) gate behind config since it
  exposes the host client's LLM/user to downstream servers
- [x] F8 Tests + docs: unit tests for each handler's forward + namespace-strip +
  capability-degrade path (`proxy.test.ts`), `namespaceNotification`
  (`notifications.test.ts`), and a real-MCP-client session-lifecycle test plus
  400/404 session-guard tests (`api.test.ts`); MCP-endpoints section of this file
  and `README.md` updated. Live notification-relay against
  `@modelcontextprotocol/server-everything` remains a manual e2e smoke (needs a
  spawned downstream that emits them)
- [x] F9 `instructions` passthrough: `createProxyServer`/`createAggregateServer`
  take an `instructions` string for `ServerOptions`; `manager` caches each
  downstream's `getInstructions()` on every `getClient` and clears it with the
  config it was read under; `mergeInstructions` builds the aggregate document
  (preamble + `## <server>` sections, members with nothing to say skipped,
  `undefined` when none have any); `routes.ts` connects before building a 1:1
  proxy `Server` and reads the cache without connecting for the aggregates.
  Covered by unit tests in `proxy.test.ts`/`manager.test.ts` and an end-to-end
  test in `api.test.ts` driving real `StreamableHTTPClientTransport` clients

### Phase 2 — Integration (after tracks merge)

- [x] I1 `npm run check` (biome + tsc all packages) and `npm test` green
- [x] I2 End-to-end smoke: install a real server from the official registry (e.g. `@modelcontextprotocol/server-everything`), set an env var in the UI, connect an MCP client to `/mcp/<name>` and `/mcp`, call a tool through both
- [x] I3 Config reload smoke: hand-edit a server JSON, `POST /api/reload`, verify reconcile
- [x] I4 Docker smoke: `docker compose up`, repeat I2 against the container

### Phase 5 — MCP transport hardening (spec compliance)

Gaps found reviewing `/mcp*` against the Streamable HTTP transport spec. The SDK
(`@modelcontextprotocol/sdk` 1.29, `StreamableHTTPServerTransport`) already
covers most of it: crypto session ids, `MCP-Protocol-Version` validation (400 on
unsupported), `Accept`-header checks, 400/404 session guards, GET SSE for relayed
notifications, DELETE termination. These are the remaining items.

- [x] H1 **Session leak — idle eviction + cap.** `sessions` in
  `gateway/routes.ts` only dropped an entry when the client sent `DELETE` (the
  SDK fires `onclose`/`onsessionclosed` *only* on DELETE — a GET-stream abort or
  a client that just disappears never closes the session), so a long-running
  gateway accumulated dead sessions (each holding a proxy `Server` + notification
  subscription) unbounded. Now each session carries a `lastActivity` clock bumped
  on every request; an opportunistic `sweepIdle()` on each request reclaims
  sessions idle past `settings.sessionIdleTimeoutMs` (default 30 min), and
  `enforceCap()` evicts the least-recently-active down to `settings.maxSessions`
  (default 1000) before minting a new one. No background timer (nothing to tear
  down). Covered by fake-clock idle-reclaim and cap-eviction tests in `api.test.ts`.
- [x] H2 **Origin validation / DNS-rebinding protection.** `createOriginMiddleware`
  (`auth.ts`) now fronts `/mcp` (before the credential check, so it applies whatever a request carries): requests with no `Origin` (native clients) or a
  loopback origin pass, plus any `settings.allowedOrigins`; a foreign origin — what
  a DNS-rebound browser page carries — gets 403. A `HOST` env / `settings.host`
  lets operators bind `127.0.0.1` (default still binds all interfaces for
  Docker/LAN). Covered by `isLoopbackOrigin` + middleware tests in `auth.test.ts`;
  README settings block updated. Spec: servers SHOULD validate `Origin` and SHOULD
  bind localhost when local.
- [x] H3 **SSE resumability (`EventStore` / `Last-Event-ID`).** Done — each
  session's transport now gets a per-session `BoundedEventStore`
  (`gateway/event-store.ts`): an insertion-ordered map capped at 256 events
  (oldest evicted first) so memory stays bounded across long-lived sessions.
  Event ids are `${streamId}_${zero-padded monotonic counter}`, so a single
  forward pass replays exactly the same-stream events after the `Last-Event-ID`
  anchor; a missing/aged-out anchor degrades gracefully to "nothing to replay".
  The SDK drives priming/replay on GET streams for protocol `>= 2025-11-25`.
  Covered by `gateway/__tests__/event-store.test.ts` (replay ordering,
  cross-stream isolation, cap eviction, stream-id lookup). Spec: client MAY
  resume a broken stream via `Last-Event-ID`; server SHOULD support it.
- [x] H4 **Downstream session lost — redial and retry.** A stateful remote
  server that restarts, or reclaims the router's session on its own, answers
  every later request `404` (unknown session id) — or `400` (no session id) if
  the router joined while it was stateless. The SDK's client transport keeps the
  dead id rather than re-initializing, the pool sees no close so the row stays
  `ready`, and a remote row is never idle-reaped: the server stayed unreachable
  until something else replaced the connection (70 minutes, the one time it was
  measured), and an aggregate or workspace listed its other members without it. `GatewayManager.withClient(name, run)` is now how every
  proxied, fanned-out and UI request reaches a downstream: on a lost session
  the requests already out on the stale client are left to settle, the row is
  redialled once and the request runs a second time. Safe for `tools/call`
  because both statuses are a refusal before dispatch. Covered in
  `gateway/__tests__/manager.test.ts` against a real stateful HTTP server (404,
  400, a concurrent burst, and an unrelated failure that must not redial). Spec:
  a client that gets `404` for its session id MUST start a new session. The redial
  itself now lives in the pool
  ([agent-mcp-pool#98](https://github.com/cubicecho/agent-mcp-pool/pull/98),
  released in 3.6.0) and `withClient` is a call to `pool.use()`, keeping only
  the router's error wording and its read of the handshake.

### Phase 6 — Remote OAuth sign-in

- [x] O1 **Pool:** `HttpServerConfig.authProvider`, passed to the SDK transport;
  not part of `sameConnection`, never reported by `state()` (agent-mcp-pool 3.8.0).
- [x] O2 **Shared:** `settings.publicUrl`, `serverOAuthSchema` on the server
  config, `needs-auth` runtime state, `ServerStatus.oauth`, the start/check DTOs,
  `oauthClient` on install and update.
- [x] O3 **Server:** `oauth/` — `StoredOAuthProvider`, `OAuthService` (flows,
  check, sign-out), public `/oauth/callback` and `/oauth/client-metadata.json`;
  manager attaches the provider and reports `needs-auth`. Covered end to end in
  `oauth/__tests__/oauth.test.ts` against a stub login + protected MCP server
  (sign-in, refresh, single-use state, cancelled login, sign-out, publicUrl).
- [x] O4 **App:** `OAuthSignInButton` (popup + `postMessage`, blocked-popup
  link), sign-in step in the add dialog, optional OAuth client fields, sign-in
  row and sign-out on the server page, `needs sign-in` badge, Public URL setting.

### Phase 7 — LAN discovery

The router finds MCP servers other machines announce, and offers each one to add; it never adds one by itself.
Design notes and the mDNS convention are in `@cubicecho/mcp-discovery`'s SPECS.md.

- [x] D1 **Shared:** `settings.instanceId` (written from the hostname on first run, then kept), `lanAdvertise`
  (default false), `lanDiscovery` (default true), `lanDismissed`; `discovered: { key, cardName }` on a server
  config and on the install request; `DiscoveredServer`, `GET /api/discovery`, `POST /api/discovery/dismissed`;
  the three settings on `RouterStatus` and the settings PATCH.
- [x] D2 **Server:** discovery documents (above). `discovery/lan-servers.ts` wraps `watchServers`: it leaves out
  the router's own announcement and every card with the router role (so two routers never add each other in a
  loop), works out available / added / dismissed (added = a config with that discovery key, or already pointing at
  the URL), suggests a free local name, and repoints an added server's config when it moves. `createAdvertiser`
  announces `MCP Router on <instanceId>` while `lanAdvertise` is on and the router is not bound to loopback. Both
  follow the store's `change` event and close first on shutdown.
- [x] D3 **App:** "Found on your network" card on the Servers page (Add opens a dialog for the local name and
  any required header, Dismiss hides it); "Network discovery" card in Settings with both switches and "Offer
  again" for dismissed servers.
- [x] D4 **End to end, 2026-11-05:** mcp-skills-manager advertising on the LAN; the router offered `/mcp` and its
  workspace, the UI added `/mcp` with its token, and the router served its tools as `skills__*` on `/mcp`.

### Phase 8 — GraphQL replaces REST (issue #91)

- [x] G1 **Server:** `/graphql` and `/admin/mcp` over the database, with a hand-written field for everything the
  REST routes did that CRUD can't (see "Management GraphQL" above).
- [x] G2 **App:** the client reads and writes through `/graphql` with typed documents from codegen.
- [x] G3 **Server:** the try-it calls as mutations (`callServerTool` and its siblings); `/api` unmounted and
  `server/src/api/` deleted. The reconcile helpers moved to `gateway/reconcile.ts`, the error middleware to
  `http/`, the test-call logic to `gateway/ui-calls.ts`; the REST-only DTOs left `shared/src/api.ts`.
- [x] G4 **Server:** better-auth (issue #91, step 4). The operator signs in through OIDC (env or paired from a setup
  URL) or as the local admin under `SECURE_LOCAL_NET`, with sessions in Postgres; machine callers use api-key plugin
  keys on `/mcp*`, `/graphql` and `/admin/mcp`; the caller role (`operator`/`agent`) comes from the credential; key
  management, sessions, sign-in setup and settings are a person's. The old router token is imported as a key. See
  the Auth decision above.
