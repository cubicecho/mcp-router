import { useQueryClient } from '@tanstack/react-query';
import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { PasswordField } from '@/components/password-field';
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
