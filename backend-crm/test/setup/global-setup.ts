// globalSetup runs outside the test environment, so .env.test is loaded here too.
import './load-test-env';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Applies pending migrations to the test database once per test run. */
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
}
