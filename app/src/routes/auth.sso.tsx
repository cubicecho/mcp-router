import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { CenteredCardLayout } from '@/components/centered-card-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { KeyRound } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { useVerifyOneTimeToken } from '@/lib/queries';

/** What the provider sign-in's callback opens this page with. */
interface SsoSearch {
  /** The one-time token to spend for a session. */
  token?: string;
}

/** The `/auth/sso` route: where a provider sign-in lands, with a one-time token to spend. */
export const Route = createFileRoute('/auth/sso')({
  validateSearch: (search: Record<string, unknown>): SsoSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: SsoPage,
});

/**
 * Spends the callback's one-time token for a session, then opens the app.
 *
 * @returns A spinner while it does, or what to do when the token could not be spent.
 */
function SsoPage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const verify = useVerifyOneTimeToken();

  // Once: the token works a single time, and strict mode runs effects twice.
  const hasSpent = useRef(false);
  useEffect(() => {
    if (token !== undefined && hasSpent.current === false) {
      hasSpent.current = true;
      verify.mutate(token, { onSuccess: () => navigate({ to: '/', replace: true }) });
    }
  });

  const hasFailed = verify.isError || token === undefined;
  return (
    <CenteredCardLayout
      iconSlot={<KeyRound />}
      title={hasFailed ? "Sign-in didn't finish" : 'Signing in'}
      contentSlot={
        hasFailed ? (
          <Alert
            variant="destructive"
            description="A sign-in has to be finished within a few minutes, and only once. Start it again."
          />
        ) : (
          <Spinner label="Signing in" />
        )
      }
      footerActionsSlot={
        hasFailed && <Button variant="outline" linkSlot={<Link to="/login" />} content="Back to sign-in" />
      }
    />
  );
}
