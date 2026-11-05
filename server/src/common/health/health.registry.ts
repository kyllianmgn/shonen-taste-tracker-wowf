import { Injectable } from '@nestjs/common';

export type HealthCheck = () => boolean | Promise<boolean>;

/** Checks other modules add to `GET /health` (e.g. the Discord connection), without CommonModule importing them. */
@Injectable()
export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  register(name: string, check: HealthCheck): void {
    if (name === 'status' || name === 'database' || this.checks.has(name)) {
      throw new Error(`Health check "${name}" is already registered`);
    }
    this.checks.set(name, check);
  }

  /** Runs every check; a check that throws counts as down. */
  async run(): Promise<Record<string, boolean>> {
    const entries = await Promise.all(
      [...this.checks].map(async ([name, check]) => {
        try {
          return [name, await check()] as const;
        } catch {
          return [name, false] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
