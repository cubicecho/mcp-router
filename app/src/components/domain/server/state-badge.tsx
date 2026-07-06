import type { ServerRuntimeState } from '@mcp-router/shared';
import { Loader2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const STATE_STYLES: Record<ServerRuntimeState, string> = {
  stopped: 'border-transparent bg-muted text-muted-foreground',
  starting: 'border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400',
  running: 'border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  error: 'border-transparent bg-destructive/15 text-destructive',
};

export function ServerStateBadge({ state, lastError }: { state: ServerRuntimeState; lastError?: string }) {
  const badge = (
    <Badge className={STATE_STYLES[state]}>
      {state === 'starting' && <Loader2Icon className="animate-spin" aria-hidden />}
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
