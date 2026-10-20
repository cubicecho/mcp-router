import { ServerRuntimeState } from '@mcp-router/shared';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const STATE_VARIANTS = {
  [ServerRuntimeState.Stopped]: 'secondary',
  [ServerRuntimeState.Starting]: 'warning',
  [ServerRuntimeState.Running]: 'positive',
  [ServerRuntimeState.Error]: 'destructive',
  [ServerRuntimeState.NeedsAuth]: 'warning',
} as const satisfies Record<ServerRuntimeState, BadgeVariant>;

/** What each state reads as, where the wire value is not already plain words. */
const STATE_LABELS: Partial<Record<ServerRuntimeState, string>> = {
  [ServerRuntimeState.NeedsAuth]: 'needs sign-in',
};

/**
 * Badge naming a server's runtime state, coloured by it.
 *
 * @param props.state - The runtime state; `starting` adds a spinner.
 * @param [props.lastError] - Shown as a tooltip, in the error state only.
 * @returns The badge.
 */
export function ServerStateBadge({ state, lastError }: { state: ServerRuntimeState; lastError?: string }) {
  const badge = (
    <Badge variant={STATE_VARIANTS[state]}>
      {state === ServerRuntimeState.Starting && <Spinner label="Starting" className="size-3" />}
      {STATE_LABELS[state] ?? state}
    </Badge>
  );

  if (state === ServerRuntimeState.Error && lastError) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-sm break-words">{lastError}</TooltipContent>
      </Tooltip>
    );
  }
  return badge;
}
