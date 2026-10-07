import type { UseMutationResult } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { DisclosureRow } from '@/components/disclosure-row';
import { QueryError } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Play } from '@/components/ui/icons';
import { toastApiError } from '@/lib/toast';
import type { SlotNode } from '@/lib/utils';
import { DataBlock } from './json-view';

/** The part of a query the card reads, taken structurally. */
interface ListQuery {
  isPending: boolean;
  error: Error | null;
  refetch: () => unknown;
}

interface CapabilityListProps {
  title: string;
  description: string;
  /** The listing's query: its first load draws the skeleton, and its error the retry banner. */
  query: ListQuery;
  /** What failed to load, for the error card, e.g. "resources". */
  what: string;
  /** What the card says when the server reports none. */
  emptySlot: SlotNode;
  /** One {@link CapabilityRow} per capability; an empty list renders `emptySlot`. */
  contentSlot: ReactElement[];
}

/**
 * Shared card shell for a downstream capability listing (tools, resources,
 * prompts): loading skeleton, retryable error, empty state, else the caller's
 * rows. A failed background refetch shows the error banner above the last-loaded
 * list rather than blanking it.
 */
export function CapabilityList({ title, description, query, what, emptySlot, contentSlot }: CapabilityListProps) {
  return (
    <CardLayout
      title={title}
      description={description}
      loading={query.isPending}
      emptySlot={emptySlot}
      contentClassName="gap-2"
      contentSlot={
        query.error
          ? [<QueryError key="error" error={query.error} onRetry={query.refetch} what={what} />, ...contentSlot]
          : contentSlot
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

/** Shared run/read/get action button: shows a spinner while loading, a play icon otherwise. */
export function RunButton({
  label,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="self-start"
      loading={loading}
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
  return { result, run, loading: mutation.isPending };
}

/** Shared JSON result panel for a run/read/get invocation, with a Text/JSON toggle. */
export function ResultBlock({ result, isError, label }: { result: unknown; isError?: boolean; label?: string }) {
  return <DataBlock value={result} isError={isError} label={label ?? (isError ? 'Returned an error' : 'Result')} />;
}
