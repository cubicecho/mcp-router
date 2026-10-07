import {
  type InstallRequest,
  type ServerStatus,
  SourceType,
  serverNameSchema,
  TRANSPORT_STDIO,
  TRANSPORT_STREAMABLE_HTTP,
} from '@mcp-router/shared';
import { useStore } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { InputField, TextareaField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { KeyValueRows } from '@/components/domain/key-value/rows';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { argsFromLines } from '@/lib/arg-lines';
import { parseJsonConfig } from '@/lib/json-config';
import { recordToRows, rowsToRecord } from '@/lib/key-value';
import { useInstallServer, useUpdateServer } from '@/lib/queries';
import { serverNameError } from '@/lib/server-name';
import { toastApiError } from '@/lib/toast';

const FORM_ID = 'add-server-form';

type Mode = 'stdio' | 'http';

function urlError(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  try {
    new URL(value.trim());
    return undefined;
  } catch {
    return 'Enter a valid URL';
  }
}

export function AddServerDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this server (prefilled) instead of creating one. */
  server?: ServerStatus;
}) {
  const install = useInstallServer();
  const update = useUpdateServer();
  const isEdit = server !== undefined;
  const transport = server?.config.transport;
  const [jsonText, setJsonText] = useState('');

  const form = useAppForm({
    defaultValues: {
      mode: (transport?.type === TRANSPORT_STREAMABLE_HTTP ? 'http' : 'stdio') as Mode,
      name: server?.config.name ?? '',
      // stdio fields
      command: transport?.type === TRANSPORT_STDIO ? transport.command : '',
      argsText: transport?.type === TRANSPORT_STDIO ? transport.args.join('\n') : '',
      cwd: transport?.type === TRANSPORT_STDIO ? (transport.cwd ?? '') : '',
      envRows: recordToRows(server?.config.env ?? {}),
      // http fields
      url: transport?.type === TRANSPORT_STREAMABLE_HTTP ? transport.url : '',
      headerRows: recordToRows(transport?.type === TRANSPORT_STREAMABLE_HTTP ? transport.headers : {}),
    },
    onSubmit: async ({ value }) => {
      const built =
        value.mode === 'stdio'
          ? {
              type: TRANSPORT_STDIO,
              command: value.command.trim(),
              args: argsFromLines(value.argsText),
              cwd: value.cwd.trim() || undefined,
            }
          : { type: TRANSPORT_STREAMABLE_HTTP, url: value.url.trim(), headers: rowsToRecord(value.headerRows) };
      // A streamable-http server has no child env.
      const env = value.mode === 'stdio' ? rowsToRecord(value.envRows) : {};

      try {
        if (isEdit) {
          // Name is the immutable route/dir key, so it is not part of the update.
          await update.mutateAsync({
            name: server.config.name,
            transport: built,
            ...(value.mode === 'stdio' ? { env } : {}),
          });
          toast.success(`Updated ${server.config.name}`);
          onOpenChange(false);
          return;
        }
        const body: InstallRequest = {
          name: serverNameSchema.parse(value.name),
          source: { type: SourceType.Remote },
          transport: built,
          env,
          enabled: true,
        };
        const status = await install.mutateAsync(body);
        toast.success(`Added ${status.config.name}`);
        onOpenChange(false);
      } catch (error) {
        toastApiError(error);
      }
    },
  });

  const values = useStore(form.store, (state) => state.values);
  const routeName = serverNameSchema.safeParse(values.name).success ? values.name : '…';
  const ready =
    serverNameSchema.safeParse(values.name).success &&
    (values.mode === 'stdio'
      ? values.command.trim().length > 0
      : values.url.trim().length > 0 && !urlError(values.url));

  const setMode = (mode: Mode) => {
    form.setFieldValue('mode', mode);
    // The URL's error only counts on the HTTP tab; re-run it so leaving that tab clears it.
    form.validateField('url', 'change');
  };

  const applyJson = () => {
    try {
      const config = parseJsonConfig(jsonText);
      setMode('stdio');
      form.setFieldValue('command', config.command);
      form.setFieldValue('argsText', config.args.join('\n'));
      form.setFieldValue('envRows', recordToRows(config.env));
      if (config.name && !form.getFieldValue('name')) {
        const suggested = serverNameSchema.safeParse(config.name);
        if (suggested.success) {
          form.setFieldValue('name', suggested.data);
        }
      }
      if (config.extraCount > 0) {
        toast.success(
          `Applied "${config.name}". Ignored ${config.extraCount} other ${
            config.extraCount === 1 ? 'server' : 'servers'
          } in the paste — add ${config.extraCount === 1 ? 'it' : 'them'} one at a time.`,
        );
      } else {
        toast.success('Config applied — fields filled in below');
      }
    } catch (error) {
      toast.error(`Could not parse config: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    }
  };

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      size="md"
      title={isEdit ? `Edit ${server.config.name}` : 'Add a server'}
      description={
        isEdit
          ? 'Change how this server is run or proxied. Saving restarts it if the transport or environment changed.'
          : 'Configure an MCP server manually — a local command to run, or an existing HTTP server to route through. Nothing is downloaded from a registry.'
      }
      footerActionsSlot={(close) => (
        <>
          <Button type="button" variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            <form.SubmitButton
              form={FORM_ID}
              disabled={ready === false}
              pendingLabel={isEdit ? 'Saving…' : 'Adding…'}
              content={isEdit ? 'Save changes' : 'Add server'}
            />
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
          className="flex flex-col gap-4"
        >
          {isEdit === false && (
            <FormField
              className="rounded-lg border border-dashed bg-foreground/10 p-3"
              label="Paste a config"
              actionSlot={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!jsonText.trim()}
                  onClick={applyJson}
                  content="Apply config"
                />
              }
              description={
                <>
                  Paste a full <Code>claude_desktop_config.json</Code> block (<Code>mcpServers</Code> wrapper), a single
                  named <Code>{'{ "name": { command, args } }'}</Code> entry, or a bare{' '}
                  <Code>{'{ command, args, env }'}</Code> object. Fills in the fields below; the first server is used if
                  several are present.
                </>
              }
              controlSlot={
                <Textarea
                  value={jsonText}
                  rows={10}
                  className="resize-y font-mono text-xs"
                  placeholder={
                    '{\n  "mcpServers": {\n    "sequentialthinking": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]\n    }\n  }\n}'
                  }
                  onChange={(event) => setJsonText(event.target.value)}
                />
              }
            />
          )}

          <InputField
            form={form}
            name="name"
            label="Local name"
            placeholder="my-server"
            disabled={isEdit}
            description={`${isEdit ? 'The name is fixed once a server exists. ' : ''}Route segment for this server: /mcp/${routeName}`}
            validators={{ onChange: ({ value }) => serverNameError(value, { allowEmpty: true }) }}
          />

          <Tabs value={values.mode} onValueChange={(value) => setMode(value as Mode)}>
            <TabsList className="w-full">
              <TabsTrigger value="stdio" className="flex-1">
                Command (stdio)
              </TabsTrigger>
              <TabsTrigger value="http" className="flex-1">
                HTTP (streamable)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stdio" className="flex flex-col gap-4 pt-2">
              <InputField form={form} name="command" label="Command" placeholder="npx" />
              <TextareaField
                form={form}
                name="argsText"
                label="Arguments (one per line)"
                rows={3}
                placeholder={'-y\nsome-mcp-server'}
              />
              <InputField form={form} name="cwd" label="Working directory (optional)" placeholder="/absolute/path" />
              <form.Field name="envRows">
                {(field) => (
                  <KeyValueRows
                    legend="Environment variables"
                    keyPlaceholder="API_KEY"
                    keyLabel="Environment variables name"
                    unnamed="new entry"
                    addLabel="Add variable"
                    value={field.state.value}
                    onValueChange={field.handleChange}
                  />
                )}
              </form.Field>
            </TabsContent>

            <TabsContent value="http" className="flex flex-col gap-4 pt-2">
              <InputField
                form={form}
                name="url"
                label="Server URL"
                placeholder="http://localhost:8080/mcp"
                description={`Requests to /mcp/${routeName} are proxied to this streamable-HTTP server.`}
                validators={{
                  onChange: ({ value, fieldApi }) =>
                    fieldApi.form.getFieldValue('mode') === 'http' ? urlError(value) : undefined,
                }}
              />
              <form.Field name="headerRows">
                {(field) => (
                  <KeyValueRows
                    legend="Headers"
                    keyPlaceholder="Authorization"
                    keyLabel="Headers name"
                    unnamed="new entry"
                    addLabel="Add header"
                    value={field.state.value}
                    onValueChange={field.handleChange}
                  />
                )}
              </form.Field>
            </TabsContent>
          </Tabs>
        </form>
      }
    />
  );
}
