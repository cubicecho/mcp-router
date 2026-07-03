# AGENTS.md — MCP Router

MCP Router is an MCP gateway: it installs MCP servers from registries (default:
the official registry at registry.modelcontextprotocol.io) or directly from
npm, runs stdio servers as lazily-spawned child processes (or proxies remote
streamable-HTTP servers), and re-exposes each one over streamable HTTP at
`/mcp/<name>` plus a merged aggregate at `/mcp` with `<server>__`-namespaced
tools. Configuration lives in hand-editable flat JSON files under
`DATA_DIR/config`; a React web UI manages registries, installs, and per-server
env vars/API keys.

**Read [`SPECS.md`](SPECS.md) first** — it holds the locked design decisions,
config-file/API contracts, and the itemized work list.

Monorepo (npm workspaces): `shared/` (zod schemas + types — the contract),
`server/` (Express 5 + MCP TS SDK), `app/` (React + Vite + shadcn/ui).

## Commands

All from the project root.

```bash
# Dev
npm run dev              # server (watch) + Vite dev server, concurrently
npm run dev:server       # Express + MCP gateway only (port 3001)
npm run dev:app          # Vite dev server only (port 3000, proxies /api + /mcp)

# Quality — run before every commit; CI fails otherwise
npm run check            # biome check + tsc --noEmit for all packages
npm run check:fix        # biome with auto-fix
npm run lint / lint:fix  # biome lint only
npm test                 # vitest run
npm run test:watch       # vitest watch

# Build / deploy
npm run build            # shared typecheck → server tsc → app vite build
npm run start            # node server/dist/index.js (serves app/dist)
npm run build:docker     # docker build -t mcp-router .
docker compose up        # run the container; ./data mounted at /data
```

## Tech Stack

| Choice | Why |
| --- | --- |
| **Biome** | Single formatter+linter; enforces `useImportType`, `noUnusedImports` |
| **Express 5 + @modelcontextprotocol/sdk** | `StreamableHTTPServerTransport` for exposed endpoints; SDK `Client` with stdio/streamable-http transports for downstream servers |
| **Flat JSON config** | `DATA_DIR/config/{settings,registries}.json` + `config/servers/<name>.json`; hand-editable, watched (chokidar) + `POST /api/reload`; secrets plaintext, files mode 0600 |
| **Node ≥22.18 type stripping** | Server dev runs `.ts` directly (`node --watch`), no build step; `tsc` with `rewriteRelativeImportExtensions` emits `dist/` for prod — so **use `.ts` extensions in all relative imports** in `server/` and `shared/` |
| **Vite + React 19 + shadcn/ui + TanStack Router/Query** | Same frontend stack as sibling repos (philotes), minus GraphQL — plain REST with shared zod DTOs |
| **Single bearer token auth** | `MCP_ROUTER_TOKEN` env or generated into settings.json; guards `/api/*` and `/mcp*` |

## Key Conventions

**The `shared/` package is the contract.** Config-file shapes, registry API
responses, and REST DTOs are zod schemas in `shared/src/`. Server validates
with them at every boundary (config load, request bodies, registry responses);
the app imports the inferred types via `@mcp-router/shared`. Never duplicate
these shapes — extend the schema and let types flow.

**Type inference — never hand-write types zod can infer:**
```typescript
export type ServerConfig = z.infer<typeof serverConfigSchema>;
```

**Validate at boundaries, trust inside:**
```typescript
const input = installRequestSchema.parse(req.body); // throws → 400 via error middleware
```

**Never swallow errors:**
```typescript
try {
  await client.connect(transport);
} catch (cause) {
  throw new Error(`Failed to connect to server "${name}"`, { cause });
}
```

**Config writes are atomic:** write to a temp file in the same dir, `chmod
0600`, then `rename`. Parse leniently (`.passthrough()`) so hand-added keys
survive round-trips.

**Child processes:** always `execFile`/`spawn` with arg arrays — never string
interpolation into a shell. Downstream env = explicit allowlist (`PATH`,
`HOME`, …) + the server's configured `env`, not full `process.env`.

**Frontend:** shadcn/ui primitives in `app/src/components/ui/` (no app logic
there); feature components in `app/src/components/domain/`; file-based routes
in `app/src/routes/`; `@/` maps to `app/src/`. Data fetching via TanStack
Query hooks wrapping the typed client in `src/lib/api.ts` — no raw `fetch` in
components. Invalidate the relevant query keys after every mutation.

## Code Style

- Biome-enforced: single quotes, semicolons, trailing commas, 2-space indent,
  120 line width, `import type` for type-only imports, arrow parens always
- Files `kebab-case.ts(x)`; components `PascalCase`; vars/functions
  `camelCase`; types/interfaces `PascalCase`; true constants
  `SCREAMING_SNAKE_CASE`
- Prefix unused params with `_`
- `unknown` over `any` (`noExplicitAny` warns)
- Tests in `__tests__/` next to source or `*.test.ts(x)`; Vitest
  `describe`/`it`/`expect`

## Git

- `git pull --no-rebase` (merge, not rebase)
- Do not add `Co-Authored-By` trailers to commit messages
- Run `npm run check` and `npm test` before every commit

## Finding code

Prefer an LSP (definitions/references) over grep when navigating the codebase.
