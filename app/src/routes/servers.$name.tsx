import { ServerRuntimeState, TRANSPORT_STDIO } from '@mcp-router/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { CapabilityTabs } from '@/components/domain/capability/tabs';
import { AddServerDialog } from '@/components/domain/server/add-server-dialog';
import { EnvEditor } from '@/components/domain/server/env-editor';
import { ServerStateBadge } from '@/components/domain/server/state-badge';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { SettingRow } from '@/components/setting-row';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ArrowLeft, Pencil, Trash2 } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import { SCOPE_SERVER } from '@/lib/api';
import { endpointPath, endpointUrl } from '@/lib/endpoint';
import { formatRelativeTime, formatSource } from '@/lib/format';
import { useDeleteServer, useRestartServer, useServer, useUpdateServer } from '@/lib/queries';
import { serverLabel } from '@/lib/server-name';
import { toastApiError, toastCopyError } from '@/lib/toast';

export const Route = createFileRoute('/servers/$name')({
  component: ServerDetailPage,
});

function ServerDetailPage() {
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const query = useServer(name);
  const { data: server } = query;
  const update = useUpdateServer();
  const restart = useRestartServer();
  const remove = useDeleteServer();
  const [editOpen, setEditOpen] = useState(false);

  const scope = { kind: SCOPE_SERVER, name } as const;
  const endpoint = endpointUrl(endpointPath(scope));

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

  const handleSaveEnv = async (env: Record<string, string>) => {
    try {
      await update.mutateAsync({ name, env });
      toast.success('Environment saved', {
        description: 'Restart the server for changes to take effect.',
        action: { label: 'Restart', onClick: handleRestart },
      });
    } catch (error) {
      toastApiError(error);
    }
  };

  return (
    <PageLayout
      iconSlot={
        <ActionButton
          variant="ghost"
          size="icon-sm"
          label="Back to servers"
          tooltip={false}
          linkSlot={<Link to="/" />}
          iconSlot={<ArrowLeft />}
        />
      }
      title={serverLabel(name, server?.config.displayName)}
      description={server?.config.description}
      loading={query.isPending}
      contentSlot={
        <div className="flex flex-col gap-6 py-4 md:py-6">
          <QueryState query={query} what="server" count={server ? 1 : 0} rows={1} />
          {server && (
            <>
              <CardLayout
                level={2}
                title="Overview"
                actionSlot={
                  <span className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditOpen(true)}
                      iconSlot={<Pencil />}
                      content="Edit"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      loading={restart.isPending}
                      onClick={handleRestart}
                      iconSlot={<RotateCwIcon />}
                      content="Restart"
                    />
                    <ConfirmButton
                      variant="outline"
                      size="sm"
                      label={`Delete ${name}`}
                      tooltip={false}
                      loading={remove.isPending}
                      title={`Delete ${name}?`}
                      description="This stops the server, deletes its config file, and removes its install directory."
                      onConfirm={handleDelete}
                      iconSlot={<Trash2 className="text-negative" />}
                      content="Delete"
                    />
                  </span>
                }
                contentClassName="gap-4"
                contentSlot={
                  <>
                    <DescriptionList
                      contentSlot={
                        <>
                          <PropertyRow
                            label="Endpoint"
                            value={endpoint}
                            valueClassName="break-all font-mono"
                            actionSlot={
                              <CopyButton
                                variant="ghost"
                                value={endpoint}
                                label="Copy endpoint URL"
                                onError={toastCopyError}
                              />
                            }
                          />
                          <PropertyRow
                            label="State"
                            value={<ServerStateBadge state={server.state} lastError={server.lastError} />}
                          />
                          <PropertyRow
                            label="Source"
                            value={formatSource(server.config.source)}
                            valueClassName="break-all"
                          />
                          <PropertyRow
                            label="Transport"
                            value={
                              server.config.transport.type === TRANSPORT_STDIO
                                ? `stdio — ${server.config.transport.command} ${server.config.transport.args.join(' ')}`.trim()
                                : `streamable-http — ${server.config.transport.url}`
                            }
                            valueClassName="break-all"
                          />
                          {server.pid !== undefined && (
                            <PropertyRow label="PID" value={server.pid} valueClassName="tabular-nums" />
                          )}
                          {server.startedAt && (
                            <PropertyRow
                              label="Started"
                              value={formatRelativeTime(server.startedAt)}
                              hint={new Date(server.startedAt).toLocaleString()}
                            />
                          )}
                        </>
                      }
                    />
                    <SettingRow
                      title="Enabled"
                      description="A disabled server is not started and its endpoint stops responding."
                      actionSlot={({ titleId }) => (
                        <Switch
                          checked={server.config.enabled}
                          disabled={update.isPending}
                          aria-labelledby={titleId}
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
                      )}
                    />
                    {server.state === ServerRuntimeState.Error && server.lastError && (
                      <Alert variant="destructive" title="Last error" description={server.lastError} />
                    )}
                  </>
                }
              />

              {server.config.transport.type === TRANSPORT_STDIO && (
                <CardLayout
                  level={2}
                  title="Environment variables"
                  description="Passed to the server process. Secret values are masked; changes take effect after a restart."
                  contentSlot={
                    <EnvEditor
                      key={name}
                      env={server.config.env}
                      envMeta={server.config.envMeta}
                      onSave={handleSaveEnv}
                      loading={update.isPending}
                    />
                  }
                />
              )}

              <CapabilityTabs scope={scope} />

              {editOpen && <AddServerDialog key={name} open server={server} onOpenChange={setEditOpen} />}
            </>
          )}
        </div>
      }
    />
  );
}
