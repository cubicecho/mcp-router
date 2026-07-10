import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon, CheckIcon, CopyIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ConnectCard } from '@/components/domain/connect-card';
import { ActivityCard } from '@/components/domain/server/activity-card';
import { PromptsCard } from '@/components/domain/server/prompts-card';
import { ResourcesCard } from '@/components/domain/server/resources-card';
import { ToolsCard } from '@/components/domain/server/tools-card';
import { MembersCard } from '@/components/domain/workspace/members-card';
import { WorkspaceDialog } from '@/components/domain/workspace/workspace-dialog';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDeleteWorkspace, useUpdateWorkspace, useWorkspace } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/workspaces_/$slug')({
  component: WorkspaceDetailPage,
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

function WorkspaceDetailPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { data: workspace, isPending, error } = useWorkspace(slug);
  const update = useUpdateWorkspace();
  const remove = useDeleteWorkspace();
  const [editOpen, setEditOpen] = useState(false);

  const endpointUrl = `${window.location.origin}/mcp/w/${slug}`;
  const scope = { kind: 'workspace', slug } as const;

  const handleDelete = () => {
    remove.mutate(slug, {
      onSuccess: () => {
        toast.success(`Deleted workspace ${workspace?.name ?? slug}`);
        navigate({ to: '/workspaces' });
      },
      onError: toastApiError,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to workspaces">
          <Link to="/workspaces">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{workspace?.name ?? slug}</h1>
          <p className="text-sm text-muted-foreground">{workspace?.description}</p>
        </div>
      </div>

      {isPending && <Skeleton className="h-64 w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load workspace: {error.message}</p>}

      {workspace && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                Overview
                <span className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <PencilIcon /> Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={remove.isPending}>
                        <Trash2Icon className="text-destructive" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete workspace {workspace.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The workspace's endpoint ({workspace.path}) stops responding. The underlying servers and their
                          global configuration are not affected.
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
              <OverviewRow label="Status">
                {workspace.enabled ? (
                  <Badge variant="outline">Enabled</Badge>
                ) : (
                  <Badge variant="secondary">Disabled</Badge>
                )}
              </OverviewRow>
              <OverviewRow label="Enabled">
                <Switch
                  checked={workspace.enabled}
                  disabled={update.isPending}
                  aria-label={`Enable workspace ${slug}`}
                  onCheckedChange={(enabled) =>
                    update.mutate(
                      { slug, enabled },
                      {
                        onSuccess: () => toast.success(`${enabled ? 'Enabled' : 'Disabled'} ${workspace.name}`),
                        onError: toastApiError,
                      },
                    )
                  }
                />
              </OverviewRow>
            </CardContent>
          </Card>

          <MembersCard workspace={workspace} />

          <Tabs defaultValue="tools">
            <TabsList>
              <TabsTrigger value="tools">Tools</TabsTrigger>
              <TabsTrigger value="resources">Resources</TabsTrigger>
              <TabsTrigger value="prompts">Prompts</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="connect">Connect</TabsTrigger>
            </TabsList>
            <TabsContent value="tools">
              <ToolsCard scope={scope} />
            </TabsContent>
            <TabsContent value="resources">
              <ResourcesCard scope={scope} />
            </TabsContent>
            <TabsContent value="prompts">
              <PromptsCard scope={scope} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityCard scope={scope} />
            </TabsContent>
            <TabsContent value="connect">
              <ConnectCard
                endpoint={endpointUrl}
                label={slug}
                description={`Point an MCP client at this workspace's aggregate endpoint (tools are <server>__-namespaced).`}
              />
            </TabsContent>
          </Tabs>

          {editOpen && <WorkspaceDialog key={slug} open workspace={workspace} onOpenChange={setEditOpen} />}
        </>
      )}
    </div>
  );
}
