import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
  resourcesResponse,
  routerStatus,
  serverCapabilityAnswers,
  workspaceCapabilityAnswers,
} from '@/storybook/fixtures';
import type { ApiRoutes } from '@/storybook/mock-api';
import { CapabilityTabs } from './tabs.tsx';

/**
 * Everything the five tabs ask of one server or workspace.
 *
 * @param kind - Whose tabs: a server's or a workspace's operations are answered.
 * @returns The answers.
 */
function capabilityRoutes(kind: 'server' | 'workspace'): ApiRoutes {
  const answers = { resources: resourcesResponse() };
  return {
    RouterStatus: { routerStatus: routerStatus() },
    ...(kind === 'server' ? serverCapabilityAnswers(answers) : workspaceCapabilityAnswers(answers)),
  };
}

const meta = {
  component: CapabilityTabs,
  args: { scope: { kind: 'server', name: 'filesystem' } },
  parameters: { api: capabilityRoutes('server') },
  decorators: [
    (Story) => (
      <div className="max-w-4xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CapabilityTabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StartsOnTools: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('heading', { name: 'Tools' })).toBeVisible();
    await expect(await canvas.findByRole('button', { name: /read_file/ })).toBeVisible();
    for (const name of ['Resources', 'Prompts', 'Activity', 'Connect']) {
      await expect(canvas.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'false');
    }
  },
};

export const ShowsResourcesOnItsTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Resources' }));
    await expect(canvas.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');
    await expect(await canvas.findByRole('button', { name: /notes\.txt/ })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /read_file/ })).not.toBeInTheDocument();
  },
};

export const ShowsPromptsOnItsTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Prompts' }));
    await expect(await canvas.findByRole('button', { name: /summarise/ })).toBeVisible();
  },
};

export const ShowsActivityOnItsTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Activity' }));
    await expect(await canvas.findByRole('button', { name: /tools\/call/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Refresh' })).toBeVisible();
  },
};

export const ConnectsStraightToAServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Connect' }));
    await expect(
      canvas.getByText('Point an MCP client directly at filesystem (tools keep their original names).'),
    ).toBeVisible();
    await expect(
      await canvas.findByText(`claude mcp add --transport http filesystem ${window.location.origin}/mcp/filesystem`),
    ).toBeVisible();
  },
};

export const ConnectsToAWorkspaceAggregate: Story = {
  args: { scope: { kind: 'workspace', slug: 'research' } },
  parameters: { api: capabilityRoutes('workspace') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: /read_file/ })).toBeVisible();
    await expect(canvas.getByText(/Tools exposed by the workspace aggregate/)).toBeVisible();
    await userEvent.click(canvas.getByRole('tab', { name: 'Connect' }));
    await expect(canvas.getByText(/this workspace's aggregate endpoint/)).toBeVisible();
    await expect(
      await canvas.findByText(`claude mcp add --transport http research ${window.location.origin}/mcp/w/research`),
    ).toBeVisible();
  },
};

export const MovesBetweenTabsWithTheArrowKeys: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Tools' }));
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('tab', { name: 'Resources' })).toHaveFocus();
    await expect(canvas.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('heading', { name: 'Resources' })).toBeVisible();
  },
};
