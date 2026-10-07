import { TRANSPORT_STDIO, type WorkspaceMember, type WorkspaceStatus } from '@mcp-router/shared';
import { toast } from 'sonner';
import { CardLayout } from '@/components/card-layout';
import { ServerStateBadge } from '@/components/domain/server/state-badge';
import { ListItem } from '@/components/list-item';
import { EmptyState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useServers, useUpdateWorkspace } from '@/lib/queries';
import { serverLabel } from '@/lib/server-name';
import { toastApiError } from '@/lib/toast';

/**
 * Names the overrides a member carries, for the hint badges.
 *
 * @param member - The workspace member.
 * @returns Any of "env", "args", "headers" and "url", in that order; an empty override does not count.
 */
function overrideLabels(member: WorkspaceMember): string[] {
  const labels: string[] = [];
  if (member.env && Object.keys(member.env).length > 0) {
    labels.push('env');
  }
  if (member.args && member.args.length > 0) {
    labels.push('args');
  }
  if (member.headers && Object.keys(member.headers).length > 0) {
    labels.push('headers');
  }
  if (member.url) {
    labels.push('url');
  }
  return labels;
}

/**
 * Card listing a workspace's member servers, each with a switch that enables it in the workspace.
 *
 * @param props.workspace - The workspace; a member whose server is no longer installed is flagged.
 * @returns The card.
 */
export function MembersCard({ workspace }: { workspace: WorkspaceStatus }) {
  const { data: servers } = useServers();
  const update = useUpdateWorkspace();

  const memberEntries = Object.entries(workspace.members);

  const toggle = (name: string, member: WorkspaceMember, on: boolean) => {
    // members is a full replacement on update — resend the whole map with this
    // one member's enabled flag flipped, preserving every override.
    const members: Record<string, WorkspaceMember> = {
      ...workspace.members,
      [name]: { ...member, enabled: on },
    };
    update.mutate(
      { slug: workspace.slug, members },
      {
        onSuccess: () => toast.success(`${on ? 'Enabled' : 'Disabled'} ${name} in ${workspace.name}`),
        onError: toastApiError,
      },
    );
  };

  return (
    <CardLayout
      level={2}
      title="Servers"
      description="The servers this workspace exposes. Disable one to drop it from the aggregate without removing its overrides. Edit the workspace to change membership or per-workspace parameters."
      emptySlot={<EmptyState compact title="This workspace has no servers yet. Edit it to add some." />}
      contentSlot={memberEntries.map(([name, member]) => {
        const server = servers?.find((s) => s.config.name === name);
        const enabled = member.enabled ?? true;
        const overrides = overrideLabels(member);
        const isStdio = server?.config.transport.type === TRANSPORT_STDIO;
        return (
          <ListItem
            key={name}
            className="px-0"
            leadingSlot={
              <Switch
                checked={enabled}
                disabled={update.isPending}
                aria-label={`Enable ${name} in workspace`}
                onCheckedChange={(on) => toggle(name, member, on)}
              />
            }
            title={serverLabel(name, server?.config.displayName)}
            description={
              (server?.config.displayName || !server || overrides.length > 0) && (
                <span className="flex flex-wrap items-center gap-1">
                  {server?.config.displayName && <span className="font-mono">{name}</span>}
                  {!server && <span className="text-negative">not installed</span>}
                  {overrides.map((label) => (
                    <Badge key={label} variant="secondary" className="text-[10px]">
                      {label}
                    </Badge>
                  ))}
                </span>
              )
            }
            meta={
              server && (
                <>
                  <Badge variant="outline">{isStdio ? 'stdio' : 'http'}</Badge>
                  <ServerStateBadge state={server.state} lastError={server.lastError} />
                </>
              )
            }
          />
        );
      })}
    />
  );
}
