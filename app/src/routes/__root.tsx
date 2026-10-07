import { useQueryClient } from '@tanstack/react-query';
import { createLink, createRootRoute, Outlet, useLocation } from '@tanstack/react-router';
import { CompassIcon, LayersIcon, ServerIcon } from 'lucide-react';
import { ActionButton } from '@/components/action-button';
import { TokenForm } from '@/components/domain/auth/token-form';
import { AppLayout } from '@/components/layouts/app-layout';
import { BarNavItem, SidebarNavItem } from '@/components/sidebar';
import { Library, Lock, Settings } from '@/components/ui/icons';
import { Toaster } from '@/components/ui/sonner';
import { useThemePreference } from '@/components/ui/theme-preference';
import { TooltipProvider } from '@/components/ui/tooltip';
import { clearToken, requireAuth, setToken, useNeedsAuth } from '@/lib/auth';
import { useRouterStatus } from '@/lib/queries';

/** The root route: the app frame, or the token screen, around every page. */
export const Route = createRootRoute({
  component: RootComponent,
});

const NAV_ITEMS = [
  { to: '/', label: 'Servers', icon: ServerIcon },
  { to: '/browse', label: 'Browse', icon: CompassIcon },
  { to: '/workspaces', label: 'Workspaces', icon: LayersIcon },
  { to: '/registries', label: 'Registries', icon: Library },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

const SidebarLink = createLink(SidebarNavItem);
const BarLink = createLink(BarNavItem);

/**
 * The root of every screen: the token screen while the router wants a token, else the app frame.
 *
 * @returns The screen, with the tooltip provider and the toaster around it.
 */
function RootComponent() {
  // Applies the stored theme on every screen and keeps System in step with the device.
  useThemePreference();
  const needsAuth = useNeedsAuth();
  const queryClient = useQueryClient();

  // Any API call that comes back 401 swaps the app for the token screen; a token brings it back and refetches.
  const unlock = (token: string) => {
    setToken(token);
    queryClient.invalidateQueries();
  };

  return (
    <TooltipProvider>
      {needsAuth ? <TokenForm onUnlock={unlock} /> : <AppFrame />}
      {/* The vendored toaster is fixed to sonner's dark theme, whose near-white description is unreadable on a light popover. */}
      <Toaster toastOptions={{ classNames: { description: 'text-popover-foreground/70!' } }} />
    </TooltipProvider>
  );
}

/**
 * The signed-in app: the layout with its navigation, the running-servers status, the lock button and the page.
 *
 * @returns The frame around the matched route.
 *
 * @remarks
 * The lock button is offered only when the router reports auth as enabled.
 */
function AppFrame() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data } = useRouterStatus();
  const status = data ? `${data.runningCount}/${data.serverCount} servers running` : undefined;
  // Servers owns "/" and the detail pages under /servers; every other place owns the paths under it.
  const isActive = (to: string) =>
    to === '/'
      ? pathname === '/' || pathname.startsWith('/servers/')
      : pathname === to || pathname.startsWith(`${to}/`);

  // Clears the stored bearer token and brings the token screen back, for shared machines.
  const lock = () => {
    clearToken();
    requireAuth();
  };

  return (
    <AppLayout
      sidebarNavSlot={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <SidebarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to)} />
      ))}
      barNavSlot={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <BarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to)} />
      ))}
      status={status}
      actionSlot={
        data?.authEnabled === true && (
          <ActionButton
            variant="ghost"
            size="icon-sm"
            label="Lock (forget the stored token)"
            hint="Lock — forget the stored token"
            onClick={lock}
            iconSlot={<Lock />}
          />
        )
      }
      contentSlot={<Outlet />}
    />
  );
}
