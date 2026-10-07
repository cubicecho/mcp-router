import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { GATEWAY_DEFAULTS } from '../core/defaults.ts';

/**
 * Drain a paginated downstream list.
 *
 * @typeParam T - The listed item.
 * @param fetchPage - Fetches the page at a cursor; undefined asks for the first.
 * @returns Every item, in page order. Stops without error after `GATEWAY_DEFAULTS.maxListPages` pages.
 *
 * @remarks
 * A caller can't forward a single client cursor to N servers (the aggregate) or replay it across pages (the
 * per-server UI endpoints), so it must collect every page itself.
 */
async function allPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < GATEWAY_DEFAULTS.maxListPages; page += 1) {
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
 * Drain an MCP SDK list method across all pages.
 *
 * @typeParam Page - One page as the SDK returns it.
 * @typeParam T - The listed item.
 * @param list - The SDK call (listTools/listResources/…); called with no params for the first page.
 * @param pick - Selects the item array from a page.
 * @returns Every item, in page order, up to the page cap.
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

/**
 * Lists every resource a downstream has, across all pages.
 *
 * @param client - The connected downstream client.
 * @returns The resources, up to the page cap.
 *
 * @remarks
 * Tools come from `@cubicecho/agent-mcp-pool`'s `listAllTools`, which also refuses a repeated cursor. The pool has no
 * equivalent for resources, templates and prompts yet; once it does, this file goes.
 */
export const listAllResources = (client: Client) =>
  listAll(
    (params) => client.listResources(params),
    (result) => result.resources,
  );

/**
 * Lists every resource template a downstream has, across all pages.
 *
 * @param client - The connected downstream client.
 * @returns The templates, up to the page cap.
 */
export const listAllResourceTemplates = (client: Client) =>
  listAll(
    (params) => client.listResourceTemplates(params),
    (result) => result.resourceTemplates,
  );

/**
 * Lists every prompt a downstream has, across all pages.
 *
 * @param client - The connected downstream client.
 * @returns The prompts, up to the page cap.
 */
export const listAllPrompts = (client: Client) =>
  listAll(
    (params) => client.listPrompts(params),
    (result) => result.prompts,
  );
