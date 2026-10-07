import { type RegistryServer, SourceType } from '@mcp-router/shared';
import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { InstallDialog } from '@/components/domain/browse/install-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download } from '@/components/ui/icons';
import { useServers } from '@/lib/queries';

function summarizeDistribution(server: RegistryServer): string[] {
  const packages = (server.packages ?? []).map((pkg) => `${pkg.registryType}: ${pkg.identifier}`);
  const remotes = (server.remotes ?? []).map((remote) => `remote: ${remote.url}`);
  return [...packages, ...remotes];
}

export function RegistryServerCard({
  registry,
  server,
  onInstalled,
}: {
  registry: string;
  server: RegistryServer;
  onInstalled?: (name: string) => void;
}) {
  const [installOpen, setInstallOpen] = useState(false);
  const distribution = summarizeDistribution(server);

  // An install of this registry entry, if one exists locally.
  const { data: installedServers } = useServers();
  const installed = installedServers?.find(
    (s) => s.config.source.type === SourceType.Registry && s.config.source.serverName === server.name,
  );

  const linkUrl = server.websiteUrl ?? server.repository?.url;

  return (
    <CardLayout
      level={2}
      className="flex flex-col"
      contentClassName="flex-1"
      title={<span className="break-all text-base">{server.title ?? server.name}</span>}
      description={<span className="break-all font-mono text-xs">{server.name}</span>}
      actionSlot={
        <span className="flex shrink-0 items-center gap-1">
          {installed && <Badge variant="positive">Installed</Badge>}
          {server.version && <Badge variant="outline">v{server.version}</Badge>}
        </span>
      }
      contentSlot={
        <>
          {server.description && <p className="line-clamp-3 text-sm text-foreground/60">{server.description}</p>}
          {distribution.length > 0 && (
            <p className="mt-2 break-all font-mono text-xs text-foreground/60">{distribution.join(' · ')}</p>
          )}
          {installOpen && (
            <InstallDialog
              registry={registry}
              server={server}
              open={installOpen}
              onOpenChange={setInstallOpen}
              onInstalled={onInstalled}
            />
          )}
        </>
      }
      footerClassName="justify-start"
      footerSlot={
        <span className="flex items-center gap-2">
          {installed ? (
            <Button
              size="sm"
              variant="outline"
              linkSlot={<Link to="/servers/$name" params={{ name: installed.config.name }} />}
              content={`View ${installed.config.name}`}
            />
          ) : (
            <Button size="sm" onClick={() => setInstallOpen(true)} iconSlot={<Download />} content="Install" />
          )}
          {linkUrl && (
            <Button
              size="sm"
              variant="outline"
              linkSlot={<a href={linkUrl} target="_blank" rel="noreferrer" />}
              iconSlot={<ExternalLinkIcon />}
              content={server.websiteUrl ? 'Website' : 'Repository'}
            />
          )}
        </span>
      }
    />
  );
}
