import type { DiscoveredServer } from '@mcp-router/shared';
import { toast } from 'sonner';
import { CardLayout } from '@/components/card-layout';
import { EmptyState } from '@/components/empty-state';
import { ListItem } from '@/components/list-item';
import { Button } from '@/components/ui/button';
import { EyeOff } from '@/components/ui/icons';
import { useSetDismissed } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

/** What the dismissed-servers card is given. */
export interface DismissedServersCardProps {
  /** The servers found on the network that the user dismissed. */
  servers: DiscoveredServer[];
  /** The found servers are still loading. */
  loading?: boolean | undefined;
}

/** Lists the found servers the user dismissed, each with a button that offers it on the Servers page again. */
export function DismissedServersCard({ servers, loading }: DismissedServersCardProps) {
  const setDismissed = useSetDismissed();

  const offerAgain = (server: DiscoveredServer, title: string) => {
    setDismissed.mutate(
      { key: server.key, dismissed: false },
      { onSuccess: () => toast.success(`${title} is offered again`), onError: toastApiError },
    );
  };

  return (
    <CardLayout
      level={2}
      iconSlot={<EyeOff />}
      title="Dismissed servers"
      description="Servers found on your network that you dismissed. Offer one again to see it on the Servers page."
      loading={loading}
      contentClassName="flex flex-col gap-2"
      contentSlot={
        servers.length === 0 ? (
          <EmptyState compact title="No dismissed servers." />
        ) : (
          servers.map((server) => {
            const title = server.title ?? server.cardName;
            return (
              <ListItem
                key={server.key}
                title={title}
                description={<span className="font-mono">{server.url}</span>}
                actionSlot={
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Offer again: ${title}`}
                    disabled={setDismissed.isPending}
                    onClick={() => offerAgain(server, title)}
                    content="Offer again"
                  />
                }
              />
            );
          })
        )
      }
    />
  );
}
