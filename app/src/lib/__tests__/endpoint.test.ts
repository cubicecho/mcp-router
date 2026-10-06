import { describe, expect, it } from 'vitest';
import { AGGREGATE_ENDPOINT_PATH, endpointPath, endpointUrl } from '../endpoint';

describe('endpointPath', () => {
  it('serves a server at /mcp/<name>', () => {
    expect(endpointPath({ kind: 'server', name: 'github' })).toBe('/mcp/github');
  });

  it('serves a workspace at /mcp/w/<slug>', () => {
    expect(endpointPath({ kind: 'workspace', slug: 'team' })).toBe('/mcp/w/team');
  });
});

describe('endpointUrl', () => {
  it('puts a path on the origin the UI was loaded from', () => {
    expect(endpointUrl(AGGREGATE_ENDPOINT_PATH)).toBe(`${window.location.origin}/mcp`);
  });
});
