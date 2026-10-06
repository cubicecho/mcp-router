import { describe, expect, it } from 'vitest';
import { claudeCodeSnippet, curlSnippet, mcpJsonSnippet, opencodeSnippet } from '@/lib/connect-snippets';

const input = { endpoint: 'http://localhost:3001/mcp', label: 'mcp-router' };

describe('connect snippets', () => {
  it('builds the claude mcp add command, with a header only when there is a token', () => {
    expect(claudeCodeSnippet(input)).toBe('claude mcp add --transport http mcp-router http://localhost:3001/mcp');
    expect(claudeCodeSnippet({ ...input, token: 'abc' })).toBe(
      'claude mcp add --transport http mcp-router http://localhost:3001/mcp --header "Authorization: Bearer abc"',
    );
  });

  it('builds a .mcp.json entry keyed by the label', () => {
    expect(JSON.parse(mcpJsonSnippet(input))).toEqual({
      mcpServers: { 'mcp-router': { type: 'http', url: input.endpoint } },
    });
    expect(JSON.parse(mcpJsonSnippet({ ...input, token: 'abc' })).mcpServers['mcp-router'].headers).toEqual({
      Authorization: 'Bearer abc',
    });
  });

  it('builds an opencode remote entry', () => {
    expect(JSON.parse(opencodeSnippet({ ...input, token: 'abc' }))).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'mcp-router': {
          type: 'remote',
          url: input.endpoint,
          enabled: true,
          headers: { Authorization: 'Bearer abc' },
        },
      },
    });
  });

  it('builds a curl tools/list call, with the auth header only when there is a token', () => {
    expect(curlSnippet(input)).not.toContain('Authorization');
    const withToken = curlSnippet({ ...input, token: 'abc' });
    expect(withToken).toContain(`curl -X POST ${input.endpoint}`);
    expect(withToken).toContain('-H "Authorization: Bearer abc"');
    expect(withToken).toContain('"method":"tools/list"');
  });
});
