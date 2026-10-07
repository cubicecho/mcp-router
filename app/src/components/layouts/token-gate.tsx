import { useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { FormField } from '@/components/form-field';
import { PasswordInput } from '@/components/password-input';
import { Code } from '@/components/ui/code';
import { KeyRound } from '@/components/ui/icons';
import { setToken, useNeedsAuth } from '@/lib/auth';
import type { SlotNode } from '@/lib/utils';

/**
 * Renders `contentSlot` normally; when any API call has come back 401 it swaps
 * in a token-entry screen. Submitting stores the token in localStorage and
 * refetches everything.
 */
export function TokenGate({ contentSlot }: { contentSlot: SlotNode }) {
  const needsAuth = useNeedsAuth();

  if (!needsAuth) {
    return contentSlot;
  }
  return <TokenForm />;
}

function TokenForm() {
  const queryClient = useQueryClient();
  const form = useAppForm({
    defaultValues: { token: '' },
    onSubmit: ({ value, formApi }) => {
      const token = value.token.trim();
      if (!token) {
        return;
      }
      setToken(token);
      formApi.reset();
      queryClient.invalidateQueries();
    },
  });
  const empty = useStore(form.store, (state) => !state.values.token.trim());

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
          <form.Field name="token">
            {(field) => (
              <FormField
                label="Token"
                controlSlot={
                  <PasswordInput
                    id="token"
                    autoFocus
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Bearer token"
                    showLabel="Show token"
                    hideLabel="Hide token"
                  />
                }
              />
            )}
          </form.Field>
          <form.AppForm>
            <form.SubmitButton disabled={empty} pendingLabel="Unlocking…" content="Unlock" />
          </form.AppForm>
        </form>
      }
    />
  );
}
