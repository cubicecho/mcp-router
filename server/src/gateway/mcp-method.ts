/** The MCP request methods the router proxies, as they are named on the wire and in the activity log. */
export const McpMethod = {
  ToolsList: 'tools/list',
  ToolsCall: 'tools/call',
  ResourcesList: 'resources/list',
  ResourceTemplatesList: 'resources/templates/list',
  ResourcesRead: 'resources/read',
  ResourcesSubscribe: 'resources/subscribe',
  ResourcesUnsubscribe: 'resources/unsubscribe',
  PromptsList: 'prompts/list',
  PromptsGet: 'prompts/get',
  CompletionComplete: 'completion/complete',
  LoggingSetLevel: 'logging/setLevel',
} as const;
export type McpMethod = (typeof McpMethod)[keyof typeof McpMethod];
