import { createLink, createRootRoute, Navigate, Outlet, useLocation } from '@tanstack/react-router';
import { CompassIcon } from 'lucide-react';
import { AppLayout } from '@/components/layouts/app-layout';
import { AppBarItem, SidebarItem } from '@/components/sidebar';
import { Button } from '@/components/ui/button';
import { Layers, Library, LogOut, Server, Settings } from '@/components/ui/icons';
import { Toaster } from '@/components/ui/sonner';
import { useThemePreference } from '@/components/ui/theme-preference';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useRouterStatus, useSignOut } from '@/lib/queries';
import { useHasSession } from '@/lib/session';

/** The root route: the app frame around every signed-in page, or the sign-in pages on their own. */
export const Route = createRootRoute({
  component: RootComponent,
});

/** The pages a signed-out browser may open: sign-in, and where a provider sign-in lands. */
const SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/login', '/auth/sso']);

/**
 * The places of the app. `footer` ones sit at the foot of the sidebar, as cubeui apps put Settings; the
 * narrow-screen bar has no foot, so it shows every place.
 */
const NAV_ITEMS = [
  { to: '/', label: 'Servers', icon: Server, placement: 'main' },
  { to: '/browse', label: 'Browse', icon: CompassIcon, placement: 'main' },
  { to: '/workspaces', label: 'Workspaces', icon: Layers, placement: 'main' },
  { to: '/registries', label: 'Registries', icon: Library, placement: 'main' },
  { to: '/settings', label: 'Settings', icon: Settings, placement: 'footer' },
] as const;

const MAIN_ITEMS = NAV_ITEMS.filter((item) => item.placement === 'main');
const FOOTER_ITEMS = NAV_ITEMS.filter((item) => item.placement === 'footer');

const SidebarLink = createLink(SidebarItem);
const BarLink = createLink(AppBarItem);

/**
 * The root of every screen: a sign-in page on its own, the app frame while signed in, and otherwise a redirect to
 * sign-in that comes back to the page asked for.
 *
 * @returns The screen, with the tooltip provider and the toaster around it.
 *
 * @remarks
 * The session goes when the user signs out or the server answers UNAUTHENTICATED; either sends the browser here.
 */
function RootComponent() {
  // Applies the stored theme on every screen and keeps System in step with the device.
  useThemePreference();
  const location = useLocation();
  const hasSession = useHasSession();
  const isSignInPage = SIGN_IN_PATHS.has(location.pathname);
  const next = location.href === '/' ? undefined : location.href;

  return (
    <TooltipProvider>
      {isSignInPage ? <Outlet /> : hasSession ? <AppFrame /> : <Navigate to="/login" search={{ next }} replace />}
      {/* The vendored toaster is fixed to sonner's dark theme, whose near-white description is unreadable on a light popover. */}
      <Toaster toastOptions={{ classNames: { description: 'text-popover-foreground/70!' } }} />
    </TooltipProvider>
  );
}

/**
 * The signed-in app: the layout with its navigation, the running-servers status, the sign-out button and the page.
 *
 * @returns The frame around the matched route.
 */
function AppFrame() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data } = useRouterStatus();
  const signOut = useSignOut();
  const status = data ? `${data.runningCount}/${data.serverCount} servers running` : undefined;
  // Servers owns "/" and the detail pages under /servers; every other place owns the paths under it.
  const isActive = (to: string) =>
    to === '/'
      ? pathname === '/' || pathname.startsWith('/servers/')
      : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <AppLayout
      sidebarNavSlot={MAIN_ITEMS.map(({ to, label, icon: Icon }) => (
        <SidebarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to)} />
      ))}
      sidebarFooterNavSlot={FOOTER_ITEMS.map(({ to, label, icon: Icon }) => (
        <SidebarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to)} />
      ))}
      barNavSlot={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <BarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to)} />
      ))}
      status={status}
      actionSlot={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Sign out"
          hint="Sign out"
          loading={signOut.isPending}
          onClick={() => signOut.mutate()}
          iconSlot={<LogOut />}
        />
      }
      contentSlot={<Outlet />}
    />
  );
}
