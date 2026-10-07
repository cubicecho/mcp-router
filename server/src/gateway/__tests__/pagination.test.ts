import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_DEFAULTS } from '../../core/defaults.ts';
import { listAll } from '../pagination.ts';

describe('listAll', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects every page in order without a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pages: Record<string, { items: string[]; nextCursor?: string }> = {
      first: { items: ['a'], nextCursor: 'second' },
      second: { items: ['b'] },
    };

    const items = await listAll(
      async (params) => pages[params?.cursor ?? 'first'] ?? { items: [] },
      (page) => page.items,
    );

    expect(items).toEqual(['a', 'b']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when a downstream still has pages at the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = await listAll(
      async () => ({ items: ['x'], nextCursor: 'more' }),
      (page) => page.items,
    );

    expect(items).toHaveLength(GATEWAY_DEFAULTS.maxListPages);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('page cap'));
  });
});
