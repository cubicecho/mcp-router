import { type InstallRequest, serverNameSchema } from '@mcp-router/shared';
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
import { useInstallServer } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

interface KeyValueRow {
  id: number;
  key: string;
  value: string;
}

let nextRowId = 0;
const newRow = (): KeyValueRow => ({ id: nextRowId++, key: '', value: '' });

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) {
      result[row.key.trim()] = row.value;
    }
  }
  return result;
}

/** Parse a pasted JSON config (a bare `{command,args,env}` object or a
 *  `claude_desktop_config.json`-style `{ mcpServers: { name: {...} } }` wrapper). */
function parseJsonConfig(text: string): {
  name?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  let name: string | undefined;
  let entry = parsed;
  const servers = parsed.mcpServers ?? parsed.servers;
  if (servers && typeof servers === 'object') {
    const keys = Object.keys(servers as Record<string, unknown>);
    const first = keys[0];
    if (!first) {
      throw new Error('No servers found under "mcpServers"');
    }
    name = first;
    entry = (servers as Record<string, Record<string, unknown>>)[first] ?? {};
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
  return { name, command, args, env };
}

export function AddServerDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: (name: string) => void;
}) {
  const install = useInstallServer();
  const [mode, setMode] = useState<'stdio' | 'http'>('stdio');
  const [name, setName] = useState('');

  // stdio fields
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [cwd, setCwd] = useState('');
  const [envRows, setEnvRows] = useState<KeyValueRow[]>([]);
  const [jsonText, setJsonText] = useState('');

  // http fields
  const [url, setUrl] = useState('');
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>([]);

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

  const reset = () => {
    setName('');
    setCommand('');
    setArgsText('');
    setCwd('');
    setEnvRows([]);
    setJsonText('');
    setUrl('');
    setHeaderRows([]);
  };

  const applyJson = () => {
    try {
      const config = parseJsonConfig(jsonText);
      setCommand(config.command);
      setArgsText(config.args.join('\n'));
      setEnvRows(Object.entries(config.env).map(([key, value]) => ({ id: nextRowId++, key, value })));
      if (config.name && !name) {
        const suggested = serverNameSchema.safeParse(config.name);
        if (suggested.success) {
          setName(suggested.data);
        }
      }
      toast.success('Config applied to the form below');
    } catch (error) {
      toast.error(`Could not parse config: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    }
  };

  const canSubmit =
    nameResult.success &&
    !urlError &&
    (mode === 'stdio' ? command.trim().length > 0 : url.trim().length > 0) &&
    !install.isPending;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameResult.success) {
      return;
    }
    let body: InstallRequest;
    if (mode === 'stdio') {
      if (!command.trim()) {
        return;
      }
      const args = argsText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      body = {
        name: nameResult.data,
        source: { type: 'remote' },
        transport: { type: 'stdio', command: command.trim(), args, cwd: cwd.trim() || undefined },
        env: rowsToRecord(envRows),
        enabled: true,
      };
    } else {
      if (!url.trim() || urlError) {
        return;
      }
      body = {
        name: nameResult.data,
        source: { type: 'remote' },
        transport: { type: 'streamable-http', url: url.trim(), headers: rowsToRecord(headerRows) },
        env: {},
        enabled: true,
      };
    }
    install.mutate(body, {
      onSuccess: (status) => {
        toast.success(`Added ${status.config.name}`);
        reset();
        onOpenChange(false);
        onAdded?.(status.config.name);
      },
      onError: toastApiError,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a server</DialogTitle>
          <DialogDescription>
            Configure an MCP server manually — a local command to run, or an existing HTTP server to route through.
            Nothing is downloaded from a registry.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-name">Local name</Label>
            <Input
              id="add-name"
              value={name}
              placeholder="my-server"
              aria-invalid={!!nameError}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Route segment for this server: /mcp/{nameResult.success ? nameResult.data : '…'}
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
                <Label htmlFor="add-json">Paste config (optional)</Label>
                <Textarea
                  id="add-json"
                  value={jsonText}
                  rows={3}
                  className="font-mono text-xs"
                  placeholder={'{ "command": "npx", "args": ["-y", "some-mcp-server"], "env": { "API_KEY": "…" } }'}
                  onChange={(event) => setJsonText(event.target.value)}
                />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" disabled={!jsonText.trim()} onClick={applyJson}>
                    Apply config
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Accepts a bare <code className="font-mono">{'{ command, args, env }'}</code> object or a{' '}
                  <code className="font-mono">claude_desktop_config.json</code>{' '}
                  <code className="font-mono">mcpServers</code> entry.
                </p>
              </div>

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
              {install.isPending ? 'Adding…' : 'Add server'}
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
