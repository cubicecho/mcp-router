import type { ResourceReadResponse } from '@mcp-router/shared';
import { ChevronRightIcon, Loader2Icon, PlayIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ServerResource, ServerResourceTemplate } from '@/lib/api';
import { useReadServerResource, useServerResources } from '@/lib/queries';
import { toastApiError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { CapabilityList, ResultBlock } from './capability-list';

/** A resource (concrete URI) or a template (an RFC 6570 URI to fill in). */
interface ResourceRowData {
  label: string;
  /** Prefill for the URI field: the concrete URI, or the template to edit. */
  uri: string;
  /** True when `uri` is a template with `{placeholders}` to replace before reading. */
  isTemplate: boolean;
  description?: string;
  mimeType?: string;
}

function ResourceRow({ serverName, data }: { serverName: string; data: ResourceRowData }) {
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState(data.uri);
  const [result, setResult] = useState<ResourceReadResponse | null>(null);
  const read = useReadServerResource(serverName);

  const run = () => {
    setResult(null);
    read.mutate({ uri: uri.trim() }, { onSuccess: setResult, onError: toastApiError });
  };

  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left">
        <ChevronRightIcon
          className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-sm">{data.label}</span>
            {data.isTemplate && <span className="text-xs text-muted-foreground">template</span>}
            {data.mimeType && <span className="text-xs text-muted-foreground">{data.mimeType}</span>}
          </span>
          {data.label !== data.uri && (
            <span className="block font-mono text-xs break-all text-muted-foreground">{data.uri}</span>
          )}
          {data.description && <p className="text-sm text-muted-foreground">{data.description}</p>}
        </span>
      </button>
      {open && (
        <div className="mt-2 ml-6 flex flex-col gap-2">
          <Input
            value={uri}
            className="font-mono text-xs"
            aria-label={`URI to read for ${data.label}`}
            onChange={(event) => setUri(event.target.value)}
          />
          {data.isTemplate && (
            <p className="text-xs text-muted-foreground">Replace the {'{placeholders}'} with concrete values.</p>
          )}
          <div>
            <Button size="sm" variant="outline" disabled={read.isPending || uri.trim().length === 0} onClick={run}>
              {read.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Read
            </Button>
          </div>
          {result && <ResultBlock result={result} />}
        </div>
      )}
    </li>
  );
}

function toRow(resource: ServerResource): ResourceRowData {
  return {
    label: resource.name ?? resource.uri,
    uri: resource.uri,
    isTemplate: false,
    description: resource.description,
    mimeType: resource.mimeType,
  };
}

function templateToRow(template: ServerResourceTemplate): ResourceRowData {
  return {
    label: template.name ?? template.uriTemplate,
    uri: template.uriTemplate,
    isTemplate: true,
    description: template.description,
    mimeType: template.mimeType,
  };
}

export function ResourcesCard({ name }: { name: string }) {
  const { data, isPending, error, refetch, isRefetching } = useServerResources(name);
  const rows = [...(data?.resources ?? []).map(toRow), ...(data?.resourceTemplates ?? []).map(templateToRow)];

  return (
    <CapabilityList
      title="Resources"
      description="Resources and resource templates exposed by the downstream server. Expand one to read it — reads show up in the Activity tab."
      isPending={isPending}
      error={error}
      isRefetching={isRefetching}
      refetch={refetch}
      errorVerb="list resources"
      count={rows.length}
      emptyText="No resources reported."
    >
      {rows.map((row) => (
        <ResourceRow key={`${row.isTemplate ? 'tpl' : 'res'}:${row.uri}`} serverName={name} data={row} />
      ))}
    </CapabilityList>
  );
}
