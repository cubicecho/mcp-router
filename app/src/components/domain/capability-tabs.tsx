import { ConnectCard } from '@/components/domain/connect-card';
import { ActivityCard } from '@/components/domain/server/activity-card';
import { PromptsCard } from '@/components/domain/server/prompts-card';
import { ResourcesCard } from '@/components/domain/server/resources-card';
import { ToolsCard } from '@/components/domain/server/tools-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type CapabilityScope, SCOPE_SERVER } from '@/lib/api';
import { endpointPath, endpointUrl } from '@/lib/endpoint';

/** What the Connect tab says about the endpoint, per kind of scope. */
const CONNECT_DESCRIPTION: Record<CapabilityScope['kind'], (label: string) => string> = {
  server: (label) => `Point an MCP client directly at ${label} (tools keep their original names).`,
  workspace: () => `Point an MCP client at this workspace's aggregate endpoint (tools are <server>__-namespaced).`,
};

/** The tools, resources, prompts, activity and connect tabs of one server or workspace. */
export function CapabilityTabs({ scope }: { scope: CapabilityScope }) {
  const label = scope.kind === SCOPE_SERVER ? scope.name : scope.slug;
  return (
    <Tabs defaultValue="tools">
      <TabsList>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="resources">Resources</TabsTrigger>
        <TabsTrigger value="prompts">Prompts</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="connect">Connect</TabsTrigger>
      </TabsList>
      <TabsContent value="tools">
        <ToolsCard scope={scope} />
      </TabsContent>
      <TabsContent value="resources">
        <ResourcesCard scope={scope} />
      </TabsContent>
      <TabsContent value="prompts">
        <PromptsCard scope={scope} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityCard scope={scope} />
      </TabsContent>
      <TabsContent value="connect">
        <ConnectCard
          endpoint={endpointUrl(endpointPath(scope))}
          label={label}
          description={CONNECT_DESCRIPTION[scope.kind](label)}
        />
      </TabsContent>
    </Tabs>
  );
}
