import { CardLayout } from '@/components/card-layout';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { claudeCodeSnippet, curlSnippet, mcpJsonSnippet, opencodeSnippet } from '@/lib/connect-snippets';
import { useRouterStatus } from '@/lib/queries';
import { toastCopyError } from '@/lib/toast';

/** What the snippets carry where the client's API key goes. */
const API_KEY_PLACEHOLDER = '<YOUR_API_KEY>';

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
 * With auth on, the snippets send a placeholder API key for the reader to replace with one of theirs from Settings.
 * The UI's own session is never put in them: it is the operator's sign-in, and it expires.
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
  // Assume auth until status says otherwise — a placeholder header is easier
  // to delete than a missing one is to diagnose.
  const authEnabled = status?.authEnabled ?? true;
  const token = authEnabled ? API_KEY_PLACEHOLDER : undefined;

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
            {snippets.map(({ value, build }) => {
              const snippet = build({ endpoint, label, token });
              return (
                <TabsContent key={value} value={value} className="pt-2">
                  <CodeBlock
                    wrap
                    content={snippet}
                    actionSlot={
                      <CopyButton variant="ghost" value={snippet} label="Copy snippet" onError={toastCopyError} />
                    }
                  />
                </TabsContent>
              );
            })}
          </Tabs>
          {authEnabled && (
            <p className="mt-2 text-xs text-foreground/60">
              Replace {API_KEY_PLACEHOLDER} with an API key from Settings, under Access.
            </p>
          )}
        </>
      }
    />
  );
}
