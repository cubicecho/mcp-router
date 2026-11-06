import type { DiscoveredServer } from '@mcp-router/shared';
import { toast } from 'sonner';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { PasswordField } from '@/components/password-field';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { useInstallServer } from '@/lib/queries';
import { serverNameError } from '@/lib/server-name';
import { toastApiError } from '@/lib/toast';

const FORM_ID = 'add-found-server-form';

/** The header a bearer token is sent in. */
const AUTHORIZATION_HEADER = 'authorization';

/** What a bearer token is sent after. */
const BEARER_PREFIX = 'Bearer ';

/**
 * The value to send in a header the user filled in.
 *
 * @param header - The header's name.
 * @param typed - What the user typed.
 * @returns The typed value, with `Bearer ` put in front of a bare token for `Authorization`.
 */
function headerValue(header: string, typed: string): string {
  const value = typed.trim();
  const isAuthorization = header.toLowerCase() === AUTHORIZATION_HEADER;
  const hasScheme = /^\S+\s+\S/.test(value);
  return isAuthorization && hasScheme === false ? `${BEARER_PREFIX}${value}` : value;
}

/**
 * The label of a header's field.
 *
 * @param header - The header's name.
 * @returns `Token` for `Authorization`, the header's own name for anything else.
 */
function headerLabel(header: string): string {
  return header.toLowerCase() === AUTHORIZATION_HEADER ? 'Token' : header;
}

/** What the add-found-server dialog is given. */
export interface AddFoundServerDialogProps {
  /** The server to add. */
  server: DiscoveredServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Adds a server found on the local network as a remote server, asking for its name and any token it needs. */
export function AddFoundServerDialog({ server, open, onOpenChange }: AddFoundServerDialogProps) {
  const install = useInstallServer();
  const form = useAppForm({
    defaultValues: {
      name: server.suggestedName,
      // A list, not a record keyed by header name: TanStack Form reads a dot in a key as a path.
      headers: server.requiredHeaders.map(() => ''),
    },
    onSubmit: async ({ value }) => {
      const headers = Object.fromEntries(
        server.requiredHeaders.map((header, index) => [header, headerValue(header, value.headers[index] ?? '')]),
      );
      try {
        const added = await install.mutateAsync({
          name: value.name,
          source: { type: 'remote' },
          transport: { type: 'streamable-http', url: server.url, headers },
          env: {},
          enabled: true,
          discovered: { key: server.key, cardName: server.cardName },
        });
        toast.success(`Added ${added.config.name}`);
        onOpenChange(false);
      } catch (error) {
        toastApiError(error);
      }
    },
  });
  const title = server.title ?? server.cardName;

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${title}`}
      description={
        <>
          Found on your network at <Code>{server.url}</Code>. The router proxies it like any other remote server.
        </>
      }
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      footerActionsSlot={(close) => (
        <>
          <Button type="button" variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            <form.SubmitButton form={FORM_ID} content="Add server" pendingLabel="Adding…" />
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
            required
            description="Its route on this router: /mcp/<name>."
            validators={{ onChange: ({ value }) => serverNameError(value) }}
          />
          {server.requiredHeaders.map((header, index) => (
            <PasswordField
              key={header}
              form={form}
              name={`headers[${index}]`}
              label={headerLabel(header)}
              required
              autoComplete="off"
              description={
                header.toLowerCase() === AUTHORIZATION_HEADER
                  ? 'The token the server asks for. It is sent as Authorization: Bearer <token>.'
                  : `Sent as the ${header} header.`
              }
              validators={{ onChange: ({ value }: { value: string }) => (value.trim() ? undefined : 'Required') }}
            />
          ))}
        </form>
      }
    />
  );
}
