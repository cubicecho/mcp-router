import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { CenteredCardLayout } from '@/components/centered-card-layout';
import { PairProviderForm } from '@/components/domain/auth/pair-provider-form';
import { LoadError } from '@/components/load-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { KeyRound } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { failureMessage } from '@/lib/failure-message';
import { safeNextPath } from '@/lib/next-path';
import { useAuthConfig, useSignInOnTrustedNetwork } from '@/lib/queries';

/** What the sign-in page is opened with. */
interface LoginSearch {
  /** Set by the provider sign-in's callback when it failed, whatever its code. */
  error?: string;
  /** Where to go once signed in: a path on this origin. */
  next?: string;
}

/** The `/login` route: the sign-in page. */
export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    next: safeNextPath(search.next),
  }),
  component: LoginPage,
});

/** What a failed provider sign-in says, whatever code the callback sent back. */
const SIGN_IN_FAILED = "Signing in with your provider didn't finish. Try again, or ask whoever runs the provider.";

/**
 * The sign-in page: the provider's button, an automatic sign-in on a trusted network, or pairing a provider.
 *
 * @returns The page, a card on its own.
 */
function LoginPage() {
  const navigate = useNavigate();
  const { error, next } = Route.useSearch();
  const config = useAuthConfig();
  const trusted = useSignInOnTrustedNetwork();
  const isTrusted = config.data?.authConfig.trustedNetwork === true;
  const open = () => navigate({ href: next ?? '/', replace: true });

  // Once: on a trusted network, opening the UI is signing in. Strict mode runs effects twice.
  const hasStarted = useRef(false);
  useEffect(() => {
    if (isTrusted && hasStarted.current === false) {
      hasStarted.current = true;
      trusted.mutate(undefined, { onSuccess: open });
    }
  });

  if (config.isError) {
    return (
      <CenteredCardLayout
        iconSlot={<KeyRound />}
        title="Sign in"
        contentSlot={<LoadError error={config.error} onRetry={() => config.refetch()} what="how to sign in" />}
      />
    );
  }
  const sso = config.data?.authConfig.sso ?? null;
  const canPair = config.data?.ssoSetup.canPair === true;
  const hasNoWay = config.data !== undefined && isTrusted === false && sso === null && canPair === false;

  return (
    <CenteredCardLayout
      iconSlot={<KeyRound />}
      title="Sign in to MCP Router"
      description={
        isTrusted
          ? 'This router is on a trusted network, so opening it signs you in.'
          : sso === null && canPair
            ? 'No sign-in provider is set up yet. Connect one to sign in with it.'
            : undefined
      }
      loading={config.isPending}
      contentClassName="flex flex-col gap-4"
      contentSlot={
        <>
          {error !== undefined && <Alert variant="destructive" description={SIGN_IN_FAILED} />}
          {isTrusted && trusted.isError === false && <Spinner label="Signing in" />}
          {trusted.isError && (
            <Alert
              variant="destructive"
              title="Couldn't sign in"
              description={failureMessage(trusted.error)}
              actionSlot={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => trusted.mutate(undefined, { onSuccess: open })}
                  content="Try again"
                />
              }
            />
          )}
          {isTrusted === false && sso === null && canPair && <PairProviderForm />}
          {hasNoWay && (
            <Alert
              variant="warning"
              title="No way to sign in yet"
              description={
                <>
                  Whoever runs this router needs to set <Code>OIDC_ISSUER</Code>, or <Code>SECURE_LOCAL_NET</Code> on a
                  private network.
                </>
              }
            />
          )}
        </>
      }
      footerActionsSlot={
        sso !== null &&
        isTrusted === false && (
          // A full-page navigation to the server, not a fetch: the provider's pages follow.
          <Button linkSlot={<a href={sso.signInUrl} />} content={`Sign in with ${sso.name}`} />
        )
      }
    />
  );
}
