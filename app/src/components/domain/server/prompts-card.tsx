import type { ServerPrompt } from '@mcp-router/shared';
import { useState } from 'react';
import { FormField } from '@/components/form-field';
import { EmptyState } from '@/components/page';
import { Input } from '@/components/ui/input';
import { type CapabilityScope, SCOPE_WORKSPACE } from '@/lib/api';
import { useCapabilityPrompts, useGetPrompt } from '@/lib/queries';
import { CapabilityList, CapabilityRow, ResultBlock, RunButton, useCapabilityRun } from './capability-list';

function PromptRow({ scope, prompt }: { scope: CapabilityScope; prompt: ServerPrompt }) {
  const [args, setArgs] = useState<Record<string, string>>({});
  const get = useGetPrompt(scope);
  const { result, run, loading } = useCapabilityRun(get);
  const declaredArgs = prompt.arguments ?? [];

  const submit = () => {
    // Only send filled-in values; the server defaults missing optional args. Trim
    // to match the required-arg check, so a whitespace-only entry counts as unset.
    const filled = Object.fromEntries(Object.entries(args).filter(([, value]) => value.trim().length > 0));
    run({ name: prompt.name, arguments: filled });
  };

  const missingRequired = declaredArgs.some((arg) => arg.required && (args[arg.name] ?? '').trim().length === 0);

  return (
    <CapabilityRow
      title={prompt.name}
      description={prompt.description}
      contentSlot={
        <>
          {declaredArgs.length === 0 && <EmptyState compact title="This prompt takes no arguments." />}
          {declaredArgs.map((arg) => (
            <FormField
              key={arg.name}
              label={<span className="font-mono">{arg.name}</span>}
              description={arg.description}
              required={arg.required}
              controlSlot={
                <Input
                  value={args[arg.name] ?? ''}
                  onChange={(event) => setArgs((prev) => ({ ...prev, [arg.name]: event.target.value }))}
                />
              }
            />
          ))}
          <RunButton label="Get" loading={loading} disabled={missingRequired} onClick={submit} />
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
