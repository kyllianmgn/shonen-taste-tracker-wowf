import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { assertIsTestDatabase, TEST_DATABASE_URL } from './test-database';

/** Recreates the test database from the versioned migrations before the e2e run. */
export default function globalSetup(): void {
  assertIsTestDatabase(TEST_DATABASE_URL);
  execSync('npx prisma migrate reset --force', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
