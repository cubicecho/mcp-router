import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { PasswordField } from '@/components/password-field';
import { Code } from '@/components/ui/code';
import { KeyRound } from '@/components/ui/icons';

/**
 * The token-entry screen shown when the router asks for its bearer token.
 *
 * @param props.onUnlock - Called with the trimmed token when the form is submitted with one.
 * @returns The screen.
 */
export function TokenForm({ onUnlock }: { onUnlock: (token: string) => void }) {
  const form = useAppForm({
    defaultValues: { token: '' },
    onSubmit: ({ value, formApi }) => {
      const token = value.token.trim();
      if (!token) {
        return;
      }
      formApi.reset();
      onUnlock(token);
    },
  });

  return (
    <CenteredLayout
      iconSlot={<KeyRound />}
      title="Authentication required"
      description={
        <>
          Enter the router token (from <Code>MCP_ROUTER_TOKEN</Code> or <Code>settings.json</Code>).
        </>
      }
      contentSlot={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <PasswordField
            form={form}
            name="token"
            label="Token"
            autoFocus
            placeholder="Bearer token"
            showLabel="Show token"
            hideLabel="Hide token"
          />
          <form.Subscribe selector={(state) => state.values.token.trim().length === 0}>
            {(empty) => (
              <form.AppForm>
                <form.SubmitButton disabled={empty} pendingLabel="Unlocking…" content="Unlock" />
              </form.AppForm>
            )}
          </form.Subscribe>
        </form>
      }
    />
  );
}
