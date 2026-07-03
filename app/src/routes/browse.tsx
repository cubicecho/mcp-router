import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { NpmInstallCard } from '@/components/domain/browse/npm-install-card';
import { RegistryServerCard } from '@/components/domain/browse/server-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useRegistries, useRegistrySearch } from '@/lib/queries';

export const Route = createFileRoute('/browse')({
  component: BrowsePage,
});

function RegistrySearch({ onInstalled }: { onInstalled: (name: string) => void }) {
  const { data: registries, isPending: registriesPending, error: registriesError } = useRegistries();
  const [selectedRegistry, setSelectedRegistry] = useState<string>();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 300);

  const registry =
    selectedRegistry ?? registries?.find((r) => r.name === 'official')?.name ?? registries?.[0]?.name ?? '';

  const results = useRegistrySearch(registry, search);
  const servers = results.data?.pages.flatMap((page) => page.servers) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Select value={registry || undefined} onValueChange={setSelectedRegistry} disabled={registriesPending}>
          <SelectTrigger className="w-48" aria-label="Registry">
            <SelectValue placeholder={registriesPending ? 'Loading…' : 'Registry'} />
          </SelectTrigger>
          <SelectContent>
            {(registries ?? []).map((r) => (
              <SelectItem key={r.name} value={r.name}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-64 flex-1">
          <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={searchInput}
            placeholder="Search servers…"
            className="pl-8"
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
      </div>

      {registriesError && (
        <p className="text-sm text-destructive">Failed to load registries: {registriesError.message}</p>
      )}

      {results.isPending && registry && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      )}

      {results.error && <p className="text-sm text-destructive">Search failed: {results.error.message}</p>}

      {results.data && servers.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No servers found.</p>
      )}

      {servers.length > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {servers.map((entry) => (
              <RegistryServerCard
                key={entry.server.name}
                registry={registry}
                server={entry.server}
                onInstalled={onInstalled}
              />
            ))}
          </div>
          {results.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" disabled={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>
                {results.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BrowsePage() {
  const navigate = useNavigate();
  const handleInstalled = (name: string) => {
    navigate({ to: '/servers/$name', params: { name } });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Browse</h1>
        <p className="text-sm text-muted-foreground">Install MCP servers from a registry or straight from npm.</p>
      </div>
      <Tabs defaultValue="registry">
        <TabsList>
          <TabsTrigger value="registry">From registry</TabsTrigger>
          <TabsTrigger value="npm">From npm</TabsTrigger>
        </TabsList>
        <TabsContent value="registry" className="pt-4">
          <RegistrySearch onInstalled={handleInstalled} />
        </TabsContent>
        <TabsContent value="npm" className="pt-4">
          <NpmInstallCard onInstalled={handleInstalled} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
