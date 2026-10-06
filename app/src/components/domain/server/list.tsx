import type { ServerStatus } from '@mcp-router/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { PlugZapIcon, RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { ConfirmButton } from '@/components/confirm-button';
import { AddServerDialog } from '@/components/domain/server/add-server-dialog';
import { ServerStateBadge } from '@/components/domain/server/state-badge';
import { EmptyState } from '@/components/page';
import { Pencil, Trash2 } from '@/components/ui/icons';
import { SearchInput } from '@/components/ui/search-input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeTime, formatSource } from '@/lib/format';
import { useDeleteServer, useRestartServer, useTestServerConnection, useUpdateServer } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

function ServerRow({ server, onEdit }: { server: ServerStatus; onEdit: (server: ServerStatus) => void }) {
  const navigate = useNavigate();
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

  // The whole row navigates, except clicks on the row's own controls.
  const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest('button, a, [role="switch"]')) {
      return;
    }
    navigate({ to: '/servers/$name', params: { name: config.name } });
  };

  return (
    <TableRow className="cursor-pointer" onClick={handleRowClick}>
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
      <TableCell className="hidden tabular-nums sm:table-cell">
        {server.toolCount ?? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground">—</span>
            </TooltipTrigger>
            <TooltipContent>Known after the first connection — try Test connection.</TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell className="hidden tabular-nums lg:table-cell">
        {server.callCount ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{server.callCount.toLocaleString()}</span>
            </TooltipTrigger>
            <TooltipContent>
              {server.lastCalledAt ? `Last called ${formatRelativeTime(server.lastCalledAt)}` : 'Since last restart'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="hidden text-muted-foreground xl:table-cell">
        {server.lastCalledAt ? formatRelativeTime(server.lastCalledAt) : '—'}
      </TableCell>
      <TableCell>
        <Switch
          checked={config.enabled}
          disabled={update.isPending}
          aria-label={`Enable ${config.name}`}
          onCheckedChange={(enabled) =>
            update.mutate(
              { name: config.name, enabled },
              {
                onSuccess: () => toast.success(`${enabled ? 'Enabled' : 'Disabled'} ${config.name}`),
                onError: toastApiError,
              },
            )
          }
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <ActionButton
            variant="ghost"
            size="icon-sm"
            label={`Test connection to ${config.name}`}
            hint="Test connection"
            loading={test.isPending}
            onClick={handleTest}
            iconSlot={<PlugZapIcon />}
          />
          <ActionButton
            variant="ghost"
            size="icon-sm"
            label={`Edit ${config.name}`}
            hint="Edit"
            onClick={() => onEdit(server)}
            iconSlot={<Pencil />}
          />
          <ActionButton
            variant="ghost"
            size="icon-sm"
            label={`Restart ${config.name}`}
            hint="Restart"
            disabled={restart.isPending}
            onClick={() =>
              restart.mutate(config.name, {
                onSuccess: () => toast.success(`Restarted ${config.name}`),
                onError: toastApiError,
              })
            }
            iconSlot={<RotateCwIcon />}
          />
          <ConfirmButton
            variant="ghost"
            size="icon-sm"
            label={`Delete ${config.name}`}
            hint="Delete"
            title={`Delete ${config.name}?`}
            description="This stops the server, deletes its config file, and removes its install directory. This cannot be undone."
            onConfirm={() =>
              remove.mutate(config.name, {
                onSuccess: () => toast.success(`Deleted ${config.name}`),
                onError: toastApiError,
              })
            }
            iconSlot={<Trash2 className="text-destructive" />}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ServerList({ servers }: { servers: ServerStatus[] }) {
  const [editing, setEditing] = useState<ServerStatus | null>(null);
  const [filter, setFilter] = useState('');

  const query = filter.trim().toLowerCase();
  const visible = query
    ? servers.filter((server) =>
        [server.config.name, server.config.displayName ?? '', formatSource(server.config.source)].some((value) =>
          value.toLowerCase().includes(query),
        ),
      )
    : servers;

  return (
    <div className="flex flex-col gap-3">
      {servers.length > 5 && (
        <SearchInput
          value={filter}
          label="Filter servers"
          placeholder="Filter servers…"
          wrapperClassName="max-w-xs"
          onChangeText={setFilter}
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="hidden md:table-cell">Transport</TableHead>
            <TableHead className="hidden lg:table-cell">Source</TableHead>
            <TableHead className="hidden sm:table-cell">Tools</TableHead>
            <TableHead className="hidden lg:table-cell">Calls</TableHead>
            <TableHead className="hidden xl:table-cell">Last called</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((server) => (
            <ServerRow key={server.config.name} server={server} onEdit={setEditing} />
          ))}
        </TableBody>
      </Table>

      {query && visible.length === 0 && (
        <EmptyState compact className="justify-center" title={`No servers match “${filter.trim()}”.`} />
      )}

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
    </div>
  );
}
