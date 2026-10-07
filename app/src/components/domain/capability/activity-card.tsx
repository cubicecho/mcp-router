import { type ActivityEntry, CallVia } from '@mcp-router/shared';
import { RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DisclosureRow } from '@/components/disclosure-row';
import { OptionSelect } from '@/components/option-select';
import { EmptyState } from '@/components/page';
import { QueryError } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2 } from '@/components/ui/icons';
import { type CapabilityScope, SCOPE_SERVER } from '@/lib/api';
import { endpointPath } from '@/lib/endpoint';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format';
import { useCapabilityActivity, useClearActivity } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { DataBlock } from './json-view.tsx';

/**
 * Collapsible row for one recorded MCP call.
 *
 * @param props.entry - The call; its params, result and error are what the row expands to.
 * @returns The row.
 */
function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.params !== undefined || entry.result !== undefined || entry.error !== undefined;

  return (
    <DisclosureRow
      open={open}
      onOpenChange={setOpen}
      title={<span className="font-mono">{entry.method}</span>}
      description={entry.target ? <span className="break-all font-mono text-xs">{entry.target}</span> : undefined}
      actionSlot={
        <>
          <Badge variant={entry.ok ? 'secondary' : 'destructive'}>{entry.ok ? 'ok' : 'error'}</Badge>
          {entry.via !== CallVia.Direct && <Badge variant="outline">{entry.via}</Badge>}
          <span className="text-foreground/60 text-xs tabular-nums">{entry.durationMs}ms</span>
          <span className="text-foreground/60 text-xs tabular-nums" title={formatAbsoluteTime(entry.at)}>
            {formatRelativeTime(entry.at)}
          </span>
        </>
      }
      contentSlot={
        hasDetail ? (
          <>
            {entry.error && <Alert variant="destructive" title="Error" description={entry.error} />}
            {entry.params !== undefined && <DataBlock value={entry.params} label="Request" />}
            {entry.result !== undefined && <DataBlock value={entry.result} label="Response" />}
          </>
        ) : undefined
      }
    />
  );
}

/**
 * Card listing the recent MCP calls of a server or workspace, filterable by outcome and method.
 *
 * @param props.scope - The server or workspace whose activity log is shown and cleared.
 * @returns The card.
 */
export function ActivityCard({ scope }: { scope: CapabilityScope }) {
  const { data, isPending, error, refetch, isRefetching } = useCapabilityActivity(scope);
  const clear = useClearActivity(scope);
  const [outcome, setOutcome] = useState<'all' | 'ok' | 'error'>('all');
  const [method, setMethod] = useState('all');

  const entries = data?.entries ?? [];
  const methods = [...new Set(entries.map((entry) => entry.method))].sort();
  const filtered = entries.filter(
    (entry) => (outcome === 'all' || (outcome === 'ok') === entry.ok) && (method === 'all' || entry.method === method),
  );
  const endpoint = endpointPath(scope);

  const handleClear = () => {
    clear.mutate(undefined, {
      onSuccess: () => toast.success('Activity cleared'),
      onError: toastApiError,
    });
  };

  return (
    <CardLayout
      level={2}
      title="Activity"
      actionSlot={
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isRefetching}
            onClick={() => refetch()}
            iconSlot={<RotateCwIcon />}
            content="Refresh"
          />
          <ConfirmButton
            variant="outline"
            size="sm"
            loading={clear.isPending}
            disabled={entries.length === 0}
            label="Clear activity"
            title="Clear the activity log?"
            description={
              scope.kind === SCOPE_SERVER
                ? 'Every recorded call to this server is removed, including the failed ones you have not looked at.'
                : "Every recorded call through this workspace's members is removed, including the failed ones you have not looked at."
            }
            confirmLabel="Clear"
            onConfirm={handleClear}
            iconSlot={<Trash2 />}
            content="Clear"
          />
        </span>
      }
      description={
        scope.kind === SCOPE_SERVER
          ? 'Recent MCP calls proxied to this server (kept in memory; the newest 200 are retained).'
          : "Recent MCP calls proxied through this workspace's members (kept in memory; the newest 200 per member are retained)."
      }
      loading={isPending}
      contentSlot={
        <>
          {error && <QueryError error={error} onRetry={() => refetch()} what="activity" />}
          {data && entries.length === 0 && (
            <EmptyState
              compact
              title={`No activity yet. Calls made through ${endpoint}${
                scope.kind === SCOPE_SERVER ? ' or the aggregate /mcp endpoint' : ''
              } will appear here.`}
            />
          )}
          {entries.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <OptionSelect
                  data-size="sm"
                  className="w-28"
                  aria-label="Filter by outcome"
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'ok', label: 'OK' },
                    { value: 'error', label: 'Errors' },
                  ]}
                  value={outcome}
                  onValueChange={(value) => setOutcome(value as typeof outcome)}
                />
                <OptionSelect
                  data-size="sm"
                  className="w-52"
                  aria-label="Filter by method"
                  options={[
                    { value: 'all', label: 'All methods' },
                    ...methods.map((value) => ({ value, label: value })),
                  ]}
                  value={method}
                  onValueChange={setMethod}
                />
              </div>
              {filtered.length === 0 ? (
                <EmptyState compact title="No entries match the current filters." />
              ) : (
                <div className="flex flex-col gap-2">
                  {filtered.map((entry) => (
                    <ActivityRow key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      }
    />
  );
}
