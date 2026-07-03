import type { RegistryServer } from '@mcp-router/shared';
import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';
import { InstallDialog } from '@/components/domain/browse/install-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

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

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span className="break-all">{server.title ?? server.name}</span>
          {server.version && (
            <Badge variant="outline" className="shrink-0">
              v{server.version}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="break-all font-mono text-xs">{server.name}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {server.description && <p className="line-clamp-3 text-sm text-muted-foreground">{server.description}</p>}
        {distribution.length > 0 && (
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{distribution.join(' · ')}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button size="sm" onClick={() => setInstallOpen(true)}>
          <DownloadIcon /> Install
        </Button>
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
