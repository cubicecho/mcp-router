import type { PromptGetResponse } from '@mcp-router/shared';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ServerPrompt } from '@/lib/api';
import { useGetServerPrompt, useServerPrompts } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { CapabilityList, CapabilityRow, ResultBlock, RunButton } from './capability-list';

function PromptRow({ serverName, prompt }: { serverName: string; prompt: ServerPrompt }) {
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PromptGetResponse | null>(null);
  const get = useGetServerPrompt(serverName);
  const declaredArgs = prompt.arguments ?? [];

  const run = () => {
    // Only send filled-in values; the server defaults missing optional args. Trim
    // to match the required-arg check, so a whitespace-only entry counts as unset.
    const filled = Object.fromEntries(Object.entries(args).filter(([, value]) => value.trim().length > 0));
    setResult(null);
    get.mutate({ name: prompt.name, arguments: filled }, { onSuccess: setResult, onError: toastApiError });
  };

  const missingRequired = declaredArgs.some((arg) => arg.required && (args[arg.name] ?? '').trim().length === 0);

  return (
    <CapabilityRow
      header={
        <>
          <span className="font-mono text-sm">{prompt.name}</span>
          {prompt.description && <p className="text-sm text-muted-foreground">{prompt.description}</p>}
        </>
      }
    >
      {declaredArgs.length === 0 && <p className="text-xs text-muted-foreground">This prompt takes no arguments.</p>}
      {declaredArgs.map((arg) => (
        <div key={arg.name} className="flex flex-col gap-1">
          <Label htmlFor={`${prompt.name}-${arg.name}`} className="text-xs">
            <span className="font-mono">{arg.name}</span>
            {arg.required && <span className="text-destructive"> *</span>}
          </Label>
          {arg.description && <p className="text-xs text-muted-foreground">{arg.description}</p>}
          <Input
            id={`${prompt.name}-${arg.name}`}
            value={args[arg.name] ?? ''}
            className="text-xs"
            onChange={(event) => setArgs((prev) => ({ ...prev, [arg.name]: event.target.value }))}
          />
        </div>
      ))}
      <RunButton label="Get" pending={get.isPending} disabled={missingRequired} onClick={run} />
      {result && <ResultBlock result={result} />}
    </CapabilityRow>
  );
}

export function PromptsCard({ name }: { name: string }) {
  const { data, isPending, error, refetch, isRefetching } = useServerPrompts(name);
  const prompts = data?.prompts ?? [];

  return (
    <CapabilityList
      title="Prompts"
      description="Prompt templates exposed by the downstream server. Expand one to fill its arguments and fetch the messages — gets show up in the Activity tab."
      isPending={isPending}
      error={error}
      isRefetching={isRefetching}
      refetch={refetch}
      errorVerb="list prompts"
      count={prompts.length}
      emptyText="No prompts reported."
    >
      {prompts.map((prompt) => (
        <PromptRow key={prompt.name} serverName={name} prompt={prompt} />
      ))}
    </CapabilityList>
  );
}
