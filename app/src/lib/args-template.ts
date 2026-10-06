/** Prefill the args editor from the tool's input schema: one key per property. */
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
