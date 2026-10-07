import { type InstallRequest, serverNameSchema, suggestServerName } from '@mcp-router/shared';
import { useStore } from '@tanstack/react-form';
import { toast } from 'sonner';
import { InputField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { KeyValueRows } from '@/components/domain/key-value/rows';
import { type KeyValueRow, rowsToRecord } from '@/lib/key-value';
import { useInstallServer } from '@/lib/queries';
import { serverNameError } from '@/lib/server-name';
import { toastApiError } from '@/lib/toast';

type Ecosystem = 'npm' | 'pypi';

const COPY: Record<Ecosystem, { title: string; description: string; packagePlaceholder: string }> = {
  npm: {
    title: 'Install from npm',
    description: 'Install any npm package that provides an MCP server binary.',
    packagePlaceholder: '@modelcontextprotocol/server-everything',
  },
  pypi: {
    title: 'Install from PyPI',
    description: 'Run any PyPI package that provides an MCP server, via uvx.',
    packagePlaceholder: 'mcp-server-fetch',
  },
};

/**
 * Picks the name that will be installed.
 *
 * @param name - The typed local name; empty means none was typed.
 * @param pkg - Package identifier a name is suggested from.
 * @returns The typed name, else the suggestion, which is empty when the package has no usable characters.
 */
const effectiveName = (name: string, pkg: string) => name || suggestServerName(pkg);

/**
 * Card with a form that installs a package straight from npm or PyPI.
 *
 * @param props.ecosystem - Which package index to install from; picks the copy and the source type.
 * @param [props.onInstalled] - Called with the installed server's local name.
 * @returns The card.
 */
export function PackageInstallCard({
  ecosystem,
  onInstalled,
}: {
  ecosystem: Ecosystem;
  onInstalled?: (name: string) => void;
}) {
  const copy = COPY[ecosystem];
  const install = useInstallServer();
  const form = useAppForm({
    defaultValues: { pkg: '', version: '', name: '', envRows: [] as KeyValueRow[] },
    onSubmit: async ({ value, formApi }) => {
      const body: InstallRequest = {
        name: serverNameSchema.parse(effectiveName(value.name, value.pkg)),
        source: { type: ecosystem, package: value.pkg.trim(), version: value.version.trim() || undefined },
        env: rowsToRecord(value.envRows, { skipEmptyValues: true }),
        enabled: true,
      };
      try {
        const status = await install.mutateAsync(body);
        toast.success(`Installed ${status.config.name}`);
        formApi.reset();
        onInstalled?.(status.config.name);
      } catch (error) {
        toastApiError(error);
      }
    },
  });

  const pkg = useStore(form.store, (state) => state.values.pkg);
  const name = useStore(form.store, (state) => state.values.name);
  const nameValid = serverNameSchema.safeParse(effectiveName(name, pkg)).success;

  return (
    <CardLayout
      level={2}
      title={copy.title}
      description={copy.description}
      contentSlot={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <InputField form={form} name="pkg" label="Package" placeholder={copy.packagePlaceholder} />
            <InputField form={form} name="version" label="Version" placeholder="latest" />
            <InputField
              form={form}
              name="name"
              label="Local name"
              placeholder={suggestServerName(pkg) || 'my-server'}
              // Only a typed name is checked here; an empty one falls back to the suggestion, and an
              // unusable suggestion keeps Install disabled.
              validators={{
                onChange: ({ value }) => serverNameError(value, { allowEmpty: true }),
              }}
            />
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <form.Field name="envRows">
                {(field) => (
                  <KeyValueRows
                    legend="Environment variables"
                    value={field.state.value}
                    onValueChange={field.handleChange}
                    keyLabel="Variable name"
                    unnamed="new variable"
                    addLabel="Add env var"
                    hideLegendWhenEmpty
                  />
                )}
              </form.Field>
            </div>
            <form.AppForm>
              <form.SubmitButton pendingLabel="Installing…" disabled={!pkg.trim() || !nameValid} content="Install" />
            </form.AppForm>
          </div>
        </form>
      }
    />
  );
}
