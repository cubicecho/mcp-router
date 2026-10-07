import type { ServerResource, ServerResourceTemplate } from '@mcp-router/shared';
import { InputField, useAppForm } from '@/components/app-form';
import { EmptyState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { type CapabilityScope, SCOPE_WORKSPACE } from '@/lib/api';
import { useCapabilityResources, useReadResource } from '@/lib/queries';
import { CapabilityList, CapabilityRow, ResultBlock, RUN_SUBMIT, RunForm, useCapabilityRun } from './list.tsx';

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

/**
 * Collapsible row for one resource or template, with an editable URI and a Read button.
 *
 * @param props.scope - The server or workspace the resource is read through.
 * @param props.data - What the row shows and what its URI field starts with.
 * @returns The row.
 */
function ResourceRow({ scope, data }: { scope: CapabilityScope; data: ResourceRowData }) {
  const read = useReadResource(scope);
  const { result, run } = useCapabilityRun(read);
  const form = useAppForm({
    defaultValues: { uri: data.uri },
    onSubmit: ({ value }) => run({ uri: value.uri.trim() }),
  });

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
          <RunForm
            onSubmit={form.handleSubmit}
            contentSlot={
              <>
                <InputField
                  form={form}
                  name="uri"
                  label="URI"
                  description={data.isTemplate ? 'Replace the {placeholders} with concrete values.' : undefined}
                  className="[&_input]:font-mono"
                  validators={{
                    onChange: ({ value }) => (value.trim().length === 0 ? 'A URI is required' : undefined),
                  }}
                />
                <form.AppForm>
                  <form.SubmitButton {...RUN_SUBMIT} content="Read" pendingLabel="Reading…" />
                </form.AppForm>
              </>
            }
          />
          {result && <ResultBlock result={result} />}
        </>
      }
    />
  );
}

/**
 * Turns a concrete resource into row data.
 *
 * @param resource - The resource as the server listed it.
 * @returns The row data, labelled by the resource's name, or its URI when it has none.
 */
function toRow(resource: ServerResource): ResourceRowData {
  return {
    label: resource.name ?? resource.uri,
    uri: resource.uri,
    isTemplate: false,
    description: resource.description,
    mimeType: resource.mimeType,
  };
}

/**
 * Turns a resource template into row data.
 *
 * @param template - The template as the server listed it.
 * @returns The row data, flagged as a template and labelled by its name, or its URI template when it has none.
 */
function templateToRow(template: ServerResourceTemplate): ResourceRowData {
  return {
    label: template.name ?? template.uriTemplate,
    uri: template.uriTemplate,
    isTemplate: true,
    description: template.description,
    mimeType: template.mimeType,
  };
}

/**
 * Card listing the resources of a server or workspace, concrete ones first and templates after.
 *
 * @param props.scope - The server or workspace whose resources are listed.
 * @returns The card.
 */
export function ResourcesCard({ scope }: { scope: CapabilityScope }) {
  const query = useCapabilityResources(scope);
  const { data } = query;
  const rows = [...(data?.resources ?? []).map(toRow), ...(data?.resourceTemplates ?? []).map(templateToRow)];
  const description =
    scope.kind === SCOPE_WORKSPACE
      ? 'Resources and resource templates exposed by the workspace aggregate, `<server>__`-namespaced. Expand one to read it — reads show up in the Activity tab.'
      : 'Resources and resource templates exposed by the downstream server. Expand one to read it — reads show up in the Activity tab.';

  return (
    <CapabilityList
      title="Resources"
      description={description}
      query={query}
      what="resources"
      emptySlot={<EmptyState compact title="No resources reported." />}
      contentSlot={rows.map((row) => (
        <ResourceRow key={`${row.isTemplate ? 'tpl' : 'res'}:${row.uri}`} scope={scope} data={row} />
      ))}
    />
  );
}
