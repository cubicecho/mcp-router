import {
  type InstallRequest,
  type RegistryServer,
  SourceType,
  serverNameSchema,
  suggestServerName,
} from '@mcp-router/shared';
import { useStore } from '@tanstack/react-form';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { KeyValueRows } from '@/components/domain/key-value/rows';
import { FormField } from '@/components/form-field';
import { OptionSelect } from '@/components/option-select';
import { Button } from '@/components/ui/button';
import { type KeyValueRow, rowsToRecord } from '@/lib/key-value';
import { useInstallServer } from '@/lib/queries';
import { buildOptions, defaultEnvValues, defaultSelector } from '@/lib/registry-options';
import { serverNameError } from '@/lib/server-name';
import { toastApiError } from '@/lib/toast';

const FORM_ID = 'install-server-form';

interface InstallDialogProps {
  registry: string;
  server: RegistryServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled?: (name: string) => void;
}

/**
 * Dialog that installs one registry entry under a local name.
 *
 * @param props.registry - Name of the registry the entry was found in.
 * @param props.server - The registry entry; its packages and remotes become the package choices.
 * @param props.open - Whether the dialog is shown.
 * @param props.onOpenChange - Called with false on cancel and after a successful install.
 * @param [props.onInstalled] - Called with the installed server's local name.
 * @returns The dialog.
 *
 * @remarks
 * A filled declared env var and every additional row with a value are sent; an additional row wins over a declared
 * variable of the same name.
 */
export function InstallDialog({ registry, server, open, onOpenChange, onInstalled }: InstallDialogProps) {
  const install = useInstallServer();
  const options = useMemo(() => buildOptions(server), [server]);
  const initialSelector = defaultSelector(server);

  const form = useAppForm({
    defaultValues: {
      name: suggestServerName(server.name),
      selector: initialSelector,
      envValues: defaultEnvValues(options.find((option) => option.selector === initialSelector)?.envVars ?? []),
      customRows: [] as KeyValueRow[],
    },
    onSubmit: async ({ value }) => {
      const envVars = options.find((option) => option.selector === value.selector)?.envVars ?? [];
      const env: Record<string, string> = {};
      envVars.forEach((envVar, index) => {
        const envValue = value.envValues[index];
        if (envValue) {
          env[envVar.name] = envValue;
        }
      });
      Object.assign(env, rowsToRecord(value.customRows, { skipEmptyValues: true }));
      const body: InstallRequest = {
        name: serverNameSchema.parse(value.name),
        source: { type: SourceType.Registry, registry, serverName: server.name, version: server.version },
        packageSelector: value.selector || undefined,
        env,
        enabled: true,
      };
      try {
        const status = await install.mutateAsync(body);
        toast.success(`Installed ${status.config.name}`);
        onOpenChange(false);
        onInstalled?.(status.config.name);
      } catch (error) {
        toastApiError(error);
      }
    },
  });

  const name = useStore(form.store, (state) => state.values.name);
  const selector = useStore(form.store, (state) => state.values.selector);
  const selected = options.find((option) => option.selector === selector);

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      size="md"
      title={`Install ${server.title ?? server.name}`}
      description={server.description}
      footerActionsSlot={(close) => (
        <>
          <Button type="button" variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            <form.SubmitButton form={FORM_ID} pendingLabel="Installing…" content="Install" />
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
          <InputField
            form={form}
            name="name"
            label="Local name"
            description={`Route segment for this server: /mcp/${serverNameError(name) ? '…' : name}`}
            validators={{ onChange: ({ value }) => serverNameError(value) }}
          />

          {options.length > 1 && (
            <FormField
              label="Package"
              controlSlot={
                <OptionSelect
                  options={options.map((option) => ({ value: option.selector, label: option.label }))}
                  value={selector}
                  placeholder="Select a package"
                  onValueChange={(value) => {
                    form.setFieldValue('selector', value);
                    const option = options.find((candidate) => candidate.selector === value);
                    form.setFieldValue('envValues', defaultEnvValues(option?.envVars ?? []));
                  }}
                />
              }
            />
          )}

          {selected && selected.envVars.length > 0 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-sm font-medium">Environment variables</legend>
              {selected.envVars.map((envVar, index) => (
                <InputField
                  key={`${selector}:${envVar.name}`}
                  form={form}
                  name={`envValues[${index}]`}
                  label={envVar.name}
                  labelClassName="font-mono text-xs"
                  required={envVar.isRequired}
                  description={envVar.description}
                  type={envVar.isSecret ? 'password' : 'text'}
                  placeholder={envVar.placeholder}
                />
              ))}
            </fieldset>
          )}

          <form.Field name="customRows">
            {(field) => (
              <KeyValueRows
                legend="Additional environment variables"
                value={field.state.value}
                onValueChange={field.handleChange}
                keyLabel="Variable name"
                unnamed="new variable"
                addLabel="Add env var"
              />
            )}
          </form.Field>
        </form>
      }
    />
  );
}
