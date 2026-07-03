import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { errorMessage } from '../errors.ts';
import type { GatewayManager } from './manager.ts';
import { createAggregateServer, createProxyServer } from './proxy.ts';

export interface McpRouterDeps {
  store: ConfigStore;
  manager: GatewayManager;
}

/**
 * Streamable-HTTP MCP endpoints, stateless mode: a fresh proxy Server +
 * transport per request, cleaned up when the response closes.
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const { store, manager } = deps;
  const router = Router();

  const handle = async (req: Request, res: Response, buildServer: () => Server): Promise<void> => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close().catch((err: unknown) => console.warn(`MCP transport close failed: ${errorMessage(err)}`));
      server.close().catch((err: unknown) => console.warn(`MCP server close failed: ${errorMessage(err)}`));
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  const proxyDeps = {
    getClient: (name: string) => manager.getClient(name),
    recordToolCount: (name: string, count: number) => manager.recordToolCount(name, count),
    recordActivity: (name: string, entry: Parameters<GatewayManager['recordActivity']>[1]) =>
      manager.recordActivity(name, entry),
  };

  router.all('/', async (req, res) => {
    await handle(req, res, () => createAggregateServer({ ...proxyDeps, serverNames: () => manager.enabledNames() }));
  });

  router.all('/:name', async (req, res) => {
    const name = req.params.name;
    const config = store.getServer(name);
    if (!config || !config.enabled) {
      res.status(404).json({ error: `Unknown server "${name}"` });
      return;
    }
    await handle(req, res, () => createProxyServer(name, proxyDeps));
  });

  return router;
}
