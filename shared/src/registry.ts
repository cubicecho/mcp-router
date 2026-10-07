import { z } from 'zod';

/**
 * Types for the official MCP registry API
 * (https://registry.modelcontextprotocol.io, OpenAPI at /openapi.yaml,
 * server.json schema 2025-12-11). Parsed leniently: we only model the
 * fields the router consumes.
 */

/** A named input a registry entry declares: an env var or a header. */
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
  .loose();

/** A command-line argument a registry package declares, positional or named. */
export const registryArgumentSchema = registryKeyValueInputSchema
  .extend({
    // Positional arguments carry no `name` (they use `value`/`valueHint`);
    // only named arguments do — so relax the inherited required `name`.
    name: z.string().optional(),
    type: z.string().optional(), // 'positional' | 'named'
    valueHint: z.string().optional(),
    isRepeated: z.boolean().optional(),
  })
  .loose();

/** The transport a registry package says it speaks. */
export const registryTransportSchema = z
  .object({
    type: z.string(), // 'stdio' | 'streamable-http' | 'sse'
    url: z.string().optional(),
    headers: z.array(registryKeyValueInputSchema).optional(),
  })
  .loose();

/** One installable package of a registry entry. */
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
  .loose();

/** One hosted endpoint of a registry entry, proxied to rather than installed. */
export const registryRemoteSchema = z
  .object({
    type: z.string(), // 'streamable-http' | 'sse'
    url: z.string(),
    headers: z.array(registryKeyValueInputSchema).optional(),
  })
  .loose();

/** The `server` object inside a registry list/detail response. */
export const registryServerSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    websiteUrl: z.string().optional(),
    repository: z.object({ url: z.string().optional(), source: z.string().optional() }).loose().optional(),
    packages: z.array(registryPackageSchema).optional(),
    remotes: z.array(registryRemoteSchema).optional(),
  })
  .loose();

/** One entry of GET /v0/servers — { server, _meta }. */
export const registryServerEntrySchema = z
  .object({
    server: registryServerSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

/** A page of `GET /v0/servers`; `metadata.nextCursor` asks for the page after it. */
export const registryListResponseSchema = z
  .object({
    servers: z.array(registryServerEntrySchema),
    metadata: z
      .object({
        nextCursor: z.string().optional(),
        count: z.number().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/** An env var or header a registry entry declares. */
export type RegistryKeyValueInput = z.infer<typeof registryKeyValueInputSchema>;
/** A command-line argument a registry package declares. */
export type RegistryArgument = z.infer<typeof registryArgumentSchema>;
/** One installable package of a registry entry. */
export type RegistryPackage = z.infer<typeof registryPackageSchema>;
/** One hosted endpoint of a registry entry. */
export type RegistryRemote = z.infer<typeof registryRemoteSchema>;
/** A registry entry's `server` object. */
export type RegistryServer = z.infer<typeof registryServerSchema>;
/** One entry of a registry's server list. */
export type RegistryServerEntry = z.infer<typeof registryServerEntrySchema>;
/** A page of a registry's server list. */
export type RegistryListResponse = z.infer<typeof registryListResponseSchema>;
