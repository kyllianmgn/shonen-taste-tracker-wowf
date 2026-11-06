/** Postgres 23505 (unique violation), whichever way Prisma or the pg adapter reports it. */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2002' || code === '23505') return true;
  let details = '';
  try {
    details = JSON.stringify(error, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    // Unserializable error: fall back to its message.
  }
  return /23505|unique constraint/i.test(`${error.message} ${details}`);
}

/** Runs `run` again when it lost a race on a unique index, at most `maxAttempts` times in all. */
export async function retryOnUniqueViolation<T>(run: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxAttempts || !isUniqueViolation(error)) throw error;
    }
  }
}
