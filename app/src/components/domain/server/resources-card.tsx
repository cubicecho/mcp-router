import type { ServerResource, ServerResourceTemplate } from '@mcp-router/shared';
import { useState } from 'react';
import { FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { CapabilityScope } from '@/lib/api';
import { useCapabilityResources, useReadResource } from '@/lib/queries';
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

function ResourceRow({ scope, data }: { scope: CapabilityScope; data: ResourceRowData }) {
  const [uri, setUri] = useState(data.uri);
  const read = useReadResource(scope);
  const { result, run, pending } = useCapabilityRun(read);

  return (
    <CapabilityRow
      title={data.label}
      meta={
        <>
          {data.isTemplate && <Badge variant="outline">template</Badge>}
          {data.mimeType && <Badge variant="secondary">{data.mimeType}</Badge>}
        </>
      }
      description={
        data.label !== data.uri || data.description ? (
          <>
            {data.label !== data.uri && <span className="block break-all font-mono text-xs">{data.uri}</span>}
            {data.description}
          </>
        ) : undefined
      }
      contentSlot={
        <>
          <FormField
            label="URI"
            description={data.isTemplate ? 'Replace the {placeholders} with concrete values.' : undefined}
            controlSlot={<Input value={uri} className="font-mono" onChange={(event) => setUri(event.target.value)} />}
          />
          <RunButton
            label="Read"
            pending={pending}
            disabled={uri.trim().length === 0}
            onClick={() => run({ uri: uri.trim() })}
          />
          {result && <ResultBlock result={result} />}
        </>
      }
    />
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

export function ResourcesCard({ scope }: { scope: CapabilityScope }) {
  const { data, isPending, error, refetch } = useCapabilityResources(scope);
  const rows = [...(data?.resources ?? []).map(toRow), ...(data?.resourceTemplates ?? []).map(templateToRow)];
  const description =
    scope.kind === 'workspace'
      ? 'Resources and resource templates exposed by the workspace aggregate, `<server>__`-namespaced. Expand one to read it — reads show up in the Activity tab.'
      : 'Resources and resource templates exposed by the downstream server. Expand one to read it — reads show up in the Activity tab.';

  return (
    <CapabilityList
      title="Resources"
      description={description}
      isPending={isPending}
      error={error}
      refetch={refetch}
      what="resources"
      emptyText="No resources reported."
      rowsSlot={rows.map((row) => (
        <ResourceRow key={`${row.isTemplate ? 'tpl' : 'res'}:${row.uri}`} scope={scope} data={row} />
      ))}
    />
  );
}
