import { RotateCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface CapabilityListProps {
  title: string;
  description: string;
  isPending: boolean;
  error: Error | null;
  isRefetching: boolean;
  refetch: () => void;
  /** Loading verb used in the error line, e.g. "list resources". */
  errorVerb: string;
  /** Number of items; 0 renders the empty state. */
  count: number;
  emptyText: string;
  children: ReactNode;
}

/**
 * Shared card shell for a downstream capability listing (resources, prompts):
 * connecting skeleton, retryable error, empty state, else the caller's list.
 */
export function CapabilityList({
  title,
  description,
  isPending,
  error,
  isRefetching,
  refetch,
  errorVerb,
  count,
  emptyText,
  children,
}: CapabilityListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
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
            <p className="text-sm text-destructive">
              Failed to {errorVerb}: {error.message}
            </p>
            <Button variant="outline" size="sm" disabled={isRefetching} onClick={refetch}>
              <RotateCwIcon /> Retry
            </Button>
          </div>
        )}
        {!isPending && !error && count === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
        {!isPending && !error && count > 0 && <ul className="flex flex-col divide-y">{children}</ul>}
      </CardContent>
    </Card>
  );
}

/** Shared JSON result panel for a run/read/get invocation. */
export function ResultBlock({ result, isError, label }: { result: unknown; isError?: boolean; label?: string }) {
  return (
    <div>
      <p className={cn('text-xs font-medium', isError ? 'text-destructive' : 'text-muted-foreground')}>
        {label ?? (isError ? 'Returned an error' : 'Result')}
      </p>
      <pre
        className={cn(
          'mt-1 max-h-96 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap',
          isError && 'border border-destructive/50',
        )}
      >
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}
