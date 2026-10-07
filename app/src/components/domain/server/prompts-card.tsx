import type { ServerPrompt } from '@mcp-router/shared';
import { InputField, useAppForm } from '@/components/app-form';
import { EmptyState } from '@/components/page';
import { type CapabilityScope, SCOPE_WORKSPACE } from '@/lib/api';
import { useCapabilityPrompts, useGetPrompt } from '@/lib/queries';
import { CapabilityList, CapabilityRow, ResultBlock, RUN_SUBMIT, RunForm, useCapabilityRun } from './capability-list';

function PromptRow({ scope, prompt }: { scope: CapabilityScope; prompt: ServerPrompt }) {
  const get = useGetPrompt(scope);
  const { result, run } = useCapabilityRun(get);
  const declaredArgs = prompt.arguments ?? [];
  // One value per declared argument, by position: an argument's name may hold a dot or a
  // bracket, which a field path would read as nesting.
  const form = useAppForm({
    defaultValues: { values: declaredArgs.map(() => '') },
    onSubmit: ({ value }) => {
      // Only send filled-in values; the server defaults missing optional args. Trim
      // to match the required-arg check, so a whitespace-only entry counts as unset.
      const filled = Object.fromEntries(
        declaredArgs
          .map((arg, index): [string, string] => [arg.name, value.values[index] ?? ''])
          .filter(([, text]) => text.trim().length > 0),
      );
      return run({ name: prompt.name, arguments: filled });
    },
  });

  return (
    <CapabilityRow
      title={prompt.name}
      description={prompt.description}
      contentSlot={
        <>
          <RunForm
            onSubmit={form.handleSubmit}
            contentSlot={
              <>
                {declaredArgs.length === 0 && <EmptyState compact title="This prompt takes no arguments." />}
                {declaredArgs.map((arg, index) => (
                  <InputField
                    key={arg.name}
                    form={form}
                    name={`values[${index}]`}
                    label={<span className="font-mono">{arg.name}</span>}
                    description={arg.description}
                    required={arg.required}
                    validators={{
                      onChange: ({ value }) =>
                        arg.required && value.trim().length === 0 ? `${arg.name} is required` : undefined,
                    }}
                  />
                ))}
                <form.AppForm>
                  <form.SubmitButton {...RUN_SUBMIT} content="Get" pendingLabel="Getting…" />
                </form.AppForm>
              </>
            }
          />
          {result && <ResultBlock result={result} />}
        </>
      }
    />
  );
}

export function PromptsCard({ scope }: { scope: CapabilityScope }) {
  const query = useCapabilityPrompts(scope);
  const { data } = query;
  const prompts = data?.prompts ?? [];
  const description =
    scope.kind === SCOPE_WORKSPACE
      ? 'Prompt templates exposed by the workspace aggregate, `<server>__`-namespaced. Expand one to fill its arguments and fetch the messages — gets show up in the Activity tab.'
      : 'Prompt templates exposed by the downstream server. Expand one to fill its arguments and fetch the messages — gets show up in the Activity tab.';

  return (
    <CapabilityList
      title="Prompts"
      description={description}
      query={query}
      what="prompts"
      emptySlot={<EmptyState compact title="No prompts reported." />}
      contentSlot={prompts.map((prompt) => <PromptRow key={prompt.name} scope={scope} prompt={prompt} />)}
    />
  );
}
