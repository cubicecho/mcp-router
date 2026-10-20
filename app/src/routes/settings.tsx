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

/** The `/settings` route. */
export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const CONFIG_TREE = `config/
├── settings.json        # port, auth token, auth enabled, idle timeout
├── registries.json      # { registries: [{ name, url }] }
└── servers/
    └── <name>.json      # one file per installed server`;

/**
 * Inline editor for the default idle timeout, entered in minutes.
 *
 * @param props.currentMs - The stored timeout, in ms.
 * @returns The form; Save is enabled only for a positive number that differs from the stored timeout.
 */
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

/**
 * Checks that typed text is blank or an http(s) URL.
 *
 * @param text - The typed address.
 * @returns Whether it can be saved.
 */
function isPublicUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  try {
    return ['http:', 'https:'].includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * Inline editor for the router's public address, the one a remote server's login sends the browser back to.
 *
 * @param props.current - The stored address; undefined when unset.
 * @returns The form; Save is enabled only for a blank or valid URL that differs from the stored one. Blank clears it.
 */
function PublicUrlEditor({ current }: { current?: string }) {
  const update = useUpdateSettings();
  const form = useAppForm({
    defaultValues: { url: current ?? '' },
    onSubmit: async ({ value }) => {
      const url = value.url.trim().replace(/\/+$/, '');
      try {
        await update.mutateAsync({ publicUrl: url || null });
        toast.success(url ? 'Public URL saved' : 'Public URL cleared');
      } catch (error) {
        toastApiError(error);
      }
    },
  });
  /** The typed address is valid and differs from the stored one. */
  const isChanged = (text: string) => isPublicUrl(text) && text.trim().replace(/\/+$/, '') !== (current ?? '');

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="url">
        {(field) => (
          <Input
            value={field.state.value}
            inputMode="url"
            placeholder={window.location.origin}
            aria-label="Public URL"
            aria-invalid={isPublicUrl(field.state.value) === false}
            className="h-8 w-64"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => isChanged(state.values.url)}>
        {(changed) => (
          <form.AppForm>
            <form.SubmitButton
              size="sm"
              variant="outline"
              disabled={changed === false}
              aria-label="Save public URL"
              content="Save"
            />
          </form.AppForm>
        )}
      </form.Subscribe>
    </form>
  );
}

/**
 * The Settings page: router status, the idle timeout and the config-file layout with a reload button.
 *
 * @returns The page.
 */
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
                    <SettingRow
                      title="Public URL"
                      description="The address a remote server's login sends you back to after you sign in, and that it fetches MCP Router's client details from. Leave it blank to use the address this page is open at; set it when the router sits behind a proxy or is reached by another name."
                      actionSlot={<PublicUrlEditor key={data.publicUrl ?? ''} current={data.publicUrl} />}
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
