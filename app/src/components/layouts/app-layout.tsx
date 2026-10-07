import { RouteIcon } from 'lucide-react';
import { Sidebar, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { ThemePicker } from '@/components/ui/theme-picker';
import type { SlotNode } from '@/lib/utils';

function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <RouteIcon className="size-5" aria-hidden />
      MCP Router
    </span>
  );
}

interface AppLayoutProps {
  /** The places of the app as sidebar items, shown on wide screens. */
  sidebarNavSlot: SlotNode;
  /** The same places as bar items, shown on narrow screens. */
  barNavSlot: SlotNode;
  /** One line about the app's state, under the navigation. */
  status?: string;
  /** Actions that sit beside the theme picker. */
  actionSlot?: SlotNode;
  contentSlot: SlotNode;
}

/** The app's frame: brand, navigation, status, theme picker and the page. It holds no data and no routing. */
export function AppLayout({ sidebarNavSlot, barNavSlot, status, actionSlot, contentSlot }: AppLayoutProps) {
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
          contentSlot={<SidebarSection as="nav" label="Main" contentSlot={sidebarNavSlot} />}
          footerSlot={
            <div className="flex flex-col gap-2">
              {status && <span className="text-foreground/60 text-xs">{status}</span>}
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <ThemePicker variant="compact" />
                </div>
                {actionSlot}
              </div>
            </div>
          }
        />
      }
      brandSlot={<RouteIcon className="size-5" aria-label="MCP Router" />}
      navSlot={barNavSlot}
      navLabel="Main"
      status={status}
      actionSlot={
        <>
          {actionSlot}
          <div className="w-24">
            <ThemePicker variant="compact" />
          </div>
        </>
      }
      contentSlot={<main className="flex min-h-0 flex-1 flex-col overflow-auto">{contentSlot}</main>}
    />
  );
}
