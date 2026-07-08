/** Defensive cap for draining paginated lists, against a downstream that never stops returning cursors. */
const MAX_LIST_PAGES = 100;

/**
 * Drain a paginated downstream list. A caller can't forward a single client
 * cursor to N servers (the aggregate) or replay it across pages (the per-server
 * UI endpoints), so it must collect every page itself — returning only page 1
 * (and its count) would silently hide tools/resources/prompts of any downstream
 * that paginates.
 */
export async function allPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) {
      break;
    }
  }
  return items;
}

/**
 * Drain an MCP SDK list method across all pages. `list` is the SDK call
 * (listTools/listResources/…) and `pick` selects the item array from a page,
 * folding the `cursor === undefined ? undefined : { cursor }` wrapping that
 * every list endpoint would otherwise repeat.
 */
export function listAll<Page extends { nextCursor?: string }, T>(
  list: (params?: { cursor: string }) => Promise<Page>,
  pick: (page: Page) => T[],
): Promise<T[]> {
  return allPages(async (cursor) => {
    const page = await list(cursor === undefined ? undefined : { cursor });
    return { items: pick(page), nextCursor: page.nextCursor };
  });
}
