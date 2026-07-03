import { type InstallRequest, serverNameSchema } from '@mcp-router/shared';
import { PlusIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { suggestLocalName } from '@/lib/format';
import { useInstallServer } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

interface EnvRow {
  id: number;
  key: string;
  value: string;
}

let nextRowId = 0;

export function NpmInstallCard({ onInstalled }: { onInstalled?: (name: string) => void }) {
  const install = useInstallServer();
  const [pkg, setPkg] = useState('');
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);

  const effectiveName = name || suggestLocalName(pkg);
  const nameResult = serverNameSchema.safeParse(effectiveName);
  const nameError =
    pkg || name
      ? nameResult.success
        ? undefined
        : (nameResult.error.issues[0]?.message ?? 'Invalid name')
      : undefined;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!pkg.trim() || !nameResult.success) {
      return;
    }
    const env: Record<string, string> = {};
    for (const row of envRows) {
      if (row.key.trim() && row.value) {
        env[row.key.trim()] = row.value;
      }
    }
    const body: InstallRequest = {
      name: nameResult.data,
      source: { type: 'npm', package: pkg.trim(), version: version.trim() || undefined },
      env,
      enabled: true,
    };
    install.mutate(body, {
      onSuccess: (status) => {
        toast.success(`Installed ${status.config.name}`);
        setPkg('');
        setVersion('');
        setName('');
        setEnvRows([]);
        onInstalled?.(status.config.name);
      },
      onError: toastApiError,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Install from npm</CardTitle>
        <CardDescription>Install any npm package that provides an MCP server binary.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="npm-package">Package</Label>
              <Input
                id="npm-package"
                value={pkg}
                placeholder="@modelcontextprotocol/server-everything"
                onChange={(event) => setPkg(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="npm-version">Version</Label>
              <Input
                id="npm-version"
                value={version}
                placeholder="latest"
                onChange={(event) => setVersion(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="npm-name">Local name</Label>
              <Input
                id="npm-name"
                value={name}
                placeholder={suggestLocalName(pkg) || 'my-server'}
                aria-invalid={!!nameError}
                onChange={(event) => setName(event.target.value)}
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
          </div>

          {envRows.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Environment variables</Label>
              {envRows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    value={row.key}
                    placeholder="KEY"
                    aria-label="Variable name"
                    className="w-2/5 font-mono"
                    onChange={(event) =>
                      setEnvRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, key: event.target.value } : r)))
                    }
                  />
                  <Input
                    value={row.value}
                    placeholder="value"
                    aria-label={`Value for ${row.key || 'new variable'}`}
                    className="flex-1 font-mono"
                    onChange={(event) =>
                      setEnvRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, value: event.target.value } : r)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${row.key || 'new variable'}`}
                    onClick={() => setEnvRows((rows) => rows.filter((r) => r.id !== row.id))}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEnvRows((rows) => [...rows, { id: nextRowId++, key: '', value: '' }])}
            >
              <PlusIcon /> Add env var
            </Button>
            <Button type="submit" disabled={!pkg.trim() || !!nameError || install.isPending}>
              {install.isPending ? 'Installing…' : 'Install'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
