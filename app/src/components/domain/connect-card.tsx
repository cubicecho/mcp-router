import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getToken } from '@/lib/auth';
import { useRouterStatus } from '@/lib/queries';

const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>';
const TOKEN_MASK = '••••••••••••';

interface SnippetInput {
  endpoint: string;
  /** Client-side name for the server entry, e.g. "mcp-router" or the server's local name. */
  label: string;
  /** Bearer token value to embed, or undefined when auth is disabled. */
  token?: string;
}

function claudeCodeSnippet({ endpoint, label, token }: SnippetInput): string {
  const header = token ? ` --header "Authorization: Bearer ${token}"` : '';
  return `claude mcp add --transport http ${label} ${endpoint}${header}`;
}

function mcpJsonSnippet({ endpoint, label, token }: SnippetInput): string {
  return JSON.stringify(
    {
      mcpServers: {
        [label]: {
          type: 'http',
          url: endpoint,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
      },
    },
    null,
    2,
  );
}

function curlSnippet({ endpoint, token }: SnippetInput): string {
  const lines = [
    `curl -X POST ${endpoint} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
  ];
  if (token) {
    lines.push(`  -H "Authorization: Bearer ${token}" \\`);
  }
  lines.push(`  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`);
  return lines.join('\n');
}

function Snippet({ display, copyText }: { display: string; copyText: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-12 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
        {display}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy snippet"
        className="absolute top-2 right-2"
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

/**
 * Ready-to-paste client configuration for an MCP endpoint. Copying embeds the
 * real bearer token; on screen it stays masked unless revealed.
 */
export function ConnectCard({
  endpoint,
  label,
  description,
}: {
  endpoint: string;
  label: string;
  description: string;
}) {
  const { data: status } = useRouterStatus();
  const [revealed, setRevealed] = useState(false);

  // Assume auth until status says otherwise — a placeholder header is easier
  // to delete than a missing one is to diagnose.
  const authEnabled = status?.authEnabled ?? true;
  const token = getToken() ?? undefined;
  const copyToken = authEnabled ? (token ?? TOKEN_PLACEHOLDER) : undefined;
  const displayToken = authEnabled ? (token ? (revealed ? token : TOKEN_MASK) : TOKEN_PLACEHOLDER) : undefined;

  const snippets = [
    { value: 'claude-code', title: 'Claude Code', build: claudeCodeSnippet },
    { value: 'mcp-json', title: '.mcp.json', build: mcpJsonSnippet },
    { value: 'curl', title: 'curl', build: curlSnippet },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          Connect a client
          {authEnabled && token && (
            <Button variant="outline" size="sm" onClick={() => setRevealed((v) => !v)}>
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
              {revealed ? 'Hide token' : 'Reveal token'}
            </Button>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="claude-code">
          <TabsList>
            {snippets.map(({ value, title }) => (
              <TabsTrigger key={value} value={value}>
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
          {snippets.map(({ value, build }) => (
            <TabsContent key={value} value={value} className="pt-2">
              <Snippet
                display={build({ endpoint, label, token: displayToken })}
                copyText={build({ endpoint, label, token: copyToken })}
              />
            </TabsContent>
          ))}
        </Tabs>
        {authEnabled && (
          <p className="mt-2 text-xs text-muted-foreground">
            Copied snippets include your bearer token{token ? '' : ' placeholder'} — treat them as secrets.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
