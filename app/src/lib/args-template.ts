/**
 * Prefills the args editor from a tool's input schema, one key per property.
 *
 * @param inputSchema - The tool's JSON Schema; anything without `properties` counts as taking no arguments.
 * @returns Pretty-printed JSON: each key holds the schema's default, else the empty value of its type. `'{}'` when
 * there are no properties.
 */
export function argsTemplate(inputSchema: unknown): string {
  const properties = (inputSchema as { properties?: Record<string, { type?: string; default?: unknown }> } | undefined)
    ?.properties;
  if (!properties || Object.keys(properties).length === 0) {
    return '{}';
  }
  const template: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    template[key] =
      prop.default ??
      (prop.type === 'number' || prop.type === 'integer'
        ? 0
        : prop.type === 'boolean'
          ? false
          : prop.type === 'array'
            ? []
            : prop.type === 'object'
              ? {}
              : '');
  }
  return JSON.stringify(template, null, 2);
}
