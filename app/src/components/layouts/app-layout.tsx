import { Link } from '@tanstack/react-router';
import { CompassIcon, LibraryIcon, RouteIcon, ServerIcon, SettingsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouterStatus } from '@/lib/queries';

const NAV_ITEMS = [
  { to: '/', label: 'Servers', icon: ServerIcon },
  { to: '/browse', label: 'Browse', icon: CompassIcon },
  { to: '/registries', label: 'Registries', icon: LibraryIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

function HeaderStatus() {
  const { data, isPending } = useRouterStatus();

  if (isPending) {
    return <Skeleton className="h-4 w-24" />;
  }
  if (!data) {
    return null;
  }
  return (
    <span className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{data.runningCount}</span>/{data.serverCount} servers running
    </span>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 px-4 py-4 font-semibold">
          <RouteIcon className="size-5" />
          MCP Router
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === '/' }}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{
                className:
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-sidebar-accent text-sidebar-accent-foreground font-medium',
              }}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b px-6">
          <HeaderStatus />
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
