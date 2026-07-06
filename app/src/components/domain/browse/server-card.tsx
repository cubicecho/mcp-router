import type { RegistryServer } from '@mcp-router/shared';
import { Link } from '@tanstack/react-router';
import { DownloadIcon, ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';
import { InstallDialog } from '@/components/domain/browse/install-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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
    (s) => s.config.source.type === 'registry' && s.config.source.serverName === server.name,
  );

  const linkUrl = server.websiteUrl ?? server.repository?.url;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span className="break-all">{server.title ?? server.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            {installed && (
              <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                Installed
              </Badge>
            )}
            {server.version && <Badge variant="outline">v{server.version}</Badge>}
          </span>
        </CardTitle>
        <CardDescription className="break-all font-mono text-xs">{server.name}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {server.description && <p className="line-clamp-3 text-sm text-muted-foreground">{server.description}</p>}
        {distribution.length > 0 && (
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{distribution.join(' · ')}</p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        {installed ? (
          <Button size="sm" variant="outline" asChild>
            <Link to="/servers/$name" params={{ name: installed.config.name }}>
              View {installed.config.name}
            </Link>
          </Button>
        ) : (
          <Button size="sm" onClick={() => setInstallOpen(true)}>
            <DownloadIcon /> Install
          </Button>
        )}
        {linkUrl && (
          <Button size="sm" variant="ghost" asChild>
            <a href={linkUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon /> {server.websiteUrl ? 'Website' : 'Repository'}
            </a>
          </Button>
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
      </CardFooter>
    </Card>
  );
}
