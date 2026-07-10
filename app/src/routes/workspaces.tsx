import type { WorkspaceStatus } from '@mcp-router/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CheckIcon, CopyIcon, LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDeleteWorkspace, useWorkspaces } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/workspaces')({
  component: WorkspacesPage,
});

/** create → the New button; edit → a specific workspace; null → closed. */
type DialogState = { mode: 'create' } | { mode: 'edit'; workspace: WorkspaceStatus } | null;

function CopyUrlButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };
  return (
    <Button variant="ghost" size="icon-sm" aria-label={`Copy URL for ${path}`} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function WorkspacesPage() {
  const { data, isPending, error } = useWorkspaces();
  const remove = useDeleteWorkspace();
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            Custom aggregates: expose a chosen subset of servers at their own URL, with optional per-workspace parameter
            overrides.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <PlusIcon /> New workspace
        </Button>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load workspaces: {error.message}</p>}

      {data && data.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayersIcon className="size-5" /> No workspaces yet
            </CardTitle>
            <CardDescription>
              Create a workspace to expose a tailored aggregate endpoint for a specific client or workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <PlusIcon /> New workspace
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Servers</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((workspace) => {
              const memberCount = Object.values(workspace.members).filter((m) => m.enabled ?? true).length;
              return (
                <TableRow key={workspace.slug}>
                  <TableCell className="font-medium">
                    <Link to="/workspaces/$slug" params={{ slug: workspace.slug }} className="hover:underline">
                      {workspace.name}
                    </Link>
                    {workspace.description && (
                      <span className="block text-xs font-normal text-muted-foreground">{workspace.description}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                      {workspace.path}
                      <CopyUrlButton path={workspace.path} />
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {memberCount} {memberCount === 1 ? 'server' : 'servers'}
                  </TableCell>
                  <TableCell>
                    {workspace.enabled ? (
                      <Badge variant="outline">Enabled</Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${workspace.name}`}
                      onClick={() => setDialog({ mode: 'edit', workspace })}
                    >
                      <PencilIcon />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${workspace.name}`}>
                          <Trash2Icon className="text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete workspace {workspace.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The workspace's endpoint ({workspace.path}) stops responding. The underlying servers and
                            their global configuration are not affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              remove.mutate(workspace.slug, {
                                onSuccess: () => toast.success(`Deleted workspace ${workspace.name}`),
                                onError: toastApiError,
                              })
                            }
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {dialog && (
        <WorkspaceDialog
          key={dialog.mode === 'edit' ? dialog.workspace.slug : 'new'}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          workspace={dialog.mode === 'edit' ? dialog.workspace : undefined}
        />
      )}
    </div>
  );
}
