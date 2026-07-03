import { z } from 'zod';

/**
 * Types for the official MCP registry API
 * (https://registry.modelcontextprotocol.io, OpenAPI at /openapi.yaml,
 * server.json schema 2025-12-11). Parsed leniently: we only model the
 * fields the router consumes.
 */

export const registryKeyValueInputSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    isSecret: z.boolean().optional(),
    default: z.string().optional(),
    placeholder: z.string().optional(),
    choices: z.array(z.string()).nullish(),
    value: z.string().optional(),
    format: z.string().optional(),
  })
  .passthrough();

export const registryArgumentSchema = registryKeyValueInputSchema
  .extend({
    type: z.string().optional(), // 'positional' | 'named'
    valueHint: z.string().optional(),
    isRepeated: z.boolean().optional(),
  })
  .passthrough();

export const registryTransportSchema = z
  .object({
    type: z.string(), // 'stdio' | 'streamable-http' | 'sse'
    url: z.string().optional(),
    headers: z.array(registryKeyValueInputSchema).optional(),
  })
  .passthrough();

export const registryPackageSchema = z
  .object({
    registryType: z.string(), // 'npm' | 'pypi' | 'oci' | 'nuget' | 'mcpb'
    registryBaseUrl: z.string().optional(),
    identifier: z.string(),
    version: z.string().optional(),
    runtimeHint: z.string().optional(), // e.g. 'npx'
    transport: registryTransportSchema.optional(),
    runtimeArguments: z.array(registryArgumentSchema).optional(),
    packageArguments: z.array(registryArgumentSchema).optional(),
    environmentVariables: z.array(registryKeyValueInputSchema).optional(),
  })
  .passthrough();

export const registryRemoteSchema = z
  .object({
    type: z.string(), // 'streamable-http' | 'sse'
    url: z.string(),
    headers: z.array(registryKeyValueInputSchema).optional(),
  })
  .passthrough();

/** The `server` object inside a registry list/detail response. */
export const registryServerSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    websiteUrl: z.string().optional(),
    repository: z.object({ url: z.string().optional(), source: z.string().optional() }).passthrough().optional(),
    packages: z.array(registryPackageSchema).optional(),
    remotes: z.array(registryRemoteSchema).optional(),
  })
  .passthrough();

/** One entry of GET /v0/servers — { server, _meta }. */
export const registryServerEntrySchema = z
  .object({
    server: registryServerSchema,
    _meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const registryListResponseSchema = z
  .object({
    servers: z.array(registryServerEntrySchema),
    metadata: z
      .object({
        nextCursor: z.string().optional(),
        count: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type RegistryKeyValueInput = z.infer<typeof registryKeyValueInputSchema>;
export type RegistryArgument = z.infer<typeof registryArgumentSchema>;
export type RegistryPackage = z.infer<typeof registryPackageSchema>;
export type RegistryRemote = z.infer<typeof registryRemoteSchema>;
export type RegistryServer = z.infer<typeof registryServerSchema>;
export type RegistryServerEntry = z.infer<typeof registryServerEntrySchema>;
export type RegistryListResponse = z.infer<typeof registryListResponseSchema>;
