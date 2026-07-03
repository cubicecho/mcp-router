import { createFileRoute, Link } from '@tanstack/react-router';
import { CompassIcon } from 'lucide-react';
import { ServerList } from '@/components/domain/server/list';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useServers } from '@/lib/queries';

export const Route = createFileRoute('/')({
  component: ServersPage,
});

function ServersPage() {
  const { data, isPending, error } = useServers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Servers</h1>
        <p className="text-sm text-muted-foreground">Installed MCP servers and their runtime state.</p>
      </div>

      {isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {error && <p className="text-sm text-destructive">Failed to load servers: {error.message}</p>}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">No servers installed yet.</p>
            <Button asChild>
              <Link to="/browse">
                <CompassIcon /> Browse registries
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && <ServerList servers={data} />}
    </div>
  );
}
