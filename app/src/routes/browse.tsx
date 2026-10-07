import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PackageInstallCard } from '@/components/domain/browse/package-install-card';
import { RegistryServerCard } from '@/components/domain/browse/server-card';
import { OptionSelect } from '@/components/option-select';
import { CardGrid, EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { QueryError, QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Search } from '@/components/ui/icons';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRegistries, useRegistrySearch } from '@/lib/queries';

/** The `/browse` route. */
export const Route = createFileRoute('/browse')({
  component: BrowsePage,
});

/**
 * Registry picker, search box and paged result cards.
 *
 * @param props.onInstalled - Called with the local name of a server installed from a result.
 * @returns The search panel.
 *
 * @remarks
 * A search runs on submit rather than per keystroke. Until one is picked, the registry is "official", else the first
 * configured.
 */
export function RegistrySearch({ onInstalled }: { onInstalled: (name: string) => void }) {
  const registriesQuery = useRegistries();
  const { data: registries, isPending: registriesPending, error: registriesError } = registriesQuery;
  const [selectedRegistry, setSelectedRegistry] = useState<string>();
  const [searchInput, setSearchInput] = useState('');
  // Only committed on submit (Enter or the Search button) to avoid a registry
  // hit on every keystroke.
  const [search, setSearch] = useState('');

  const registry =
    selectedRegistry ?? registries?.find((r) => r.name === 'official')?.name ?? registries?.[0]?.name ?? '';

  const results = useRegistrySearch(registry, search);
  const servers = results.data?.pages.flatMap((page) => page.servers) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <OptionSelect
          className="w-48"
          aria-label="Registry"
          options={(registries ?? []).map((r) => ({ value: r.name, label: r.name }))}
          value={registry}
          onValueChange={setSelectedRegistry}
          disabled={registriesPending}
          placeholder={registriesPending ? 'Loading…' : 'Registry'}
        />
        <form
          className="flex min-w-64 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <SearchInput
            value={searchInput}
            label="Search servers"
            placeholder="Search servers…"
            wrapperClassName="flex-1"
            onChangeText={setSearchInput}
          />
          <Button type="submit" disabled={!registry} content="Search" />
        </form>
      </div>

      {registriesError && (
        <QueryError error={registriesError} onRetry={() => registriesQuery.refetch()} what="registries" />
      )}

      {registry && (
        <QueryState
          query={results}
          what="search results"
          count={servers.length}
          rows={3}
          emptySlot={
            <EmptyState icon={Search} title="No servers found" description="Try another search term or registry." />
          }
        />
      )}

      {servers.length > 0 && (
        <>
          <CardGrid
            contentSlot={servers.map((entry) => (
              <RegistryServerCard
                key={entry.server.name}
                registry={registry}
                server={entry.server}
                onInstalled={onInstalled}
              />
            ))}
          />
          {results.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              loading={results.isFetchingNextPage}
              loadingLabel="Loading…"
              onClick={() => results.fetchNextPage()}
              content="Load more"
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The Browse page: install from a registry, from npm or from PyPI, then go to the new server's page.
 *
 * @returns The page.
 */
function BrowsePage() {
  const navigate = useNavigate();
  const handleInstalled = (name: string) => {
    navigate({ to: '/servers/$name', params: { name } });
  };

  return (
    <PageLayout
      title="Browse"
      description="Install MCP servers from a registry, or straight from npm or PyPI."
      contentSlot={
        <Tabs defaultValue="registry" className="py-4 md:py-6">
          <TabsList>
            <TabsTrigger value="registry">From registry</TabsTrigger>
            <TabsTrigger value="npm">From npm</TabsTrigger>
            <TabsTrigger value="pypi">From PyPI</TabsTrigger>
          </TabsList>
          <TabsContent value="registry" className="pt-4">
            <RegistrySearch onInstalled={handleInstalled} />
          </TabsContent>
          <TabsContent value="npm" className="pt-4">
            <PackageInstallCard ecosystem="npm" onInstalled={handleInstalled} />
          </TabsContent>
          <TabsContent value="pypi" className="pt-4">
            <PackageInstallCard ecosystem="pypi" onInstalled={handleInstalled} />
          </TabsContent>
        </Tabs>
      }
    />
  );
}
