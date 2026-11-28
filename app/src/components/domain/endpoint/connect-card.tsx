import { CardLayout } from '@/components/card-layout';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { claudeCodeSnippet, curlSnippet, mcpJsonSnippet, opencodeSnippet } from '@/lib/connect-snippets';
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
 * The snippets send a placeholder API key for the reader to replace with one from Settings → API keys: `/mcp*` takes
 * only API keys, even on a trusted network. The UI's own session is never put in them; it does not open `/mcp`.
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
  const token = API_KEY_PLACEHOLDER;

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
          <p className="mt-2 text-xs text-foreground/60">
            Replace {API_KEY_PLACEHOLDER} with a key from Settings → API keys. Every client needs one.
          </p>
        </>
      }
    />
  );
}
