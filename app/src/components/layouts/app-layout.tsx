import { createLink, useLocation } from '@tanstack/react-router';
import { CompassIcon, LayersIcon, RouteIcon, ServerIcon } from 'lucide-react';
import { ActionButton } from '@/components/action-button';
import { BarNavItem, Sidebar, SidebarNavItem, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { Library, Lock, Settings } from '@/components/ui/icons';
import { ThemePicker } from '@/components/ui/theme-picker';
import { clearToken, requireAuth } from '@/lib/auth';
import { useRouterStatus } from '@/lib/queries';
import type { SlotNode } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Servers', icon: ServerIcon },
  { to: '/browse', label: 'Browse', icon: CompassIcon },
  { to: '/workspaces', label: 'Workspaces', icon: LayersIcon },
  { to: '/registries', label: 'Registries', icon: Library },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

const SidebarLink = createLink(SidebarNavItem);
const BarLink = createLink(BarNavItem);

/** Clears the stored bearer token and brings the token gate back — for shared machines. */
function LockButton() {
  const { data } = useRouterStatus();

  if (!data?.authEnabled) {
    return null;
  }

  const lock = () => {
    clearToken();
    requireAuth();
  };

  return (
    <ActionButton
      variant="ghost"
      size="icon-sm"
      label="Lock (forget the stored token)"
      hint="Lock — forget the stored token"
      onClick={lock}
      iconSlot={<Lock />}
    />
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <RouteIcon className="size-5" aria-hidden />
      MCP Router
    </span>
  );
}

export function AppLayout({ contentSlot }: { contentSlot: SlotNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data } = useRouterStatus();
  const status = data ? `${data.runningCount}/${data.serverCount} servers running` : undefined;
  // Servers owns "/" and the detail pages under /servers; every other place owns the paths under it.
  const isActive = (to: string) =>
    to === '/'
      ? pathname === '/' || pathname.startsWith('/servers/')
      : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <SidebarLayout
      sidebarPosition="start"
      sidebarWidth="auto"
      divider="none"
      sidebarHideBelow="md"
      sidebarSlot={
        <Sidebar
          label="Main"
          headerSlot={<Brand />}
          contentSlot={
            <SidebarSection
              as="nav"
              label="Main"
              contentSlot={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <SidebarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to)} />
              ))}
            />
          }
          footerSlot={
            <div className="flex flex-col gap-2">
              {status && <span className="text-foreground/60 text-xs">{status}</span>}
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <ThemePicker variant="compact" />
                </div>
                <LockButton />
              </div>
            </div>
          }
        />
      }
      brandSlot={<RouteIcon className="size-5" aria-label="MCP Router" />}
      navSlot={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <BarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to)} />
      ))}
      navLabel="Main"
      status={status}
      actionSlot={
        <>
          <LockButton />
          <div className="w-24">
            <ThemePicker variant="compact" />
          </div>
        </>
      }
      contentSlot={<main className="flex min-h-0 flex-1 flex-col overflow-auto">{contentSlot}</main>}
    />
  );
}
