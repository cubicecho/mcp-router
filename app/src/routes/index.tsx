import { DiscoveredServerState } from '@mcp-router/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CompassIcon } from 'lucide-react';
import { useState } from 'react';
import { FoundServersCard } from '@/components/domain/discovery/found-servers-card';
import { ConnectCard } from '@/components/domain/endpoint/connect-card';
import { AddServerDialog } from '@/components/domain/server/add-server-dialog';
import { ServerList } from '@/components/domain/server/list';
import { EmptyState } from '@/components/empty-state';
import { LoadState } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Plus, Server } from '@/components/ui/icons';
import { AGGREGATE_ENDPOINT_PATH, endpointUrl } from '@/lib/endpoint';
import { useDiscovery, useServers } from '@/lib/queries';

/** The `/` route. */
export const Route = createFileRoute('/')({
  component: ServersPage,
});

/**
 * The Servers page: servers found on the network, the installed servers, the aggregate endpoint's connect card and
 * the add-server dialog.
 *
 * @returns The page.
 */
function ServersPage() {
  const servers = useServers();
  const { data } = servers;
  const [addOpen, setAddOpen] = useState(false);
  const discovery = useDiscovery();
  const found = (discovery.data?.servers ?? []).filter((server) => server.state === DiscoveredServerState.Available);

  return (
    <PageLayout
      title="Servers"
      description="Installed MCP servers and their runtime state."
      actionSlot={<Button onClick={() => setAddOpen(true)} iconSlot={<Plus />} content="Add server" />}
      contentSlot={
        <div className="flex flex-col gap-6 py-4 md:py-6">
          {found.length > 0 && <FoundServersCard servers={found} />}

          <LoadState
            query={servers}
            what="servers"
            count={data?.length ?? 0}
            emptySlot={
              <EmptyState
                iconSlot={<Server />}
                title="No servers installed yet"
                description="Add one by hand, or install one from a registry."
                actionSlot={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => setAddOpen(true)} iconSlot={<Plus />} content="Add server" />
                    <Button
                      variant="outline"
                      linkSlot={<Link to="/browse" />}
                      iconSlot={<CompassIcon />}
                      content="Browse registries"
                    />
                  </div>
                }
              />
            }
          />

          {data && data.length > 0 && (
            <>
              <ServerList servers={data} />
              <ConnectCard
                endpoint={endpointUrl(AGGREGATE_ENDPOINT_PATH)}
                label="mcp-router"
                description="Point an MCP client at the aggregate endpoint to get every enabled server's tools, namespaced as <server>__<tool>."
              />
            </>
          )}

          {addOpen && <AddServerDialog open onOpenChange={setAddOpen} />}
        </div>
      }
    />
  );
}
