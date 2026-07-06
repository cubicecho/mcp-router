import type { ToolCallResponse } from '@mcp-router/shared';
import { ChevronRightIcon, Loader2Icon, PlayIcon, RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { ServerTool } from '@/lib/api';
import { useCallServerTool, useServerTools } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** Prefill the args editor from the tool's input schema: one key per property. */
function argsTemplate(inputSchema: unknown): string {
  const properties = (inputSchema as { properties?: Record<string, { type?: string; default?: unknown }> } | undefined)
    ?.properties;
  if (!properties || Object.keys(properties).length === 0) {
    return '{}';
  }
  const template: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    template[key] =
      prop.default ??
      (prop.type === 'number' || prop.type === 'integer'
        ? 0
        : prop.type === 'boolean'
          ? false
          : prop.type === 'array'
            ? []
            : prop.type === 'object'
              ? {}
              : '');
  }
  return JSON.stringify(template, null, 2);
}

function ToolRow({ serverName, tool }: { serverName: string; tool: ServerTool }) {
  const [open, setOpen] = useState(false);
  const [argsText, setArgsText] = useState(() => argsTemplate(tool.inputSchema));
  const [result, setResult] = useState<ToolCallResponse | null>(null);
  const call = useCallServerTool(serverName);

  const run = () => {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsText.trim() || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('arguments must be a JSON object');
      }
      args = parsed as Record<string, unknown>;
    } catch (error) {
      toast.error(`Invalid arguments: ${error instanceof Error ? error.message : 'not valid JSON'}`);
      return;
    }
    setResult(null);
    call.mutate(
      { name: tool.name, arguments: args },
      {
        onSuccess: setResult,
        onError: toastApiError,
      },
    );
  };

  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left">
        <ChevronRightIcon
          className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0">
          <span className="font-mono text-sm">{tool.name}</span>
          {tool.description && <p className="text-sm text-muted-foreground">{tool.description}</p>}
        </span>
      </button>
      {open && (
        <div className="mt-2 ml-6 flex flex-col gap-2">
          <Textarea
            value={argsText}
            rows={Math.min(10, Math.max(3, argsText.split('\n').length))}
            className="font-mono text-xs"
            aria-label={`Arguments for ${tool.name}`}
            onChange={(event) => setArgsText(event.target.value)}
          />
          <div>
            <Button size="sm" variant="outline" disabled={call.isPending} onClick={run}>
              {call.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Run
            </Button>
          </div>
          {result && (
            <div>
              <p className={cn('text-xs font-medium', result.isError ? 'text-destructive' : 'text-muted-foreground')}>
                {result.isError ? 'Tool returned an error' : 'Result'}
              </p>
              <pre
                className={cn(
                  'mt-1 max-h-96 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap',
                  result.isError && 'border border-destructive/50',
                )}
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ToolsCard({ name }: { name: string }) {
  const { data, isPending, error, refetch, isRefetching } = useServerTools(name);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tools</CardTitle>
        <CardDescription>
          Tools reported by the downstream server. Expand one to run it with JSON arguments — runs show up in the
          Activity tab.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Connecting to the server — this may take a moment…</p>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        )}
        {error && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-destructive">Failed to list tools: {error.message}</p>
            <Button variant="outline" size="sm" disabled={isRefetching} onClick={() => refetch()}>
              <RotateCwIcon /> Retry
            </Button>
          </div>
        )}
        {data && data.tools.length === 0 && <p className="text-sm text-muted-foreground">No tools reported.</p>}
        {data && data.tools.length > 0 && (
          <ul className="flex flex-col divide-y">
            {data.tools.map((tool) => (
              <ToolRow key={tool.name} serverName={name} tool={tool} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
