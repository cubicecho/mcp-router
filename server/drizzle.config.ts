import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

const ENV_FILE = '../.env';
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

// Migrations are generated from the tables alone, so no database is needed to write one.
export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  ...(process.env.DATABASE_URL ? { dbCredentials: { url: process.env.DATABASE_URL } } : {}),
});
