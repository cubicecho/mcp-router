import { createFileRoute, Link } from '@tanstack/react-router';
import { CompassIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { AddServerDialog } from '@/components/domain/server/add-server-dialog';
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
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Servers</h1>
          <p className="text-sm text-muted-foreground">Installed MCP servers and their runtime state.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon /> Add server
        </Button>
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
            <div className="flex gap-2">
              <Button onClick={() => setAddOpen(true)}>
                <PlusIcon /> Add server
              </Button>
              <Button variant="outline" asChild>
                <Link to="/browse">
                  <CompassIcon /> Browse registries
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && <ServerList servers={data} />}

      {addOpen && <AddServerDialog open onOpenChange={setAddOpen} />}
    </div>
  );
}
