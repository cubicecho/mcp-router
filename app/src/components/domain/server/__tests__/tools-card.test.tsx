import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import * as api from '@/lib/api';
import { ToolsCard } from '../tools-card';

const SCOPE = { kind: 'server', name: 'echo-server' } as const;

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToolsCard scope={SCOPE} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Opens the echo tool's row and returns its arguments box. */
async function openEchoRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /echo/ }));
  return screen.getByLabelText(/Arguments/);
}

describe('ToolsCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getTools').mockResolvedValue({
      tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }],
    });
  });

  it('runs the tool with the typed arguments', async () => {
    const callTool = vi.spyOn(api, 'callTool').mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const user = userEvent.setup();
    renderCard();

    const box = await openEchoRow(user);
    await user.clear(box);
    await user.type(box, '{{"text":"hi"}');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(callTool).toHaveBeenCalledWith(SCOPE, { name: 'echo', arguments: { text: 'hi' } }));
    expect(await screen.findByText('Result')).toBeInTheDocument();
  });

  it('says why the arguments are not usable, and calls nothing', async () => {
    const callTool = vi.spyOn(api, 'callTool');
    const user = userEvent.setup();
    renderCard();

    const box = await openEchoRow(user);
    await user.clear(box);
    await user.type(box, '[[1]');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Arguments must be a JSON object')).toBeInTheDocument();
    expect(callTool).not.toHaveBeenCalled();
  });
});
