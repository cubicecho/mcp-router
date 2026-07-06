import { type InstallRequest, type ServerStatus, serverNameSchema } from '@mcp-router/shared';
import { PlusIcon, XIcon } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useInstallServer, useUpdateServer } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

interface KeyValueRow {
  id: number;
  key: string;
  value: string;
}

let nextRowId = 0;
const newRow = (): KeyValueRow => ({ id: nextRowId++, key: '', value: '' });
const recordToRows = (record: Record<string, string>): KeyValueRow[] =>
  Object.entries(record).map(([key, value]) => ({ id: nextRowId++, key, value }));

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) {
      result[row.key.trim()] = row.value;
    }
  }
  return result;
}

/** Parse a pasted JSON config into a single stdio server entry. Accepts:
 *  - a bare `{ command, args, env }` object,
 *  - a named entry `{ "my-server": { command, args } }`,
 *  - a `claude_desktop_config.json` wrapper `{ mcpServers: { "my-server": {...} } }`
 *    (or a `servers` wrapper).
 *  When several servers are present, the first is used and `extraCount` reports
 *  how many were skipped. Trailing commas (a common copy-paste artifact) are tolerated. */
function parseJsonConfig(text: string): {
  name?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  extraCount: number;
} {
  // Tolerate trailing commas before a closing brace/bracket.
  const cleaned = text.replace(/,(\s*[}\]])/g, '$1');
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  // Unwrap a `mcpServers` / `servers` wrapper if present.
  const wrapper = parsed.mcpServers ?? parsed.servers;
  const map = wrapper && typeof wrapper === 'object' ? (wrapper as Record<string, unknown>) : parsed;

  let name: string | undefined;
  let entry: Record<string, unknown>;
  let extraCount = 0;
  if (typeof map.command === 'string') {
    // A bare `{ command, args, env }` config.
    entry = map;
  } else {
    // A name -> config map; use the first entry.
    const keys = Object.keys(map);
    const first = keys[0];
    if (!first) {
      throw new Error('No server entries found');
    }
    name = first;
    extraCount = keys.length - 1;
    const value = map[first];
    if (!value || typeof value !== 'object') {
      throw new Error(`Entry "${first}" is not an object`);
    }
    entry = value as Record<string, unknown>;
  }

  const command = entry.command;
  if (typeof command !== 'string' || !command) {
    throw new Error('Config has no "command" string');
  }
  const args = Array.isArray(entry.args) ? entry.args.map((a) => String(a)) : [];
  const env: Record<string, string> = {};
  if (entry.env && typeof entry.env === 'object') {
    for (const [k, v] of Object.entries(entry.env as Record<string, unknown>)) {
      env[k] = String(v);
    }
  }
  return { name, command, args, env, extraCount };
}

export function AddServerDialog({
  open,
  onOpenChange,
  onSaved,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (name: string) => void;
  /** When provided, the dialog edits this server (prefilled) instead of creating one. */
  server?: ServerStatus;
}) {
  const install = useInstallServer();
  const update = useUpdateServer();
  const isEdit = server !== undefined;
  const transport = server?.config.transport;

  const [mode, setMode] = useState<'stdio' | 'http'>(transport?.type === 'streamable-http' ? 'http' : 'stdio');
  const [name, setName] = useState(server?.config.name ?? '');

  // stdio fields
  const [command, setCommand] = useState(transport?.type === 'stdio' ? transport.command : '');
  const [argsText, setArgsText] = useState(transport?.type === 'stdio' ? transport.args.join('\n') : '');
  const [cwd, setCwd] = useState(transport?.type === 'stdio' ? (transport.cwd ?? '') : '');
  const [envRows, setEnvRows] = useState<KeyValueRow[]>(() => recordToRows(server?.config.env ?? {}));
  const [jsonText, setJsonText] = useState('');

  // http fields
  const [url, setUrl] = useState(transport?.type === 'streamable-http' ? transport.url : '');
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>(() =>
    recordToRows(transport?.type === 'streamable-http' ? transport.headers : {}),
  );

  const nameResult = serverNameSchema.safeParse(name);
  const nameError = name
    ? nameResult.success
      ? undefined
      : (nameResult.error.issues[0]?.message ?? 'Invalid name')
    : undefined;

  const urlError = useMemo(() => {
    if (mode !== 'http' || !url.trim()) {
      return undefined;
    }
    try {
      new URL(url.trim());
      return undefined;
    } catch {
      return 'Enter a valid URL';
    }
  }, [mode, url]);

  const applyJson = () => {
    try {
      const config = parseJsonConfig(jsonText);
      setMode('stdio');
      setCommand(config.command);
      setArgsText(config.args.join('\n'));
      setEnvRows(recordToRows(config.env));
      if (config.name && !name) {
        const suggested = serverNameSchema.safeParse(config.name);
        if (suggested.success) {
          setName(suggested.data);
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

  const pending = install.isPending || update.isPending;
  const canSubmit =
    nameResult.success &&
    !urlError &&
    (mode === 'stdio' ? command.trim().length > 0 : url.trim().length > 0) &&
    !pending;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameResult.success) {
      return;
    }
    const built = buildTransport();
    if (!built) {
      return;
    }

    if (isEdit) {
      // Name is the immutable route/dir key, so it is not part of the update.
      // Only send env in stdio mode; a streamable-http server has no child env.
      update.mutate(
        { name: server.config.name, transport: built, ...(mode === 'stdio' ? { env: rowsToRecord(envRows) } : {}) },
        {
          onSuccess: () => {
            toast.success(`Updated ${server.config.name}`);
            onOpenChange(false);
            onSaved?.(server.config.name);
          },
          onError: toastApiError,
        },
      );
      return;
    }

    const body: InstallRequest = {
      name: nameResult.data,
      source: { type: 'remote' },
      transport: built,
      env: mode === 'stdio' ? rowsToRecord(envRows) : {},
      enabled: true,
    };
    install.mutate(body, {
      onSuccess: (status) => {
        toast.success(`Added ${status.config.name}`);
        onOpenChange(false);
        onSaved?.(status.config.name);
      },
      onError: toastApiError,
    });
  };

  const buildTransport = () => {
    if (mode === 'stdio') {
      if (!command.trim()) {
        return undefined;
      }
      const args = argsText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return { type: 'stdio' as const, command: command.trim(), args, cwd: cwd.trim() || undefined };
    }
    if (!url.trim() || urlError) {
      return undefined;
    }
    return { type: 'streamable-http' as const, url: url.trim(), headers: rowsToRecord(headerRows) };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${server.config.name}` : 'Add a server'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Change how this server is run or proxied. Saving restarts it if the transport or environment changed.'
              : 'Configure an MCP server manually — a local command to run, or an existing HTTP server to route through. Nothing is downloaded from a registry.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!isEdit && (
            <section className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="add-json">Paste a config</Label>
                <Button type="button" variant="outline" size="sm" disabled={!jsonText.trim()} onClick={applyJson}>
                  Apply config
                </Button>
              </div>
              <Textarea
                id="add-json"
                value={jsonText}
                rows={10}
                className="resize-y font-mono text-xs"
                placeholder={
                  '{\n  "mcpServers": {\n    "sequentialthinking": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]\n    }\n  }\n}'
                }
                onChange={(event) => setJsonText(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Paste a full <code className="font-mono">claude_desktop_config.json</code> block (
                <code className="font-mono">mcpServers</code> wrapper), a single named{' '}
                <code className="font-mono">{'{ "name": { command, args } }'}</code> entry, or a bare{' '}
                <code className="font-mono">{'{ command, args, env }'}</code> object. Fills in the fields below; the
                first server is used if several are present.
              </p>
            </section>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="add-name">Local name</Label>
            <Input
              id="add-name"
              value={name}
              placeholder="my-server"
              aria-invalid={!!nameError}
              disabled={isEdit}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? 'The name is fixed once a server exists.' : null} Route segment for this server: /mcp/
              {nameResult.success ? nameResult.data : '…'}
            </p>
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          <Tabs value={mode} onValueChange={(value) => setMode(value as 'stdio' | 'http')}>
            <TabsList className="w-full">
              <TabsTrigger value="stdio" className="flex-1">
                Command (stdio)
              </TabsTrigger>
              <TabsTrigger value="http" className="flex-1">
                HTTP (streamable)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stdio" className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-command">Command</Label>
                <Input
                  id="add-command"
                  value={command}
                  placeholder="npx"
                  className="font-mono"
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="add-args">Arguments (one per line)</Label>
                <Textarea
                  id="add-args"
                  value={argsText}
                  rows={3}
                  className="font-mono text-sm"
                  placeholder={'-y\nsome-mcp-server'}
                  onChange={(event) => setArgsText(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="add-cwd">Working directory (optional)</Label>
                <Input
                  id="add-cwd"
                  value={cwd}
                  placeholder="/absolute/path"
                  className="font-mono"
                  onChange={(event) => setCwd(event.target.value)}
                />
              </div>

              <KeyValueEditor
                legend="Environment variables"
                keyPlaceholder="API_KEY"
                rows={envRows}
                onChange={setEnvRows}
              />
            </TabsContent>

            <TabsContent value="http" className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-url">Server URL</Label>
                <Input
                  id="add-url"
                  value={url}
                  placeholder="http://localhost:8080/mcp"
                  className="font-mono"
                  aria-invalid={!!urlError}
                  onChange={(event) => setUrl(event.target.value)}
                />
                {urlError && <p className="text-xs text-destructive">{urlError}</p>}
                <p className="text-xs text-muted-foreground">
                  Requests to /mcp/{nameResult.success ? nameResult.data : '…'} are proxied to this streamable-HTTP
                  server.
                </p>
              </div>

              <KeyValueEditor
                legend="Headers"
                keyPlaceholder="Authorization"
                rows={headerRows}
                onChange={setHeaderRows}
              />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? (isEdit ? 'Saving…' : 'Adding…') : isEdit ? 'Save changes' : 'Add server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KeyValueEditor({
  legend,
  keyPlaceholder,
  rows,
  onChange,
}: {
  legend: string;
  keyPlaceholder: string;
  rows: KeyValueRow[];
  onChange: (updater: (rows: KeyValueRow[]) => KeyValueRow[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{legend}</Label>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            value={row.key}
            placeholder={keyPlaceholder}
            aria-label={`${legend} name`}
            className="w-2/5 font-mono"
            onChange={(event) =>
              onChange((current) => current.map((r) => (r.id === row.id ? { ...r, key: event.target.value } : r)))
            }
          />
          <Input
            value={row.value}
            placeholder="value"
            aria-label={`Value for ${row.key || 'new entry'}`}
            className="flex-1 font-mono"
            onChange={(event) =>
              onChange((current) => current.map((r) => (r.id === row.id ? { ...r, value: event.target.value } : r)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${row.key || 'new entry'}`}
            onClick={() => onChange((current) => current.filter((r) => r.id !== row.id))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange((current) => [...current, newRow()])}>
          <PlusIcon /> Add {legend === 'Headers' ? 'header' : 'variable'}
        </Button>
      </div>
    </div>
  );
}
