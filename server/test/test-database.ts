/** Test database URL. Defaults to a dedicated database on the dev Postgres (docker-compose.dev.yml). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://forever:forever@localhost:5432/forever_test';

/** Guard against wiping a real database: the name must end with `_test`. */
export function assertIsTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use database "${name}" for tests: its name must end with "_test".`);
  }
}
