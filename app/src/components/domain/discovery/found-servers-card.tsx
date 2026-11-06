import type { DiscoveredServer } from '@mcp-router/shared';
import { RadarIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CardLayout } from '@/components/card-layout';
import { ListItem } from '@/components/list-item';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { useSetDismissed } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { AddFoundServerDialog } from './add-found-server-dialog.tsx';

/** What the found-servers card is given. */
export interface FoundServersCardProps {
  /** The servers found on the network that are not added or dismissed yet. */
  servers: DiscoveredServer[];
}

/** Offers each MCP server another machine on the network announces, to add with one dialog or dismiss. */
export function FoundServersCard({ servers }: FoundServersCardProps) {
  const [adding, setAdding] = useState<DiscoveredServer | null>(null);
  const setDismissed = useSetDismissed();

  const dismiss = (server: DiscoveredServer) => {
    setDismissed.mutate(
      { key: server.key, dismissed: true },
      {
        onSuccess: () =>
          toast.success(`Dismissed ${server.title ?? server.cardName}`, {
            description: 'Offer it again from Settings.',
          }),
        onError: toastApiError,
      },
    );
  };

  return (
    <>
      <CardLayout
        level={2}
        iconSlot={<RadarIcon />}
        title="Found on your network"
        description="MCP servers that other machines on your network announce. Add one to use it through this router."
        contentClassName="flex flex-col gap-2"
        contentSlot={servers.map((server) => {
          const title = server.title ?? server.cardName;
          const needsToken = server.requiredHeaders.length > 0;
          return (
            // Stacked on a phone, so the badge and buttons never squeeze the name to a sliver.
            <div key={server.key} className="flex flex-col gap-1 sm:flex-row sm:items-center">
              <ListItem
                className="flex-1"
                title={title}
                description={
                  <>
                    {server.description} <span className="font-mono text-foreground/60">{server.url}</span>
                  </>
                }
              />
              <div className="flex shrink-0 items-center gap-2 px-3 pb-2 sm:pb-0">
                {needsToken && <Badge variant="secondary">Needs a token</Badge>}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  aria-label={`Dismiss ${title}`}
                  disabled={setDismissed.isPending}
                  onClick={() => dismiss(server)}
                  content="Dismiss"
                />
                <Button
                  size="sm"
                  aria-label={`Add ${title}`}
                  onClick={() => setAdding(server)}
                  iconSlot={<Plus />}
                  content="Add"
                />
              </div>
            </div>
          );
        })}
      />
      {adding && (
        <AddFoundServerDialog
          server={adding}
          open
          onOpenChange={(open) => {
            if (open === false) {
              setAdding(null);
            }
          }}
        />
      )}
    </>
  );
}
