import type { ServerStatus } from '@mcp-router/shared';
import { Link } from '@tanstack/react-router';
import { Loader2Icon, PencilIcon, PlugZapIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AddServerDialog } from '@/components/domain/server/add-server-dialog';
import { ServerStateBadge } from '@/components/domain/server/state-badge';
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
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatSource } from '@/lib/format';
import { useDeleteServer, useRestartServer, useTestServerConnection, useUpdateServer } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

function ServerRow({ server, onEdit }: { server: ServerStatus; onEdit: (server: ServerStatus) => void }) {
  const update = useUpdateServer();
  const restart = useRestartServer();
  const remove = useDeleteServer();
  const test = useTestServerConnection();
  const { config } = server;

  const handleTest = () =>
    test.mutate(config.name, {
      onSuccess: (result) => {
        const count = result.tools.length;
        toast.success(`${config.name} connected — ${count} tool${count === 1 ? '' : 's'}`);
      },
      onError: toastApiError,
    });

  return (
    <TableRow>
      <TableCell>
        <Link to="/servers/$name" params={{ name: config.name }} className="font-medium hover:underline">
          {config.displayName ?? config.name}
        </Link>
      </TableCell>
      <TableCell>
        <ServerStateBadge state={server.state} lastError={server.lastError} />
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">{config.transport.type}</TableCell>
      <TableCell
        className="hidden max-w-64 truncate text-muted-foreground lg:table-cell"
        title={formatSource(config.source)}
      >
        {formatSource(config.source)}
      </TableCell>
      <TableCell className="hidden tabular-nums sm:table-cell">{server.toolCount ?? '—'}</TableCell>
      <TableCell>
        <Switch
          checked={config.enabled}
          disabled={update.isPending}
          aria-label={`Enable ${config.name}`}
          onCheckedChange={(enabled) => update.mutate({ name: config.name, enabled }, { onError: toastApiError })}
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Test connection to ${config.name}`}
                disabled={test.isPending}
                onClick={handleTest}
              >
                {test.isPending ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Test connection</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${config.name}`} onClick={() => onEdit(server)}>
                <PencilIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Restart ${config.name}`}
                disabled={restart.isPending}
                onClick={() =>
                  restart.mutate(config.name, {
                    onSuccess: () => toast.success(`Restarted ${config.name}`),
                    onError: toastApiError,
                  })
                }
              >
                <RotateCwIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Restart</TooltipContent>
          </Tooltip>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${config.name}`}>
                <Trash2Icon className="text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {config.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This stops the server, deletes its config file, and removes its install directory. This cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    remove.mutate(config.name, {
                      onSuccess: () => toast.success(`Deleted ${config.name}`),
                      onError: toastApiError,
                    })
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ServerList({ servers }: { servers: ServerStatus[] }) {
  const [editing, setEditing] = useState<ServerStatus | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="hidden md:table-cell">Transport</TableHead>
            <TableHead className="hidden lg:table-cell">Source</TableHead>
            <TableHead className="hidden sm:table-cell">Tools</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {servers.map((server) => (
            <ServerRow key={server.config.name} server={server} onEdit={setEditing} />
          ))}
        </TableBody>
      </Table>

      {editing && (
        <AddServerDialog
          key={editing.config.name}
          open
          server={editing}
          onOpenChange={(next) => {
            if (!next) {
              setEditing(null);
            }
          }}
        />
      )}
    </>
  );
}
