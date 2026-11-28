import { toast } from 'sonner';
import { SsoSource } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { PairProviderForm } from '@/components/domain/auth/pair-provider-form';
import { LoadError } from '@/components/load-state';
import { PropertyList, PropertyRow } from '@/components/property-list';
import { Code } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import type { SsoSetup } from '@/lib/api';
import { useSsoSetup, useUnpairSso } from '@/lib/queries';
import { toastApiError, toastCopyError } from '@/lib/toast';

/**
 * Says where the provider in use comes from.
 *
 * @param setup - How sign-in is set up.
 * @returns The hint under the provider's row.
 */
function sourceHint(setup: SsoSetup) {
  if (setup.source === SsoSource.Env) {
    return (
      <>
        Set by <Code>OIDC_ISSUER</Code> in the server's environment. Change it there.
      </>
    );
  }
  if (setup.source === SsoSource.Paired) {
    return 'Paired from a setup URL.';
  }
  return setup.canPair
    ? 'None yet. Connect one below with the setup URL your provider gives you.'
    : 'None yet. Only the operator can connect one.';
}

/**
 * The Sign-in card of Settings: which OIDC provider people sign in with, where it comes from, and the redirect URI to
 * register with a provider by hand. Pairs a provider, or disconnects the paired one, where the operator may.
 *
 * @returns The card.
 */
export function SignInCard() {
  const query = useSsoSetup();
  const unpair = useUnpairSso();
  const setup = query.data;
  const canDisconnect = setup?.source === SsoSource.Paired && setup.canPair;
  const canConnect = setup?.source === SsoSource.None && setup.canPair;
  const providerName = setup?.name ?? 'the provider';

  return (
    <CardLayout
      level={2}
      title="Sign-in"
      description="How you sign in to this page. MCP clients and agents use API keys instead."
      loading={query.isPending}
      contentClassName="flex flex-col gap-4"
      contentSlot={
        query.isError ? (
          <LoadError error={query.error} onRetry={() => query.refetch()} what="how sign-in is set up" />
        ) : (
          setup && (
            <>
              <PropertyList
                contentSlot={
                  <>
                    <PropertyRow label="Provider" value={setup.name ?? 'None'} hint={sourceHint(setup)} />
                    {setup.issuer && <PropertyRow label="Issuer" value={setup.issuer} valueClassName="break-all" />}
                    <PropertyRow
                      label="Redirect URI"
                      value={setup.redirectUri}
                      valueClassName="break-all font-mono"
                      hint={
                        <>
                          Register it with your provider when you set <Code>OIDC_ISSUER</Code> by hand. Pairing from a
                          setup URL registers it for you.
                        </>
                      }
                      actionSlot={
                        <CopyButton value={setup.redirectUri} label="Copy redirect URI" onError={toastCopyError} />
                      }
                    />
                  </>
                }
              />
              {canConnect && (
                <PairProviderForm
                  onPaired={(name) => toast.success(name ? `Connected ${name}` : 'Connected the provider')}
                />
              )}
            </>
          )
        )
      }
      footerActionsSlot={
        canDisconnect && (
          <ConfirmButton
            title={`Disconnect ${providerName}?`}
            description={
              <>
                The sign-in page stops offering {providerName}, and the router's client there is deleted. To sign in
                after that, pair a provider again or run the router with <Code>SECURE_LOCAL_NET</Code>.
              </>
            }
            confirmLabel="Disconnect provider"
            loading={unpair.isPending}
            onConfirm={() =>
              unpair.mutate(undefined, {
                onSuccess: () => toast.success(`Disconnected ${providerName}`),
                onError: toastApiError,
              })
            }
            content="Disconnect provider"
          />
        )
      }
    />
  );
}
