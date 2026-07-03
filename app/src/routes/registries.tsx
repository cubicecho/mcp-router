import { createRegistryRequestSchema } from '@mcp-router/shared';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCreateRegistry, useDeleteRegistry, useRegistries } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/registries')({
  component: RegistriesPage,
});

function AddRegistryForm() {
  const create = useCreateRegistry();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({});

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = createRegistryRequestSchema.safeParse({ name: name.trim(), url: url.trim() });
    if (!result.success) {
      const fieldErrors: { name?: string; url?: string } = {};
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'name' && !fieldErrors.name) {
          fieldErrors.name = issue.message;
        }
        if (issue.path[0] === 'url' && !fieldErrors.url) {
          fieldErrors.url = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    create.mutate(result.data, {
      onSuccess: () => {
        toast.success(`Added registry ${result.data.name}`);
        setName('');
        setUrl('');
      },
      onError: toastApiError,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add registry</CardTitle>
        <CardDescription>Any service implementing the MCP registry API (GET /v0/servers).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="registry-name">Name</Label>
            <Input
              id="registry-name"
              value={name}
              placeholder="my-registry"
              aria-invalid={!!errors.name}
              onChange={(event) => setName(event.target.value)}
            />
            {errors.name && <p className="max-w-48 text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="flex min-w-64 flex-1 flex-col gap-2">
            <Label htmlFor="registry-url">URL</Label>
            <Input
              id="registry-url"
              value={url}
              placeholder="https://registry.example.com"
              aria-invalid={!!errors.url}
              onChange={(event) => setUrl(event.target.value)}
            />
            {errors.url && <p className="text-xs text-destructive">{errors.url}</p>}
          </div>
          <Button type="submit" className="mt-[1.375rem]" disabled={create.isPending}>
            <PlusIcon /> {create.isPending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RegistriesPage() {
  const { data, isPending, error } = useRegistries();
  const remove = useDeleteRegistry();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Registries</h1>
        <p className="text-sm text-muted-foreground">Sources to browse and install MCP servers from.</p>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-sm text-destructive">Failed to load registries: {error.message}</p>}

      {data && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No registries configured.
                </TableCell>
              </TableRow>
            )}
            {data.map((registry) => (
              <TableRow key={registry.name}>
                <TableCell className="font-medium">{registry.name}</TableCell>
                <TableCell className="text-muted-foreground">{registry.url}</TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${registry.name}`}>
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete registry {registry.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Installed servers are not affected; you just won't be able to browse this registry anymore.
                          {registry.name === 'official' &&
                            " Note: 'official' is the default registry seeded on first run."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            remove.mutate(registry.name, {
                              onSuccess: () => toast.success(`Deleted registry ${registry.name}`),
                              onError: toastApiError,
                            })
                          }
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AddRegistryForm />
    </div>
  );
}
