import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon, CheckIcon, CopyIcon, PencilIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ConnectCard } from '@/components/domain/connect-card';
import { ActivityCard } from '@/components/domain/server/activity-card';
import { AddServerDialog } from '@/components/domain/server/add-server-dialog';
import { EnvEditor } from '@/components/domain/server/env-editor';
import { PromptsCard } from '@/components/domain/server/prompts-card';
import { ResourcesCard } from '@/components/domain/server/resources-card';
import { ServerStateBadge } from '@/components/domain/server/state-badge';
import { ToolsCard } from '@/components/domain/server/tools-card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelativeTime, formatSource } from '@/lib/format';
import { useDeleteServer, useRestartServer, useServer, useUpdateServer } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/servers/$name')({
  component: ServerDetailPage,
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <Button variant="ghost" size="icon-sm" aria-label="Copy endpoint URL" onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function OverviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ServerDetailPage() {
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const { data: server, isPending, error } = useServer(name);
  const update = useUpdateServer();
  const restart = useRestartServer();
  const remove = useDeleteServer();
  const [editOpen, setEditOpen] = useState(false);

  const endpointUrl = `${window.location.origin}/mcp/${name}`;

  const handleDelete = () => {
    remove.mutate(name, {
      onSuccess: () => {
        toast.success(`Deleted ${name}`);
        navigate({ to: '/' });
      },
      onError: toastApiError,
    });
  };

  const handleRestart = () => {
    restart.mutate(name, {
      onSuccess: () => toast.success(`Restarted ${name}`),
      onError: toastApiError,
    });
  };

  const handleSaveEnv = (env: Record<string, string>) => {
    update.mutate(
      { name, env },
      {
        onSuccess: () => {
          toast.success('Environment saved', {
            description: 'Restart the server for changes to take effect.',
            action: { label: 'Restart', onClick: handleRestart },
          });
        },
        onError: toastApiError,
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to servers">
          <Link to="/">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{server?.config.displayName ?? name}</h1>
          <p className="text-sm text-muted-foreground">{server?.config.description}</p>
        </div>
      </div>

      {isPending && <Skeleton className="h-64 w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load server: {error.message}</p>}

      {server && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                Overview
                <span className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <PencilIcon /> Edit
                  </Button>
                  <Button variant="outline" size="sm" disabled={restart.isPending} onClick={handleRestart}>
                    <RotateCwIcon /> Restart
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={remove.isPending}>
                        <Trash2Icon className="text-destructive" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This stops the server, deletes its config file, and removes its install directory. This cannot
                          be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <OverviewRow label="Endpoint">
                <span className="flex items-center gap-1">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all">{endpointUrl}</code>
                  <CopyButton text={endpointUrl} />
                </span>
              </OverviewRow>
              <OverviewRow label="State">
                <ServerStateBadge state={server.state} lastError={server.lastError} />
              </OverviewRow>
              <OverviewRow label="Source">
                <span className="break-all">{formatSource(server.config.source)}</span>
              </OverviewRow>
              <OverviewRow label="Transport">
                <span className="break-all">
                  {server.config.transport.type === 'stdio'
                    ? `stdio — ${server.config.transport.command} ${server.config.transport.args.join(' ')}`.trim()
                    : `streamable-http — ${server.config.transport.url}`}
                </span>
              </OverviewRow>
              <OverviewRow label="Enabled">
                <Switch
                  checked={server.config.enabled}
                  disabled={update.isPending}
                  aria-label={`Enable ${name}`}
                  onCheckedChange={(enabled) =>
                    update.mutate(
                      { name, enabled },
                      {
                        onSuccess: () => toast.success(`${enabled ? 'Enabled' : 'Disabled'} ${name}`),
                        onError: toastApiError,
                      },
                    )
                  }
                />
              </OverviewRow>
              {server.pid !== undefined && (
                <OverviewRow label="PID">
                  <span className="tabular-nums">{server.pid}</span>
                </OverviewRow>
              )}
              {server.startedAt && (
                <OverviewRow label="Started">
                  <span title={new Date(server.startedAt).toLocaleString()}>
                    {formatRelativeTime(server.startedAt)}
                  </span>
                </OverviewRow>
              )}
              {server.state === 'error' && server.lastError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">Last error</p>
                  <p className="break-words whitespace-pre-wrap">{server.lastError}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {server.config.transport.type === 'stdio' && (
            <Card>
              <CardHeader>
                <CardTitle>Environment variables</CardTitle>
                <CardDescription>
                  Passed to the server process. Secret values are masked; changes take effect after a restart.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EnvEditor
                  key={name}
                  env={server.config.env}
                  envMeta={server.config.envMeta}
                  onSave={handleSaveEnv}
                  saving={update.isPending}
                />
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="tools">
            <TabsList>
              <TabsTrigger value="tools">Tools</TabsTrigger>
              <TabsTrigger value="resources">Resources</TabsTrigger>
              <TabsTrigger value="prompts">Prompts</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="connect">Connect</TabsTrigger>
            </TabsList>
            <TabsContent value="tools">
              <ToolsCard scope={{ kind: 'server', name }} />
            </TabsContent>
            <TabsContent value="resources">
              <ResourcesCard scope={{ kind: 'server', name }} />
            </TabsContent>
            <TabsContent value="prompts">
              <PromptsCard scope={{ kind: 'server', name }} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityCard scope={{ kind: 'server', name }} />
            </TabsContent>
            <TabsContent value="connect">
              <ConnectCard
                endpoint={endpointUrl}
                label={name}
                description={`Point an MCP client directly at ${name} (tools keep their original names).`}
              />
            </TabsContent>
          </Tabs>

          {editOpen && <AddServerDialog key={name} open server={server} onOpenChange={setEditOpen} />}
        </>
      )}
    </div>
  );
}
