import type { CreateProjectRequest, ProjectMember, ProjectStatus, ServerStatus } from '@mcp-router/shared';
import { slugify } from '@mcp-router/shared';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConnectCard } from '@/components/domain/connect-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCreateProject, useServers, useUpdateProject } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

/** Per-server override text held while editing; parsed into a ProjectMember on submit. */
interface OverrideText {
  env: string;
  args: string;
  headers: string;
  url: string;
}

const emptyOverride = (): OverrideText => ({ env: '', args: '', headers: '', url: '' });

const recordToLines = (record?: Record<string, string>): string =>
  Object.entries(record ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

const linesToRecord = (text: string): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key) {
      record[key] = trimmed.slice(eq + 1).trim();
    }
  }
  return record;
};

const textToArgs = (text: string): string[] => text.split('\n').filter((line) => line.trim().length > 0);

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing project; omitted when creating. */
  project?: ProjectStatus;
}

export function ProjectDialog({ open, onOpenChange, project }: ProjectDialogProps) {
  const isEdit = project !== undefined;
  const { data: servers } = useServers();
  const create = useCreateProject();
  const update = useUpdateProject();

  const [name, setName] = useState(project?.name ?? '');
  const [enabled, setEnabled] = useState(project?.enabled ?? true);
  const [description, setDescription] = useState(project?.description ?? '');
  const [members, setMembers] = useState<Set<string>>(
    () => new Set(Object.keys(project?.members ?? {}).filter((key) => project?.members[key]?.enabled ?? true)),
  );
  const [overrides, setOverrides] = useState<Record<string, OverrideText>>(() => {
    const initial: Record<string, OverrideText> = {};
    for (const [server, member] of Object.entries(project?.members ?? {})) {
      initial[server] = {
        env: recordToLines(member.env),
        args: (member.args ?? []).join('\n'),
        headers: recordToLines(member.headers),
        url: member.url ?? '',
      };
    }
    return initial;
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  // Auto-slug: renaming re-derives the URL. In edit mode the URL only moves once
  // the name actually changes, so show the stored slug until then.
  const slug = isEdit && name === project.name ? project.slug : slugify(name);
  const slugValid = slug.length > 0;

  const toggleMember = (server: string, on: boolean) => {
    setMembers((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(server);
      } else {
        next.delete(server);
        setExpanded((cur) => (cur === server ? null : cur));
      }
      return next;
    });
    if (on) {
      // Seed the URL override for remote members with the base URL so "extending"
      // it (e.g. appending a project path) is just editing the tail. Unchanged
      // values are dropped on submit, so this never persists a redundant override.
      const config = servers?.find((s) => s.config.name === server)?.config;
      if (config?.transport.type === 'streamable-http') {
        const baseUrl = config.transport.url;
        setOverrides((prev) =>
          prev[server]?.url ? prev : { ...prev, [server]: { ...emptyOverride(), ...prev[server], url: baseUrl } },
        );
      }
    }
  };

  const setOverride = (server: string, patch: Partial<OverrideText>) => {
    setOverrides((prev) => ({ ...prev, [server]: { ...emptyOverride(), ...prev[server], ...patch } }));
  };

  const buildMembers = (): Record<string, ProjectMember> => {
    const result: Record<string, ProjectMember> = {};
    for (const server of servers ?? []) {
      const serverName = server.config.name;
      if (!members.has(serverName)) {
        continue;
      }
      const ov = overrides[serverName] ?? emptyOverride();
      const member: ProjectMember = { enabled: true };
      if (server.config.transport.type === 'stdio') {
        const env = linesToRecord(ov.env);
        if (Object.keys(env).length > 0) {
          member.env = env;
        }
        const args = textToArgs(ov.args);
        if (args.length > 0) {
          member.args = args;
        }
      } else {
        const headers = linesToRecord(ov.headers);
        if (Object.keys(headers).length > 0) {
          member.headers = headers;
        }
        // Only persist a URL override when it actually differs from the base URL.
        const url = ov.url.trim();
        if (server.config.transport.type === 'streamable-http' && url && url !== server.config.transport.url) {
          member.url = url;
        }
      }
      result[serverName] = member;
    }
    return result;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !slugValid) {
      toast.error('Enter a project name that produces a valid URL slug');
      return;
    }
    const body: CreateProjectRequest = {
      name: trimmedName,
      enabled,
      description: description.trim() || undefined,
      members: buildMembers(),
    };
    if (isEdit) {
      update.mutate(
        { slug: project.slug, ...body },
        {
          onSuccess: (updated) => {
            toast.success(`Saved project ${updated.name}`);
            onOpenChange(false);
          },
          onError: toastApiError,
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: (created) => {
          toast.success(`Created project ${created.name}`);
          onOpenChange(false);
        },
        onError: toastApiError,
      });
    }
  };

  const pending = create.isPending || update.isPending;
  const endpoint = useMemo(() => `${window.location.origin}/mcp/p/${project?.slug ?? ''}`, [project?.slug]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${project.name}` : 'New project'}</DialogTitle>
          <DialogDescription>
            A project exposes a custom aggregate of the servers you choose at its own URL, with optional per-project
            parameter overrides. Each server runs isolated per project, independent of its global enabled state.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={name}
              placeholder="Acme backend"
              onChange={(event) => setName(event.target.value)}
            />
            <p className="font-mono text-xs text-muted-foreground">
              {slugValid ? `/mcp/p/${slug}` : 'Enter a name to generate the URL'}
              {isEdit && slugValid && slug !== project.slug && ' — renaming moves the URL'}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-description">Description (optional)</Label>
            <Input
              id="project-description"
              value={description}
              placeholder="What this project is for"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <label className="flex items-center gap-3 text-sm" htmlFor="project-enabled">
            <Switch id="project-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <span>
              Enabled
              <span className="block text-xs text-muted-foreground">
                When off, the project's endpoint returns 404 without deleting it.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <Label>Servers</Label>
            <p className="text-xs text-muted-foreground">
              Choose which servers this project exposes. Expand a server to override its parameters for this project
              only.
            </p>
            <div className="divide-y rounded-md border">
              {(servers ?? []).length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No servers installed yet.</p>
              )}
              {(servers ?? []).map((server) => (
                <MemberRow
                  key={server.config.name}
                  server={server}
                  included={members.has(server.config.name)}
                  expanded={expanded === server.config.name}
                  override={overrides[server.config.name] ?? emptyOverride()}
                  onToggle={(on) => toggleMember(server.config.name, on)}
                  onExpandToggle={() => setExpanded((cur) => (cur === server.config.name ? null : server.config.name))}
                  onOverrideChange={(patch) => setOverride(server.config.name, patch)}
                />
              ))}
            </div>
          </div>

          {isEdit && enabled && (
            <ConnectCard
              endpoint={endpoint}
              label={project.slug}
              description="Point an MCP client at this project's aggregate endpoint."
            />
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !slugValid}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface MemberRowProps {
  server: ServerStatus;
  included: boolean;
  expanded: boolean;
  override: OverrideText;
  onToggle: (on: boolean) => void;
  onExpandToggle: () => void;
  onOverrideChange: (patch: Partial<OverrideText>) => void;
}

function MemberRow({
  server,
  included,
  expanded,
  override,
  onToggle,
  onExpandToggle,
  onOverrideChange,
}: MemberRowProps) {
  const isStdio = server.config.transport.type === 'stdio';
  const name = server.config.name;
  const baseUrl = server.config.transport.type === 'streamable-http' ? server.config.transport.url : undefined;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <Switch checked={included} onCheckedChange={onToggle} aria-label={`Include ${name}`} />
        <div className="min-w-0 flex-1">
          <span className="font-medium">{server.config.displayName || name}</span>
          {server.config.displayName && <span className="ml-2 text-xs text-muted-foreground">{name}</span>}
        </div>
        <Badge variant="outline">{isStdio ? 'stdio' : 'http'}</Badge>
        {included && (
          <Button type="button" variant="ghost" size="sm" onClick={onExpandToggle}>
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            Overrides
          </Button>
        )}
      </div>

      {included && expanded && (
        <div className="flex flex-col gap-3 pl-11">
          {isStdio ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`env-${name}`} className="text-xs">
                  Env overrides (KEY=VALUE per line)
                </Label>
                <Textarea
                  id={`env-${name}`}
                  rows={3}
                  className="resize-y font-mono text-xs"
                  placeholder={'API_KEY=project-specific-value'}
                  value={override.env}
                  onChange={(event) => onOverrideChange({ env: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">Merged over the server's env; project values win.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`args-${name}`} className="text-xs">
                  Arguments (one per line)
                </Label>
                <Textarea
                  id={`args-${name}`}
                  rows={3}
                  className="resize-y font-mono text-xs"
                  placeholder={'leave blank to use the server defaults'}
                  value={override.args}
                  onChange={(event) => onOverrideChange({ args: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">Replaces the server's args entirely when set.</p>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`url-${name}`} className="text-xs">
                  URL override
                </Label>
                <Input
                  id={`url-${name}`}
                  className="font-mono text-xs"
                  placeholder={baseUrl ?? 'https://example.com/mcp'}
                  value={override.url}
                  onChange={(event) => onOverrideChange({ url: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Replaces the server's URL for this project — e.g. append a path to scope a shared upstream. Leave as
                  the base URL to inherit it.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`headers-${name}`} className="text-xs">
                  Header overrides (KEY=VALUE per line)
                </Label>
                <Textarea
                  id={`headers-${name}`}
                  rows={3}
                  className="resize-y font-mono text-xs"
                  placeholder={'Authorization=Bearer project-token'}
                  value={override.headers}
                  onChange={(event) => onOverrideChange({ headers: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">Merged over the server's request headers.</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
