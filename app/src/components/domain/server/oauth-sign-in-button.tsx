import { oauthResultMessageSchema } from '@mcp-router/shared';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { KeyRound } from '@/components/ui/icons';
import { useInvalidateServers, useStartServerOAuth } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

/** The name the sign-in window is opened under, so a second click reuses it rather than stacking windows. */
const SIGN_IN_WINDOW = 'mcp-router-oauth';
/** Its size: about what a login page is laid out for. */
const SIGN_IN_FEATURES = 'popup,width=520,height=720';
/** How often to look whether the user closed the window without finishing, in ms. */
const CLOSED_POLL_MS = 1000;

type OAuthSignInButtonProps = {
  /** The remote server to sign in to. */
  name: string;
  /** Called once the sign-in window reports success. */
  onSignedIn?: () => void;
} & Pick<ComponentProps<typeof Button>, 'variant' | 'size'>;

/**
 * Signs the router in to a remote server that asks for an OAuth login.
 *
 * @param props.name - The server.
 * @param [props.onSignedIn] - Called once the login reports success.
 * @param [props.variant] - The button's variant; `info` by default.
 * @param [props.size] - The button's size; `sm` by default.
 * @returns The button, and a link to the login page when the browser blocked the window.
 *
 * @remarks
 * The window is opened on the click itself, before the login URL is known: a window opened after an `await` is a
 * popup the browser blocks. It is pointed at the login once the router answers. The login sends it back to the
 * router's callback page, which posts the result here and closes it.
 */
export function OAuthSignInButton({ name, onSignedIn, variant = 'info', size = 'sm' }: OAuthSignInButtonProps) {
  const start = useStartServerOAuth();
  const invalidateServers = useInvalidateServers();
  const popup = useRef<Window | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [blockedUrl, setBlockedUrl] = useState<string>();
  // Refs, so the listener is installed once rather than on every render's fresh callbacks.
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const invalidateRef = useRef(invalidateServers);
  invalidateRef.current = invalidateServers;

  // A window closed without finishing posts nothing: stop waiting, and re-read in case it did finish.
  useEffect(() => {
    if (!waiting) {
      return;
    }
    const timer = window.setInterval(() => {
      if (popup.current?.closed !== false) {
        popup.current = null;
        setWaiting(false);
        invalidateRef.current();
      }
    }, CLOSED_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only the window this button opened, and only the router's own message from it.
      if (popup.current === null || event.source !== popup.current) {
        return;
      }
      const parsed = oauthResultMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.server !== name) {
        return;
      }
      popup.current = null;
      setWaiting(false);
      invalidateRef.current();
      if (parsed.data.ok) {
        toast.success(`Signed in to ${name}`);
        onSignedInRef.current?.();
      } else {
        toast.error(`Signing in to ${name} failed`, { description: parsed.data.error });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [name]);

  const handleClick = () => {
    setBlockedUrl(undefined);
    const opened = window.open('', SIGN_IN_WINDOW, SIGN_IN_FEATURES);
    popup.current = opened;
    start.mutate(
      { name, origin: window.location.origin },
      {
        onSuccess: (result) => {
          if (result.signedIn || !result.authorizationUrl) {
            opened?.close();
            popup.current = null;
            invalidateServers();
            toast.success(`Signed in to ${name}`);
            onSignedInRef.current?.();
            return;
          }
          if (opened && !opened.closed) {
            opened.location.href = result.authorizationUrl;
            setWaiting(true);
          } else {
            setBlockedUrl(result.authorizationUrl);
          }
        },
        onError: (error) => {
          opened?.close();
          popup.current = null;
          toastApiError(error);
        },
      },
    );
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant={variant}
        size={size}
        loading={start.isPending || waiting}
        onClick={handleClick}
        iconSlot={<KeyRound />}
        content={waiting ? 'Waiting for sign-in…' : 'Sign in'}
      />
      {blockedUrl && (
        <a href={blockedUrl} target="_blank" rel="noreferrer" className="text-info text-sm underline">
          Your browser blocked the sign-in window. Open the login page
        </a>
      )}
    </span>
  );
}
