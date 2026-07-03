import { createFileRoute } from '@tanstack/react-router';
import { RotateCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useReloadConfig, useRouterStatus } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function SettingsPage() {
  const { data: status, isPending, error } = useRouterStatus();
  const reload = useReloadConfig();
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

  const handleReload = () => {
    reload.mutate(undefined, {
      onSuccess: () => toast.success('Configuration reloaded', { description: 'Running servers were reconciled.' }),
      onError: toastApiError,
    });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Router status and configuration.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Router</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {isPending && <Skeleton className="h-24 w-full" />}
          {error && <p className="text-sm text-destructive">Failed to load status: {error.message}</p>}
          {status && (
            <>
              <Row label="Version">{status.version}</Row>
              <Row label="Uptime">{formatUptime(status.uptimeSeconds)}</Row>
              <Row label="Port">{port}</Row>
              <Row label="Servers">
                {status.runningCount}/{status.serverCount} running
              </Row>
              <Row label="Auth">
                {status.authEnabled ? (
                  <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    enabled
                  </Badge>
                ) : (
                  <Badge variant="secondary">disabled</Badge>
                )}
              </Row>
              <p className="text-xs text-muted-foreground">
                The bearer token is set via the <code>MCP_ROUTER_TOKEN</code> environment variable or{' '}
                <code>settings.json</code>; it protects <code>/api/*</code> and <code>/mcp*</code>.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration files</CardTitle>
          <CardDescription>
            All configuration lives in flat, hand-editable JSON files under <code>DATA_DIR/config</code>:
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {`config/
├── settings.json        # port, auth token, auth enabled, idle timeout
├── registries.json      # { registries: [{ name, url }] }
└── servers/
    └── <name>.json      # one file per installed server`}
          </pre>
          <p className="text-sm text-muted-foreground">
            Files are watched for changes automatically. After hand-editing you can also trigger an explicit reload — it
            re-reads everything from disk and reconciles running servers.
          </p>
          <div>
            <Button disabled={reload.isPending} onClick={handleReload}>
              <RotateCwIcon /> {reload.isPending ? 'Reloading…' : 'Reload config'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
