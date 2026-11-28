import type { CodegenConfig } from '@graphql-codegen/cli';

/** Typed documents for the UI, from the schema `server/src/graphql/write-schema.ts` prints. */
const config: CodegenConfig = {
  schema: [
    '../server/__generated__/schema.graphql',
    // TEMPORARY: sign-in and API keys, until the better-auth server branch serves them. Remove with the file.
    './src/auth-contract.graphql',
  ],
  documents: ['./src/**/*.ts', './src/**/*.tsx', '!./src/__generated__/**'],
  ignoreNoDocuments: true,
  generates: {
    'src/__generated__/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      config: {
        avoidOptionals: { field: true },
        useTypeImports: true,
        defaultScalarType: 'unknown',
        skipTypeNameForRoot: true,
        // Enums as `as const` objects, since Biome forbids TS enums. Their keys read as the shared constants did.
        enumType: 'const',
        // ISO strings on the wire. Parsing into Date invites timezone bugs.
        scalars: { DateTime: 'string', UUID: 'string', JSON: 'unknown' },
      },
    },
    // The stories answer each operation by running it against this copy, imported with `?raw`: a story runs in a
    // browser, where `../server/…` is not a path Vite serves.
    'src/__generated__/schema.graphql': { plugins: ['schema-ast'] },
  },
};

export default config;
