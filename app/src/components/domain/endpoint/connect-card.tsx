import { useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Eye, EyeOff } from '@/components/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getToken } from '@/lib/auth';
import { claudeCodeSnippet, curlSnippet, mcpJsonSnippet, opencodeSnippet } from '@/lib/connect-snippets';
import { useRouterStatus } from '@/lib/queries';
import { toastCopyError } from '@/lib/toast';

const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>';
const TOKEN_MASK = '••••••••••••';

/**
 * Code block whose copy button copies different text from what it shows.
 *
 * @param props.display - What is shown, with the token masked or a placeholder.
 * @param props.copyText - What the copy button copies, with the real token when there is one.
 * @returns The code block.
 */
function Snippet({ display, copyText }: { display: string; copyText: string }) {
  return (
    <CodeBlock
      wrap
      content={display}
      actionSlot={<CopyButton variant="ghost" value={copyText} label="Copy snippet" onError={toastCopyError} />}
    />
  );
}

/**
 * Ready-to-paste client configuration for an MCP endpoint.
 *
 * @param props.endpoint - Absolute URL of the endpoint.
 * @param props.label - Name the snippets register the endpoint under.
 * @param props.description - Line under the card title.
 * @param [props.level] - Heading rank of the card title: `2` under a page title, `3` inside a dialog.
 * @returns The card.
 *
 * @remarks
 * Copying embeds the real bearer token; on screen it stays masked unless revealed. With auth on and no stored token,
 * both carry a placeholder.
 */
export function ConnectCard({
  endpoint,
  label,
  description,
  level = 2,
}: {
  endpoint: string;
  label: string;
  description: string;
  /** Heading rank of the card title: `2` under a page title, `3` inside a dialog. */
  level?: 2 | 3;
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
    { value: 'opencode', title: 'OpenCode', build: opencodeSnippet },
    { value: 'curl', title: 'curl', build: curlSnippet },
  ];

  return (
    <CardLayout
      level={level}
      title="Connect a client"
      description={description}
      actionSlot={
        authEnabled &&
        Boolean(token) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevealed((v) => !v)}
            iconSlot={revealed ? <EyeOff /> : <Eye />}
            content={revealed ? 'Hide token' : 'Reveal token'}
          />
        )
      }
      contentSlot={
        <>
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
            <p className="mt-2 text-xs text-foreground/60">
              Copied snippets include your bearer token{token ? '' : ' placeholder'} — treat them as secrets.
            </p>
          )}
        </>
      }
    />
  );
}
