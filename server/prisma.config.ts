import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env by itself; real environment variables win.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Placeholder lets `prisma generate` run without a database (CI, postinstall).
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder@localhost:5432/placeholder',
  },
});
