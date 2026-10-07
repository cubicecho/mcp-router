import type { ServerTool } from '@mcp-router/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/page';
import { Textarea } from '@/components/ui/textarea';
import { type CapabilityScope, SCOPE_WORKSPACE } from '@/lib/api';
import { argsTemplate } from '@/lib/args-template';
import { DISPLAY_DEFAULTS } from '@/lib/defaults';
import { useCallTool, useCapabilityTools } from '@/lib/queries';
import { CapabilityList, CapabilityRow, ResultBlock, RunButton, useCapabilityRun } from './capability-list';

function ToolRow({ scope, tool }: { scope: CapabilityScope; tool: ServerTool }) {
  const schemaSig = JSON.stringify(tool.inputSchema);
  const [seededSig, setSeededSig] = useState(schemaSig);
  const [argsText, setArgsText] = useState(() => argsTemplate(tool.inputSchema));
  const call = useCallTool(scope);
  const { result, run, loading } = useCapabilityRun(call);

  // A refetch that genuinely changes this tool's schema re-seeds the args editor
  // in place (rather than remounting the row), so the last result stays visible.
  if (schemaSig !== seededSig) {
    setSeededSig(schemaSig);
    setArgsText(argsTemplate(tool.inputSchema));
  }

  const submit = () => {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsText.trim() || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('arguments must be a JSON object');
      }
      args = parsed as Record<string, unknown>;
    } catch (error) {
      toast.error(`Invalid arguments: ${error instanceof Error ? error.message : 'not valid JSON'}`);
      return;
    }
    run({ name: tool.name, arguments: args });
  };

  return (
    <CapabilityRow
      title={tool.name}
      description={tool.description}
      contentSlot={
        <>
          <Textarea
            value={argsText}
            rows={Math.min(
              DISPLAY_DEFAULTS.argsMaxRows,
              Math.max(DISPLAY_DEFAULTS.argsMinRows, argsText.split('\n').length),
            )}
            className="font-mono text-xs"
            aria-label={`Arguments for ${tool.name}`}
            onChange={(event) => setArgsText(event.target.value)}
          />
          <RunButton label="Run" loading={loading} onClick={submit} />
          {result && (
            <ResultBlock
              result={result}
              isError={result.isError}
              label={result.isError ? 'Tool returned an error' : 'Result'}
            />
          )}
        </>
      }
    />
  );
}

export function ToolsCard({ scope }: { scope: CapabilityScope }) {
  const query = useCapabilityTools(scope);
  const { data } = query;
  const tools = data?.tools ?? [];
  const description =
    scope.kind === SCOPE_WORKSPACE
      ? 'Tools exposed by the workspace aggregate, `<server>__`-namespaced, with per-workspace overrides applied. Expand one to run it with JSON arguments — runs show up in the Activity tab.'
      : 'Tools reported by the downstream server. Expand one to run it with JSON arguments — runs show up in the Activity tab.';

  return (
    <CapabilityList
      title="Tools"
      description={description}
      query={query}
      what="tools"
      emptySlot={<EmptyState compact title="No tools reported." />}
      contentSlot={tools.map((tool) => <ToolRow key={tool.name} scope={scope} tool={tool} />)}
    />
  );
}
