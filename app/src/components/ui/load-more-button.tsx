import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type LoadMoreButtonProps = {
  /** Whether there is another page: `hasNextPage`. Off, nothing is drawn. */
  hasMore: boolean;
  /**
   * Asks for the next page: `fetchNextPage`, passed as it is. It is called with nothing, so a
   * function whose first parameter is options is not handed the press event as them.
   */
  onLoadMore: () => unknown;
  /** The next page is on its way: `isFetchingNextPage`. The button is disabled and spins. */
  loading?: boolean | undefined;
  /**
   * What the button says.
   *
   * @defaultValue "Load more"
   */
  label?: string | undefined;
  /**
   * What it says while `loading`.
   *
   * @defaultValue "Loading…"
   */
  loadingLabel?: string | undefined;
  /** On the row the button is centred in. */
  className?: string | undefined;
};

/**
 * Load more, under a paged list, while there is more.
 *
 * @param props - Whether there is more, how to ask for it, and whether it is on its way.
 * @returns The centred button, or nothing once every page is in.
 */
export function LoadMoreButton({
  hasMore,
  onLoadMore,
  loading = false,
  label = 'Load more',
  loadingLabel = 'Loading…',
  className,
}: LoadMoreButtonProps) {
  if (hasMore === false) {
    return null;
  }
  return (
    <div data-slot="load-more-button" className={cn('cube-rn-view', 'flex-row justify-center', className)}>
      <Button
        variant="outline"
        loading={loading}
        loadingLabel={loadingLabel}
        onClick={() => {
          onLoadMore();
        }}
        content={label}
      />
    </div>
  );
}
