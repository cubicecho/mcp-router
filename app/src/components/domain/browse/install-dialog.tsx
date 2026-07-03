import {
  type InstallRequest,
  type RegistryKeyValueInput,
  type RegistryServer,
  serverNameSchema,
} from '@mcp-router/shared';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { suggestLocalName } from '@/lib/format';
import { useInstallServer } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

interface PackageOption {
  selector: string;
  label: string;
  envVars: RegistryKeyValueInput[];
}

function buildOptions(server: RegistryServer): PackageOption[] {
  const packages = (server.packages ?? []).map((pkg, index) => ({
    selector: String(index),
    label: `${pkg.registryType}: ${pkg.identifier}${pkg.version ? `@${pkg.version}` : ''}`,
    envVars: pkg.environmentVariables ?? [],
  }));
  const remotes = (server.remotes ?? []).map((remote, index) => ({
    selector: `remote:${index}`,
    label: `${remote.type}: ${remote.url}`,
    envVars: [],
  }));
  return [...packages, ...remotes];
}

/** Default: the first npm package, else the first package, else the first remote. */
function defaultSelector(server: RegistryServer): string | undefined {
  const packages = server.packages ?? [];
  const npmIndex = packages.findIndex((pkg) => pkg.registryType === 'npm');
  if (npmIndex >= 0) {
    return String(npmIndex);
  }
  if (packages.length > 0) {
    return '0';
  }
  if ((server.remotes ?? []).length > 0) {
    return 'remote:0';
  }
  return undefined;
}

function defaultEnvValues(envVars: RegistryKeyValueInput[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const envVar of envVars) {
    values[envVar.name] = envVar.value ?? envVar.default ?? '';
  }
  return values;
}

interface InstallDialogProps {
  registry: string;
  server: RegistryServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled?: (name: string) => void;
}

export function InstallDialog({ registry, server, open, onOpenChange, onInstalled }: InstallDialogProps) {
  const install = useInstallServer();
  const options = useMemo(() => buildOptions(server), [server]);

  const [name, setName] = useState(() => suggestLocalName(server.name));
  const [selector, setSelector] = useState(() => defaultSelector(server));
  const selected = options.find((option) => option.selector === selector);
  const [envValues, setEnvValues] = useState<Record<string, string>>(() => defaultEnvValues(selected?.envVars ?? []));

  const nameResult = serverNameSchema.safeParse(name);
  const nameError = nameResult.success ? undefined : (nameResult.error.issues[0]?.message ?? 'Invalid name');

  const handleSelectorChange = (value: string) => {
    setSelector(value);
    const option = options.find((candidate) => candidate.selector === value);
    setEnvValues(defaultEnvValues(option?.envVars ?? []));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameResult.success) {
      return;
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(envValues)) {
      if (value) {
        env[key] = value;
      }
    }
    const body: InstallRequest = {
      name: nameResult.data,
      source: { type: 'registry', registry, serverName: server.name, version: server.version },
      packageSelector: selector,
      env,
      enabled: true,
    };
    install.mutate(body, {
      onSuccess: (status) => {
        toast.success(`Installed ${status.config.name}`);
        onOpenChange(false);
        onInstalled?.(status.config.name);
      },
      onError: toastApiError,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Install {server.title ?? server.name}</DialogTitle>
          <DialogDescription>{server.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="install-name">Local name</Label>
            <Input
              id="install-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={!!nameError}
            />
            <p className="text-xs text-muted-foreground">
              Route segment for this server: /mcp/{nameResult.success ? nameResult.data : '…'}
            </p>
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          {options.length > 1 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="install-package">Package</Label>
              <Select value={selector} onValueChange={handleSelectorChange}>
                <SelectTrigger id="install-package" className="w-full">
                  <SelectValue placeholder="Select a package" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.selector} value={option.selector}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selected && selected.envVars.length > 0 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">Environment variables</legend>
              {selected.envVars.map((envVar) => (
                <div key={envVar.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={`install-env-${envVar.name}`} className="font-mono text-xs">
                    {envVar.name}
                    {envVar.isRequired && (
                      <span className="text-destructive" title="Required">
                        *
                      </span>
                    )}
                  </Label>
                  {envVar.description && <p className="text-xs text-muted-foreground">{envVar.description}</p>}
                  <Input
                    id={`install-env-${envVar.name}`}
                    type={envVar.isSecret ? 'password' : 'text'}
                    value={envValues[envVar.name] ?? ''}
                    placeholder={envVar.placeholder}
                    onChange={(event) => setEnvValues((current) => ({ ...current, [envVar.name]: event.target.value }))}
                  />
                </div>
              ))}
            </fieldset>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!nameError || install.isPending}>
              {install.isPending ? 'Installing…' : 'Install'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
