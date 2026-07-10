import type { ProjectMember, ProjectStatus } from '@mcp-router/shared';
import { toast } from 'sonner';
import { ServerStateBadge } from '@/components/domain/server/state-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useServers, useUpdateProject } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

/** Which overrides a member carries, for the "overrides" hint badges. */
function overrideLabels(member: ProjectMember): string[] {
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

export function MembersCard({ project }: { project: ProjectStatus }) {
  const { data: servers } = useServers();
  const update = useUpdateProject();

  const memberEntries = Object.entries(project.members);

  const toggle = (name: string, member: ProjectMember, on: boolean) => {
    // members is a full replacement on update — resend the whole map with this
    // one member's enabled flag flipped, preserving every override.
    const members: Record<string, ProjectMember> = {
      ...project.members,
      [name]: { ...member, enabled: on },
    };
    update.mutate(
      { slug: project.slug, members },
      {
        onSuccess: () => toast.success(`${on ? 'Enabled' : 'Disabled'} ${name} in ${project.name}`),
        onError: toastApiError,
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Servers</CardTitle>
        <CardDescription>
          The servers this project exposes. Disable one to drop it from the aggregate without removing its overrides.
          Edit the project to change membership or per-project parameters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {memberEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">This project has no servers yet. Edit it to add some.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {memberEntries.map(([name, member]) => {
              const server = servers?.find((s) => s.config.name === name);
              const enabled = member.enabled ?? true;
              const overrides = overrideLabels(member);
              const isStdio = server?.config.transport.type === 'stdio';
              return (
                <li key={name} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Switch
                    checked={enabled}
                    disabled={update.isPending}
                    aria-label={`Enable ${name} in project`}
                    onCheckedChange={(on) => toggle(name, member, on)}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{server?.config.displayName || name}</span>
                    {server?.config.displayName && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{name}</span>
                    )}
                    {!server && <span className="ml-2 text-xs text-destructive">not installed</span>}
                    {overrides.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {overrides.map((label) => (
                          <Badge key={label} variant="secondary" className="text-[10px]">
                            {label}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </div>
                  {server && <Badge variant="outline">{isStdio ? 'stdio' : 'http'}</Badge>}
                  {server && <ServerStateBadge state={server.state} lastError={server.lastError} />}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
