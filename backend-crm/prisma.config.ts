import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads the datasource URL from schema.prisma.
// `prisma generate` does not need a database, so an empty URL is tolerated here;
// commands that connect (migrate, seed) fail fast if DATABASE_URL is missing.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
