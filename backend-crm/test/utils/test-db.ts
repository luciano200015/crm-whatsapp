import { PrismaPg } from '@prisma/adapter-pg';
import { createConnection, type Connection } from 'mongoose';
import { PrismaClient } from '../../src/generated/prisma/client';
import { assertTestDatabase } from '../setup/load-test-env';

export function createTestPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  assertTestDatabase(url);
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
}

/** Empties every application table in the (verified) test database. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables
    .map(({ tablename }) => `"public"."${tablename}"`)
    .join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

/** Extracts the Prisma/Postgres error code from a rejected query. */
export async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return String(error.code);
    }
    throw error;
  }
  throw new Error('Expected the query to fail, but it succeeded');
}

/** Mongoose connection to the (verified) test MongoDB database. */
export async function createTestMongo(): Promise<Connection> {
  const url = process.env.MONGODB_URI;
  assertTestDatabase(url, 'MONGODB_URI');
  return createConnection(url ?? '').asPromise();
}

/**
 * Empties every collection of the test MongoDB database. Uses the native
 * driver on purpose: the workspaceScoped plugin refuses unfiltered deletes.
 */
export async function clearMongo(connection: Connection): Promise<void> {
  assertTestDatabase(process.env.MONGODB_URI, 'MONGODB_URI');
  const db = connection.db;
  if (!db) throw new Error('MongoDB connection is not open');
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  await Promise.all(
    collections.map(({ name }) => db.collection(name).deleteMany({})),
  );
}
