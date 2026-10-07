import type { ServerTool } from '@mcp-router/shared';
import { TextareaField, useAppForm } from '@/components/app-form';
import { EmptyState } from '@/components/page';
import { type CapabilityScope, SCOPE_WORKSPACE } from '@/lib/api';
import { argsTemplate } from '@/lib/args-template';
import { DISPLAY_DEFAULTS } from '@/lib/defaults';
import { useCallTool, useCapabilityTools } from '@/lib/queries';
import { CapabilityList, CapabilityRow, ResultBlock, RUN_SUBMIT, RunForm, useCapabilityRun } from './capability-list';

type ToolArguments = Record<string, unknown>;

/** The typed text as an arguments object, or why it is not one. */
function parseArguments(text: string): { args: ToolArguments } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim() || '{}');
  } catch (error) {
    return { error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Arguments must be a JSON object' };
  }
  return { args: parsed as ToolArguments };
}

function ToolArgsForm({ tool, onRun }: { tool: ServerTool; onRun: (args: ToolArguments) => Promise<void> }) {
  const form = useAppForm({
    defaultValues: { argsText: argsTemplate(tool.inputSchema) },
    onSubmit: async ({ value }) => {
      const parsed = parseArguments(value.argsText);
      if ('args' in parsed) {
        await onRun(parsed.args);
      }
    },
  });

  return (
    <RunForm
      onSubmit={form.handleSubmit}
      contentSlot={
        <>
          <form.Subscribe selector={(state) => state.values.argsText.split('\n').length}>
            {(lines) => (
              <TextareaField
                form={form}
                name="argsText"
                label="Arguments"
                description="A JSON object."
                rows={Math.min(DISPLAY_DEFAULTS.argsMaxRows, Math.max(DISPLAY_DEFAULTS.argsMinRows, lines))}
                className="[&_textarea]:font-mono [&_textarea]:text-xs"
                validators={{
                  onSubmit: ({ value }) => {
                    const parsed = parseArguments(value);
                    return 'error' in parsed ? parsed.error : undefined;
                  },
                }}
              />
            )}
          </form.Subscribe>
          <form.AppForm>
            <form.SubmitButton {...RUN_SUBMIT} content="Run" pendingLabel="Running…" />
          </form.AppForm>
        </>
      }
    />
  );
}

function ToolRow({ scope, tool }: { scope: CapabilityScope; tool: ServerTool }) {
  const call = useCallTool(scope);
  const { result, run } = useCapabilityRun(call);

  return (
    <CapabilityRow
      title={tool.name}
      description={tool.description}
      contentSlot={
        <>
          {/* Keyed by the schema: a refetch that changes it remounts only the form, which
              re-seeds the arguments while the last result stays visible. */}
          <ToolArgsForm
            key={JSON.stringify(tool.inputSchema)}
            tool={tool}
            onRun={(args) => run({ name: tool.name, arguments: args })}
          />
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
