import type { ProjectStatus } from '@mcp-router/shared';
import { createFileRoute } from '@tanstack/react-router';
import { CheckIcon, CopyIcon, LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProjectDialog } from '@/components/domain/project/project-dialog';
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
import { useDeleteProject, useProjects } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/projects')({
  component: ProjectsPage,
});

/** create → the New button; edit → a specific project; null → closed. */
type DialogState = { mode: 'create' } | { mode: 'edit'; project: ProjectStatus } | null;

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

function ProjectsPage() {
  const { data, isPending, error } = useProjects();
  const remove = useDeleteProject();
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Custom aggregates: expose a chosen subset of servers at their own URL, with optional per-project parameter
            overrides.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <PlusIcon /> New project
        </Button>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load projects: {error.message}</p>}

      {data && data.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayersIcon className="size-5" /> No projects yet
            </CardTitle>
            <CardDescription>
              Create a project to expose a tailored aggregate endpoint for a specific client or workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <PlusIcon /> New project
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
            {data.map((project) => {
              const memberCount = Object.values(project.members).filter((m) => m.enabled ?? true).length;
              return (
                <TableRow key={project.slug}>
                  <TableCell className="font-medium">
                    {project.name}
                    {project.description && (
                      <span className="block text-xs font-normal text-muted-foreground">{project.description}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                      {project.path}
                      <CopyUrlButton path={project.path} />
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {memberCount} {memberCount === 1 ? 'server' : 'servers'}
                  </TableCell>
                  <TableCell>
                    {project.enabled ? (
                      <Badge variant="outline">Enabled</Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${project.name}`}
                      onClick={() => setDialog({ mode: 'edit', project })}
                    >
                      <PencilIcon />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${project.name}`}>
                          <Trash2Icon className="text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete project {project.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The project's endpoint ({project.path}) stops responding. The underlying servers and their
                            global configuration are not affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              remove.mutate(project.slug, {
                                onSuccess: () => toast.success(`Deleted project ${project.name}`),
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
        <ProjectDialog
          key={dialog.mode === 'edit' ? dialog.project.slug : 'new'}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          project={dialog.mode === 'edit' ? dialog.project : undefined}
        />
      )}
    </div>
  );
}
