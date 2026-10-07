import { createRegistryRequestSchema } from '@mcp-router/shared';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { InputField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Plus, Trash2 } from '@/components/ui/icons';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCreateRegistry, useDeleteRegistry, useRegistries } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

/** The `/registries` route. */
export const Route = createFileRoute('/registries')({
  component: RegistriesPage,
});

/**
 * Validates one field of the add-registry form against the create-registry schema.
 *
 * @param field - Which schema field to check.
 * @param value - The typed text; checked trimmed.
 * @returns The first issue's message, or undefined when valid.
 */
function registryFieldError(field: 'name' | 'url', value: string): string | undefined {
  const result = createRegistryRequestSchema.shape[field].safeParse(value.trim());
  return result.success ? undefined : result.error.issues[0]?.message;
}

/**
 * Card with the name and URL form that adds a registry.
 *
 * @returns The card.
 */
function AddRegistryForm() {
  const create = useCreateRegistry();
  const form = useAppForm({
    defaultValues: { name: '', url: '' },
    onSubmit: async ({ value, formApi }) => {
      const body = createRegistryRequestSchema.parse({ name: value.name.trim(), url: value.url.trim() });
      try {
        await create.mutateAsync(body);
        toast.success(`Added registry ${body.name}`);
        formApi.reset();
      } catch (error) {
        toastApiError(error);
      }
    },
  });

  return (
    <CardLayout
      level={2}
      title="Add registry"
      description="Any service implementing the MCP registry API (GET /v0/servers)."
      contentSlot={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-wrap items-start gap-4"
        >
          <InputField
            form={form}
            name="name"
            label="Name"
            placeholder="my-registry"
            className="w-48"
            validators={{ onSubmit: ({ value }) => registryFieldError('name', value) }}
          />
          <InputField
            form={form}
            name="url"
            label="URL"
            placeholder="https://registry.example.com"
            className="min-w-64 flex-1"
            validators={{ onSubmit: ({ value }) => registryFieldError('url', value) }}
          />
          <form.AppForm>
            <form.SubmitButton className="mt-[1.375rem]" pendingLabel="Adding…" iconSlot={<Plus />} content="Add" />
          </form.AppForm>
        </form>
      }
    />
  );
}

/**
 * The Registries page: the configured registries, each deletable, and the add form.
 *
 * @returns The page.
 */
function RegistriesPage() {
  const registries = useRegistries();
  const { data } = registries;
  const remove = useDeleteRegistry();

  return (
    <PageLayout
      title="Registries"
      description="Sources to browse and install MCP servers from."
      contentSlot={
        <div className="flex flex-col gap-6 py-4 md:py-6">
          <QueryState query={registries} what="registries" count={data ? 1 : 0} />

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
                    <TableCell colSpan={3} className="text-center text-foreground/60">
                      No registries configured.
                    </TableCell>
                  </TableRow>
                )}
                {data.map((registry) => (
                  <TableRow key={registry.name}>
                    <TableCell className="font-medium">{registry.name}</TableCell>
                    <TableCell className="text-foreground/60">{registry.url}</TableCell>
                    <TableCell className="text-right">
                      <ConfirmButton
                        variant="ghost"
                        size="icon-sm"
                        label={`Delete ${registry.name}`}
                        title={`Delete registry ${registry.name}?`}
                        description={
                          <>
                            Installed servers are not affected; you just won't be able to browse this registry anymore.
                            {registry.name === 'official' &&
                              " Note: 'official' is the default registry seeded on first run."}
                          </>
                        }
                        onConfirm={() =>
                          remove.mutate(registry.name, {
                            onSuccess: () => toast.success(`Deleted registry ${registry.name}`),
                            onError: toastApiError,
                          })
                        }
                        iconSlot={<Trash2 className="text-negative" />}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <AddRegistryForm />
        </div>
      }
    />
  );
}
