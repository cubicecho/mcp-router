import { RotateCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useServerTools } from '@/lib/queries';

export function ToolsCard({ name }: { name: string }) {
  const { data, isPending, error, refetch, isRefetching } = useServerTools(name);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tools</CardTitle>
        <CardDescription>Tools reported by the downstream server.</CardDescription>
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
              <li key={tool.name} className="py-2 first:pt-0 last:pb-0">
                <span className="font-mono text-sm">{tool.name}</span>
                {tool.description && <p className="text-sm text-muted-foreground">{tool.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
