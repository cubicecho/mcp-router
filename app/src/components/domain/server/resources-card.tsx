import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { ServerResource, ServerResourceTemplate } from '@/lib/api';
import { useReadServerResource, useServerResources } from '@/lib/queries';
import { CapabilityList, CapabilityRow, ResultBlock, RunButton, useCapabilityRun } from './capability-list';

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
  const [uri, setUri] = useState(data.uri);
  const read = useReadServerResource(serverName);
  const { result, run, pending } = useCapabilityRun(read);

  return (
    <CapabilityRow
      header={
        <>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-sm">{data.label}</span>
            {data.isTemplate && <span className="text-xs text-muted-foreground">template</span>}
            {data.mimeType && <span className="text-xs text-muted-foreground">{data.mimeType}</span>}
          </span>
          {data.label !== data.uri && (
            <span className="block font-mono text-xs break-all text-muted-foreground">{data.uri}</span>
          )}
          {data.description && <p className="text-sm text-muted-foreground">{data.description}</p>}
        </>
      }
    >
      <Input
        value={uri}
        className="font-mono text-xs"
        aria-label={`URI to read for ${data.label}`}
        onChange={(event) => setUri(event.target.value)}
      />
      {data.isTemplate && (
        <p className="text-xs text-muted-foreground">Replace the {'{placeholders}'} with concrete values.</p>
      )}
      <RunButton
        label="Read"
        pending={pending}
        disabled={uri.trim().length === 0}
        onClick={() => run({ uri: uri.trim() })}
      />
      {result && <ResultBlock result={result} />}
    </CapabilityRow>
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
