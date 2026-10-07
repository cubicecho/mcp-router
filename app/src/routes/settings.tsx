import { MS_PER_MINUTE } from '@mcp-router/shared';
import { createFileRoute } from '@tanstack/react-router';
import { RotateCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { PageLayout } from '@/components/page-layout';
import { QueryError } from '@/components/query-state';
import { SettingRow } from '@/components/setting-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Code, CodeBlock } from '@/components/ui/code';
import { Input } from '@/components/ui/input';
import { formatUptime } from '@/lib/format';
import { useReloadConfig, useRouterStatus, useUpdateSettings } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const CONFIG_TREE = `config/
├── settings.json        # port, auth token, auth enabled, idle timeout
├── registries.json      # { registries: [{ name, url }] }
└── servers/
    └── <name>.json      # one file per installed server`;

/** Inline editor for the default idle timeout, entered in minutes. */
function IdleTimeoutEditor({ currentMs }: { currentMs: number }) {
  const update = useUpdateSettings();
  const form = useAppForm({
    defaultValues: { minutes: String(currentMs / MS_PER_MINUTE) },
    onSubmit: async ({ value }) => {
      try {
        await update.mutateAsync({ idleTimeoutMs: Math.round(Number(value.minutes) * MS_PER_MINUTE) });
        toast.success('Idle timeout saved', { description: 'Applies from each server’s next use.' });
      } catch (error) {
        toastApiError(error);
      }
    },
  });
  /** The typed minutes are a positive number. */
  const isValid = (text: string) => Number.isFinite(Number(text)) && Number(text) > 0;
  /** The typed minutes are valid and differ from the stored timeout. */
  const isChanged = (text: string) => isValid(text) && Math.round(Number(text) * MS_PER_MINUTE) !== currentMs;

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="minutes">
        {(field) => (
          <Input
            value={field.state.value}
            inputMode="decimal"
            aria-label="Idle timeout in minutes"
            aria-invalid={isValid(field.state.value) === false}
            className="h-8 w-20 tabular-nums"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        )}
      </form.Field>
      <span className="text-foreground/60">minutes</span>
      <form.Subscribe selector={(state) => isChanged(state.values.minutes)}>
        {(changed) => (
          <form.AppForm>
            <form.SubmitButton size="sm" variant="outline" disabled={changed === false} content="Save" />
          </form.AppForm>
        )}
      </form.Subscribe>
    </form>
  );
}

function SettingsPage() {
  const status = useRouterStatus();
  const { data } = status;
  const reload = useReloadConfig();
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

  const handleReload = () => {
    reload.mutate(undefined, {
      onSuccess: () => toast.success('Configuration reloaded', { description: 'Running servers were reconciled.' }),
      onError: toastApiError,
    });
  };

  return (
    <PageLayout
      title="Settings"
      description="Router status and configuration."
      width="prose"
      contentSlot={
        <div className="flex flex-col gap-6 py-4 md:py-6">
          <CardLayout
            level={2}
            title="Router"
            loading={status.isPending}
            contentClassName="gap-4"
            contentSlot={
              status.error ? (
                <QueryError error={status.error} onRetry={() => status.refetch()} what="status" />
              ) : (
                data && (
                  <>
                    <DescriptionList
                      contentSlot={
                        <>
                          <PropertyRow label="Version" value={data.version} />
                          <PropertyRow label="Uptime" value={formatUptime(data.uptimeSeconds)} />
                          <PropertyRow label="Port" value={port} />
                          <PropertyRow label="Servers" value={`${data.runningCount}/${data.serverCount} running`} />
                          <PropertyRow
                            label="Auth"
                            value={
                              data.authEnabled ? (
                                <Badge variant="positive">enabled</Badge>
                              ) : (
                                <Badge variant="secondary">disabled</Badge>
                              )
                            }
                            hint={
                              <>
                                The bearer token is set via the <Code>MCP_ROUTER_TOKEN</Code> environment variable or{' '}
                                <Code>settings.json</Code>; it protects <Code>/api/*</Code> and <Code>/mcp*</Code>.
                              </>
                            }
                          />
                        </>
                      }
                    />
                    <SettingRow
                      title="Idle timeout"
                      description="How long an unused server keeps running before it is stopped."
                      actionSlot={<IdleTimeoutEditor key={data.idleTimeoutMs} currentMs={data.idleTimeoutMs} />}
                    />
                  </>
                )
              )
            }
          />

          <CardLayout
            level={2}
            title="Configuration files"
            description={
              <>
                All configuration lives in flat, hand-editable JSON files under <Code>DATA_DIR/config</Code>:
              </>
            }
            contentClassName="flex flex-col gap-4"
            contentSlot={
              <>
                <CodeBlock content={CONFIG_TREE} />
                <p className="text-sm text-foreground/60">
                  Files are watched for changes automatically. After hand-editing you can also trigger an explicit
                  reload — it re-reads everything from disk and reconciles running servers.
                </p>
                <div>
                  <Button
                    loading={reload.isPending}
                    loadingLabel="Reloading…"
                    onClick={handleReload}
                    iconSlot={<RotateCwIcon />}
                    content="Reload config"
                  />
                </div>
              </>
            }
          />
        </div>
      }
    />
  );
}
