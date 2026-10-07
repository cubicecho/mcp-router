import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { CapabilityTabs } from '@/components/domain/capability-tabs';
import { MembersCard } from '@/components/domain/workspace/members-card';
import { WorkspaceDialog } from '@/components/domain/workspace/workspace-dialog';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { SettingRow } from '@/components/setting-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ArrowLeft, Pencil, Trash2 } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import { SCOPE_WORKSPACE } from '@/lib/api';
import { endpointPath, endpointUrl } from '@/lib/endpoint';
import { useDeleteWorkspace, useUpdateWorkspace, useWorkspace } from '@/lib/queries';
import { toastApiError, toastCopyError } from '@/lib/toast';

export const Route = createFileRoute('/workspaces_/$slug')({
  component: WorkspaceDetailPage,
});

function WorkspaceDetailPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const query = useWorkspace(slug);
  const { data: workspace } = query;
  const update = useUpdateWorkspace();
  const remove = useDeleteWorkspace();
  const [editOpen, setEditOpen] = useState(false);

  const scope = { kind: SCOPE_WORKSPACE, slug } as const;
  const endpoint = endpointUrl(endpointPath(scope));

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
    <PageLayout
      iconSlot={
        <ActionButton
          variant="ghost"
          size="icon-sm"
          label="Back to workspaces"
          tooltip={false}
          linkSlot={<Link to="/workspaces" />}
          iconSlot={<ArrowLeft />}
        />
      }
      title={workspace?.name ?? slug}
      description={workspace?.description}
      loading={query.isPending}
      contentSlot={
        <div className="flex flex-col gap-6 py-4 md:py-6">
          <QueryState query={query} what="workspace" count={workspace ? 1 : 0} rows={1} />
          {workspace && (
            <>
              <CardLayout
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
                    <ConfirmButton
                      variant="outline"
                      size="sm"
                      label={`Delete ${workspace.name}`}
                      tooltip={false}
                      disabled={remove.isPending}
                      title={`Delete workspace ${workspace.name}?`}
                      description={`The workspace's endpoint (${workspace.path}) stops responding. The underlying servers and their global configuration are not affected.`}
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
                            label="Status"
                            value={
                              workspace.enabled ? (
                                <Badge variant="outline">Enabled</Badge>
                              ) : (
                                <Badge variant="secondary">Disabled</Badge>
                              )
                            }
                          />
                        </>
                      }
                    />
                    <SettingRow
                      title="Enabled"
                      description="A disabled workspace's endpoint stops responding; its servers are not affected."
                      actionSlot={({ titleId }) => (
                        <Switch
                          checked={workspace.enabled}
                          disabled={update.isPending}
                          aria-labelledby={titleId}
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
                      )}
                    />
                  </>
                }
              />

              <MembersCard workspace={workspace} />

              <CapabilityTabs scope={scope} />

              {editOpen && <WorkspaceDialog key={slug} open workspace={workspace} onOpenChange={setEditOpen} />}
            </>
          )}
        </div>
      }
    />
  );
}
