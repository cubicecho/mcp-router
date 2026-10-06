import type { ServerRuntimeState } from '@mcp-router/shared';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { LoaderCircle } from '@/components/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const STATE_VARIANTS = {
  stopped: 'secondary',
  starting: 'warning',
  running: 'positive',
  error: 'destructive',
} as const satisfies Record<ServerRuntimeState, BadgeVariant>;

export function ServerStateBadge({ state, lastError }: { state: ServerRuntimeState; lastError?: string }) {
  const badge = (
    <Badge variant={STATE_VARIANTS[state]}>
      {state === 'starting' && <LoaderCircle className="animate-spin" aria-hidden />}
      {state}
    </Badge>
  );

  if (state === 'error' && lastError) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-sm break-words">{lastError}</TooltipContent>
      </Tooltip>
    );
  }
  return badge;
}
