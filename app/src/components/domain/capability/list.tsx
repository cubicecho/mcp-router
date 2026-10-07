import type { UseMutationResult } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { DisclosureRow } from '@/components/disclosure-row';
import { QueryError } from '@/components/query-state';
import { Play } from '@/components/ui/icons';
import { toastApiError } from '@/lib/toast';
import type { SlotNode } from '@/lib/utils';
import { DataBlock } from './json-view.tsx';

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
 * Shared card shell for a downstream capability listing (tools, resources, prompts).
 *
 * @param props.title - Card heading.
 * @param props.description - Line under the heading.
 * @param props.query - The listing's query: its first load draws the skeleton, and its error the retry banner.
 * @param props.what - What failed to load, for the error banner, e.g. "resources".
 * @param props.emptySlot - What the card says when the server reports none.
 * @param props.contentSlot - One row per capability; an empty list renders `emptySlot`.
 * @returns The card.
 *
 * @remarks
 * A failed background refetch shows the error banner above the last-loaded list rather than blanking it.
 */
export function CapabilityList({ title, description, query, what, emptySlot, contentSlot }: CapabilityListProps) {
  return (
    <CardLayout
      level={2}
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
  /** Revealed when expanded: inputs, a {@link RunForm}, and a {@link ResultBlock}. */
  contentSlot: SlotNode;
}

/**
 * Shared collapsible row for one capability (tool, resource, prompt).
 *
 * @param props.title - The capability's name, drawn in monospace.
 * @param [props.meta] - Short facts beside the name, e.g. a resource's MIME type.
 * @param [props.description] - The capability's own description, under the name.
 * @param props.contentSlot - Revealed when expanded: inputs, a run form and its result.
 * @returns The row, collapsed at first.
 */
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

/** What every run/read/get form's submit button looks like; the label is the row's own. */
export const RUN_SUBMIT = { size: 'sm', variant: 'outline', className: 'self-start', iconSlot: <Play /> } as const;

/**
 * The `<form>` of a capability row: its fields in a column, submitted by Enter or the button.
 *
 * @param props.onSubmit - Called on submit, after the browser's own submit is prevented.
 * @param props.contentSlot - The fields and the submit button.
 * @returns The form.
 */
export function RunForm({ onSubmit, contentSlot }: { onSubmit: () => void; contentSlot: SlotNode }) {
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {contentSlot}
    </form>
  );
}

/**
 * Shared run/read/get state for a capability row.
 *
 * @typeParam TData - What the mutation resolves with.
 * @typeParam TVariables - What the mutation is called with.
 * @param mutation - The call, read or get mutation to run.
 * @returns `result`, the last result or null before one and during a run; and `run`, which never rejects.
 *
 * @remarks
 * `run` clears the result, toasts a failure, and settles when the call does, so a form awaiting it shows progress on
 * its submit.
 */
export function useCapabilityRun<TData, TVariables>(mutation: UseMutationResult<TData, Error, TVariables>) {
  const [result, setResult] = useState<TData | null>(null);
  const run = async (variables: TVariables): Promise<void> => {
    setResult(null);
    try {
      setResult(await mutation.mutateAsync(variables));
    } catch (error) {
      toastApiError(error);
    }
  };
  return { result, run };
}

/**
 * Shared JSON result panel for a run/read/get invocation, with a Text/JSON toggle.
 *
 * @param props.result - What the invocation returned.
 * @param [props.isError] - Marks the result as an error the capability itself returned.
 * @param [props.label] - Caption; left out, it says "Result" or "Returned an error".
 * @returns The panel.
 */
export function ResultBlock({ result, isError, label }: { result: unknown; isError?: boolean; label?: string }) {
  return <DataBlock value={result} isError={isError} label={label ?? (isError ? 'Returned an error' : 'Result')} />;
}
