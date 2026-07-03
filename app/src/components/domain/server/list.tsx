import type { ServerStatus } from '@mcp-router/shared';
import { Link } from '@tanstack/react-router';
import { Loader2Icon, PlugZapIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
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

function ServerRow({ server }: { server: ServerStatus }) {
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
      <TableCell className="text-muted-foreground">{config.transport.type}</TableCell>
      <TableCell className="max-w-64 truncate text-muted-foreground" title={formatSource(config.source)}>
        {formatSource(config.source)}
      </TableCell>
      <TableCell className="tabular-nums">{server.toolCount ?? '—'}</TableCell>
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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Transport</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Tools</TableHead>
          <TableHead>Enabled</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {servers.map((server) => (
          <ServerRow key={server.config.name} server={server} />
        ))}
      </TableBody>
    </Table>
  );
}
