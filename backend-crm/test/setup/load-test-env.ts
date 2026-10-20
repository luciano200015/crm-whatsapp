import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const envFile = resolve(__dirname, '../../.env.test');
if (!existsSync(envFile)) {
  throw new Error(
    'Missing .env.test — copy .env.test.example to .env.test and fill in the credentials.',
  );
}

// override: tests must never inherit a dev/prod DATABASE_URL from the shell.
config({ path: envFile, override: true, quiet: true });
process.env.NODE_ENV = 'test';

assertTestDatabase(process.env.DATABASE_URL);

/** Refuse to run destructive test helpers against anything but a *_test database. */
export function assertTestDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL is not set in .env.test');
  const database = new URL(url).pathname.replace(/^\//, '');
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${database}": name must end with "_test".`,
    );
  }
}
