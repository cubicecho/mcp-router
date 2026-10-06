import type { UseMutationResult } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { DisclosureRow } from '@/components/disclosure-row';
import { EmptyState } from '@/components/page';
import { QueryError } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Play } from '@/components/ui/icons';
import { toastApiError } from '@/lib/toast';
import type { SlotNode } from '@/lib/utils';
import { DataBlock } from './json-view';

interface CapabilityListProps {
  title: string;
  description: string;
  isPending: boolean;
  error: Error | null;
  refetch: () => void;
  /** What failed to load, for the error card, e.g. "resources". */
  what: string;
  emptyText: string;
  /** One {@link CapabilityRow} per capability; an empty list renders the empty state. */
  rowsSlot: ReactElement[];
}

/**
 * Shared card shell for a downstream capability listing (tools, resources,
 * prompts): loading skeleton, retryable error, empty state, else the caller's
 * rows. A failed background refetch shows the error banner above the last-loaded
 * list rather than blanking it.
 */
export function CapabilityList({
  title,
  description,
  isPending,
  error,
  refetch,
  what,
  emptyText,
  rowsSlot,
}: CapabilityListProps) {
  return (
    <CardLayout
      title={title}
      description={description}
      loading={isPending}
      emptySlot={<EmptyState compact title={emptyText} />}
      contentClassName="gap-2"
      contentSlot={
        error ? [<QueryError key="error" error={error} onRetry={refetch} what={what} />, ...rowsSlot] : rowsSlot
      }
    />
  );
}

interface CapabilityRowProps {
  /** The capability's name, drawn in monospace. */
  title: string;
  /** Short facts beside the name, e.g. a resource's MIME type. */
  meta?: ReactNode;
  description?: ReactNode;
  /** Revealed when expanded: inputs, a {@link RunButton}, and a {@link ResultBlock}. */
  contentSlot: SlotNode;
}

/** Shared collapsible row for one capability (tool, resource, prompt). */
export function CapabilityRow({ title, meta, description, contentSlot }: CapabilityRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <DisclosureRow
      open={open}
      onOpenChange={setOpen}
      title={<span className="font-mono">{title}</span>}
      meta={meta}
      description={description}
      contentSlot={contentSlot}
      contentClassName="gap-3"
    />
  );
}

/** Shared run/read/get action button: shows a spinner while pending, a play icon otherwise. */
export function RunButton({
  label,
  pending,
  disabled,
  onClick,
}: {
  label: string;
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="self-start"
      loading={pending}
      disabled={disabled}
      onClick={onClick}
      iconSlot={<Play />}
      content={label}
    />
  );
}

/**
 * Shared run/read/get state for a capability row: holds the last result, clears
 * it before each invocation, and toasts errors. Callers supply the mutation
 * (call/read/get) and pass their built variables to `run`.
 */
export function useCapabilityRun<TData, TVariables>(mutation: UseMutationResult<TData, Error, TVariables>) {
  const [result, setResult] = useState<TData | null>(null);
  const run = (variables: TVariables) => {
    setResult(null);
    mutation.mutate(variables, { onSuccess: setResult, onError: toastApiError });
  };
  return { result, run, pending: mutation.isPending };
}

/** Shared JSON result panel for a run/read/get invocation, with a Text/JSON toggle. */
export function ResultBlock({ result, isError, label }: { result: unknown; isError?: boolean; label?: string }) {
  return <DataBlock value={result} isError={isError} label={label ?? (isError ? 'Returned an error' : 'Result')} />;
}
