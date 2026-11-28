import { useState } from 'react';
import { toast } from 'sonner';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { CreateApiKeyDialog } from '@/components/domain/auth/create-api-key-dialog';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { LoadError } from '@/components/load-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { Plus, Trash2 } from '@/components/ui/icons';
import type { ApiKey } from '@/lib/api';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format';
import { useApiKeys, useRevokeApiKey } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

/** The name the router gives the key it made from the bearer token it was set up with before sign-in. */
export const IMPORTED_KEY_NAME = 'Imported router token';

/**
 * The line under a key's name: how it starts, and when it was made.
 *
 * @param key - The key.
 * @returns E.g. "mcpr_a1b2… · created 3d ago", with when it expires for a key that does.
 */
function keyDescription(key: ApiKey): string {
  const parts = [key.start ? `${key.start}…` : null, `created ${formatRelativeTime(key.createdAt)}`];
  if (key.expiresAt) {
    parts.push(`expires ${formatAbsoluteTime(key.expiresAt)}`);
  }
  return parts.filter((part) => part !== null).join(' · ');
}

/**
 * When a key was last sent.
 *
 * @param key - The key.
 * @returns E.g. "used 2h ago", or "never used".
 */
function lastUsed(key: ApiKey): string {
  return key.lastUsedAt ? `used ${formatRelativeTime(key.lastUsedAt)}` : 'never used';
}

/**
 * The API keys card of Settings: the operator's keys, with when each was made and last used, a button that makes one
 * and a revoke on each.
 *
 * @returns The card.
 */
export function ApiKeysCard() {
  const query = useApiKeys();
  const revoke = useRevokeApiKey();
  const [isCreating, setIsCreating] = useState(false);
  const keys = query.data ?? [];
  const hasImportedKey = keys.some((key) => key.name === IMPORTED_KEY_NAME);

  return (
    <CardLayout
      level={2}
      title="API keys"
      description={
        <>
          For MCP clients and agents. A client sends its key as <Code>Authorization: Bearer {'<key>'}</Code> to{' '}
          <Code>/mcp</Code>, <Code>/mcp/{'<name>'}</Code> or <Code>/mcp/w/{'<slug>'}</Code>. Those take only API keys,
          even on a trusted network.
        </>
      }
      actionSlot={<Button size="sm" iconSlot={<Plus />} onClick={() => setIsCreating(true)} content="Create API key" />}
      loading={query.isPending}
      contentClassName="flex flex-col gap-4"
      contentSlot={
        <>
          {query.isError && <LoadError error={query.error} onRetry={() => query.refetch()} what="API keys" />}
          {hasImportedKey && (
            <Alert
              variant="info"
              description={`The router token this router used before sign-in was kept as a key named “${IMPORTED_KEY_NAME}”, so clients that send it still work. Give each client a key of its own, then revoke it.`}
            />
          )}
          {query.isSuccess && keys.length === 0 && (
            <EmptyState compact title="No API keys yet. Create one for each client that connects." />
          )}
          {keys.length > 0 && (
            <List
              contentSlot={keys.map((key) => (
                <ListItem
                  key={key.id}
                  title={key.name}
                  description={keyDescription(key)}
                  meta={
                    <span
                      className="text-foreground/60 text-xs"
                      title={key.lastUsedAt ? formatAbsoluteTime(key.lastUsedAt) : undefined}
                    >
                      {lastUsed(key)}
                    </span>
                  }
                  actionSlot={
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Revoke ${key.name}`}
                      title={`Revoke ${key.name}?`}
                      description="A client sending this key is refused from now on. This can't be undone; the client needs a new key."
                      confirmLabel="Revoke key"
                      onConfirm={() =>
                        revoke.mutate(key.id, {
                          onSuccess: () => toast.success(`Revoked ${key.name}`),
                          onError: toastApiError,
                        })
                      }
                      iconSlot={<Trash2 className="text-negative" />}
                    />
                  }
                />
              ))}
            />
          )}
          <CreateApiKeyDialog open={isCreating} onOpenChange={setIsCreating} />
        </>
      }
    />
  );
}
