import { ServerRuntimeState } from '@mcp-router/shared';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { LoaderCircle } from '@/components/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const STATE_VARIANTS = {
  [ServerRuntimeState.Stopped]: 'secondary',
  [ServerRuntimeState.Starting]: 'warning',
  [ServerRuntimeState.Running]: 'positive',
  [ServerRuntimeState.Error]: 'destructive',
} as const satisfies Record<ServerRuntimeState, BadgeVariant>;

export function ServerStateBadge({ state, lastError }: { state: ServerRuntimeState; lastError?: string }) {
  const badge = (
    <Badge variant={STATE_VARIANTS[state]}>
      {state === ServerRuntimeState.Starting && <LoaderCircle className="animate-spin" aria-hidden />}
      {state}
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
