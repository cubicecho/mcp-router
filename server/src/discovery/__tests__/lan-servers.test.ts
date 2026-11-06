import { createServerCard, type ServerCard } from '@cubicecho/mcp-discovery';
import { type LanServer, type ServerWatchHandlers, toMcpHost } from '@cubicecho/mcp-discovery/mdns';
import type { ServerConfig } from '@mcp-router/shared';
import { describe, expect, it, vi } from 'vitest';
import { ROUTER_ROLE_META_KEY } from '../endpoints.ts';
import { createLanServers } from '../lan-servers.ts';

/** A server another host advertises, as `watchServers` reports it. */
function lanServer(
  instance: string,
  card: Partial<ServerCard> & { name: string },
  url: string,
  headers = false,
): LanServer {
  const full = createServerCard({
    version: '1.0.0',
    description: 'Something useful.',
    remotes: [
      {
        type: 'streamable-http',
        url,
        headers: headers ? [{ name: 'Authorization', isRequired: true, isSecret: true }] : [],
      },
    ],
    ...card,
  });
  const host = toMcpHost({ name: instance, host: 'nas.local', port: 3000, addresses: ['192.168.1.20'], txt: {} });
  const requiredHeaders = headers ? ['Authorization'] : [];
  return { key: `${instance}/${full.name}`, host, card: full, cardUrl: null, connection: { url, requiredHeaders } };
}

/** A remote server config. */
function remote(name: string, url: string, discovered?: ServerConfig['discovered']): ServerConfig {
  return {
    name,
    enabled: true,
    source: { type: 'remote' },
    transport: { type: 'streamable-http', url, headers: {} },
    env: {},
    envMeta: {},
    ...(discovered ? { discovered } : {}),
  };
}

/** A LAN watch over a fake network, with the settings and configs under the test's control. */
function setup() {
  const state = { wanted: true, servers: [] as ServerConfig[], dismissed: [] as string[] };
  let handlers: ServerWatchHandlers | undefined;
  const stop = vi.fn(async () => undefined);
  const watch = vi.fn(async (given: ServerWatchHandlers) => {
    handlers = given;
    return { stop };
  });
  const onMoved = vi.fn(async () => undefined);
  const lan = createLanServers({
    isWanted: () => state.wanted,
    ownInstanceName: () => 'MCP Router on box',
    servers: () => state.servers,
    dismissed: () => state.dismissed,
    onMoved,
    log: () => undefined,
    watch,
  });
  const announce = (server: LanServer) => handlers?.onUp(server);
  const leave = (server: LanServer) => handlers?.onDown?.(server);
  return { lan, state, watch, stop, onMoved, announce, leave };
}

const skills = lanServer(
  'MCP Skills on nas',
  { name: 'io.github.cubicecho.mcp-skills.nas/skills', title: 'Skills' },
  'http://192.168.1.20:3000/mcp',
  true,
);

describe('createLanServers', () => {
  it('offers a found server with a free local name and the headers left to fill in', async () => {
    const { lan, announce } = setup();
    await lan.sync();
    announce(skills);
    expect(lan.list()).toEqual([
      {
        key: skills.key,
        cardName: 'io.github.cubicecho.mcp-skills.nas/skills',
        title: 'Skills',
        description: 'Something useful.',
        version: '1.0.0',
        host: 'MCP Skills on nas',
        url: 'http://192.168.1.20:3000/mcp',
        requiredHeaders: ['Authorization'],
        suggestedName: 'skills',
        state: 'available',
      },
    ]);
  });

  it('never offers itself or another router', async () => {
    const { lan, announce } = setup();
    await lan.sync();
    announce(
      lanServer('MCP Router on box', { name: 'io.github.cubicecho.mcp-skills.box/skills' }, 'http://10.0.0.1/mcp'),
    );
    announce(
      lanServer(
        'MCP Router on other',
        { name: 'io.github.cubicecho.mcp-router.other/aggregate', _meta: { [ROUTER_ROLE_META_KEY]: 'aggregate' } },
        'http://10.0.0.2/mcp',
      ),
    );
    expect(lan.list()).toEqual([]);
  });

  it('shows a server as added when a config came from it, or already points at its URL', async () => {
    const { lan, state, announce } = setup();
    await lan.sync();
    announce(skills);
    state.servers = [remote('my-skills', 'http://192.168.1.20:3000/mcp/')];
    expect(lan.list()[0]).toMatchObject({ state: 'added', serverName: 'my-skills' });
    state.servers = [remote('found', 'http://elsewhere/mcp', { key: skills.key, cardName: skills.card.name })];
    expect(lan.list()[0]).toMatchObject({ state: 'added', serverName: 'found' });
  });

  it('suggests a name that is not taken', async () => {
    const { lan, state, announce } = setup();
    await lan.sync();
    announce(skills);
    state.servers = [remote('skills', 'http://other/mcp'), remote('skills-2', 'http://other2/mcp')];
    expect(lan.list()[0]?.suggestedName).toBe('skills-3');
  });

  it('shows a dismissed server as dismissed, and forgets one that left', async () => {
    const { lan, state, announce, leave } = setup();
    await lan.sync();
    announce(skills);
    state.dismissed = [skills.key];
    expect(lan.list()[0]?.state).toBe('dismissed');
    leave(skills);
    expect(lan.list()).toEqual([]);
  });

  it('points an added server at its new URL when it moves', async () => {
    const { lan, state, announce, onMoved } = setup();
    await lan.sync();
    const config = remote('skills', 'http://192.168.1.20:3000/mcp', { key: skills.key, cardName: skills.card.name });
    state.servers = [config];
    announce({ ...skills, connection: { url: 'http://192.168.1.99:3000/mcp', requiredHeaders: [] } });
    expect(onMoved).toHaveBeenCalledWith(config, 'http://192.168.1.99:3000/mcp');
  });

  it('watches only while the setting is on', async () => {
    const { lan, state, watch, stop, announce } = setup();
    state.wanted = false;
    await lan.sync();
    expect(watch).not.toHaveBeenCalled();
    state.wanted = true;
    await lan.sync();
    await lan.sync();
    expect(watch).toHaveBeenCalledTimes(1);
    announce(skills);
    state.wanted = false;
    await lan.sync();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(lan.list()).toEqual([]);
  });
});
