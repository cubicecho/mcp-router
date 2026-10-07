import {
  type CreateWorkspaceRequest,
  type ServerStatus,
  slugify,
  TRANSPORT_STDIO,
  TRANSPORT_STREAMABLE_HTTP,
  type WorkspaceMember,
  type WorkspaceStatus,
} from '@mcp-router/shared';
import { useStore } from '@tanstack/react-form';
import { type ReactElement, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { InputField, SwitchField, TextareaField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { ConnectCard } from '@/components/domain/connect-card';
import { FormField } from '@/components/form-field';
import { EmptyState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import { SCOPE_WORKSPACE } from '@/lib/api';
import { argsFromLines } from '@/lib/arg-lines';
import { endpointPath, endpointUrl } from '@/lib/endpoint';
import { useCreateWorkspace, useServers, useUpdateWorkspace } from '@/lib/queries';
import { serverLabel } from '@/lib/server-name';
import { toastApiError } from '@/lib/toast';

/**
 * One server's membership while editing: whether it is in the workspace, and its
 * override text, parsed into a WorkspaceMember on submit. Held as a list of these
 * rather than a record keyed by server name — a name may contain dots, which
 * TanStack Form would read as a path into the value.
 */
interface MemberDraft {
  name: string;
  included: boolean;
  env: string;
  args: string;
  headers: string;
  url: string;
}

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

const FORM_ID = 'workspace-form';

const toDrafts = (members: Record<string, WorkspaceMember>): MemberDraft[] =>
  Object.entries(members).map(([name, member]) => ({
    name,
    included: member.enabled ?? true,
    env: recordToLines(member.env),
    args: (member.args ?? []).join('\n'),
    headers: recordToLines(member.headers),
    url: member.url ?? '',
  }));

/** The members to save: every included draft whose server is still installed, with its overrides parsed. */
function buildMembers(drafts: MemberDraft[], servers: ServerStatus[]): Record<string, WorkspaceMember> {
  const result: Record<string, WorkspaceMember> = {};
  for (const server of servers) {
    const draft = drafts.find((candidate) => candidate.name === server.config.name);
    if (draft?.included !== true) {
      continue;
    }
    const member: WorkspaceMember = { enabled: true };
    if (server.config.transport.type === TRANSPORT_STDIO) {
      const env = linesToRecord(draft.env);
      if (Object.keys(env).length > 0) {
        member.env = env;
      }
      const args = argsFromLines(draft.args);
      if (args.length > 0) {
        member.args = args;
      }
    } else {
      const headers = linesToRecord(draft.headers);
      if (Object.keys(headers).length > 0) {
        member.headers = headers;
      }
      // Only persist a URL override when it actually differs from the base URL.
      const url = draft.url.trim();
      if (server.config.transport.type === TRANSPORT_STREAMABLE_HTTP && url && url !== server.config.transport.url) {
        member.url = url;
      }
    }
    result[server.config.name] = member;
  }
  return result;
}

interface WorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing workspace; omitted when creating. */
  workspace?: WorkspaceStatus;
}

export function WorkspaceDialog({ open, onOpenChange, workspace }: WorkspaceDialogProps) {
  const isEdit = workspace !== undefined;
  // Undefined until the installed servers are known. The member list is drawn from them and rebuilt from
  // them on save, so until then there is nothing to choose from and nothing safe to send.
  const { data: loadedServers } = useServers();
  const servers = loadedServers ?? [];
  const create = useCreateWorkspace();
  const update = useUpdateWorkspace();
  const [expanded, setExpanded] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: {
      name: workspace?.name ?? '',
      description: workspace?.description ?? '',
      enabled: workspace?.enabled ?? true,
      // Starts with the workspace's own members; a server joins the list the first time it is switched on.
      members: toDrafts(workspace?.members ?? {}),
    },
    onSubmit: async ({ value }) => {
      const body: CreateWorkspaceRequest = {
        name: value.name.trim(),
        enabled: value.enabled,
        description: value.description.trim() || undefined,
        // Left out while the servers are unknown: the API then keeps the members the workspace already has.
        ...(loadedServers ? { members: buildMembers(value.members, loadedServers) } : {}),
      };
      try {
        if (isEdit) {
          const updated = await update.mutateAsync({ slug: workspace.slug, ...body });
          toast.success(`Saved workspace ${updated.name}`);
        } else {
          const created = await create.mutateAsync(body);
          toast.success(`Created workspace ${created.name}`);
        }
        onOpenChange(false);
      } catch (error) {
        toastApiError(error);
      }
    },
  });
  const values = useStore(form.store, (state) => state.values);

  // Auto-slug: renaming re-derives the URL. In edit mode the URL only moves once
  // the name actually changes, so show the stored slug until then.
  const slug = isEdit && values.name === workspace.name ? workspace.slug : slugify(values.name);
  const slugValid = slug.length > 0;

  const toggleMember = (server: ServerStatus, on: boolean) => {
    const serverName = server.config.name;
    // Seed the URL override for remote members with the base URL so "extending"
    // it (e.g. appending a workspace path) is just editing the tail. Unchanged
    // values are dropped on submit, so this never persists a redundant override.
    const baseUrl = server.config.transport.type === TRANSPORT_STREAMABLE_HTTP ? server.config.transport.url : '';
    const members = form.getFieldValue('members');
    const index = members.findIndex((member) => member.name === serverName);
    if (index === -1) {
      if (on) {
        form.pushFieldValue('members', {
          name: serverName,
          included: true,
          env: '',
          args: '',
          headers: '',
          url: baseUrl,
        });
      }
      return;
    }
    form.setFieldValue(`members[${index}].included`, on);
    if (on && baseUrl && !members[index]?.url) {
      form.setFieldValue(`members[${index}].url`, baseUrl);
    }
    if (!on) {
      setExpanded((current) => (current === serverName ? null : current));
    }
  };

  const endpoint = useMemo(
    () => endpointUrl(endpointPath({ kind: SCOPE_WORKSPACE, slug: workspace?.slug ?? '' })),
    [workspace?.slug],
  );

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? `Edit ${workspace.name}` : 'New workspace'}
      description="A workspace exposes a custom aggregate of the servers you choose at its own URL, with optional per-workspace parameter overrides. Each server runs isolated per workspace, independent of its global enabled state."
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      footerActionsSlot={(close) => (
        <>
          <Button type="button" variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            <form.SubmitButton form={FORM_ID} content={isEdit ? 'Save changes' : 'Create workspace'} />
          </form.AppForm>
        </>
      )}
      contentSlot={
        <form
          id={FORM_ID}
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-5"
        >
          <InputField
            form={form}
            name="name"
            label="Workspace name"
            required
            placeholder="Acme backend"
            descriptionClassName="font-mono"
            description={
              <>
                {slugValid ? `/mcp/w/${slug}` : 'Enter a name to generate the URL'}
                {isEdit && slugValid && slug !== workspace.slug && ' — renaming moves the URL'}
              </>
            }
            validators={{
              onChange: ({ value }) =>
                slugify(value).length > 0 ? undefined : 'Enter a workspace name that produces a valid URL slug',
            }}
          />

          <InputField
            form={form}
            name="description"
            label="Description (optional)"
            placeholder="What this workspace is for"
          />

          <SwitchField
            form={form}
            name="enabled"
            label="Enabled"
            description="When off, the workspace's endpoint returns 404 without deleting it."
          />

          <FormField
            asGroup
            label="Servers"
            description="Choose which servers this workspace exposes. Expand a server to override its parameters for this workspace only."
            controlSlot={
              <div className="divide-y rounded-md border">
                {loadedServers?.length === 0 && (
                  <EmptyState compact title="No servers installed yet." className="p-3" />
                )}
                {servers.map((server) => {
                  const serverName = server.config.name;
                  const index = values.members.findIndex((member) => member.name === serverName);
                  const transport = server.config.transport;
                  return (
                    <MemberRow
                      key={serverName}
                      server={server}
                      included={values.members[index]?.included ?? false}
                      open={expanded === serverName}
                      onToggle={(on) => toggleMember(server, on)}
                      onOpenChange={(open) => setExpanded(open ? serverName : null)}
                      overridesSlot={
                        transport.type === TRANSPORT_STDIO ? (
                          <>
                            <TextareaField
                              form={form}
                              name={`members[${index}].env`}
                              label="Env overrides (KEY=VALUE per line)"
                              labelClassName="font-sans text-xs"
                              description="Merged over the server's env; workspace values win."
                              rows={3}
                              placeholder="API_KEY=workspace-specific-value"
                              className="font-mono"
                              descriptionClassName="font-sans"
                            />
                            <TextareaField
                              form={form}
                              name={`members[${index}].args`}
                              label="Arguments (one per line)"
                              labelClassName="font-sans text-xs"
                              description="Replaces the server's args entirely when set."
                              rows={3}
                              placeholder="leave blank to use the server defaults"
                              className="font-mono"
                              descriptionClassName="font-sans"
                            />
                          </>
                        ) : (
                          <>
                            <InputField
                              form={form}
                              name={`members[${index}].url`}
                              label="URL override"
                              labelClassName="font-sans text-xs"
                              description="Replaces the server's URL for this workspace — e.g. append a path to scope a shared upstream. Leave as the base URL to inherit it."
                              placeholder={
                                transport.type === TRANSPORT_STREAMABLE_HTTP ? transport.url : 'https://example.com/mcp'
                              }
                              className="font-mono"
                              descriptionClassName="font-sans"
                            />
                            <TextareaField
                              form={form}
                              name={`members[${index}].headers`}
                              label="Header overrides (KEY=VALUE per line)"
                              labelClassName="font-sans text-xs"
                              description="Merged over the server's request headers."
                              rows={3}
                              placeholder="Authorization=Bearer workspace-token"
                              className="font-mono"
                              descriptionClassName="font-sans"
                            />
                          </>
                        )
                      }
                    />
                  );
                })}
              </div>
            }
          />

          {isEdit && values.enabled && (
            <ConnectCard
              endpoint={endpoint}
              label={workspace.slug}
              description="Point an MCP client at this workspace's aggregate endpoint."
            />
          )}
        </form>
      }
    />
  );
}

interface MemberRowProps {
  server: ServerStatus;
  included: boolean;
  /** Whether the override fields are showing. */
  open: boolean;
  onToggle: (on: boolean) => void;
  onOpenChange: (open: boolean) => void;
  /** The override fields for this server, drawn while it is included and open. */
  overridesSlot: ReactElement;
}

function MemberRow({ server, included, open, onToggle, onOpenChange, overridesSlot }: MemberRowProps) {
  const isStdio = server.config.transport.type === TRANSPORT_STDIO;
  const name = server.config.name;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <Switch checked={included} onCheckedChange={onToggle} aria-label={`Include ${name}`} />
        <div className="min-w-0 flex-1">
          <span className="font-medium">{serverLabel(name, server.config.displayName)}</span>
          {server.config.displayName && <span className="ml-2 text-xs text-foreground/60">{name}</span>}
        </div>
        <Badge variant="outline">{isStdio ? 'stdio' : 'http'}</Badge>
        {included && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(open === false)}
            iconSlot={open ? <ChevronDown /> : <ChevronRight />}
            content="Overrides"
          />
        )}
      </div>

      {included && open && <div className="flex flex-col gap-3 pl-11">{overridesSlot}</div>}
    </div>
  );
}
