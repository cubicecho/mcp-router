import { InputField, useAppForm } from '@/components/app-form';
import { Alert } from '@/components/ui/alert';
import { failureMessage } from '@/lib/failure-message';
import { usePairSso } from '@/lib/queries';

/**
 * Pastes an OIDC provider's setup URL, so the router registers itself there and offers that provider's sign-in.
 *
 * @param [props.onPaired] - Called once the provider is paired, with its name when the setup URL gave one.
 * @returns The form. A refusal is said under it, and what was typed is kept.
 *
 * @remarks
 * Offer it only where `ssoSetup.canPair` is true and no provider is set: the server refuses anyone else.
 */
export function PairProviderForm({ onPaired }: { onPaired?: (name: string | null) => void }) {
  const pair = usePairSso();
  const form = useAppForm({
    defaultValues: { setupUrl: '' },
    onSubmit: async ({ value }) => {
      try {
        const setup = await pair.mutateAsync(value.setupUrl.trim());
        onPaired?.(setup.name);
      } catch {
        // Said under the field, from the mutation's error.
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <InputField
        form={form}
        name="setupUrl"
        label="Setup URL"
        inputMode="url"
        autoComplete="off"
        required
        description="From your OIDC provider. The router registers itself there, and its sign-in button appears."
        validators={{ onChange: ({ value }) => (value.trim() === '' ? 'Paste the setup URL.' : undefined) }}
      />
      {pair.isError && (
        <Alert
          variant="destructive"
          title="Couldn't connect the provider"
          description={`${failureMessage(pair.error)} Check the setup URL, or ask your provider for a new one.`}
        />
      )}
      <form.AppForm>
        <form.SubmitButton createLabel="Connect provider" loadingLabel="Connecting…" />
      </form.AppForm>
    </form>
  );
}
