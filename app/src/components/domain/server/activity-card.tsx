import type { ActivityEntry } from '@mcp-router/shared';
import { ChevronRightIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useClearServerActivity, useServerActivity } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { cn } from '@/lib/utils';

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.params !== undefined || entry.result !== undefined || entry.error !== undefined;

  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left disabled:cursor-default"
      >
        <ChevronRightIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
            !hasDetail && 'invisible',
          )}
        />
        <span className="font-mono text-sm">{entry.method}</span>
        {entry.target && <span className="truncate font-mono text-xs text-muted-foreground">{entry.target}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Badge variant={entry.ok ? 'secondary' : 'destructive'}>{entry.ok ? 'ok' : 'error'}</Badge>
          {entry.via === 'aggregate' && <Badge variant="outline">aggregate</Badge>}
          <span className="text-xs text-muted-foreground tabular-nums">{entry.durationMs}ms</span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatTime(entry.at)}</span>
        </span>
      </button>
      {open && hasDetail && (
        <div className="mt-2 ml-6 flex flex-col gap-2">
          {entry.error && (
            <div>
              <p className="text-xs font-medium text-destructive">Error</p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{entry.error}</pre>
            </div>
          )}
          {entry.params !== undefined && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Request</p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{stringify(entry.params)}</pre>
            </div>
          )}
          {entry.result !== undefined && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Response</p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{stringify(entry.result)}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ActivityCard({ name }: { name: string }) {
  const { data, isPending, error, refetch, isRefetching } = useServerActivity(name);
  const clear = useClearServerActivity();

  const entries = data?.entries ?? [];

  const handleClear = () => {
    clear.mutate(name, {
      onSuccess: () => toast.success('Activity cleared'),
      onError: toastApiError,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Activity
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={isRefetching} onClick={() => refetch()}>
              <RotateCwIcon /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={clear.isPending || entries.length === 0}
              onClick={handleClear}
            >
              <Trash2Icon /> Clear
            </Button>
          </span>
        </CardTitle>
        <CardDescription>
          Recent MCP calls proxied to this server (kept in memory; the newest 200 are retained).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        )}
        {error && <p className="text-sm text-destructive">Failed to load activity: {error.message}</p>}
        {data && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No activity yet. Calls made through <code className="font-mono">/mcp/{name}</code> or the aggregate{' '}
            <code className="font-mono">/mcp</code> endpoint will appear here.
          </p>
        )}
        {entries.length > 0 && (
          <ul className="flex flex-col divide-y">
            {entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
