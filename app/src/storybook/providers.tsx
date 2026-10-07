import type { Decorator } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { routeTree } from '@/routeTree.gen';

/**
 * Creates a query client that belongs to one story.
 *
 * @returns A client with no cache from the story before it, and no retries to wait out.
 */
function createStoryQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
}

/**
 * Creates the real app's router, for a story about a page.
 *
 * @param route - The path the app starts at.
 * @returns A router over the generated route tree, with in-memory history.
 */
function createAppRouter(route: string) {
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [route] }) });
}

/**
 * Creates a router whose only page is the story, so links and `useNavigate` work in a component story.
 *
 * @param Story - Rendered at `/`.
 * @returns The router; every other path renders its own pathname, which a story can assert on after a navigation.
 */
function createComponentRouter(Story: () => React.ReactNode) {
  const rootRoute = createRootRoute();
  const storyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Story });
  const elsewhereRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => <p>Navigated to {router.state.location.pathname}</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([storyRoute, elsewhereRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return router;
}

/**
 * Wraps every story in what the app's entry point provides: a fresh query client and a router.
 *
 * @param Story - The story to render.
 * @param context.parameters - The story's parameters; a string `route` picks the page to render.
 * @returns The story inside its providers.
 *
 * @remarks
 * A story with `parameters.route` renders the whole app at that path, token screen and frame included; any other story
 * renders its component with tooltips and toasts around it.
 */
export const withProviders: Decorator = (Story, { parameters }) => {
  const route: unknown = parameters.route;
  const [queryClient] = useState(createStoryQueryClient);
  const [router] = useState(() =>
    typeof route === 'string'
      ? createAppRouter(route)
      : createComponentRouter(() => (
          <TooltipProvider>
            <Story />
            <Toaster toastOptions={{ classNames: { description: 'text-popover-foreground/70!' } }} />
          </TooltipProvider>
        )),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* biome-ignore lint/suspicious/noExplicitAny: the story router is not the registered app router */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>
  );
};
